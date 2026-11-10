// Cloudflare Pages Function: /api/used-price
// 楽天市場API / Yahoo!ショッピングAPI から該当機種・容量の出品リストをリアルタイム取得し、
// 状態ランク・SIMフリー判定済みの offers（安い順・最大15件）を返す。
// 楽天APIの「1秒1リクエスト」制限対策として、正規化した「機種ID＋容量」単位で
// Cache API (caches.default) に 10 分間（s-maxage=600）エッジキャッシュする。
import { searchRakutenUsedPrice } from '../../scripts/fetch-live-prices.mjs';

const CACHE_TTL_SECONDS = 600;
const RAKUTEN_GAP_MS = 1100;

/** 機種ID＋容量を正規化（大文字小文字・空白・全角半角の揺れを吸収） */
function normalizeKeyPart(v) {
  return String(v ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[^a-z0-9\u3040-\u30ff\u4e00-\u9fff\-_.]/g, '');
}

function jsonResponse(body, status, cacheStatus) {
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
  const { request, env } = context;
  const url = new URL(request.url);
  const productId = url.searchParams.get('productId') || '';
  const productName = url.searchParams.get('productName') || '';
  const storage = url.searchParams.get('storage') || '';
  const category = url.searchParams.get('category') || 'iPhone';
  const launchPrice = Number(url.searchParams.get('launchPrice') || 0) || 0;
  const releaseDate = url.searchParams.get('releaseDate') || '';

  if (!productName && !productId) {
    return jsonResponse({ error: 'productName or productId is required' }, 400, 'BYPASS');
  }

  // キャッシュキーは「機種ID＋容量」のみ（クエリ順序や余分なパラメータの影響を受けない）
  const keyId = normalizeKeyPart(productId || productName);
  const keyStorage = normalizeKeyPart(storage);
  const cacheKey = new Request(`https://cache.apple-price-atlas.internal/api/used-price/${encodeURIComponent(keyId)}/${encodeURIComponent(keyStorage)}`);
  const cache = typeof caches !== 'undefined' ? caches.default : null;

  if (cache) {
    try {
      const hit = await cache.match(cacheKey);
      if (hit) {
        const res = new Response(hit.body, hit);
        res.headers.set('X-Cache', 'HIT');
        return res;
      }
    } catch {
      /* キャッシュ取得失敗時はそのまま実取得へ */
    }
  }

  let data;
  try {
    data = await searchRakutenUsedPrice({
      productName: productName || productId,
      storage,
      category,
      launchPrice: launchPrice || 98800,
      releaseDate: releaseDate || '2023-09-22',
      appId: String(env?.RAKUTEN_APP_ID ?? '').trim(),
      affiliateId: String(env?.RAKUTEN_AFFILIATE_ID ?? '').trim(),
      accessKey: String(env?.RAKUTEN_ACCESS_KEY ?? '').trim(),
      yahooAppId: String(env?.YAHOO_APP_ID ?? '').trim(),
      rakutenGapMs: RAKUTEN_GAP_MS,
    });
  } catch (err) {
    return jsonResponse({ error: String(err?.message ?? err) }, 502, 'MISS');
  }

  // 安い順・最大15件に整形（searchRakutenUsedPrice 側で除外・ランク/SIMフリー判定済み）
  const offers = (Array.isArray(data.offers) ? data.offers : [])
    .filter((o) => o && Number(o.price) > 0)
    .sort((a, b) => a.price - b.price)
    .slice(0, 15);
  const body = { ...data, offers, cachedAt: new Date().toISOString() };
  if (body.usedPricing) body.usedPricing = { ...body.usedPricing, offers };

  const response = jsonResponse(body, 200, 'MISS');

  if (cache) {
    const put = cache.put(cacheKey, response.clone());
    if (typeof context.waitUntil === 'function') context.waitUntil(put);
    else await put;
  }
  return response;
}
