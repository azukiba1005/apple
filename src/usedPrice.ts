import type { Category, Product, Sku } from './App';

/* =====================================================================================
 * 楽天市場 商品検索API (IchibaItem/Search/20220601) 中古・未使用品最安値取得モジュール
 * ===================================================================================== */

export const RAKUTEN_API_ENDPOINT = 'https://app.rakuten.co.jp/services/api/IchibaItem/Search/20220601';
export const RAKUTEN_OPENAPI_ENDPOINT = 'https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20220601';

export const RAKUTEN_NG_KEYWORD =
  'ケース フィルム カバー 保護 ガラス 修理 レンタル ジャンク 部品 交換 バッテリー バンド ベルト';

export const RAKUTEN_GENRE_IDS: Record<string, string> = {
  iPhone: '560202',
  iPad: '560029',
  Mac: '100040',
  'Apple Watch': '564500',
  Watch: '564500',
};

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
  used: UsedItemOffer;
  unused: UsedItemOffer | null;
  /** （現在の中古最安値 ÷ 発売時Apple直販価格）× 100 */
  resaleRate: number | null;
  /** 'api' = 楽天APIから実取得, 'mock' = キー未設定時の推定フォールバック */
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

/** 検索用キーワード `${製品名} ${容量} 中古` (または `未使用`) を組み立てる */
export function buildSearchKeyword(
  productName: string,
  storage: string,
  condition: '中古' | '未使用' = '中古',
): string {
  const cleanName = productName.replace(/\s+/g, ' ').trim();
  const cleanStorage = storage && storage !== '-' ? storage.trim() : '';
  return [cleanName, cleanStorage, condition].filter(Boolean).join(' ');
}

/** 楽天市場 商品検索API のリクエストURLを生成する */
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

/** 楽天市場のWeb検索URL（フォールバック時や一覧確認用のリンク） */
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

/** タイトルに除外ワードが含まれていないか二次チェック */
const EXCLUDE_TITLE_RE =
  /ケース|フィルム|カバー|保護|ガラス|修理|レンタル|ジャンク|部品|交換|バッテリー交換|バンドのみ|ベルトのみ|モックアップ|空箱|箱のみ/;

export function pickCheapestValidItem(items: any[], minPrice: number): UsedItemOffer | null {
  if (!Array.isArray(items)) return null;
  for (const raw of items) {
    const it = raw?.Item ?? raw;
    if (!it) continue;
    const price = Number(it.itemPrice);
    const title = String(it.itemName ?? '');
    if (!Number.isFinite(price) || price < minPrice) continue;
    if (EXCLUDE_TITLE_RE.test(title)) continue;
    return {
      price,
      shopName: String(it.shopName || '楽天市場ショップ'),
      itemName: title,
      itemUrl: String(it.affiliateUrl || it.itemUrl || ''),
    };
  }
  return null;
}

/** 環境変数から RAKUTEN_APP_ID を取得する (Node / Vite 両対応) */
export function resolveRakutenAppId(): string {
  try {
    const metaEnv = (import.meta as any)?.env;
    if (metaEnv?.RAKUTEN_APP_ID) return String(metaEnv.RAKUTEN_APP_ID).trim();
    if (metaEnv?.VITE_RAKUTEN_APP_ID) return String(metaEnv.VITE_RAKUTEN_APP_ID).trim();
  } catch {
    /* ignore */
  }
  try {
    const procEnv = (globalThis as any)?.process?.env;
    if (procEnv) {
      if (procEnv.RAKUTEN_APP_ID) return String(procEnv.RAKUTEN_APP_ID).trim();
      if (procEnv.VITE_RAKUTEN_APP_ID) return String(procEnv.VITE_RAKUTEN_APP_ID).trim();
    }
  } catch {
    /* ignore */
  }
  return '';
}

const MOCK_SHOPS = [
  'イオシス 楽天市場店',
  'じゃんぱら 楽天市場店',
  'ゲオモバイル 楽天市場店',
  'ソフマップ 楽天市場店',
  'にこスマ 楽天市場店',
];

