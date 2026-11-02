import type { Category, Product, Sku } from './App';

/* =====================================================================================
 * 楽天市場API (IchibaItem/Search/20220601) ＆
 * Yahoo!ショッピングAPI (v3: ShoppingWebService/V3/itemSearch)
 * 横断中古最安値・リセールバリュー取得モジュール
 * ===================================================================================== */

export const RAKUTEN_API_ENDPOINT = 'https://app.rakuten.co.jp/services/api/IchibaItem/Search/20220601';
export const RAKUTEN_OPENAPI_ENDPOINT = 'https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20220601';
export const YAHOO_API_ENDPOINT = 'https://shopping.yahooapis.jp/ShoppingWebService/V3/itemSearch';

export const RAKUTEN_NG_KEYWORD =
  'ケース フィルム カバー 保護 ガラス 修理 レンタル ジャンク 部品 交換 バッテリー バンド ベルト';

export const YAHOO_NEGATIVE_TERMS =
  '-ケース -フィルム -カバー -ガラス -修理 -レンタル -ジャンク -バッテリー -交換 -バンド -ベルト';

export const RAKUTEN_GENRE_IDS: Record<string, string> = {
  iPhone: '560202',
  iPad: '560029',
  Mac: '100040',
  'Apple Watch': '564500',
  Watch: '564500',
};

export const YAHOO_GENRE_CATEGORY_IDS: Record<string, string> = {
  iPhone: '38338',        // スマホ本体
  iPad: '38340',          // タブレット本体
  Mac: '2514',            // Macノート
  'Apple Watch': '49950', // スマートウォッチ
  Watch: '49950',
};

export type UsedPlatformId = 'rakuten' | 'yahoo';

export interface UsedPlatformOffer {
  price: number;
  shopName: string;
  url: string;
  updatedAt: string;
  itemName?: string;
  source?: 'api' | 'mock';
}

export interface UsedPricing {
  lowestPrice: number;
  lowestPlatform: UsedPlatformId;
  /** (lowestPrice / launchApplePrice) * 100 */
  resaleValuePercent: number | null;
  rakuten: UsedPlatformOffer | null;
  yahoo: UsedPlatformOffer | null;
}

export interface UsedItemOffer {
  price: number;
  shopName: string;
  itemName: string;
  itemUrl: string;
}

export interface UsedMarketData {
  productId: string;
  skuId: string;
  keyword: string;
  genreId: string;
  minPrice: number;
  launchPrice: number | null;
  usedPricing: UsedPricing;
  used: UsedItemOffer;
  unused: UsedItemOffer | null;
  /** （現在の中古最安値 ÷ 発売時Apple直販価格）× 100 */
  resaleRate: number | null;
  /** 'api' = 楽天またはYahoo! APIから実取得, 'mock' = キー未設定時の推定フォールバック */
  source: 'api' | 'mock';
  fetchedAt: string;
}

/** カテゴリに応じた楽天ジャンルIDを返す */
export function getRakutenGenreId(category: Category | string): string {
  if (category in RAKUTEN_GENRE_IDS) return RAKUTEN_GENRE_IDS[category];
  if (/watch/i.test(category)) return RAKUTEN_GENRE_IDS.Watch;
  if (/ipad/i.test(category)) return RAKUTEN_GENRE_IDS.iPad;
  if (/mac/i.test(category)) return RAKUTEN_GENRE_IDS.Mac;
  return RAKUTEN_GENRE_IDS.iPhone;
}

/** カテゴリに応じたYahoo!ショッピング genre_category_id を返す */
export function getYahooGenreCategoryId(category: Category | string): string {
  if (category in YAHOO_GENRE_CATEGORY_IDS) return YAHOO_GENRE_CATEGORY_IDS[category];
  if (/watch/i.test(category)) return YAHOO_GENRE_CATEGORY_IDS.Watch;
  if (/ipad/i.test(category)) return YAHOO_GENRE_CATEGORY_IDS.iPad;
  if (/mac/i.test(category)) return YAHOO_GENRE_CATEGORY_IDS.Mac;
  return YAHOO_GENRE_CATEGORY_IDS.iPhone;
}

