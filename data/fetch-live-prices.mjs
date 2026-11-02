/**
 * 4大キャリア最新端末価格 ＆ 楽天市場・Yahoo!ショッピング中古最安値 自動収集スクリプト
 * 出力先: data/prices/live-prices-cache.json
 *
 * 1. 楽天モバイル（新品キャリア価格）の確実な取得:
 *    - 楽天商品検索APIで `shopCode=rakutenmobile` を指定し、現行のiPhone・iPad・Apple Watchの
 *      「楽天モバイル公式 楽天市場店」における新品一括価格と商品URLを取得
 * 2. docomo / au / SoftBank のキャリア価格取得（Playwright + フォールバック設計）:
 *    - Playwright (Chromium) を使用し、各キャリアの公式オンラインショップ価格一覧ページから
 *      「通常一括価格」と「2年返却プログラム適用時の実質負担額」の取得を試行
 *    - HTML構造変更やWAFブロック等で取得できなかった項目はエラーで止めず既存マスターデータを維持
 * 3. 楽天市場 ＆ Yahoo!ショッピングの中古最安値取得:
 *    - 厳密タイトル検証 (`isValidProductTitle`) ＋ 大手中古ショップ優先ロジック (`isTrustedShop`)
 *    - アフィリエイトURL変換（楽天アフィリエイト / Yahoo! バリューコマース・もしも）を適用
 *    - APIのレートリミット回避のため 1リクエストごとに `1200ms` のウェイトを挿入
 */
import { readFileSync, readdirSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  RAKUTEN_API_ENDPOINT,
  RAKUTEN_OPENAPI_ENDPOINT,
  YAHOO_API_ENDPOINT,
  RAKUTEN_NG_KEYWORD,
  isValidProductTitle,
  isTrustedShop,
  cleanSearchProductName,
  extractStorageToken,
  calcMinPrice,
  callRakutenIchibaSearch,
  isRakutenApiDisabled,
  fetchFromRakutenApi,
  fetchFromYahooApi,
  estimatePlatformOffers,
  buildUsedPricingObject,
  toRakutenAffiliateUrl,
  toYahooAffiliateUrl,
} from './fetch-used-prices.mjs';

// ローカルの .env があれば自動で読み込む
if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '').trim();
    }
  }
}

export const LIVE_CACHE_PATH = 'data/prices/live-prices-cache.json';
export const API_WAIT_MS = 1200;
const TODAY = new Date().toISOString().slice(0, 10);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* ---------- キャリア公式価格ページURL定義 ---------- */
export const CARRIER_PRICE_URLS = {
  docomo: {
    iPhone: 'https://onlineshop.smt.docomo.ne.jp/products/iphone/index.html',
    iPad: 'https://onlineshop.smt.docomo.ne.jp/products/ipad/index.html',
    'Apple Watch': 'https://onlineshop.smt.docomo.ne.jp/products/apple_watch/index.html',
  },
  au: {
    iPhone: 'https://www.au.com/iphone/',
    iPad: 'https://www.au.com/ipad/',
    'Apple Watch': 'https://www.au.com/apple-watch/',
  },
  softbank: {
    iPhone: 'https://www.softbank.jp/iphone/',
    iPad: 'https://www.softbank.jp/ipad/',
    'Apple Watch': 'https://www.softbank.jp/mobile/apple-watch/',
  },
};

const CARRIER_PROGRAM_DEFAULT = {
  docomo: { name: 'いつでもカエドキプログラム', months: 23, residualRatio: 0.42, mnpDiscount: 22000 },
  au: { name: 'スマホトクするプログラム', months: 24, residualRatio: 0.5, mnpDiscount: 22000 },
  softbank: { name: '新トクするサポート', months: 24, residualRatio: 0.5, mnpDiscount: 21600 },
  rakuten: { name: '楽天モバイル買い替え超トクプログラム', months: 24, residualRatio: 0.5, mnpDiscount: 20000 },
};

const CARRIER_MULTIPLIER_DEFAULT = {
  iPhone: { docomo: 1.19, au: 1.17, softbank: 1.18, rakuten: 1.02 },
  iPad: { docomo: 1.12, au: 1.1, softbank: 1.1, rakuten: 1.0 },
  'Apple Watch': { docomo: 1.1, au: 1.08, softbank: 1.08, rakuten: 1.0 },
};

const round10 = (n) => Math.round(n / 10) * 10;

/**
 * 既存のマスターデータ（`data/prices/*.json`, `data/detail/*.json`, `public/products.json`, 既存キャッシュ）を統合して
 * 安全なフォールバック用ベースラインを構築する
 */
