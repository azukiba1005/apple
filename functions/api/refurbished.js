// Cloudflare Pages Function: /api/refurbished
// Apple公式の整備済製品ページ（mac / ipad / iphone / watch / airpods）の HTML 内
// window.REFURB_GRID_BOOTSTRAP JSON を第一優先で抽出し、フォールバックとして
// Refurb Tracker の日本向け RSS（jp_mac.xml 等）を併用して「現在の実在庫」を返す。
// 取得結果は site 内の products.json と名寄せ（モデル・SKUマッチ）済みで返却し、
// Cache API (caches.default) で 15 分間（s-maxage=900）エッジキャッシュする。
import {
  APPLE_REFURBISHED_PAGES,
  REFURB_TRACKER_FEEDS,
  parseAppleRefurbishedHtml,
  parseRefurbTrackerRssXml,
  matchAndEnrichRefurbishedItem,
} from '../../scripts/fetch-refurbished.mjs';

const CACHE_TTL_SECONDS = 900;
const FETCH_TIMEOUT_MS = 8000;
const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,application/rss+xml,*/*;q=0.8',
  'Accept-Language': 'ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7',
};

async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: BROWSER_HEADERS });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

async function loadProducts(context) {
  const target = new URL('/products.json', context.request.url);
  try {
    const res = context.env?.ASSETS
      ? await context.env.ASSETS.fetch(new Request(target))
      : await fetch(target);
    if (!res.ok) return [];
    const raw = await res.json();
    return Array.isArray(raw) ? raw : (raw.products ?? []);
  } catch {
    return [];
  }
}

function json(body, status, cacheStatus) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': status === 200 ? `public, max-age=60, s-maxage=${CACHE_TTL_SECONDS}` : 'no-store',
      'Access-Control-Allow-Origin': '*',
      'X-Cache': cacheStatus,
    },
  });
}

export async function onRequestGet(context) {
  const cache = typeof caches !== 'undefined' ? caches.default : null;
  const cacheKey = new Request('https://cache.apple-price-atlas.internal/api/refurbished/jp');

  if (cache) {
    try {
      const hit = await cache.match(cacheKey);
      if (hit) {
        const res = new Response(hit.body, hit);
        res.headers.set('X-Cache', 'HIT');
        return res;
      }
    } catch {
      /* ignore */
    }
  }

  const appleItems = [];
  const rssItems = [];
  let appleOk = false;
  let rssOk = false;

  // 1) 第一優先: Apple公式ページの REFURB_GRID_BOOTSTRAP
  await Promise.all(
    APPLE_REFURBISHED_PAGES.map(async ({ category, url }) => {
      try {
        const parsed = parseAppleRefurbishedHtml(await fetchText(url), category);
        if (parsed.length) {
          appleOk = true;
          appleItems.push(...parsed);
        }
      } catch {
        /* 次のソースへフォールバック */
      }
    }),
  );

  // 2) フォールバック併用: Refurb Tracker JP RSS（Apple公式で取得できなかったカテゴリを補完）
  const coveredCategories = new Set(appleItems.map((i) => i.category));
  await Promise.all(
    REFURB_TRACKER_FEEDS.filter((f) => !coveredCategories.has(f.category) || !appleOk).map(async ({ category, url }) => {
      try {
        const parsed = parseRefurbTrackerRssXml(await fetchText(url), category);
        if (parsed.length) {
          rssOk = true;
          rssItems.push(...parsed);
        }
      } catch {
        /* ignore */
      }
    }),
  );

  const rawItems = [...appleItems, ...rssItems];
  if (rawItems.length === 0) {
    // 取得失敗はキャッシュせず、クライアントに静的JSONへのフォールバックを促す
    return json({ error: 'no live refurbished data available' }, 502, 'MISS');
  }

  const products = await loadProducts(context);
  const enrichedMap = new Map();
  for (const raw of rawItems) {
    const enriched = matchAndEnrichRefurbishedItem({ ...raw, isLiveStock: true, stockStatus: 'Live' }, products);
    if (!enriched) continue;
    const key = `${enriched.productId}:${enriched.skuId}`;
    const prev = enrichedMap.get(key);
    if (!prev || enriched.refurbishedPrice < prev.refurbishedPrice) enrichedMap.set(key, enriched);
  }
  const items = [...enrichedMap.values()].sort((a, b) => a.refurbishedPrice - b.refurbishedPrice);

  const body = {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    sources: {
      appleOfficialWeb: appleOk ? 'live' : 'fallback',
      refurbTrackerRss: rssOk ? 'live' : 'fallback',
      liveCount: items.length,
      referenceCount: 0,
      totalCount: items.length,
    },
    items,
  };

  const response = json(body, 200, 'MISS');
  if (cache) {
    const put = cache.put(cacheKey, response.clone());
    if (typeof context.waitUntil === 'function') context.waitUntil(put);
    else await put;
  }
  return response;
}