/** SKU・製品情報から発売時Apple直販価格(税込)を取得する */
export function getLaunchApplePrice(product: Product, sku: Sku): number | null {
  if (sku.priceHistory.length > 0 && sku.priceHistory[0].appleStorePrice > 0) {
    return sku.priceHistory[0].appleStorePrice;
  }
  if (sku.carriers.apple?.launchPrice && sku.carriers.apple.launchPrice > 0) {
    return sku.carriers.apple.launchPrice;
  }
  const rawSpec = product.specs?.launchPriceJpy;
  if (typeof rawSpec === 'string') {
    const m = rawSpec.replace(/,/g, '').match(/¥?(\d{4,7})/);
    if (m) return Number(m[1]);
  }
  return null;
}

/** 発売時価格の15%（または最低5,000円）を下限に設定 */
export function calcMinPrice(launchPrice: number | null | undefined): number {
  if (!launchPrice || !Number.isFinite(launchPrice) || launchPrice <= 0) return 5000;
  return Math.max(Math.round(launchPrice * 0.15), 5000);
}

/** リセールバリュー（残価率）= （現在の中古最安値 ÷ 発売時Apple直販価格）× 100 */
export function calcResaleRate(usedPrice: number | null | undefined, launchPrice: number | null | undefined): number | null {
  if (!usedPrice || !launchPrice || launchPrice <= 0) return null;
  return Math.round((usedPrice / launchPrice) * 100);
}

/** 楽天検索用キーワード `${製品名} ${容量} 中古` (または `未使用`) を組み立てる */
export function buildSearchKeyword(
  productName: string,
  storage: string,
  condition: '中古' | '未使用' = '中古',
): string {
  const cleanName = productName.replace(/\s+/g, ' ').trim();
  const cleanStorage = storage && storage !== '-' ? storage.trim() : '';
  return [cleanName, cleanStorage, condition].filter(Boolean).join(' ');
}

/** Yahoo!ショッピングAPI (v3) 用マイナス検索つきクエリを組み立てる */
export function buildYahooSearchQuery(productName: string, storage: string): string {
  const cleanName = productName.replace(/\s+/g, ' ').trim();
  const cleanStorage = storage && storage !== '-' ? storage.trim() : '';
  return [cleanName, cleanStorage, YAHOO_NEGATIVE_TERMS].filter(Boolean).join(' ');
}

/** 楽天市場 商品検索API のリクエストパラメータを生成する */
export function buildRakutenSearchParams(opts: {
  appId: string;
  affiliateId?: string;
  accessKey?: string;
  productName: string;
  storage: string;
  category: string;
  launchPrice?: number | null;
  condition?: '中古' | '未使用';
}): URLSearchParams {
  const condition = opts.condition ?? '中古';
  const keyword = buildSearchKeyword(opts.productName, opts.storage, condition);
  const genreId = getRakutenGenreId(opts.category);
  const minPrice = calcMinPrice(opts.launchPrice);

  const params = new URLSearchParams({
    applicationId: opts.appId,
    format: 'json',
    formatVersion: '2',
    keyword,
    NGKeyword: RAKUTEN_NG_KEYWORD,
    genreId,
    minPrice: String(minPrice),
    sort: '+itemPrice',
    availability: '1',
    hits: '10',
  });
  if (opts.affiliateId) params.set('affiliateId', opts.affiliateId);
  if (opts.accessKey) params.set('accessKey', opts.accessKey);
  return params;
}

/** Yahoo!ショッピングAPI (v3) のリクエストパラメータを生成する */
export function buildYahooSearchParams(opts: {
  yahooAppId: string;
  productName: string;
  storage: string;
  category: string;
  launchPrice?: number | null;
}): URLSearchParams {
  const query = buildYahooSearchQuery(opts.productName, opts.storage);
  const genreCategoryId = getYahooGenreCategoryId(opts.category);
  const priceFrom = calcMinPrice(opts.launchPrice);

  return new URLSearchParams({
    appid: opts.yahooAppId,
    query,
    condition: 'used',
    genre_category_id: genreCategoryId,
    price_from: String(priceFrom),
    sort: '+price',
    results: '5',
  });
}