export function loadMasterBaseline() {
  const masterProducts = new Map();

  // 1) data/prices/*.json から Apple Store 価格履歴を読み込む
  const priceResearchByFamily = new Map();
  if (existsSync('data/prices')) {
    for (const f of readdirSync('data/prices').filter((f) => f.endsWith('.json') && f !== 'live-prices-cache.json')) {
      try {
        const ds = JSON.parse(readFileSync(`data/prices/${f}`, 'utf8'));
        for (const [fam, entry] of Object.entries(ds.families ?? {})) {
          priceResearchByFamily.set(fam, entry);
        }
      } catch {
        /* ignore invalid json */
      }
    }
  }

  // 2) public/products.json があれば全製品・SKU構造を読み込む
  if (existsSync('public/products.json')) {
    try {
      const pub = JSON.parse(readFileSync('public/products.json', 'utf8'));
      for (const p of pub.products ?? []) {
        masterProducts.set(p.id, structuredClone(p));
      }
    } catch {
      /* ignore */
    }
  }

  // 3) data/detail/*.json の詳細データ（キャリア価格マスター）を読み込んで補完
  if (existsSync('data/detail')) {
    for (const f of readdirSync('data/detail').filter((f) => f.endsWith('.json'))) {
      try {
        const ds = JSON.parse(readFileSync(`data/detail/${f}`, 'utf8'));
        for (const d of ds.products ?? []) {
          const existing = masterProducts.get(d.id);
          if (!existing) {
            masterProducts.set(d.id, { ...structuredClone(d), detail: true });
          } else {
            existing.detail = true;
            for (const dSku of d.skus ?? []) {
              const targetSku = existing.skus?.find(
                (s) =>
                  s.id === dSku.id ||
                  (s.storage === dSku.storage &&
                    (s.connectivity === dSku.connectivity || !dSku.connectivity || dSku.connectivity === '-')),
              );
              if (targetSku && (!targetSku.carriers || Object.keys(targetSku.carriers).length === 0)) {
                targetSku.carriers = structuredClone(dSku.carriers ?? {});
              }
            }
          }
        }
      } catch {
        /* ignore */
      }
    }
  }

  // 4) 既存の live-prices-cache.json があればフォールバックソースとして保持
  let previousCache = null;
  if (existsSync(LIVE_CACHE_PATH)) {
    try {
      previousCache = JSON.parse(readFileSync(LIVE_CACHE_PATH, 'utf8'));
    } catch {
      previousCache = null;
    }
  }

  return { masterProducts, priceResearchByFamily, previousCache };
}

/**
 * 自動価格収集の対象となる主要・現行モデルを抽出する
 * - detail: true の全モデル
 * - 2022年以降発売の現行・主要 iPhone / iPad / Apple Watch / Mac モデル
 */
export function selectTargetProducts(masterProducts) {
  const TARGET_IDS = new Set([
    'iphone-13-mini',
    'iphone-13',
    'iphone-13-pro',
    'iphone-13-pro-max',
    'iphone-14',
    'iphone-14-plus',
    'iphone-14-pro',
    'iphone-14-pro-max',
    'iphone-15',
    'iphone-15-plus',
    'iphone-15-pro',
    'iphone-15-pro-max',
    'iphone-16',
    'iphone-16-plus',
    'iphone-16-pro',
    'iphone-16-pro-max',
    'iphone-16e',
    'iphone-se-3rd-generation',
    'ipad-10',
    'ipad-air-11-m2',
    'ipad-air-13-inch-m2',
    'ipad-pro-11-inch-m4',
    'ipad-mini-a17-pro',
    'watch-s10',
    'apple-watch-series-9',
    'apple-watch-ultra-2',
    'mba-13-m2',
  ]);

  const targets = [];
  for (const p of masterProducts.values()) {
    if (p.detail || TARGET_IDS.has(p.id)) {
      targets.push(p);
    }
  }
  return targets;
}

/**
 * SKU の既存キャリア価格または Apple Store 価格からフォールバック用のキャリア価格オブジェクトを構築する
 */
