import type { Category, Product, Sku } from './App';

/* =====================================================================================
 * 楽天市場API (IchibaItem/Search/20220601) ＆
 * Yahoo!ショッピングAPI (v3: ShoppingWebService/V3/itemSearch)
 * 横断中古最安値・リセールバリュー取得モジュール（厳密タイトル検証＆大手ショップ優先版）
 * ===================================================================================== */

export const RAKUTEN_API_ENDPOINT = 'https://app.rakuten.co.jp/services/api/IchibaItem/Search/20220601';
export const RAKUTEN_OPENAPI_ENDPOINT = 'https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20220601';
export const YAHOO_API_ENDPOINT = 'https://shopping.yahooapis.jp/ShoppingWebService/V3/itemSearch';

export const RAKUTEN_NG_KEYWORD =
  'ケース フィルム カバー 保護 ガラス 修理 レンタル ジャンク 部品 交換 バッテリー バンド ベルト 用 対応 互換 AQUOS Galaxy Xperia Pixel OPPO Xiaomi';

export const YAHOO_NEGATIVE_TERMS =
  '-ケース -フィルム -カバー -ガラス -修理 -レンタル -ジャンク -バッテリー -交換 -バンド -ベルト -AQUOS -Galaxy -Xperia -Pixel -OPPO -Xiaomi -モック -空箱';

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

/** 他社スマホ・アクセサリー・ジャンクの完全ブラックリスト */
export const TITLE_BLACKLIST = [
  'AQUOS', 'Galaxy', 'Xperia', 'Pixel', 'arrows', 'OPPO', 'Xiaomi', 'Redmi', 'ZenFone', 'HUAWEI',
  'ケース', 'カバー', 'フィルム', 'ガラス', 'バンド', 'ベルト', 'ストラップ', '充電器', 'ケーブル', 'アダプタ',
  '用', '対応', '互換', '保護', '修理', '交換', 'バッテリー交換',
  'ジャンク', '難あり', '訳あり', '画面割れ', '赤ロム', 'モック', '空箱', '箱のみ', 'レンタル', 'ふるさと納税',
];

const NORMALIZED_BLACKLIST = TITLE_BLACKLIST.map((w) => w.normalize('NFKC').toUpperCase());

/** 信頼できる大手中古ショップキーワード一覧 */
export const TRUSTED_SHOP_KEYWORDS = [
  'イオシス', 'じゃんぱら', 'ゲオ', 'GEO', 'ソフマップ', 'リコレ', 'ビックカメラ',
  'ヤマダ', 'ケーズ', 'ノジマ', 'エディオン', 'カメラのキタムラ', 'ブックオフ', 'BOOKOFF',
  'ハードオフ', 'セカンドストリート', '2nd STREET', 'にこスマ', 'エコたん', 'PCコンフル',
  'デジタルコレクション', 'モバックス', 'ムスビー', 'ワールドモバイル', 'アメモバ',
  '대黒屋', '大黒屋', 'コメ兵', 'KOMEHYO', 'Be-Stock',
];

const NORMALIZED_TRUSTED_SHOPS = TRUSTED_SHOP_KEYWORDS.map((w) => ({
  raw: w,
  norm: w.normalize('NFKC').toUpperCase(),
}));

const ALL_CAPACITIES = ['16GB', '32GB', '64GB', '128GB', '256GB', '512GB', '1TB', '2TB'];

export type UsedPlatformId = 'rakuten' | 'yahoo';

export type UsedConditionRank = 'unused' | 'rankA' | 'rankB' | 'rankC' | 'used';

export interface UsedShopOffer {
  platform: UsedPlatformId;
  price: number;
  title: string;
  shopName: string;
  isTrusted: boolean;
  conditionRank: UsedConditionRank;
  simFree: boolean;
  url: string;
}

export interface UsedPlatformOffer {
  price: number;
  shopName: string;
  url: string;
  updatedAt: string;
  isTrustedShop?: boolean;
  itemName?: string;
  source?: 'api' | 'mock';
  offers?: UsedShopOffer[];
}

export interface UsedPricing {
  lowestPrice: number;
  lowestPlatform: UsedPlatformId;
  /** (lowestPrice / launchApplePrice) * 100 */
  resaleValuePercent: number | null;
  /** 実APIデータがなく発売時価格・年式からの推定相場である場合 true */
  isEstimated?: boolean;
  rakuten: UsedPlatformOffer | null;
  yahoo: UsedPlatformOffer | null;
  offers?: UsedShopOffer[];
}

export interface UsedItemOffer {
  price: number;
  shopName: string;
  itemName: string;
  itemUrl: string;
  isTrustedShop?: boolean;
}

export interface UsedMarketData {
  productId: string;
  skuId: string;
  keyword: string;
  genreId: string;
  minPrice: number;
  launchPrice: number | null;
  usedPricing: UsedPricing;
  offers: UsedShopOffer[];
  used: UsedItemOffer;
  unused: UsedItemOffer | null;
  /** （現在の中古最安値 ÷ 発売時Apple直販価格）× 100 */
  resaleRate: number | null;
  /** 'api' = 楽天またはYahoo! APIから実取得, 'mock' = キー未設定時の推定フォールバック */
  source: 'api' | 'mock';
  /** 実APIから取得した実在庫データがない推定相場の場合 true */
  isEstimated: boolean;
  /** 楽天市場の条件付き検索URL（アフィリエイト対応） */
  rakutenSearchUrl: string;
  /** Yahoo!ショッピングの条件付き検索URL（アフィリエイト対応） */
  yahooSearchUrl: string;
  fetchedAt: string;
}