/** 楽天市場のWeb検索URL */
export function buildRakutenWebUrl(opts: {
  productName: string;
  storage: string;
  category: string;
  launchPrice?: number | null;
  condition?: '中古' | '未使用';
}): string {
  const keyword = buildSearchKeyword(opts.productName, opts.storage, opts.condition ?? '中古');
  const genreId = getRakutenGenreId(opts.category);
  const minPrice = calcMinPrice(opts.launchPrice);
  const encodedKw = encodeURIComponent(keyword);
  const qs = new URLSearchParams({
    min: String(minPrice),
    nitem: RAKUTEN_NG_KEYWORD,
    s: '2', // 価格が安い順
  });
  return `https://search.rakuten.co.jp/search/mall/${encodedKw}/${genreId}/?${qs.toString()}`;
}

/** Yahoo!ショッピングのWeb検索URL */
export function buildYahooWebUrl(opts: {
  productName: string;
  storage: string;
  category: string;
  launchPrice?: number | null;
}): string {
  const cleanName = opts.productName.replace(/\s+/g, ' ').trim();
  const cleanStorage = opts.storage && opts.storage !== '-' ? opts.storage.trim() : '';
  const p = [cleanName, cleanStorage, '中古'].filter(Boolean).join(' ');
  const cid = getYahooGenreCategoryId(opts.category);
  const pf = calcMinPrice(opts.launchPrice);
  const qs = new URLSearchParams({
    p,
    cid,
    pf: String(pf),
    used: '1',
    X: '2', // 価格が安い順
  });
  return `https://shopping.yahoo.co.jp/search?${qs.toString()}`;
}

/** タイトルにジャンク・難あり・訳あり・アクセサリー類が含まれていないか二次チェック */
const EXCLUDE_TITLE_RE =
  /ジャンク|難あり|訳あり|訳有|ケース|フィルム|カバー|保護|ガラス|修理|レンタル|部品|交換|バッテリー交換|バンドのみ|ベルトのみ|モックアップ|空箱|箱のみ/;

export function pickCheapestRakutenOffer(items: any[], minPrice: number): UsedPlatformOffer | null {
  if (!Array.isArray(items)) return null;
  const today = new Date().toISOString().slice(0, 10);
  const candidates: UsedPlatformOffer[] = [];
  for (const raw of items) {
    const it = raw?.Item ?? raw;
    if (!it) continue;
    const price = Number(it.itemPrice);
    const title = String(it.itemName ?? '');
    if (!Number.isFinite(price) || price < minPrice) continue;
    if (EXCLUDE_TITLE_RE.test(title)) continue;
    candidates.push({
      price,
      shopName: String(it.shopName || '楽天市場ショップ'),
      url: String(it.affiliateUrl || it.itemUrl || ''),
      updatedAt: today,
      itemName: title,
      source: 'api',
    });
  }
  candidates.sort((a, b) => a.price - b.price);
  return candidates[0] ?? null;
}

/**
 * Yahoo!ショッピングAPI (v3) の上位5件から
 * 商品名に「ジャンク」「難あり」「訳あり」が含まれない最安の1件を採用する
 */
export function pickCheapestYahooOffer(hits: any[], minPrice: number): UsedPlatformOffer | null {
  if (!Array.isArray(hits)) return null;
  const today = new Date().toISOString().slice(0, 10);
  const candidates: UsedPlatformOffer[] = [];
  for (const hit of hits.slice(0, 5)) {
    if (!hit) continue;
    const price = Number(hit.price);
    const title = String(hit.name ?? '');
    if (!Number.isFinite(price) || price < minPrice) continue;
    if (EXCLUDE_TITLE_RE.test(title)) continue;
    candidates.push({
      price,
      shopName: String(hit.seller?.name || 'Yahoo!ショッピング店'),
      url: String(hit.url || ''),
      updatedAt: today,
      itemName: title,
      source: 'api',
    });
  }
  candidates.sort((a, b) => a.price - b.price);
  return candidates[0] ?? null;
}

/** 環境変数から RAKUTEN_APP_ID / YAHOO_APP_ID を取得する (Node / Vite 両対応) */
export function resolveRakutenAppId(): string {
  try {
    const metaEnv = (import.meta as any)?.env;
    if (metaEnv?.RAKUTEN_APP_ID) return String(metaEnv.RAKUTEN_APP_ID).trim();
    if (metaEnv?.VITE_RAKUTEN_APP_ID) return String(metaEnv.VITE_RAKUTEN_APP_ID).trim();
  } catch { /* ignore */ }
  try {
    const procEnv = (globalThis as any)?.process?.env;
    if (procEnv?.RAKUTEN_APP_ID) return String(procEnv.RAKUTEN_APP_ID).trim();
    if (procEnv?.VITE_RAKUTEN_APP_ID) return String(procEnv.VITE_RAKUTEN_APP_ID).trim();
  } catch { /* ignore */ }
  return '';
}