export function buildFallbackCarrierPrices(product, sku, previousCachedSku = null) {
  const launchApplePrice =
    sku.priceHistory?.[0]?.appleStorePrice ?? sku.carriers?.apple?.launchPrice ?? 98800;
  const currentApplePrice =
    sku.priceHistory?.at(-1)?.appleStorePrice ?? sku.carriers?.apple?.currentPrice ?? launchApplePrice;

  const existingCarriers = sku.carriers ?? {};
  const cachedCarriers = previousCachedSku?.carriers ?? {};
  const result = {};

  if (existingCarriers.apple || cachedCarriers.apple) {
    result.apple = structuredClone(cachedCarriers.apple ?? existingCarriers.apple);
  } else if (sku.priceHistory?.length) {
    result.apple = {
      launchPrice: launchApplePrice,
      currentPrice: currentApplePrice,
      mnpPrice: null,
      returnProgram: null,
    };
  }

  const isCarrierTarget =
    product.category === 'iPhone' ||
    (product.category === 'iPad' && /Cellular/i.test(sku.connectivity || '')) ||
    (product.category === 'Apple Watch' && /Cellular/i.test(sku.connectivity || ''));

  const multMap = CARRIER_MULTIPLIER_DEFAULT[product.category] ?? null;

  for (const carrierId of ['docomo', 'au', 'softbank', 'rakuten']) {
    if (existingCarriers[carrierId]) {
      result[carrierId] = structuredClone(existingCarriers[carrierId]);
    } else if (cachedCarriers[carrierId]) {
      result[carrierId] = structuredClone(cachedCarriers[carrierId]);
    } else if (isCarrierTarget && multMap) {
      const mult = multMap[carrierId] ?? 1.1;
      const prog = CARRIER_PROGRAM_DEFAULT[carrierId];
      const launchPrice = round10(launchApplePrice * mult);
      const currentPrice = round10(currentApplePrice * mult);
      const mnpPrice = Math.max(0, currentPrice - prog.mnpDiscount);
      const hasReturnProgram = product.category !== 'Apple Watch';
      result[carrierId] = {
        launchPrice,
        currentPrice,
        mnpPrice,
        returnProgram: hasReturnProgram
          ? {
              name: prog.name,
              months: prog.months,
              effectiveCost: round10(currentPrice * (1 - prog.residualRatio)),
              residualValue: round10(currentPrice * prog.residualRatio),
            }
          : null,
        note: 'マスターデータ由来の推定・基準価格',
      };
    }
  }

  // 楽天アフィリエイトURL変換の適用
  if (result.rakuten?.url) {
    result.rakuten.url = toRakutenAffiliateUrl(result.rakuten.url);
  }

  return result;
}

/* ============================================================================
 * 1. 楽天モバイル（新品キャリア価格）の取得 (`shopCode=rakutenmobile`)
 * ============================================================================ */

/**
 * 楽天商品検索APIで `shopCode=rakutenmobile` を指定し、
 * 「楽天モバイル公式 楽天市場店」の新品一括価格と商品URLを取得する
 */