function hashCode(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/**
 * RAKUTEN_APP_ID 未設定時またはオフライン時の推定中古・未使用品最安値ジェネレータ
 * 発売年・カテゴリ・SKU価格から現実的な中古相場と残価率を算出する
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
  const keyword = buildSearchKeyword(product.name, sku.storage || sku.label, '中古');

  // 発売からの経過年数に応じてカテゴリ別の残価率カーブを適用
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

  // 年間減価率: 1年目は緩やか、以降年ごとに減価
  const decay = Math.pow(0.86, ageYears);
  const seed = hashCode(`${product.id}:${sku.id}`);
  const jitter = ((seed % 7) - 3) * 0.008; // ±2.4% の個体差
  const rawRatio = Math.min(0.9, Math.max(0.18, catFactor * decay + jitter));

  // 100円単位で丸め、800円端数にする (例: ¥67,800)
  const rawUsed = Math.max(minPrice, Math.round((basePrice * rawRatio) / 1000) * 1000 - 200);
  const usedPrice = Math.max(minPrice, rawUsed);

  // 未使用品最安値は中古最安値の +12%〜+16% (ただし最新定価の96%以下)
  const rawUnused = Math.min(
    Math.round((latestPrice * 0.96) / 1000) * 1000 - 200,
    Math.round((usedPrice * 1.14) / 1000) * 1000 - 200,
  );
  const unusedPrice = Math.max(usedPrice + 3000, rawUnused);

  const shopUsed = MOCK_SHOPS[seed % MOCK_SHOPS.length];
  const shopUnused = MOCK_SHOPS[(seed + 1) % MOCK_SHOPS.length];
  const storageLabel = sku.storage || sku.label;

  return {
    productId: product.id,
    skuId: sku.id,
    keyword,
    genreId,
    minPrice,
    launchPrice,
    used: {
      price: usedPrice,
      shopName: shopUsed,
      itemName: `【中古】${product.name} ${storageLabel} SIMフリー 本体 A〜Bランク`,
      itemUrl: buildRakutenWebUrl({
        productName: product.name,
        storage: storageLabel,
        category: product.category,
        launchPrice,
        condition: '中古',
      }),
    },
    unused: {
      price: unusedPrice,
      shopName: shopUnused,
      itemName: `【未使用品】${product.name} ${storageLabel} 本体 開封済み未使用`,
      itemUrl: buildRakutenWebUrl({
        productName: product.name,
        storage: storageLabel,
        category: product.category,
        launchPrice,
        condition: '未使用',
      }),
    },
    resaleRate: calcResaleRate(usedPrice, launchPrice),
    source: 'mock',
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * 楽天市場 商品検索API を呼び出して中古最安値（および未使用品最安値）を取得する関数
 * 1. サーバプロキシ `/api/used-price` または直接API (`RAKUTEN_APP_ID` 設定時) を試行
 * 2. キー未設定または通信エラー時は推定値フォールバック (`estimateUsedMarketData`) を返す
 */
const memoryCache = new Map<string, UsedMarketData>();

export async function fetchUsedMarketPrice(
  product: Product,
  sku: Sku,
  options?: { appId?: string; forceRefresh?: boolean },
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

  // 1) ローカル/Cloudflare の `/api/used-price` プロキシエンドポイントが利用可能な場合
  if (typeof window !== 'undefined' && !appId) {
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
        if (data && data.used && typeof data.used.price === 'number') {
          const result: UsedMarketData = {
            productId: product.id,
            skuId: sku.id,
            keyword,
            genreId,
            minPrice,
            launchPrice,
            used: data.used,
            unused: data.unused ?? null,
            resaleRate: calcResaleRate(data.used.price, launchPrice),
            source: data.source === 'api' ? 'api' : 'mock',
            fetchedAt: data.fetchedAt ?? new Date().toISOString(),
          };
          memoryCache.set(cacheKey, result);
          return result;
        }
      }
    } catch {
      /* プロキシ未起動時は下の直接呼び出しまたはフォールバックへ */
    }
  }

  // 2) RAKUTEN_APP_ID が設定されている場合は楽天APIから直接取得
  if (appId) {
    try {
      const metaEnv = (import.meta as any)?.env;
      const affiliateId = String(metaEnv?.RAKUTEN_AFFILIATE_ID || '').trim();
      const accessKey = String(metaEnv?.RAKUTEN_ACCESS_KEY || '').trim();
      const endpoint = accessKey ? RAKUTEN_OPENAPI_ENDPOINT : RAKUTEN_API_ENDPOINT;

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
      const usedRes = await fetch(`${endpoint}?${usedParams.toString()}`);
      if (usedRes.ok) {
        const usedJson = await usedRes.json();
        const usedOffer = pickCheapestValidItem(usedJson?.Items ?? [], minPrice);

        let unusedOffer: UsedItemOffer | null = null;
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
          const unusedRes = await fetch(`${endpoint}?${unusedParams.toString()}`);
          if (unusedRes.ok) {
            const unusedJson = await unusedRes.json();
            unusedOffer = pickCheapestValidItem(unusedJson?.Items ?? [], minPrice);
          }
        } catch {
          /* 未使用品取得失敗時は中古のみ */
        }

        if (usedOffer) {
          const result: UsedMarketData = {
            productId: product.id,
            skuId: sku.id,
            keyword,
            genreId,
            minPrice,
            launchPrice,
            used: usedOffer,
            unused: unusedOffer,
            resaleRate: calcResaleRate(usedOffer.price, launchPrice),
            source: 'api',
            fetchedAt: new Date().toISOString(),
          };
          memoryCache.set(cacheKey, result);
          return result;
        }
      }
    } catch {
      /* APIエラー時はフォールバックへ */
    }
  }

  // 3) フォールバック（モック/推定値）
  const fallback = estimateUsedMarketData(product, sku);
  memoryCache.set(cacheKey, fallback);
  return fallback;
}
