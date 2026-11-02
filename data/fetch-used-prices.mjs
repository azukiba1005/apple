/**
 * 楽天市場 商品検索API (IchibaItem/Search/20220601) ＆
 * Yahoo!ショッピング 商品検索API (v3: ShoppingWebService/V3/itemSearch)
 * 横断中古最安値・リセールバリュー取得モジュール＆CLIスクリプト
 *
 * 使い方:
 *   node data/fetch-used-prices.mjs
 *   (環境変数 RAKUTEN_APP_ID / YAHOO_APP_ID を .env から読み込み。片方のみの設定や未設定でも動作します)
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// ローカルの .env があれば自動で読み込む
if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '').trim();
    }
  }
}

/* ---------- 1. エンドポイント・定数 ---------- */
export const RAKUTEN_API_ENDPOINT = 'https://app.rakuten.co.jp/services/api/IchibaItem/Search/20220601';
export const RAKUTEN_OPENAPI_ENDPOINT = 'https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20220601';
export const YAHOO_API_ENDPOINT = 'https://shopping.yahooapis.jp/ShoppingWebService/V3/itemSearch';

export const RAKUTEN_NG_KEYWORD =
  'ケース フィルム カバー 保護 ガラス 修理 レンタル ジャンク 部品 交換 バッテリー バンド ベルト';

export const YAHOO_NEGATIVE_TERMS =
  '-ケース -フィルム -カバー -ガラス -修理 -レンタル -ジャンク -バッテリー -交換 -バンド -ベルト';

export const RAKUTEN_GENRE_IDS = {
  iPhone: '560202',
  iPad: '560029',
  Mac: '100040',
  'Apple Watch': '564500',
  Watch: '564500',
};

export const YAHOO_GENRE_CATEGORY_IDS = {
  iPhone: '38338',        // スマホ本体
  iPad: '38340',          // タブレット本体
  Mac: '2514',            // Macノート
  'Apple Watch': '49950', // スマートウォッチ
  Watch: '49950',
};

// 商品名による二次除外フィルタ（ジャンク・難あり・訳あり・アクセサリー類を除外）
const YAHOO_EXCLUDE_TITLE_RE =
  /ジャンク|難あり|訳あり|訳有|ケース|フィルム|カバー|保護|ガラス|修理|レンタル|部品|バッテリー交換|バンドのみ|ベルトのみ|モックアップ|空箱|箱のみ/;

const RAKUTEN_EXCLUDE_TITLE_RE =
  /ジャンク|難あり|訳あり|訳有|ケース|フィルム|カバー|保護|ガラス|修理|レンタル|部品|交換|バッテリー交換|バンドのみ|ベルトのみ|モックアップ|空箱|箱のみ/;

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

export function getRakutenGenreId(category) {
  if (RAKUTEN_GENRE_IDS[category]) return RAKUTEN_GENRE_IDS[category];
  if (/watch/i.test(category)) return RAKUTEN_GENRE_IDS.Watch;
  if (/ipad/i.test(category)) return RAKUTEN_GENRE_IDS.iPad;
  if (/mac/i.test(category)) return RAKUTEN_GENRE_IDS.Mac;
  return RAKUTEN_GENRE_IDS.iPhone;
}

export function getYahooGenreCategoryId(category) {
  if (YAHOO_GENRE_CATEGORY_IDS[category]) return YAHOO_GENRE_CATEGORY_IDS[category];
  if (/watch/i.test(category)) return YAHOO_GENRE_CATEGORY_IDS.Watch;
  if (/ipad/i.test(category)) return YAHOO_GENRE_CATEGORY_IDS.iPad;
  if (/mac/i.test(category)) return YAHOO_GENRE_CATEGORY_IDS.Mac;
  return YAHOO_GENRE_CATEGORY_IDS.iPhone;
}

/** 発売時価格の15%（または最低5,000円）を下限に設定 */
export function calcMinPrice(launchPrice) {
  const n = Number(launchPrice);
  if (!Number.isFinite(n) || n <= 0) return 5000;
  return Math.max(Math.round(n * 0.15), 5000);
}

export function buildRakutenKeyword(productName, storage, condition = '中古') {
  const cleanName = String(productName ?? '').replace(/\s+/g, ' ').trim();
  const cleanStorage = storage && storage !== '-' ? String(storage).trim() : '';
  return [cleanName, cleanStorage, condition].filter(Boolean).join(' ');
}