export async function fetchRakutenMobileOfficialPrice({
  productName,
  storage = '',
  connectivity = '-',
  category = 'iPhone',
  launchPrice = 98800,
  appId = process.env.RAKUTEN_APP_ID?.trim(),
  affiliateId = process.env.RAKUTEN_AFFILIATE_ID?.trim(),
  accessKey = process.env.RAKUTEN_ACCESS_KEY?.trim(),
}) {
  const cleanAppId = String(appId ?? '').trim();
  if (!cleanAppId || isRakutenApiDisabled()) return null;

  // Wi-Fi専用iPadやGPS専用Watch、Macは楽天モバイルのキャリア端末対象外の場合はスキップ可能だが、
  // 楽天モバイル公式楽天市場店ではApple Watch GPSやiPadも扱うため検索を試みる
  if (category === 'Mac') return null;

  const cleanName = cleanSearchProductName(productName);
  const cleanStorage = extractStorageToken(storage, category);
  const keyword = [cleanName, cleanStorage]
    .filter(Boolean)
    .join(' ')
    .replace(/[()（）+/,-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // 新品端末のため発売時価格の50%を下限に設定（アクセサリーや極端な割引セット誤認防止）
  const minNewPrice = Math.max(Math.round((Number(launchPrice) || 80000) * 0.5), 25000);

  const validAffId =
    affiliateId && /^[0-9a-f]+\.[0-9a-f]+\.[0-9a-f]+\.[0-9a-f]+$/i.test(affiliateId.trim())
      ? affiliateId.trim()
      : '';

  const json = await callRakutenIchibaSearch({
    appId: cleanAppId,
    affiliateId: validAffId,
    accessKey,
    keyword,
    shopCode: 'rakutenmobile',
    minPrice: minNewPrice,
    hits: 30,
  });
  const items = json?.Items ?? [];
  if (!Array.isArray(items) || items.length === 0) return null;

  const validItems = [];
  for (const raw of items) {
    const it = raw?.Item ?? raw;
    if (!it) continue;
    const price = Number(it.itemPrice);
    const title = String(it.itemName ?? '');
    if (!Number.isFinite(price) || price < minNewPrice) continue;
    if (!isValidProductTitle(title, productName, storage, category)) continue;

    // Apple Watch / iPad の場合、GPS vs Cellular / Wi-Fi vs Cellular の整合性を確認
    if (category === 'Apple Watch') {
      const wantCell = /Cellular/i.test(connectivity);
      const hasCellInTitle = /Cellular|セルラー/i.test(title);
      if (wantCell !== hasCellInTitle && /GPS/i.test(title)) continue;
    }

    const isStandalone = /単品|本体のみ|回線セットなし|SIMフリー/i.test(title) && !/回線セット|プランセット/i.test(title);
    validItems.push({
      price,
      url: toRakutenAffiliateUrl(String(it.affiliateUrl || it.itemUrl || ''), affiliateId),
      itemName: title,
      shopName: String(it.shopName || '楽天モバイル公式 楽天市場店'),
      isStandalone,
      updatedAt: TODAY,
    });
  }

  if (validItems.length === 0) return null;

  // 端末単体（回線セット値引きなしの一括定価）を優先し、なければ最安値を採用
  validItems.sort((a, b) => Number(b.isStandalone) - Number(a.isStandalone) || a.price - b.price);
  const picked = validItems[0];

  return {
    currentPrice: picked.price,
    url: picked.url,
    itemName: picked.itemName,
    shopName: picked.shopName,
    updatedAt: picked.updatedAt,
    source: 'rakutenmobile_api',
  };
}

/* ============================================================================
 * 2. docomo / au / SoftBank キャリア価格スクレイピング (Playwright + 安全フォールバック)
 * ============================================================================ */

/**
 * ページ内のテキストブロックから製品名・容量に一致する「通常一括価格」と「2年返却実質負担額」を抽出するヘルパー
 */
function parseCarrierBlocksForSku(blocks, productName, storage, carrierId) {
  const normProd = cleanSearchProductName(productName).toUpperCase();
  const storToken = extractStorageToken(storage).toUpperCase();

  for (const text of blocks) {
    const normText = String(text ?? '').normalize('NFKC');
    const upperText = normText.toUpperCase();
    if (!isValidProductTitle(normText, productName, storToken)) continue;
    if (!upperText.includes(normProd) && !upperText.includes(productName.toUpperCase())) continue;

    // 金額表記 (例: "148,500円" / "¥148,500") をすべて抽出
    const yenMatches = [...normText.matchAll(/(?:¥|￥)?\s*(\d{1,3}(?:,\d{3})+)\s*円?/g)]
      .map((m) => Number(m[1].replace(/,/g, '')))
      .filter((n) => Number.isFinite(n) && n >= 1000 && n <= 450000);

    if (yenMatches.length === 0) continue;

    // 一括価格（通常 40,000円〜450,000円 の最大値付近）
    const totalCandidates = yenMatches.filter((n) => n >= 40000 && n <= 450000);
    const currentPrice = totalCandidates.length > 0 ? Math.max(...totalCandidates) : null;

    // 2年返却プログラム実質負担額（一括価格より小さく、1,000円〜250,000円の範囲）
    let effectiveCost = null;
    if (currentPrice) {
      const programRegex =
        carrierId === 'docomo'
          ? /(?:カエドキ|実質負担|負担額)[^0-9]{0,30}(\d{1,3}(?:,\d{3})+)\s*円/
          : carrierId === 'au'
            ? /(?:トクする|実質負担|負担額)[^0-9]{0,30}(\d{1,3}(?:,\d{3})+)\s*円/
            : /(?:新トクする|実質負担|負担額)[^0-9]{0,30}(\d{1,3}(?:,\d{3})+)\s*円/;
      const pm = normText.match(programRegex);
      if (pm) {
        const val = Number(pm[1].replace(/,/g, ''));
        if (val > 0 && val < currentPrice) effectiveCost = val;
      }
      if (!effectiveCost) {
        const smaller = yenMatches.filter((n) => n >= 9800 && n < currentPrice * 0.85);
        if (smaller.length > 0) effectiveCost = Math.min(...smaller);
      }
    }

    if (currentPrice) {
      return { currentPrice, effectiveCost, updatedAt: TODAY, source: 'playwright' };
    }
  }
  return null;
}

/**
 * 単一キャリアの価格一覧ページからDOMテキストブロックを収集する
 */
async function scrapeCarrierCategoryBlocks(context, carrierId, url) {
  let page = null;
  try {
    page = await context.newPage();
    const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    if (!res || res.status() >= 400) {
      console.log(`[info] ${carrierId} (${url}): HTTP ${res?.status() ?? 'ERR'} - 既存マスターデータを維持します`);
      return [];
    }
    await page.waitForTimeout(2000);
    const blocks = await page.evaluate(() => {
      const selectors = [
        'table tr',
        '[class*="price"]',
        '[class*="product"]',
        '[class*="model"]',
        '[class*="card"]',
        '[class*="item"]',
        'section',
        'article',
        'li',
      ];
      const nodes = document.querySelectorAll(selectors.join(','));
      const results = [];
      for (const el of nodes) {
        const txt = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
        if (txt.length >= 15 && txt.length <= 1200 && /(iPhone|iPad|Watch)/i.test(txt) && /[0-9]{2,3},[0-9]{3}/.test(txt)) {
          results.push(txt);
        }
      }
      return results.slice(0, 400);
    });
    return Array.isArray(blocks) ? blocks : [];
  } catch (err) {
    console.warn(`[warn] ${carrierId} スクレイピング失敗 (${url}): ${err.message} → 既存マスターデータを維持します`);
    return [];
  } finally {
    if (page) {
      await page.close().catch(() => {});
    }
  }
}

export async function scrapeDocomoPrices(context, targetProducts) {
  const blocksByCat = {};
  for (const [cat, url] of Object.entries(CARRIER_PRICE_URLS.docomo)) {
    blocksByCat[cat] = await scrapeCarrierCategoryBlocks(context, 'docomo', url);
  }
  const results = new Map();
  for (const p of targetProducts) {
    const blocks = blocksByCat[p.category] ?? [];
    if (!blocks.length) continue;
    for (const s of p.skus ?? []) {
      const parsed = parseCarrierBlocksForSku(blocks, p.name, s.storage || s.label, 'docomo');
      if (parsed) results.set(`${p.id}:${s.id}`, parsed);
    }
  }
  return results;
}

export async function scrapeAuPrices(context, targetProducts) {
  const blocksByCat = {};
  for (const [cat, url] of Object.entries(CARRIER_PRICE_URLS.au)) {
    blocksByCat[cat] = await scrapeCarrierCategoryBlocks(context, 'au', url);
  }
  const results = new Map();
  for (const p of targetProducts) {
    const blocks = blocksByCat[p.category] ?? [];
    if (!blocks.length) continue;
    for (const s of p.skus ?? []) {
      const parsed = parseCarrierBlocksForSku(blocks, p.name, s.storage || s.label, 'au');
      if (parsed) results.set(`${p.id}:${s.id}`, parsed);
    }
  }
  return results;
}

export async function scrapeSoftbankPrices(context, targetProducts) {
  const blocksByCat = {};
  for (const [cat, url] of Object.entries(CARRIER_PRICE_URLS.softbank)) {
    blocksByCat[cat] = await scrapeCarrierCategoryBlocks(context, 'softbank', url);
  }
  const results = new Map();
  for (const p of targetProducts) {
    const blocks = blocksByCat[p.category] ?? [];
    if (!blocks.length) continue;
    for (const s of p.skus ?? []) {
      const parsed = parseCarrierBlocksForSku(blocks, p.name, s.storage || s.label, 'softbank');
      if (parsed) results.set(`${p.id}:${s.id}`, parsed);
    }
  }
  return results;
}

/**
 * Playwright (Chromium) で docomo / au / SoftBank のキャリア価格取得を試み、
 * 失敗・未取得項目はすべて安全にフォールバックする
 */
export async function scrapeAllCarriersWithPlaywright(targetProducts) {
  const scraped = {
    docomo: new Map(),
    au: new Map(),
    softbank: new Map(),
  };

  if (process.env.SKIP_PLAYWRIGHT === '1') {
    console.log('[info] SKIP_PLAYWRIGHT=1 のため Playwright スクレイピングをスキップし、マスターデータを使用します。');
    return scraped;
  }

  let playwrightModule = null;
  try {
    playwrightModule = await import('playwright');
  } catch (err) {
    console.warn(`[warn] Playwright が未導入またはロード不可 (${err.message}) のため、キャリア価格は既存マスターデータを維持します。`);
    return scraped;
  }

  let browser = null;
  try {
    browser = await playwrightModule.chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
    });
    const context = await browser.newContext({
      locale: 'ja-JP',
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      viewport: { width: 1440, height: 900 },
    });

    console.log('🌐 Playwright (Chromium) で docomo / au / SoftBank 公式価格ページを確認中...');
    scraped.docomo = await scrapeDocomoPrices(context, targetProducts);
    scraped.au = await scrapeAuPrices(context, targetProducts);
    scraped.softbank = await scrapeSoftbankPrices(context, targetProducts);
  } catch (err) {
    console.warn(`[warn] Playwright 実行中エラー (${err.message}) → 全キャリア既存マスターデータへ安全にフォールバックします。`);
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }

  return scraped;
}