/**
 * 商品タイトルから状態ランク (`conditionRank`) を自動判定する
 * - `"unused"`: タイトルに `未使用` / `新古` / `未開封` を含む
 * - `"rankA"`: タイトルに `Aランク` / `ランクA` / `超美品` / `極美品` / `美品` / `Sランク` を含む
 * - `"rankB"`: タイトルに `Bランク` / `ランクB` / `良品` を含む
 * - `"rankC"`: タイトルに `Cランク` / `ランクC` を含む
 * - `"used"`: 上記以外の一般中古品
 */
export function inferConditionRank(title: string, defaultRank: UsedConditionRank = 'used'): UsedConditionRank {
  const norm = String(title ?? '').normalize('NFKC');
  if (/未使用|新古|未開封/i.test(norm)) return 'unused';
  if (/Aランク|ランクA|超美品|極美品|美品|Sランク|ランクS/i.test(norm)) return 'rankA';
  if (/Bランク|ランクB|良品/i.test(norm)) return 'rankB';
  if (/Cランク|ランクC/i.test(norm)) return 'rankC';
  return defaultRank;
}

/**
 * 商品タイトルに `SIMフリー` または `SIMロック解除` を含むか判定する
 */
export function inferSimFree(title: string): boolean {
  const norm = String(title ?? '').normalize('NFKC');
  return /SIMフリー|SIMロック解除/i.test(norm);
}

/**
 * 複数の出品リストを結合・重複排除・価格昇順ソートし、最大 `maxOffers` 件（デフォルト15件）を返す
 */