/** Yahoo!ショッピングAPI (v3) 用クエリ（マイナス検索つき） */
export function buildYahooQuery(productName, storage) {
  const cleanName = String(productName ?? '').replace(/\s+/g, ' ').trim();
  const cleanStorage = storage && storage !== '-' ? String(storage).trim() : '';
  return [cleanName, cleanStorage, YAHOO_NEGATIVE_TERMS].filter(Boolean).join(' ');
}

export function buildRakutenWebSearchUrl({ productName, storage, category, launchPrice, condition = '中古' }) {
  const keyword = buildRakutenKeyword(productName, storage, condition);
  const genreId = getRakutenGenreId(category);
  const minPrice = calcMinPrice(launchPrice);
  const qs = new URLSearchParams({
    min: String(minPrice),
    nitem: RAKUTEN_NG_KEYWORD,
    s: '2',
  });
  return `https://search.rakuten.co.jp/search/mall/${encodeURIComponent(keyword)}/${genreId}/?${qs.toString()}`;
}

export function buildYahooWebSearchUrl({ productName, storage, category, launchPrice }) {
  const cleanName = String(productName ?? '').replace(/\s+/g, ' ').trim();
  const cleanStorage = storage && storage !== '-' ? String(storage).trim() : '';
  const p = [cleanName, cleanStorage, '中古'].filter(Boolean).join(' ');
  const cid = getYahooGenreCategoryId(category);
  const pf = calcMinPrice(launchPrice);
  const qs = new URLSearchParams({
    p,
    cid,
    pf: String(pf),
    used: '1',
    X: '2', // 価格が安い順
  });
  return `https://shopping.yahoo.co.jp/search?${qs.toString()}`;
}