/**
 * スクレイピング結果または楽天モバイル公式API結果を既存のキャリアマスターデータに安全にマージする
 */
export function mergeLiveCarrierPrice(baseCarrierObj, liveData, carrierId) {
  if (!liveData || typeof liveData.currentPrice !== 'number' || liveData.currentPrice <= 0) {
    return baseCarrierObj;
  }

  const progDefault = CARRIER_PROGRAM_DEFAULT[carrierId];
  const merged = structuredClone(
    baseCarrierObj ?? {
      launchPrice: liveData.currentPrice,
      currentPrice: liveData.currentPrice,
      mnpPrice: Math.max(0, liveData.currentPrice - (progDefault?.mnpDiscount ?? 20000)),
      returnProgram: null,
    },
  );

  const prevDiscount =
    merged.mnpPrice != null && merged.currentPrice > merged.mnpPrice
      ? merged.currentPrice - merged.mnpPrice
      : (progDefault?.mnpDiscount ?? 20000);

  merged.currentPrice = liveData.currentPrice;
  if (merged.mnpPrice !== null) {
    merged.mnpPrice = Math.max(0, liveData.currentPrice - prevDiscount);
  }

  if (typeof liveData.effectiveCost === 'number' && liveData.effectiveCost > 0) {
    const residualValue = Math.max(0, liveData.currentPrice - liveData.effectiveCost);
    merged.returnProgram = {
      name: merged.returnProgram?.name ?? progDefault?.name ?? '2年返却プログラム',
      months: merged.returnProgram?.months ?? progDefault?.months ?? 24,
      effectiveCost: liveData.effectiveCost,
      residualValue,
    };
  } else if (merged.returnProgram && merged.returnProgram.effectiveCost > 0) {
    // 一括価格のみ更新された場合、残価率を維持して再計算
    const ratio = progDefault?.residualRatio ?? 0.5;
    merged.returnProgram = {
      ...merged.returnProgram,
      effectiveCost: round10(liveData.currentPrice * (1 - ratio)),
      residualValue: round10(liveData.currentPrice * ratio),
    };
  }

  if (liveData.url) merged.url = liveData.url;
  if (liveData.shopName) merged.shopName = liveData.shopName;
  if (liveData.updatedAt) merged.updatedAt = liveData.updatedAt;
  if (liveData.source) merged.source = liveData.source;

  return merged;
}