export function resolveYahooAppId(): string {
  try {
    const metaEnv = (import.meta as any)?.env;
    if (metaEnv?.YAHOO_APP_ID) return String(metaEnv.YAHOO_APP_ID).trim();
    if (metaEnv?.VITE_YAHOO_APP_ID) return String(metaEnv.VITE_YAHOO_APP_ID).trim();
  } catch { /* ignore */ }
  try {
    const procEnv = (globalThis as any)?.process?.env;
    if (procEnv?.YAHOO_APP_ID) return String(procEnv.YAHOO_APP_ID).trim();
    if (procEnv?.VITE_YAHOO_APP_ID) return String(procEnv.VITE_YAHOO_APP_ID).trim();
  } catch { /* ignore */ }
  return '';
}

const MOCK_RAKUTEN_SHOPS = [
  'イオシス楽天市場店',
  'じゃんぱら楽天市場店',
  'ゲオモバイル楽天市場店',
  'ソフマップ楽天市場店',
  'にこスマ楽天市場店',
];

const MOCK_YAHOO_SHOPS = [
  'じゃんぱら Yahoo!店',
  'イオシス Yahoo!店',
  'ゲオオンラインストア Yahoo!店',
  'ソフマップ Yahoo!店',
  'スマホ市場 Yahoo!店',
];