function hashCode(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/**
 * 推定相場ジェネレータ（APIキー未設定時・通信エラー時のフォールバック）
 */
export function estimatePlatformOffers({
  productName,
  storage = '',
  category = 'iPhone',
  launchPrice = 98800,
  releaseDate = '2023-09-22',
}) {
  const basePrice = Number(launchPrice) > 0 ? Number(launchPrice) : 98800;
  const minPrice = calcMinPrice(basePrice);
  const today = new Date().toISOString().slice(0, 10);

  const relMs = Date.parse(`${releaseDate}T00:00:00Z`);
  const ageYears = Math.max(0, (Date.now() - (Number.isFinite(relMs) ? relMs : Date.now())) / (365.25 * 864e5));
  const catFactor =
    category === 'iPhone' ? 0.84 : category === 'iPad' ? 0.78 : category === 'Mac' ? 0.75 : 0.68;
  const decay = Math.pow(0.86, ageYears);
  const seed = hashCode(`${productName}:${storage}`);
  const jitter = ((seed % 7) - 3) * 0.008;
  const ratio = Math.min(0.9, Math.max(0.18, catFactor * decay + jitter));

  const baseUsed = Math.max(minPrice, Math.round((basePrice * ratio) / 1000) * 1000 - 200);
  // モデルごとに楽天が安いケースとYahooが安いケースを再現
  const yahooDelta = seed % 2 === 0 ? -1000 : 1000;
  const rakutenPrice = Math.max(minPrice, baseUsed);
  const yahooPrice = Math.max(minPrice, baseUsed + yahooDelta);
  const unusedPrice = Math.max(
    Math.max(rakutenPrice, yahooPrice) + 3000,
    Math.min(
      Math.round((basePrice * 0.96) / 1000) * 1000 - 200,
      Math.round((baseUsed * 1.14) / 1000) * 1000 - 200,
    ),
  );

  const rakutenOffer = {
    price: rakutenPrice,
    shopName: MOCK_RAKUTEN_SHOPS[seed % MOCK_RAKUTEN_SHOPS.length],
    url: buildRakutenWebSearchUrl({ productName, storage, category, launchPrice: basePrice, condition: '中古' }),
    updatedAt: today,
    itemName: `【中古】${productName} ${storage} 本体`.trim(),
    source: 'mock',
  };

  const yahooOffer = {
    price: yahooPrice,
    shopName: MOCK_YAHOO_SHOPS[seed % MOCK_YAHOO_SHOPS.length],
    url: buildYahooWebSearchUrl({ productName, storage, category, launchPrice: basePrice }),
    updatedAt: today,
    itemName: `【中古】${productName} ${storage} 本体`.trim(),
    source: 'mock',
  };

  const unusedOffer = {
    price: unusedPrice,
    shopName: MOCK_RAKUTEN_SHOPS[(seed + 1) % MOCK_RAKUTEN_SHOPS.length],
    url: buildRakutenWebSearchUrl({ productName, storage, category, launchPrice: basePrice, condition: '未使用' }),
    updatedAt: today,
    itemName: `【未使用品】${productName} ${storage} 本体`.trim(),
    source: 'mock',
  };

  return { rakutenOffer, yahooOffer, unusedOffer };
}

/** 楽天APIレスポンスから最安1件を抽出 */
export function pickCheapestRakutenItem(items, minPrice, today = new Date().toISOString().slice(0, 10)) {
  if (!Array.isArray(items)) return null;
  const candidates = [];
  for (const raw of items) {
    const it = raw?.Item ?? raw;
    if (!it) continue;
    const price = Number(it.itemPrice);
    const title = String(it.itemName ?? '');
    if (!Number.isFinite(price) || price < minPrice) continue;
    if (RAKUTEN_EXCLUDE_TITLE_RE.test(title)) continue;
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
 * Yahoo!ショッピングAPI (v3) レスポンスの上位5件から
 * 商品名に「ジャンク」「難あり」「訳あり」等が含まれない最安の1件を採用する
 */
export function pickCheapestYahooItem(hits, minPrice, today = new Date().toISOString().slice(0, 10)) {
  if (!Array.isArray(hits)) return null;
  const candidates = [];
  for (const hit of hits.slice(0, 5)) {
    if (!hit) continue;
    const price = Number(hit.price);
    const title = String(hit.name ?? '');
    if (!Number.isFinite(price) || price < minPrice) continue;
    if (YAHOO_EXCLUDE_TITLE_RE.test(title)) continue;
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

/**
 * 楽天市場API 単体呼び出し
 */
export async function fetchFromRakutenApi({
  productName,
  storage = '',
  category = 'iPhone',
  launchPrice = 98800,
  condition = '中古',
  appId = process.env.RAKUTEN_APP_ID,
  affiliateId = process.env.RAKUTEN_AFFILIATE_ID,
  accessKey = process.env.RAKUTEN_ACCESS_KEY,
}) {
  if (!appId) return null;
  const minPrice = calcMinPrice(launchPrice);
  const genreId = getRakutenGenreId(category);
  const kw = buildRakutenKeyword(productName, storage, condition);
  const params = new URLSearchParams({
    applicationId: appId,
    format: 'json',
    formatVersion: '2',
    keyword: kw,
    NGKeyword: RAKUTEN_NG_KEYWORD,
    genreId,
    minPrice: String(minPrice),
    sort: '+itemPrice',
    availability: '1',
    hits: '10',
  });
  if (affiliateId) params.set('affiliateId', affiliateId);
  if (accessKey) params.set('accessKey', accessKey);

  const endpoint = accessKey ? RAKUTEN_OPENAPI_ENDPOINT : RAKUTEN_API_ENDPOINT;
  const res = await fetch(`${endpoint}?${params.toString()}`);
  if (!res.ok) throw new Error(`Rakuten API HTTP ${res.status}`);
  const json = await res.json();
  return pickCheapestRakutenItem(json?.Items ?? [], minPrice);
}

/**
 * Yahoo!ショッピング 商品検索API (v3) 単体呼び出し
 * エンドポイント: https://shopping.yahooapis.jp/ShoppingWebService/V3/itemSearch
 */
export async function fetchFromYahooApi({
  productName,
  storage = '',
  category = 'iPhone',
  launchPrice = 98800,
  yahooAppId = process.env.YAHOO_APP_ID,
}) {
  if (!yahooAppId) return null;
  const priceFrom = calcMinPrice(launchPrice);
  const genreCategoryId = getYahooGenreCategoryId(category);
  const query = buildYahooQuery(productName, storage);

  const params = new URLSearchParams({
    appid: yahooAppId,
    query,
    condition: 'used',
    genre_category_id: genreCategoryId,
    price_from: String(priceFrom),
    sort: '+price',
    results: '5',
  });

  const res = await fetch(`${YAHOO_API_ENDPOINT}?${params.toString()}`);
  if (!res.ok) throw new Error(`Yahoo! Shopping API HTTP ${res.status}`);
  const json = await res.json();
  return pickCheapestYahooItem(json?.hits ?? [], priceFrom);
}

/**
 * 楽天とYahoo!の結果から横断比較データ `usedPricing` を組み立てる
 * 片方のAPIキーのみ設定されている場合は、実取得できたAPI側の価格を最優先して比較する
 */
export function buildUsedPricingObject({
  rakutenOffer,
  yahooOffer,
  unusedOffer = null,
  launchPrice,
}) {
  const baseLaunch = Number(launchPrice) > 0 ? Number(launchPrice) : null;

  // 実APIから取得できたオファーがあればそれを優先して最安判定（モック値が実API値を上書きしないようにする）
  const rIsApi = rakutenOffer?.source === 'api';
  const yIsApi = yahooOffer?.source === 'api';

  let lowestPlatform = 'rakuten';
  let lowestPrice = rakutenOffer?.price ?? yahooOffer?.price ?? 0;

  if (rIsApi && yIsApi) {
    if (yahooOffer.price < rakutenOffer.price) {
      lowestPlatform = 'yahoo';
      lowestPrice = yahooOffer.price;
    } else {
      lowestPlatform = 'rakuten';
      lowestPrice = rakutenOffer.price;
    }
  } else if (rIsApi && !yIsApi) {
    lowestPlatform = 'rakuten';
    lowestPrice = rakutenOffer.price;
  } else if (!rIsApi && yIsApi) {
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

  const resaleValuePercent =
    baseLaunch && lowestPrice > 0 ? Math.round((lowestPrice / baseLaunch) * 100) : null;

  return {
    lowestPrice,
    lowestPlatform,
    resaleValuePercent,
    rakuten: rakutenOffer
      ? {
          price: rakutenOffer.price,
          shopName: rakutenOffer.shopName,
          url: rakutenOffer.url,
          updatedAt: rakutenOffer.updatedAt,
          ...(rakutenOffer.itemName ? { itemName: rakutenOffer.itemName } : {}),
          ...(rakutenOffer.source ? { source: rakutenOffer.source } : {}),
        }
      : null,
    yahoo: yahooOffer
      ? {
          price: yahooOffer.price,
          shopName: yahooOffer.shopName,
          url: yahooOffer.url,
          updatedAt: yahooOffer.updatedAt,
          ...(yahooOffer.itemName ? { itemName: yahooOffer.itemName } : {}),
          ...(yahooOffer.source ? { source: yahooOffer.source } : {}),
        }
      : null,
    ...(unusedOffer ? { unused: unusedOffer } : {}),
  };
}

/**
 * 楽天市場 ＆ Yahoo!ショッピング 横断検索メイン関数
 * - 両方のAPIキーがある場合は並列取得して最安値を比較
 * - 片方のAPIキーのみの場合は設定されている方のAPIで取得
 * - いずれも未設定またはエラー時はフォールバック推定値を返す
 */
export async function searchRakutenUsedPrice({
  productName,
  storage = '',
  category = 'iPhone',
  launchPrice = 98800,
  releaseDate = '2023-09-22',
  appId = process.env.RAKUTEN_APP_ID,
  affiliateId = process.env.RAKUTEN_AFFILIATE_ID,
  accessKey = process.env.RAKUTEN_ACCESS_KEY,
  yahooAppId = process.env.YAHOO_APP_ID,
}) {
  const minPrice = calcMinPrice(launchPrice);
  const genreId = getRakutenGenreId(category);
  const keyword = buildRakutenKeyword(productName, storage, '中古');
  const fallback = estimatePlatformOffers({ productName, storage, category, launchPrice, releaseDate });

  let rakutenOffer = null;
  let yahooOffer = null;
  let unusedOffer = null;

  const tasks = [];

  if (appId) {
    tasks.push(
      (async () => {
        try {
          rakutenOffer = await fetchFromRakutenApi({
            productName,
            storage,
            category,
            launchPrice,
            condition: '中古',
            appId,
            affiliateId,
            accessKey,
          });
        } catch (err) {
          console.warn(`[warn] Rakuten API (${productName} ${storage}): ${err.message}`);
        }
        try {
          unusedOffer = await fetchFromRakutenApi({
            productName,
            storage,
            category,
            launchPrice,
            condition: '未使用',
            appId,
            affiliateId,
            accessKey,
          });
        } catch {
          /* ignore */
        }
      })(),
    );
  }

  if (yahooAppId) {
    tasks.push(
      (async () => {
        try {
          yahooOffer = await fetchFromYahooApi({
            productName,
            storage,
            category,
            launchPrice,
            yahooAppId,
          });
        } catch (err) {
          console.warn(`[warn] Yahoo API (${productName} ${storage}): ${err.message}`);
        }
      })(),
    );
  }

  if (tasks.length > 0) {
    await Promise.all(tasks);
  }

  const finalRakuten = rakutenOffer ?? fallback.rakutenOffer;
  const finalYahoo = yahooOffer ?? fallback.yahooOffer;
  const finalUnused = unusedOffer ?? fallback.unusedOffer;

  const usedPricing = buildUsedPricingObject({
    rakutenOffer: finalRakuten,
    yahooOffer: finalYahoo,
    unusedOffer: finalUnused,
    launchPrice,
  });

  const bestOffer = usedPricing.lowestPlatform === 'yahoo' ? finalYahoo : finalRakuten;
  const anyApi = rakutenOffer?.source === 'api' || yahooOffer?.source === 'api';

  return {
    keyword,
    genreId,
    minPrice,
    launchPrice: Number(launchPrice) > 0 ? Number(launchPrice) : null,
    usedPricing,
    // 後方互換フィールド
    used: {
      price: usedPricing.lowestPrice,
      shopName: bestOffer.shopName,
      itemName: bestOffer.itemName ?? '',
      itemUrl: bestOffer.url,
    },
    unused: finalUnused
      ? {
          price: finalUnused.price,
          shopName: finalUnused.shopName,
          itemName: finalUnused.itemName ?? '',
          itemUrl: finalUnused.url,
        }
      : null,
    resaleRate: usedPricing.resaleValuePercent,
    source: anyApi ? 'api' : 'mock',
    fetchedAt: new Date().toISOString(),
  };
}

export const searchCrossPlatformUsedPrice = searchRakutenUsedPrice;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// CLIとして直接実行された場合のバッチ処理
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  (async () => {
    const appId = process.env.RAKUTEN_APP_ID;
    const yahooAppId = process.env.YAHOO_APP_ID;
    console.log(
      `API設定状態: RAKUTEN_APP_ID=${appId ? '設定済' : '未設定(推定フォールバック)'} / YAHOO_APP_ID=${yahooAppId ? '設定済' : '未設定(推定フォールバック)'}`,
    );

    const targets = [
      { id: 'iphone-13', name: 'iPhone 13', category: 'iPhone', releaseDate: '2021-09-24', storage: '128GB', launchPrice: 98800 },
      { id: 'iphone-14', name: 'iPhone 14', category: 'iPhone', releaseDate: '2022-09-16', storage: '128GB', launchPrice: 119800 },
      { id: 'iphone-15', name: 'iPhone 15', category: 'iPhone', releaseDate: '2023-09-22', storage: '128GB', launchPrice: 124800 },
      { id: 'iphone-16', name: 'iPhone 16', category: 'iPhone', releaseDate: '2024-09-20', storage: '128GB', launchPrice: 124800 },
      { id: 'ipad-10', name: 'iPad (第10世代)', category: 'iPad', releaseDate: '2022-10-26', storage: '64GB', launchPrice: 68800 },
      { id: 'ipad-air-11-m2', name: 'iPad Air 11インチ (M2)', category: 'iPad', releaseDate: '2024-05-15', storage: '128GB', launchPrice: 98800 },
      { id: 'watch-s10', name: 'Apple Watch Series 10', category: 'Apple Watch', releaseDate: '2024-09-20', storage: '64GB', launchPrice: 59800 },
      { id: 'mba-13-m2', name: 'MacBook Air 13インチ (M2)', category: 'Mac', releaseDate: '2022-07-15', storage: '256GB', launchPrice: 164800 },
    ];

    const out = {};
    for (const t of targets) {
      const res = await searchRakutenUsedPrice({
        productName: t.name,
        storage: t.storage,
        category: t.category,
        launchPrice: t.launchPrice,
        releaseDate: t.releaseDate,
        appId,
        yahooAppId,
      });
      const up = res.usedPricing;
      out[`${t.id}:${t.storage}`] = res;
      console.log(
        `✓ ${t.name} (${t.storage}) 最安: ¥${up.lowestPrice.toLocaleString()} [${up.lowestPlatform.toUpperCase()}] (楽天: ¥${up.rakuten?.price.toLocaleString()} / Yahoo: ¥${up.yahoo?.price.toLocaleString()}) リセール率: ${up.resaleValuePercent}%`,
      );
      if (appId || yahooAppId) await sleep(1100);
    }

    if (existsSync('public')) {
      mkdirSync('public', { recursive: true });
      writeFileSync('public/used-prices.json', JSON.stringify({ generatedAt: new Date().toISOString(), items: out }, null, 2));
      console.log('\npublic/used-prices.json に保存しました。');
    }
  })();
}