/* ============================================================================
 * 3. メイン実行パイプライン (`runFetchLivePrices`)
 * ============================================================================ */

export async function runFetchLivePrices() {
  const appId = process.env.RAKUTEN_APP_ID?.trim();
  const affiliateId = process.env.RAKUTEN_AFFILIATE_ID?.trim();
  const accessKey = process.env.RAKUTEN_ACCESS_KEY?.trim();
  const yahooAppId = process.env.YAHOO_APP_ID?.trim();

  console.log('================================================================');
  console.log('📦 Apple Price Atlas 自動価格収集バッチ (fetch-live-prices.mjs)');
  console.log(`  RAKUTEN_APP_ID      : ${appId ? '設定済' : '未設定 (既存データ/推定フォールバック)'}`);
  console.log(`  YAHOO_APP_ID        : ${yahooAppId ? '設定済' : '未設定 (既存データ/推定フォールバック)'}`);
  console.log(`  RAKUTEN_AFFILIATE_ID: ${affiliateId ? '設定済' : '未設定'}`);
  console.log(
    `  YAHOO_AFFILIATE     : ${
      process.env.YAHOO_VC_SID && process.env.YAHOO_VC_PID
        ? 'ValueCommerce設定済'
        : process.env.YAHOO_MOSHIMO_AID
          ? 'もしも設定済'
          : '未設定'
    }`,
  );
  console.log('================================================================\n');

  const { masterProducts, previousCache } = loadMasterBaseline();
  const targetProducts = selectTargetProducts(masterProducts);

  // Step 1: Playwright による 3キャリア (docomo / au / SoftBank) スクレイピング試行
  const scrapedCarriers = await scrapeAllCarriersWithPlaywright(targetProducts);

  // Step 2 & 3: 各ターゲット製品・SKUごとに
  //   - 楽天モバイル公式 (`shopCode=rakutenmobile`) 新品価格取得
  //   - 楽天市場 ＆ Yahoo!ショッピング 中古最安値取得（厳密タイトル検証＋大手優先＋アフィリエイトURL変換）
  //   - APIリクエストごとに `1200ms` ウェイトを厳守
  const rakutenMobileQueryCache = new Map();
  const usedPriceQueryCache = new Map();

  let rakutenMobileHits = 0;
  let usedApiHits = 0;
  const cacheProductsOut = {};

  for (const product of targetProducts) {
    const prevProdCache = previousCache?.products?.[product.id] ?? null;
    const skusOut = {};

    for (const sku of product.skus ?? []) {
      const prevSkuCache = prevProdCache?.skus?.[sku.id] ?? null;
      const launchPrice =
        sku.priceHistory?.[0]?.appleStorePrice ?? sku.carriers?.apple?.launchPrice ?? 98800;
      const storageTerm = sku.storage || sku.label;

      // 2-A. ベースライン（フォールバック用マスターキャリア価格）を構築
      const carriers = buildFallbackCarrierPrices(product, sku, prevSkuCache);

      // 2-B. Playwright で取得できた docomo / au / SoftBank 価格があれば安全にマージ
      for (const cid of ['docomo', 'au', 'softbank']) {
        const liveScraped = scrapedCarriers[cid]?.get(`${product.id}:${sku.id}`);
        if (liveScraped) {
          carriers[cid] = mergeLiveCarrierPrice(carriers[cid], liveScraped, cid);
        }
      }

      // 2-C. 楽天モバイル公式 (`shopCode=rakutenmobile`) 新品キャリア価格を取得
      const normStorageKey = extractStorageToken(storageTerm, product.category) || storageTerm;
      const rmKey = `${product.name}|${normStorageKey}|${sku.connectivity || '-'}`;
      let rmLive = null;
      if (appId && !isRakutenApiDisabled() && product.category !== 'Mac') {
        if (rakutenMobileQueryCache.has(rmKey)) {
          rmLive = rakutenMobileQueryCache.get(rmKey);
        } else {
          try {
            rmLive = await fetchRakutenMobileOfficialPrice({
              productName: product.name,
              storage: storageTerm,
              connectivity: sku.connectivity,
              category: product.category,
              launchPrice,
              appId,
              affiliateId,
              accessKey,
            });
            if (rmLive) rakutenMobileHits++;
          } catch (err) {
            console.warn(`[warn] 楽天モバイル公式API (${product.name} ${storageTerm}): ${err.message}`);
          }
          rakutenMobileQueryCache.set(rmKey, rmLive);
          if (!isRakutenApiDisabled()) await sleep(API_WAIT_MS);
        }
      }
      if (rmLive) {
        carriers.rakuten = mergeLiveCarrierPrice(carriers.rakuten, rmLive, 'rakuten');
      }

      // 3. 楽天市場 ＆ Yahoo!ショッピング 中古最安値の取得 (1リクエストごとに 1200ms ウェイト)
      const usedKey = `${product.name}|${normStorageKey}|${product.category}`;
      let usedPricing = null;

      if (usedPriceQueryCache.has(usedKey)) {
        usedPricing = structuredClone(usedPriceQueryCache.get(usedKey));
      } else {
        const fallbackOffers = estimatePlatformOffers({
          productName: product.name,
          storage: storageTerm,
          category: product.category,
          launchPrice,
          releaseDate: product.releaseDate,
        });

        // 既存キャッシュにAPI実取得値があればフォールバック候補として優先保持
        const prevRakuten =
          prevSkuCache?.usedPricing?.rakuten?.source === 'api'
            ? prevSkuCache.usedPricing.rakuten
            : fallbackOffers.rakutenOffer;
        const prevYahoo =
          prevSkuCache?.usedPricing?.yahoo?.source === 'api'
            ? prevSkuCache.usedPricing.yahoo
            : fallbackOffers.yahooOffer;
        const prevUnused =
          prevSkuCache?.usedPricing?.unused?.source === 'api'
            ? prevSkuCache.usedPricing.unused
            : fallbackOffers.unusedOffer;

        let rakutenOffer = null;
        let yahooOffer = null;
        let unusedOffer = null;

        if (appId && !isRakutenApiDisabled()) {
          try {
            rakutenOffer = await fetchFromRakutenApi({
              productName: product.name,
              storage: storageTerm,
              category: product.category,
              launchPrice,
              condition: '中古',
              appId,
              affiliateId,
              accessKey,
            });
          } catch (err) {
            console.warn(`[warn] 楽天市場API 中古 (${product.name} ${storageTerm}): ${err.message}`);
          }
          if (!isRakutenApiDisabled()) await sleep(API_WAIT_MS);

          if (!isRakutenApiDisabled()) {
            try {
              unusedOffer = await fetchFromRakutenApi({
                productName: product.name,
                storage: storageTerm,
                category: product.category,
                launchPrice,
                condition: '未使用',
                appId,
                affiliateId,
                accessKey,
              });
            } catch {
              /* ignore */
            }
            if (!isRakutenApiDisabled()) await sleep(API_WAIT_MS);
          }
        }

        if (yahooAppId) {
          try {
            yahooOffer = await fetchFromYahooApi({
              productName: product.name,
              storage: storageTerm,
              category: product.category,
              launchPrice,
              yahooAppId,
            });
          } catch (err) {
            console.warn(`[warn] Yahoo! API 中古 (${product.name} ${storageTerm}): ${err.message}`);
          }
          await sleep(API_WAIT_MS);
        }

        if (rakutenOffer?.source === 'api' || yahooOffer?.source === 'api') {
          usedApiHits++;
        }

        usedPricing = buildUsedPricingObject({
          rakutenOffer: rakutenOffer ?? prevRakuten,
          yahooOffer: yahooOffer ?? prevYahoo,
          unusedOffer: unusedOffer ?? prevUnused,
          launchPrice,
        });

        usedPriceQueryCache.set(usedKey, usedPricing);
      }

      // SKU ごとの launchPrice に合わせてリセール率を再計算しアフィリエイトURL変換を保証
      if (usedPricing) {
        if (usedPricing.rakuten?.url) {
          usedPricing.rakuten.url = toRakutenAffiliateUrl(usedPricing.rakuten.url, affiliateId);
        }
        if (usedPricing.yahoo?.url) {
          usedPricing.yahoo.url = toYahooAffiliateUrl(usedPricing.yahoo.url);
        }
        if (usedPricing.unused?.url) {
          usedPricing.unused.url = toRakutenAffiliateUrl(usedPricing.unused.url, affiliateId);
        }
        usedPricing.resaleValuePercent =
          launchPrice > 0 && usedPricing.lowestPrice > 0
            ? Math.round((usedPricing.lowestPrice / launchPrice) * 100)
            : usedPricing.resaleValuePercent;
      }

      skusOut[sku.id] = {
        skuId: sku.id,
        label: sku.label,
        storage: sku.storage ?? '',
        connectivity: sku.connectivity ?? '-',
        carriers,
        usedPricing,
      };
    }

    cacheProductsOut[product.id] = {
      id: product.id,
      name: product.name,
      category: product.category,
      releaseDate: product.releaseDate,
      skus: skusOut,
    };
  }

  const output = {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    sources: {
      rakutenMobileApi: rakutenMobileHits > 0 ? 'api' : 'fallback',
      carrierScraping: {
        docomo: scrapedCarriers.docomo.size > 0 ? 'scraped' : 'fallback',
        au: scrapedCarriers.au.size > 0 ? 'scraped' : 'fallback',
        softbank: scrapedCarriers.softbank.size > 0 ? 'scraped' : 'fallback',
      },
      usedPricesApi: {
        rakuten: appId && usedApiHits > 0 ? 'api' : 'fallback',
        yahoo: yahooAppId && usedApiHits > 0 ? 'api' : 'fallback',
      },
    },
    products: cacheProductsOut,
  };

  mkdirSync('data/prices', { recursive: true });
  writeFileSync(LIVE_CACHE_PATH, JSON.stringify(output, null, 2));

  console.log(`\n✅ ${LIVE_CACHE_PATH} を更新しました。`);
  console.log(
    `   対象モデル: ${Object.keys(cacheProductsOut).length}機種 / 楽天モバイル実取得: ${rakutenMobileHits}件 / キャリアスクレイピング: docomo=${scrapedCarriers.docomo.size}, au=${scrapedCarriers.au.size}, softbank=${scrapedCarriers.softbank.size} / 中古API実取得: ${usedApiHits}件`,
  );

  return output;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runFetchLivePrices().catch((err) => {
    console.error('[error] fetch-live-prices.mjs failed:', err);
    process.exitCode = 1;
  });
}