export function mergeAndSortShopOffers(
  offerLists: Array<UsedShopOffer[] | undefined | null>,
  maxOffers = 15,
): UsedShopOffer[] {
  const seen = new Set<string>();
  const merged: UsedShopOffer[] = [];
  for (const list of offerLists) {
    if (!Array.isArray(list)) continue;
    for (const raw of list) {
      if (!raw || !Number.isFinite(Number(raw.price)) || Number(raw.price) <= 0) continue;
      const platform: UsedPlatformId = raw.platform === 'yahoo' ? 'yahoo' : 'rakuten';
      const price = Number(raw.price);
      const title = String(raw.title ?? '').trim();
      const shopName = String(raw.shopName || (platform === 'yahoo' ? 'Yahoo!ショッピング店' : '楽天市場ショップ')).trim();
      const dedupeKey = `${platform}:${price}:${shopName}:${title.slice(0, 48)}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      const isTrusted = typeof raw.isTrusted === 'boolean' ? raw.isTrusted : isTrustedShop(shopName);
      const conditionRank: UsedConditionRank = raw.conditionRank || inferConditionRank(title, 'used');
      const simFree = typeof raw.simFree === 'boolean' ? raw.simFree : inferSimFree(title);
      merged.push({
        platform,
        price,
        title,
        shopName,
        isTrusted,
        conditionRank,
        simFree,
        url: String(raw.url || ''),
      });
    }
  }
  merged.sort((a, b) => a.price - b.price);
  return merged.slice(0, maxOffers);
}

/**
 * ショップ名が信頼できる大手中古ショップに該当するか判定する
 */
export function isTrustedShop(shopName: string): boolean {
  const norm = String(shopName ?? '').normalize('NFKC').toUpperCase();
  if (!norm) return false;
  return NORMALIZED_TRUSTED_SHOPS.some((k) => norm.includes(k.norm));
}

/**
 * 厳密タイトル検証関数 (`isValidProductTitle`)
 * 1. NFKC正規化後にブラックリスト語句を完全除外
 * 2. 別モデル（Pro / Plus / Max / mini / e / Air 等）の誤爆を厳密に防止
 * 3. ストレージ容量の一致確認と他容量の除外
 */
export function isValidProductTitle(
  title: string,
  productName: string,
  storage = '',
  category = '',
): boolean {
  if (!title || !productName) return false;
  const normTitle = String(title).normalize('NFKC');
  const upperTitle = normTitle.toUpperCase();
  const normProd = String(productName).normalize('NFKC').trim();
  const upperProd = normProd.toUpperCase();

  // [条件3] ブラックリスト文字列が1つでも含まれる場合は無条件で除外
  for (const word of NORMALIZED_BLACKLIST) {
    if (upperTitle.includes(word)) return false;
  }

  // [条件1] 別モデル（上位/下位機種）の誤爆防止
  if (/^IPHONE/i.test(normProd) || category === 'iPhone') {
    if (!upperTitle.includes('IPHONE')) return false;

    const seMatch = normProd.match(/^iPhone\s*SE/i);
    if (seMatch) {
      if (!/IPHONE\s*SE\b/i.test(upperTitle)) return false;
      if (/第3世代|3rd/i.test(normProd) && !/第3世代|3世代|3RD|SE3|SE\s*3|2022/i.test(upperTitle)) return false;
      if (/第2世代|2nd/i.test(normProd) && !/第2世代|2世代|2ND|SE2|SE\s*2|2020/i.test(upperTitle)) return false;
    } else {
      const m = normProd.match(/^iPhone\s*(\d+|X[SR]?|X)\b/i);
      const eModel = normProd.match(/^iPhone\s*(\d+)e\b/i);
      const modelCode = (eModel ? eModel[1] : m ? m[1] : '').toUpperCase();
      if (modelCode) {
        const wantPro = /\bPRO\b/i.test(normProd);
        const wantMax = /\bMAX\b/i.test(normProd);
        const wantPlus = /\bPLUS\b/i.test(normProd);
        const wantMini = /\bMINI\b/i.test(normProd);
        const wantE = Boolean(eModel) || new RegExp(`^IPHONE\\s*${modelCode}\\s*E\\b`, 'i').test(normProd);

        if (wantE) {
          const eRe = new RegExp(`IPHONE\\s*${modelCode}\\s*E(?![A-Z0-9])`, 'i');
          if (!eRe.test(upperTitle)) return false;
        } else {
          const baseRe = new RegExp(`IPHONE\\s*${modelCode}(?![0-9A-Z]|\\s*E\\b)`, 'i');
          if (!baseRe.test(upperTitle)) return false;
          const afterModelRe = new RegExp(
            `IPHONE\\s*${modelCode}\\s*(PRO|PLUS|MAX|MINI|E)\\b`,
            'i',
          );
          if (!wantPro && !wantPlus && !wantMax && !wantMini && afterModelRe.test(upperTitle)) {
            return false;
          }
        }

        if (wantPro !== /\bPRO\b/i.test(upperTitle)) return false;
        if (wantMax !== /\bMAX\b/i.test(upperTitle)) return false;
        if (wantPlus !== /\bPLUS\b/i.test(upperTitle)) return false;
        if (wantMini !== /\bMINI\b/i.test(upperTitle)) return false;

        // 別のiPhoneナンバーが併記されているタイトルを除外
        const otherNums = ['11', '12', '13', '14', '15', '16', '17'].filter((n) => n !== modelCode);
        for (const on of otherNums) {
          if (new RegExp(`IPHONE\\s*${on}(?![0-9])`, 'i').test(upperTitle)) return false;
        }
      }
    }
  } else if (/^IPAD/i.test(normProd) || category === 'iPad') {
    if (!upperTitle.includes('IPAD')) return false;
    const wantAir = /\bAIR\b/i.test(normProd);
    const wantPro = /\bPRO\b/i.test(normProd);
    const wantMini = /\bMINI\b/i.test(normProd);

    if (wantAir !== /\bAIR\b/i.test(upperTitle)) return false;
    if (wantPro !== /\bPRO\b/i.test(upperTitle)) return false;
    if (wantMini !== /\bMINI\b/i.test(upperTitle)) return false;

    const genMatch = normProd.match(/第(\d+)世代|(\d+)(?:st|nd|rd|th)\s+generation/i);
    if (genMatch) {
      const genNum = genMatch[1] || genMatch[2];
      const genRe = new RegExp(`(第\\s*${genNum}\\s*世代|${genNum}\\s*世代|${genNum}TH|第${genNum})`, 'i');
      if (!genRe.test(upperTitle)) return false;
    }

    const chipMatch = normProd.match(/\b(M\d+)\b/i);
    if (chipMatch) {
      const chip = chipMatch[1].toUpperCase();
      if (!new RegExp(`\\b${chip}\\b`, 'i').test(upperTitle)) return false;
    }

    const inchMatch = normProd.match(/(\d+(?:\.\d+)?)\s*(?:インチ|-inch)/i);
    if (inchMatch) {
      const inch = inchMatch[1].replace('.', '\\.');
      if (!new RegExp(`(?<!\\d)${inch}\\s*(?:インチ|INCH|型)?`, 'i').test(upperTitle)) return false;
    }
  } else if (/WATCH/i.test(normProd) || category === 'Apple Watch' || category === 'Watch') {
    if (!upperTitle.includes('WATCH')) return false;
    const wantUltra = /\bULTRA\b/i.test(normProd);
    const wantSE = /\bSE\b/i.test(normProd);
    const seriesMatch = normProd.match(/Series\s*(\d+)/i);

    if (wantUltra !== /\bULTRA\b/i.test(upperTitle)) return false;
    if (wantSE !== /\bSE\b/i.test(upperTitle)) return false;
    if (seriesMatch) {
      const sNum = seriesMatch[1];
      const sRe = new RegExp(`(SERIES\\s*${sNum}|S${sNum})(?![0-9])`, 'i');
      if (!sRe.test(upperTitle)) return false;
    }
  } else if (/MAC/i.test(normProd) || category === 'Mac') {
    if (/MACBOOK\s*AIR/i.test(normProd)) {
      if (!/MACBOOK\s*AIR/i.test(upperTitle) || /MACBOOK\s*PRO/i.test(upperTitle)) return false;
    } else if (/MACBOOK\s*PRO/i.test(normProd)) {
      if (!/MACBOOK\s*PRO/i.test(upperTitle) || /MACBOOK\s*AIR/i.test(upperTitle)) return false;
    } else if (/MAC\s*MINI/i.test(normProd)) {
      if (!/MAC\s*MINI/i.test(upperTitle)) return false;
    } else if (/IMAC/i.test(normProd)) {
      if (!/\bIMAC\b/i.test(upperTitle)) return false;
    } else if (/MAC\s*STUDIO/i.test(normProd)) {
      if (!/MAC\s*STUDIO/i.test(upperTitle)) return false;
    }
    const chipMatch = normProd.match(/\b(M\d+)\b/i);
    if (chipMatch) {
      const chip = chipMatch[1].toUpperCase();
      if (!new RegExp(`\\b${chip}\\b`, 'i').test(upperTitle)) return false;
    }
  } else {
    if (!upperTitle.includes(upperProd)) return false;
  }

  // [条件2] ストレージ容量の一致確認（Watch以外の容量指定SKU）
  const isWatch = /WATCH/i.test(normProd) || category === 'Apple Watch' || category === 'Watch';
  const storMatch = String(storage ?? '').normalize('NFKC').toUpperCase().match(/\b(\d+)\s*(GB|TB)\b/);
  if (storMatch && !isWatch) {
    const targetNum = storMatch[1];
    const targetUnit = storMatch[2];
    const targetCap = `${targetNum}${targetUnit}`;

    const targetRe =
      targetUnit === 'GB'
        ? new RegExp(`(?<!\\d)${targetNum}\\s*G(?:B)?(?![A-Z0-9])`, 'i')
        : new RegExp(`(?<!\\d)${targetNum}\\s*T(?:B)?(?![A-Z0-9])`, 'i');

    if (!targetRe.test(upperTitle)) return false;

    const isMac = /MAC/i.test(normProd) || category === 'Mac';
    for (const cap of ALL_CAPACITIES) {
      if (cap === targetCap) continue;
      if (isMac && (cap === '16GB' || cap === '32GB')) continue;
      const mCap = cap.match(/^(\d+)(GB|TB)$/);
      if (!mCap) continue;
      const otherRe =
        mCap[2] === 'GB'
          ? new RegExp(`(?<!\\d)${mCap[1]}\\s*G(?:B)?(?![A-Z0-9])`, 'i')
          : new RegExp(`(?<!\\d)${mCap[1]}\\s*T(?:B)?(?![A-Z0-9])`, 'i');
      if (otherRe.test(upperTitle)) return false;
    }
  }

  return true;
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

export function cleanSearchProductName(productName: string): string {
  return String(productName ?? '')
    .normalize('NFKC')
    .replace(/\((\d+)(?:st|nd|rd|th)\s+generation\)/i, '第$1世代')
    .replace(/[()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractStorageToken(storage: string, category = ''): string {
  if (/watch/i.test(category)) {
    const mm = String(storage ?? '').match(/\b(\d+mm)\b/i);
    return mm ? mm[1] : '';
  }
  const m = String(storage ?? '').normalize('NFKC').match(/\b(\d+\s*(?:GB|TB))\b/i);
  return m ? m[1].replace(/\s+/g, '') : '';
}

/** 楽天検索用キーワード `${製品名} ${容量} 中古` (または `未使用`) を組み立てる */
export function buildSearchKeyword(
  productName: string,
  storage: string,
  condition: '中古' | '未使用' = '中古',
  category = '',
): string {
  const cleanName = cleanSearchProductName(productName);
  const cleanStorage = extractStorageToken(storage, category);
  return [cleanName, cleanStorage, condition].filter(Boolean).join(' ');
}

/** Yahoo!ショッピングAPI (v3) 用フレーズ検索＋マイナス検索つきクエリを組み立てる */
export function buildYahooSearchQuery(productName: string, storage: string, category = ''): string {
  const cleanName = cleanSearchProductName(productName);
  const cleanStorage = extractStorageToken(storage, category);
  return [`"${cleanName}"`, cleanStorage, YAHOO_NEGATIVE_TERMS].filter(Boolean).join(' ');
}

/** 楽天市場 商品検索API のリクエストパラメータを生成する (hits=20) */
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
  const keyword = buildSearchKeyword(opts.productName, opts.storage, condition, opts.category);
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
    hits: '20',
  });
  if (opts.affiliateId) params.set('affiliateId', opts.affiliateId);
  if (opts.accessKey) params.set('accessKey', opts.accessKey);
  return params;
}

/** Yahoo!ショッピングAPI (v3) のリクエストパラメータを生成する (results=20) */
export function buildYahooSearchParams(opts: {
  yahooAppId: string;
  productName: string;
  storage: string;
  category: string;
  launchPrice?: number | null;
}): URLSearchParams {
  const query = buildYahooSearchQuery(opts.productName, opts.storage, opts.category);
  const genreCategoryId = getYahooGenreCategoryId(opts.category);
  const priceFrom = calcMinPrice(opts.launchPrice);

  return new URLSearchParams({
    appid: opts.yahooAppId,
    query,
    condition: 'used',
    genre_category_id: genreCategoryId,
    price_from: String(priceFrom),
    sort: '+price',
    results: '20',
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
  const keyword = buildSearchKeyword(opts.productName, opts.storage, opts.condition ?? '中古', opts.category);
  const genreId = getRakutenGenreId(opts.category);
  const minPrice = calcMinPrice(opts.launchPrice);
  const encodedKw = encodeURIComponent(keyword);
  const qs = new URLSearchParams({
    min: String(minPrice),
    nitem: RAKUTEN_NG_KEYWORD,
    s: '2',
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
  const cleanName = cleanSearchProductName(opts.productName);
  const cleanStorage = extractStorageToken(opts.storage, opts.category);
  const p = [cleanName, cleanStorage, '中古', '-ケース', '-フィルム', '-ジャンク'].filter(Boolean).join(' ');
  const cid = getYahooGenreCategoryId(opts.category);
  const pf = calcMinPrice(opts.launchPrice);
  const qs = new URLSearchParams({
    p,
    cid,
    pf: String(pf),
    used: '1',
    X: '2',
  });
  return `https://shopping.yahoo.co.jp/search?${qs.toString()}`;
}

/**
 * 候補リストから「大手ショップ (`isTrustedShop: true`) の最安値」を最優先で採用し、
 * 大手ショップが0件の場合のみ「一般ショップの最安値（参考価格）」を採用する
 */
function selectBestValidatedCandidate(
  candidates: UsedPlatformOffer[],
  offers: UsedShopOffer[] = [],
): UsedPlatformOffer | null {
  if (!candidates.length) return null;
  const sorted = [...candidates].sort((a, b) => a.price - b.price);
  const trusted = sorted.filter((c) => c.isTrustedShop);
  if (trusted.length > 0) return { ...trusted[0], offers };
  return { ...sorted[0], offers };
}

export function pickCheapestRakutenOffer(
  items: any[],
  minPrice: number,
  productName: string,
  storage = '',
  category = '',
  defaultRank: UsedConditionRank = 'used',
): UsedPlatformOffer | null {
  if (!Array.isArray(items)) return null;
  const today = new Date().toISOString().slice(0, 10);
  const candidates: UsedPlatformOffer[] = [];
  const rawOffers: UsedShopOffer[] = [];
  for (const raw of items.slice(0, 20)) {
    const it = raw?.Item ?? raw;
    if (!it) continue;
    const price = Number(it.itemPrice);
    const title = String(it.itemName ?? '');
    const shopName = String(it.shopName || '楽天市場ショップ');
    if (!Number.isFinite(price) || price < minPrice) continue;
    if (!isValidProductTitle(title, productName, storage, category)) continue;
    const url = String(it.affiliateUrl || it.itemUrl || '');
    const trusted = isTrustedShop(shopName);
    candidates.push({
      price,
      shopName,
      url,
      updatedAt: today,
      itemName: title,
      isTrustedShop: trusted,
      source: 'api',
    });
    rawOffers.push({
      platform: 'rakuten',
      price,
      title,
      shopName,
      isTrusted: trusted,
      conditionRank: inferConditionRank(title, defaultRank),
      simFree: inferSimFree(title),
      url,
    });
  }
  const offers = mergeAndSortShopOffers([rawOffers], 15);
  return selectBestValidatedCandidate(candidates, offers);
}

/**
 * Yahoo!ショッピングAPI (v3) の上位20件から
 * 厳密タイトル検証 (`isValidProductTitle`) ＋ 大手ショップ優先 (`isTrustedShop`) で最安の1件を採用する
 */
export function pickCheapestYahooOffer(
  hits: any[],
  minPrice: number,
  productName: string,
  storage = '',
  category = '',
  defaultRank: UsedConditionRank = 'used',
): UsedPlatformOffer | null {
  if (!Array.isArray(hits)) return null;
  const today = new Date().toISOString().slice(0, 10);
  const candidates: UsedPlatformOffer[] = [];
  const rawOffers: UsedShopOffer[] = [];
  for (const hit of hits.slice(0, 20)) {
    if (!hit) continue;
    const price = Number(hit.price);
    const title = String(hit.name ?? '');
    const shopName = String(hit.seller?.name || 'Yahoo!ショッピング店');
    if (!Number.isFinite(price) || price < minPrice) continue;
    if (!isValidProductTitle(title, productName, storage, category)) continue;
    const url = String(hit.url || '');
    const trusted = isTrustedShop(shopName);
    candidates.push({
      price,
      shopName,
      url,
      updatedAt: today,
      itemName: title,
      isTrustedShop: trusted,
      source: 'api',
    });
    rawOffers.push({
      platform: 'yahoo',
      price,
      title,
      shopName,
      isTrusted: trusted,
      conditionRank: inferConditionRank(title, defaultRank),
      simFree: inferSimFree(title),
      url,
    });
  }
  const offers = mergeAndSortShopOffers([rawOffers], 15);
  return selectBestValidatedCandidate(candidates, offers);
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

function hashCode(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function isRealApiOffer(offer: UsedPlatformOffer | null | undefined): boolean {
  if (!offer) return false;
  const src = String(offer.source ?? '');
  return src === 'api' || src === 'live';
}

/**
 * 実APIから取得されたオファーのみから出品リスト（最大15件）を構築する。
 * 推定相場時（実APIデータ未取得時）には架空の店舗名やダミー出品を一切生成せず空配列を返す。
 */
export function buildRealShopOffers(params: {
  rakutenOffer: UsedPlatformOffer | null;
  yahooOffer: UsedPlatformOffer | null;
  existingOffers?: UsedShopOffer[];
  isEstimated: boolean;
}): UsedShopOffer[] {
  const { rakutenOffer, yahooOffer, existingOffers, isEstimated } = params;
  if (isEstimated) return [];

  const directOffers: UsedShopOffer[] = [];
  if (rakutenOffer && isRealApiOffer(rakutenOffer) && rakutenOffer.price > 0 && rakutenOffer.shopName) {
    const rTitle = rakutenOffer.itemName || `${rakutenOffer.shopName} 出品`;
    directOffers.push({
      platform: 'rakuten',
      price: rakutenOffer.price,
      title: rTitle,
      shopName: rakutenOffer.shopName,
      isTrusted: rakutenOffer.isTrustedShop ?? isTrustedShop(rakutenOffer.shopName),
      conditionRank: inferConditionRank(rTitle, 'used'),
      simFree: inferSimFree(rTitle),
      url: rakutenOffer.url,
    });
  }
  if (yahooOffer && isRealApiOffer(yahooOffer) && yahooOffer.price > 0 && yahooOffer.shopName) {
    const yTitle = yahooOffer.itemName || `${yahooOffer.shopName} 出品`;
    directOffers.push({
      platform: 'yahoo',
      price: yahooOffer.price,
      title: yTitle,
      shopName: yahooOffer.shopName,
      isTrusted: yahooOffer.isTrustedShop ?? isTrustedShop(yahooOffer.shopName),
      conditionRank: inferConditionRank(yTitle, 'used'),
      simFree: inferSimFree(yTitle),
      url: yahooOffer.url,
    });
  }

  return mergeAndSortShopOffers(
    [
      existingOffers,
      isRealApiOffer(rakutenOffer) ? rakutenOffer?.offers : undefined,
      isRealApiOffer(yahooOffer) ? yahooOffer?.offers : undefined,
      directOffers,
    ],
    15,
  );
}

/** 楽天・Yahoo!のオファーから `UsedPricing` 横断比較オブジェクトを組み立てる */
export function buildUsedPricing(
  rakutenOffer: UsedPlatformOffer | null,
  yahooOffer: UsedPlatformOffer | null,
  launchPrice: number | null | undefined,
  extraOffers?: UsedShopOffer[],
): UsedPricing {
  const rIsApi = isRealApiOffer(rakutenOffer);
  const yIsApi = isRealApiOffer(yahooOffer);
  const anyApi = rIsApi || yIsApi;
  const rTrusted = rIsApi && Boolean(rakutenOffer?.isTrustedShop);
  const yTrusted = yIsApi && Boolean(yahooOffer?.isTrustedShop);

  let lowestPlatform: UsedPlatformId = 'rakuten';
  let lowestPrice = rakutenOffer?.price ?? yahooOffer?.price ?? 0;

  const pickCheaper = (r: UsedPlatformOffer, y: UsedPlatformOffer) => {
    if (rTrusted && !yTrusted) {
      lowestPlatform = 'rakuten';
      lowestPrice = r.price;
    } else if (!rTrusted && yTrusted) {
      lowestPlatform = 'yahoo';
      lowestPrice = y.price;
    } else if (y.price < r.price) {
      lowestPlatform = 'yahoo';
      lowestPrice = y.price;
    } else {
      lowestPlatform = 'rakuten';
      lowestPrice = r.price;
    }
  };

  if (rIsApi && yIsApi && rakutenOffer && yahooOffer) {
    pickCheaper(rakutenOffer, yahooOffer);
  } else if (rIsApi && rakutenOffer) {
    lowestPlatform = 'rakuten';
    lowestPrice = rakutenOffer.price;
  } else if (yIsApi && yahooOffer) {
    lowestPlatform = 'yahoo';
    lowestPrice = yahooOffer.price;
  } else if (rakutenOffer && yahooOffer) {
    pickCheaper(rakutenOffer, yahooOffer);
  } else if (yahooOffer) {
    lowestPlatform = 'yahoo';
    lowestPrice = yahooOffer.price;
  }

  const offers = anyApi
    ? mergeAndSortShopOffers(
        [
          extraOffers,
          rIsApi ? rakutenOffer?.offers : undefined,
          yIsApi ? yahooOffer?.offers : undefined,
        ],
        15,
      )
    : [];

  return {
    lowestPrice,
    lowestPlatform,
    resaleValuePercent: calcResaleRate(lowestPrice, launchPrice),
    isEstimated: !anyApi,
    rakuten: rakutenOffer
      ? {
          ...rakutenOffer,
          shopName: rIsApi ? rakutenOffer.shopName : '',
          isTrustedShop: rIsApi ? (rakutenOffer.isTrustedShop ?? isTrustedShop(rakutenOffer.shopName)) : false,
          source: rIsApi ? 'api' : 'mock',
        }
      : null,
    yahoo: yahooOffer
      ? {
          ...yahooOffer,
          shopName: yIsApi ? yahooOffer.shopName : '',
          isTrustedShop: yIsApi ? (yahooOffer.isTrustedShop ?? isTrustedShop(yahooOffer.shopName)) : false,
          source: yIsApi ? 'api' : 'mock',
        }
      : null,
    ...(offers.length > 0 ? { offers } : {}),
  };
}

/**
 * APIキー未設定時またはオフライン時の推定中古・未使用品最安値ジェネレータ
 * （実データ未取得時は特定の店舗名や「大手認定」を一切付与しない）
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
  const keyword = buildSearchKeyword(product.name, storageLabel, '中古', product.category);
  const today = new Date().toISOString().slice(0, 10);
  const seed = hashCode(`${product.id}:${sku.id}`);

  const rakutenSearchUrl = buildRakutenWebUrl({
    productName: product.name,
    storage: storageLabel,
    category: product.category,
    launchPrice,
    condition: '中古',
  });
  const yahooSearchUrl = buildYahooWebUrl({
    productName: product.name,
    storage: storageLabel,
    category: product.category,
    launchPrice,
  });

  if (sku.usedPricing && sku.usedPricing.lowestPrice > 0) {
    const rIsApi = isRealApiOffer(sku.usedPricing.rakuten);
    const yIsApi = isRealApiOffer(sku.usedPricing.yahoo);
    const hasRealApi = !sku.usedPricing.isEstimated && (rIsApi || yIsApi);

    const normalizedRakuten: UsedPlatformOffer | null = sku.usedPricing.rakuten
      ? {
          ...sku.usedPricing.rakuten,
          shopName: rIsApi ? sku.usedPricing.rakuten.shopName : '',
          url: sku.usedPricing.rakuten.url || rakutenSearchUrl,
          isTrustedShop: rIsApi
            ? (sku.usedPricing.rakuten.isTrustedShop ?? isTrustedShop(sku.usedPricing.rakuten.shopName))
            : false,
          source: rIsApi ? 'api' : 'mock',
        }
      : null;
    const normalizedYahoo: UsedPlatformOffer | null = sku.usedPricing.yahoo
      ? {
          ...sku.usedPricing.yahoo,
          shopName: yIsApi ? sku.usedPricing.yahoo.shopName : '',
          url: sku.usedPricing.yahoo.url || yahooSearchUrl,
          isTrustedShop: yIsApi
            ? (sku.usedPricing.yahoo.isTrustedShop ?? isTrustedShop(sku.usedPricing.yahoo.shopName))
            : false,
          source: yIsApi ? 'api' : 'mock',
        }
      : null;

    const offers = buildRealShopOffers({
      rakutenOffer: normalizedRakuten,
      yahooOffer: normalizedYahoo,
      existingOffers: hasRealApi ? sku.usedPricing.offers : [],
      isEstimated: !hasRealApi,
    });

    const up: UsedPricing = {
      ...sku.usedPricing,
      isEstimated: !hasRealApi,
      rakuten: normalizedRakuten,
      yahoo: normalizedYahoo,
      offers,
    };
    const best = up.lowestPlatform === 'yahoo' ? up.yahoo ?? up.rakuten : up.rakuten ?? up.yahoo;
    const unusedOfferFromOffers = offers.find((o) => o.conditionRank === 'unused');
    return {
      productId: product.id,
      skuId: sku.id,
      keyword,
      genreId,
      minPrice,
      launchPrice,
      usedPricing: up,
      offers,
      used: {
        price: up.lowestPrice,
        shopName: hasRealApi ? (best?.shopName ?? '') : '',
        itemName: hasRealApi ? (best?.itemName ?? '') : '',
        itemUrl: best?.url ?? (up.lowestPlatform === 'yahoo' ? yahooSearchUrl : rakutenSearchUrl),
        isTrustedShop: hasRealApi ? Boolean(best?.isTrustedShop) : false,
      },
      unused:
        hasRealApi && unusedOfferFromOffers
          ? {
              price: unusedOfferFromOffers.price,
              shopName: unusedOfferFromOffers.shopName,
              itemName: unusedOfferFromOffers.title,
              itemUrl: unusedOfferFromOffers.url,
              isTrustedShop: unusedOfferFromOffers.isTrusted,
            }
          : null,
      resaleRate: up.resaleValuePercent ?? calcResaleRate(up.lowestPrice, launchPrice),
      source: hasRealApi ? 'api' : 'mock',
      isEstimated: !hasRealApi,
      rakutenSearchUrl,
      yahooSearchUrl,
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
  const jitter = ((seed % 7) - 3) * 0.008;
  const rawRatio = Math.min(0.9, Math.max(0.18, catFactor * decay + jitter));

  const baseUsed = Math.max(minPrice, Math.round((basePrice * rawRatio) / 1000) * 1000 - 200);
  const yahooDelta = seed % 2 === 0 ? -1000 : 1000;
  const rakutenPrice = Math.max(minPrice, baseUsed);
  const yahooPrice = Math.max(minPrice, baseUsed + yahooDelta);

  const rakutenOffer: UsedPlatformOffer = {
    price: rakutenPrice,
    shopName: '',
    url: rakutenSearchUrl,
    updatedAt: today,
    isTrustedShop: false,
    source: 'mock',
  };

  const yahooOffer: UsedPlatformOffer = {
    price: yahooPrice,
    shopName: '',
    url: yahooSearchUrl,
    updatedAt: today,
    isTrustedShop: false,
    source: 'mock',
  };

  const usedPricing = buildUsedPricing(rakutenOffer, yahooOffer, launchPrice, []);
  const bestOffer = usedPricing.lowestPlatform === 'yahoo' ? yahooOffer : rakutenOffer;

  return {
    productId: product.id,
    skuId: sku.id,
    keyword,
    genreId,
    minPrice,
    launchPrice,
    usedPricing,
    offers: [],
    used: {
      price: usedPricing.lowestPrice,
      shopName: '',
      itemName: '',
      itemUrl: bestOffer.url,
      isTrustedShop: false,
    },
    unused: null,
    resaleRate: usedPricing.resaleValuePercent,
    source: 'mock',
    isEstimated: true,
    rakutenSearchUrl,
    yahooSearchUrl,
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * 楽天市場API ＆ Yahoo!ショッピングAPI (v3) を呼び出して横断最安値を取得する関数
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
  const keyword = buildSearchKeyword(product.name, storageTerm, '中古', product.category);
  const appId = options?.appId?.trim() || resolveRakutenAppId();
  const yahooAppId = options?.yahooAppId?.trim() || resolveYahooAppId();
  const fallback = estimateUsedMarketData(product, sku);

  // 1) ローカル/Cloudflare の `/api/used-price` プロキシエンドポイントが利用可能な場合
  if (typeof window !== 'undefined') {
    try {
      const proxyParams = new URLSearchParams({
        productId: product.id,
        skuId: sku.id,
        productName: product.name,
        storage: storageTerm,
        category: product.category,
        launchPrice: launchPrice ? String(launchPrice) : '',
        releaseDate: product.releaseDate || '',
      });
      const res = await fetch(`/api/used-price?${proxyParams.toString()}`);
      if (res.ok) {
        const data = await res.json();
        if (data && data.usedPricing && typeof data.usedPricing.lowestPrice === 'number') {
          const isApiSource =
            data.source === 'api' ||
            isRealApiOffer(data.usedPricing.rakuten) ||
            isRealApiOffer(data.usedPricing.yahoo);
          const rOffer = data.usedPricing.rakuten
            ? {
                ...data.usedPricing.rakuten,
                shopName: isRealApiOffer(data.usedPricing.rakuten) ? data.usedPricing.rakuten.shopName : '',
                isTrustedShop: isRealApiOffer(data.usedPricing.rakuten)
                  ? (data.usedPricing.rakuten.isTrustedShop ?? isTrustedShop(data.usedPricing.rakuten.shopName))
                  : false,
              }
            : fallback.usedPricing.rakuten;
          const yOffer = data.usedPricing.yahoo
            ? {
                ...data.usedPricing.yahoo,
                shopName: isRealApiOffer(data.usedPricing.yahoo) ? data.usedPricing.yahoo.shopName : '',
                isTrustedShop: isRealApiOffer(data.usedPricing.yahoo)
                  ? (data.usedPricing.yahoo.isTrustedShop ?? isTrustedShop(data.usedPricing.yahoo.shopName))
                  : false,
              }
            : fallback.usedPricing.yahoo;
          const apiOffers: UsedShopOffer[] = isApiSource
            ? Array.isArray(data.usedPricing.offers)
              ? data.usedPricing.offers
              : Array.isArray(data.offers)
                ? data.offers
                : []
            : [];
          const up = buildUsedPricing(rOffer, yOffer, launchPrice, apiOffers);
          const best = up.lowestPlatform === 'yahoo' ? up.yahoo ?? up.rakuten! : up.rakuten ?? up.yahoo!;
          const result: UsedMarketData = {
            productId: product.id,
            skuId: sku.id,
            keyword,
            genreId,
            minPrice,
            launchPrice,
            usedPricing: up,
            offers: isApiSource ? (up.offers ?? []) : [],
            used: {
              price: up.lowestPrice,
              shopName: isApiSource ? best.shopName : '',
              itemName: isApiSource ? (best.itemName ?? '') : '',
              itemUrl: best.url,
              isTrustedShop: isApiSource ? Boolean(best.isTrustedShop) : false,
            },
            unused: isApiSource ? (data.unused ?? null) : null,
            resaleRate: up.resaleValuePercent,
            source: isApiSource ? 'api' : 'mock',
            isEstimated: !isApiSource,
            rakutenSearchUrl: fallback.rakutenSearchUrl,
            yahooSearchUrl: fallback.yahooSearchUrl,
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

  // 2) RAKUTEN_APP_ID または YAHOO_APP_ID が設定されている場合
  if (appId || yahooAppId) {
    let rakutenOffer = null as UsedPlatformOffer | null;
    let yahooOffer = null as UsedPlatformOffer | null;
    let unusedOffer = null as UsedItemOffer | null;
    let unusedOffersList: UsedShopOffer[] = [];

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
                rakutenOffer = pickCheapestRakutenOffer(
                  usedJson?.Items ?? [],
                  minPrice,
                  product.name,
                  storageTerm,
                  product.category,
                  'used',
                );
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
                const u = pickCheapestRakutenOffer(
                  unusedJson?.Items ?? [],
                  minPrice,
                  product.name,
                  storageTerm,
                  product.category,
                  'unused',
                );
                if (u) {
                  unusedOffersList = u.offers ?? [];
                  unusedOffer = {
                    price: u.price,
                    shopName: u.shopName,
                    itemName: u.itemName ?? '',
                    itemUrl: u.url,
                    isTrustedShop: Boolean(u.isTrustedShop),
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
                yahooOffer = pickCheapestYahooOffer(
                  yJson?.hits ?? [],
                  minPrice,
                  product.name,
                  storageTerm,
                  product.category,
                  'used',
                );
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
      const combinedOffers = mergeAndSortShopOffers(
        [rakutenOffer?.offers, yahooOffer?.offers, unusedOffersList],
        15,
      );
      const usedPricing = buildUsedPricing(
        finalRakuten,
        finalYahoo,
        launchPrice,
        combinedOffers,
      );
      const best = usedPricing.lowestPlatform === 'yahoo' ? finalYahoo! : finalRakuten!;
      const result: UsedMarketData = {
        productId: product.id,
        skuId: sku.id,
        keyword,
        genreId,
        minPrice,
        launchPrice,
        usedPricing,
        offers: usedPricing.offers ?? [],
        used: {
          price: usedPricing.lowestPrice,
          shopName: best.shopName,
          itemName: best.itemName ?? '',
          itemUrl: best.url,
          isTrustedShop: Boolean(best.isTrustedShop),
        },
        unused: unusedOffer ?? null,
        resaleRate: usedPricing.resaleValuePercent,
        source: 'api',
        isEstimated: false,
        rakutenSearchUrl: fallback.rakutenSearchUrl,
        yahooSearchUrl: fallback.yahooSearchUrl,
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