function hashCode(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/** 楽天・Yahoo!のオファーから `UsedPricing` 横断比較オブジェクトを組み立てる */
export function buildUsedPricing(
  rakutenOffer: UsedPlatformOffer | null,
  yahooOffer: UsedPlatformOffer | null,
  launchPrice: number | null | undefined,
): UsedPricing {
  const rIsApi = rakutenOffer?.source === 'api';
  const yIsApi = yahooOffer?.source === 'api';

  let lowestPlatform: UsedPlatformId = 'rakuten';
  let lowestPrice = rakutenOffer?.price ?? yahooOffer?.price ?? 0;

  if (rIsApi && yIsApi && rakutenOffer && yahooOffer) {
    if (yahooOffer.price < rakutenOffer.price) {
      lowestPlatform = 'yahoo';
      lowestPrice = yahooOffer.price;
    } else {
      lowestPlatform = 'rakuten';
      lowestPrice = rakutenOffer.price;
    }
  } else if (rIsApi && rakutenOffer) {
    lowestPlatform = 'rakuten';
    lowestPrice = rakutenOffer.price;
  } else if (yIsApi && yahooOffer) {
    lowestPlatform = 'yahoo';
    lowestPrice = yahooOffer.price;
  } else if (rakutenOffer && yahooOffer) {
    if (yahooOffer.price < rakutenOffer.price) {
      lowestPlatform = 'yahoo';
      lowestPrice = yahooOffer.price;
    } else {
      lowestPlatform = 'rakuten';
      lowestPrice = rakutenOffer.price;
    }
  } else if (yahooOffer) {
    lowestPlatform = 'yahoo';
    lowestPrice = yahooOffer.price;
  }

  return {
    lowestPrice,
    lowestPlatform,
    resaleValuePercent: calcResaleRate(lowestPrice, launchPrice),
    rakuten: rakutenOffer,
    yahoo: yahooOffer,
  };
}

/**
 * APIキー未設定時またはオフライン時の推定中古・未使用品最安値ジェネレータ
 * 楽天市場・Yahoo!ショッピング双方の相場と横断最安値を算出する
 */
export function estimateUsedMarketData(product: Product, sku: Sku): UsedMarketData {
  const launchPrice = getLaunchApplePrice(product, sku);
  const latestPrice =
    sku.priceHistory.length > 0
      ? sku.priceHistory[sku.priceHistory.length - 1].appleStorePrice
      : launchPrice ?? 98800;
  const basePrice = launchPrice ?? latestPrice;
  const minPrice = calcMinPrice(launchPrice);
  const genreId = getRakutenGenreId(product.category);
  const storageLabel = sku.storage || sku.label;
  const keyword = buildSearchKeyword(product.name, storageLabel, '中古');
  const today = new Date().toISOString().slice(0, 10);

  // SKU にビルド済みの usedPricing がある場合はそれを初期値として活用
  if (sku.usedPricing && sku.usedPricing.lowestPrice > 0) {
    const up = sku.usedPricing;
    const best = up.lowestPlatform === 'yahoo' ? up.yahoo ?? up.rakuten : up.rakuten ?? up.yahoo;
    const unusedPrice = Math.min(
      Math.round((latestPrice * 0.96) / 1000) * 1000 - 200,
      Math.round((up.lowestPrice * 1.14) / 1000) * 1000 - 200,
    );
    return {
      productId: product.id,
      skuId: sku.id,
      keyword,
      genreId,
      minPrice,
      launchPrice,
      usedPricing: up,
      used: {
        price: up.lowestPrice,
        shopName: best?.shopName ?? 'イオシス楽天市場店',
        itemName: best?.itemName ?? `【中古】${product.name} ${storageLabel}`,
        itemUrl:
          best?.url ??
          buildRakutenWebUrl({
            productName: product.name,
            storage: storageLabel,
            category: product.category,
            launchPrice,
            condition: '中古',
          }),
      },
      unused: {
        price: Math.max(up.lowestPrice + 3000, unusedPrice),
        shopName: up.rakuten?.shopName ?? 'イオシス楽天市場店',
        itemName: `【未使用品】${product.name} ${storageLabel} 本体`,
        itemUrl: buildRakutenWebUrl({
          productName: product.name,
          storage: storageLabel,
          category: product.category,
          launchPrice,
          condition: '未使用',
        }),
      },
      resaleRate: up.resaleValuePercent ?? calcResaleRate(up.lowestPrice, launchPrice),
      source: up.rakuten?.source === 'api' || up.yahoo?.source === 'api' ? 'api' : 'mock',
      fetchedAt: today,
    };
  }

  const relMs = Date.parse((product.releaseDate || '2023-09-22') + 'T00:00:00Z');
  const nowMs = Date.now();
  const ageYears = Math.max(0, (nowMs - (Number.isFinite(relMs) ? relMs : nowMs)) / (365.25 * 864e5));

  const catFactor =
    product.category === 'iPhone'
      ? 0.84
      : product.category === 'iPad'
        ? 0.78
        : product.category === 'Mac'
          ? 0.75
          : 0.68;

  const decay = Math.pow(0.86, ageYears);
  const seed = hashCode(`${product.id}:${sku.id}`);
  const jitter = ((seed % 7) - 3) * 0.008;
  const rawRatio = Math.min(0.9, Math.max(0.18, catFactor * decay + jitter));

  const baseUsed = Math.max(minPrice, Math.round((basePrice * rawRatio) / 1000) * 1000 - 200);
  const yahooDelta = seed % 2 === 0 ? -1000 : 1000;
  const rakutenPrice = Math.max(minPrice, baseUsed);
  const yahooPrice = Math.max(minPrice, baseUsed + yahooDelta);

  const rawUnused = Math.min(
    Math.round((latestPrice * 0.96) / 1000) * 1000 - 200,
    Math.round((baseUsed * 1.14) / 1000) * 1000 - 200,
  );
  const unusedPrice = Math.max(Math.max(rakutenPrice, yahooPrice) + 3000, rawUnused);

  const rakutenOffer: UsedPlatformOffer = {
    price: rakutenPrice,
    shopName: MOCK_RAKUTEN_SHOPS[seed % MOCK_RAKUTEN_SHOPS.length],
    url: buildRakutenWebUrl({
      productName: product.name,
      storage: storageLabel,
      category: product.category,
      launchPrice,
      condition: '中古',
    }),
    updatedAt: today,
    itemName: `【中古】${product.name} ${storageLabel} SIMフリー 本体`,
    source: 'mock',
  };

  const yahooOffer: UsedPlatformOffer = {
    price: yahooPrice,
    shopName: MOCK_YAHOO_SHOPS[seed % MOCK_YAHOO_SHOPS.length],
    url: buildYahooWebUrl({
      productName: product.name,
      storage: storageLabel,
      category: product.category,
      launchPrice,
    }),
    updatedAt: today,
    itemName: `【中古】${product.name} ${storageLabel} SIMフリー 本体`,
    source: 'mock',
  };

  const usedPricing = buildUsedPricing(rakutenOffer, yahooOffer, launchPrice);
  const bestOffer = usedPricing.lowestPlatform === 'yahoo' ? yahooOffer : rakutenOffer;

  return {
    productId: product.id,
    skuId: sku.id,
    keyword,
    genreId,
    minPrice,
    launchPrice,
    usedPricing,
    used: {
      price: usedPricing.lowestPrice,
      shopName: bestOffer.shopName,
      itemName: bestOffer.itemName ?? '',
      itemUrl: bestOffer.url,
    },
    unused: {
      price: unusedPrice,
      shopName: MOCK_RAKUTEN_SHOPS[(seed + 1) % MOCK_RAKUTEN_SHOPS.length],
      itemName: `【未使用品】${product.name} ${storageLabel} 本体 開封済み未使用`,
      itemUrl: buildRakutenWebUrl({
        productName: product.name,
        storage: storageLabel,
        category: product.category,
        launchPrice,
        condition: '未使用',
      }),
    },
    resaleRate: usedPricing.resaleValuePercent,
    source: 'mock',
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * 楽天市場API ＆ Yahoo!ショッピングAPI (v3) を呼び出して横断最安値を取得する関数
 * 1. サーバプロキシ `/api/used-price` を試行
 * 2. 直接API呼び出し (`RAKUTEN_APP_ID` / `YAHOO_APP_ID` 設定時、片方のみでも動作)
 * 3. 未設定・通信エラー時は推定値フォールバック (`estimateUsedMarketData`) を返す
 */
const memoryCache = new Map<string, UsedMarketData>();

export async function fetchUsedMarketPrice(
  product: Product,
  sku: Sku,
  options?: { appId?: string; yahooAppId?: string; forceRefresh?: boolean },
): Promise<UsedMarketData> {
  const cacheKey = `${product.id}__${sku.id}`;
  if (!options?.forceRefresh && memoryCache.has(cacheKey)) {
    return memoryCache.get(cacheKey)!;
  }

  const launchPrice = getLaunchApplePrice(product, sku);
  const minPrice = calcMinPrice(launchPrice);
  const genreId = getRakutenGenreId(product.category);
  const storageTerm = sku.storage || sku.label;
  const keyword = buildSearchKeyword(product.name, storageTerm, '中古');
  const appId = options?.appId?.trim() || resolveRakutenAppId();
  const yahooAppId = options?.yahooAppId?.trim() || resolveYahooAppId();
  const fallback = estimateUsedMarketData(product, sku);

  // 1) ローカル/Cloudflare の `/api/used-price` プロキシエンドポイントが利用可能な場合
  if (typeof window !== 'undefined') {
    try {
      const proxyParams = new URLSearchParams({
        productName: product.name,
        storage: storageTerm,
        category: product.category,
        launchPrice: launchPrice ? String(launchPrice) : '',
        releaseDate: product.releaseDate || '',
      });
      const res = await fetch(`./api/used-price?${proxyParams.toString()}`);
      if (res.ok) {
        const data = await res.json();
        if (data && data.usedPricing && typeof data.usedPricing.lowestPrice === 'number') {
          const up: UsedPricing = {
            lowestPrice: data.usedPricing.lowestPrice,
            lowestPlatform: data.usedPricing.lowestPlatform === 'yahoo' ? 'yahoo' : 'rakuten',
            resaleValuePercent:
              data.usedPricing.resaleValuePercent ?? calcResaleRate(data.usedPricing.lowestPrice, launchPrice),
            rakuten: data.usedPricing.rakuten ?? fallback.usedPricing.rakuten,
            yahoo: data.usedPricing.yahoo ?? fallback.usedPricing.yahoo,
          };
          const best = up.lowestPlatform === 'yahoo' ? up.yahoo ?? up.rakuten! : up.rakuten ?? up.yahoo!;
          const result: UsedMarketData = {
            productId: product.id,
            skuId: sku.id,
            keyword,
            genreId,
            minPrice,
            launchPrice,
            usedPricing: up,
            used: {
              price: up.lowestPrice,
              shopName: best.shopName,
              itemName: best.itemName ?? '',
              itemUrl: best.url,
            },
            unused: data.unused ?? fallback.unused,
            resaleRate: up.resaleValuePercent,
            source: data.source === 'api' ? 'api' : 'mock',
            fetchedAt: data.fetchedAt ?? new Date().toISOString(),
          };
          memoryCache.set(cacheKey, result);
          return result;
        }
      }
    } catch {
      /* プロキシ未応答時は直接API呼び出しまたはフォールバックへ */
    }
  }

  // 2) RAKUTEN_APP_ID または YAHOO_APP_ID が設定されている場合（片方のみでも動作）
  if (appId || yahooAppId) {
    let rakutenOffer: UsedPlatformOffer | null = null;
    let yahooOffer: UsedPlatformOffer | null = null;
    let unusedOffer: UsedItemOffer | null = null;

    const metaEnv = (import.meta as any)?.env;
    const affiliateId = String(metaEnv?.RAKUTEN_AFFILIATE_ID || '').trim();
    const accessKey = String(metaEnv?.RAKUTEN_ACCESS_KEY || '').trim();
    const rakutenEndpoint = accessKey ? RAKUTEN_OPENAPI_ENDPOINT : RAKUTEN_API_ENDPOINT;

    await Promise.all([
      appId
        ? (async () => {
            try {
              const usedParams = buildRakutenSearchParams({
                appId,
                affiliateId,
                accessKey,
                productName: product.name,
                storage: storageTerm,
                category: product.category,
                launchPrice,
                condition: '中古',
              });
              const usedRes = await fetch(`${rakutenEndpoint}?${usedParams.toString()}`);
              if (usedRes.ok) {
                const usedJson = await usedRes.json();
                rakutenOffer = pickCheapestRakutenOffer(usedJson?.Items ?? [], minPrice);
              }
            } catch {
              /* ignore */
            }
            try {
              const unusedParams = buildRakutenSearchParams({
                appId,
                affiliateId,
                accessKey,
                productName: product.name,
                storage: storageTerm,
                category: product.category,
                launchPrice,
                condition: '未使用',
              });
              const unusedRes = await fetch(`${rakutenEndpoint}?${unusedParams.toString()}`);
              if (unusedRes.ok) {
                const unusedJson = await unusedRes.json();
                const u = pickCheapestRakutenOffer(unusedJson?.Items ?? [], minPrice);
                if (u) {
                  unusedOffer = {
                    price: u.price,
                    shopName: u.shopName,
                    itemName: u.itemName ?? '',
                    itemUrl: u.url,
                  };
                }
              }
            } catch {
              /* ignore */
            }
          })()
        : Promise.resolve(),
      yahooAppId
        ? (async () => {
            try {
              const yParams = buildYahooSearchParams({
                yahooAppId,
                productName: product.name,
                storage: storageTerm,
                category: product.category,
                launchPrice,
              });
              const yRes = await fetch(`${YAHOO_API_ENDPOINT}?${yParams.toString()}`);
              if (yRes.ok) {
                const yJson = await yRes.json();
                yahooOffer = pickCheapestYahooOffer(yJson?.hits ?? [], minPrice);
              }
            } catch {
              /* ignore */
            }
          })()
        : Promise.resolve(),
    ]);

    if (rakutenOffer || yahooOffer) {
      const finalRakuten = rakutenOffer ?? fallback.usedPricing.rakuten;
      const finalYahoo = yahooOffer ?? fallback.usedPricing.yahoo;
      const usedPricing = buildUsedPricing(finalRakuten, finalYahoo, launchPrice);
      const best = usedPricing.lowestPlatform === 'yahoo' ? finalYahoo! : finalRakuten!;
      const result: UsedMarketData = {
        productId: product.id,
        skuId: sku.id,
        keyword,
        genreId,
        minPrice,
        launchPrice,
        usedPricing,
        used: {
          price: usedPricing.lowestPrice,
          shopName: best.shopName,
          itemName: best.itemName ?? '',
          itemUrl: best.url,
        },
        unused: unusedOffer ?? fallback.unused,
        resaleRate: usedPricing.resaleValuePercent,
        source: 'api',
        fetchedAt: new Date().toISOString(),
      };
      memoryCache.set(cacheKey, result);
      return result;
    }
  }

  // 3) フォールバック（モック/推定値）
  memoryCache.set(cacheKey, fallback);
  return fallback;
}
