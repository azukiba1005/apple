/**
 * 楽天市場 商品検索API (IchibaItem/Search/20220601) を用いた
 * Apple製品の中古最安値・未使用品最安値データ取得スクリプト
 *
 * 使い方:
 *   RAKUTEN_APP_ID=あなたのアプリID node data/fetch-used-prices.mjs
 *   (RAKUTEN_APP_ID 未設定時は発売時価格・経過年数から算出した推定フォールバック値を出力します)
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

export const RAKUTEN_API_ENDPOINT = 'https://app.rakuten.co.jp/services/api/IchibaItem/Search/20220601';
export const RAKUTEN_OPENAPI_ENDPOINT = 'https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20220601';

export const NG_KEYWORD =
  'ケース フィルム カバー 保護 ガラス 修理 レンタル ジャンク 部品 交換 バッテリー バンド ベルト';

export const GENRE_IDS = {
  iPhone: '560202',
  iPad: '560029',
  Mac: '100040',
  'Apple Watch': '564500',
  Watch: '564500',
};

const EXCLUDE_TITLE_RE =
  /ケース|フィルム|カバー|保護|ガラス|修理|レンタル|ジャンク|部品|交換|バッテリー交換|バンドのみ|ベルトのみ|モックアップ|空箱|箱のみ/;

const MOCK_SHOPS = [
  'イオシス 楽天市場店',
  'じゃんぱら 楽天市場店',
  'ゲオモバイル 楽天市場店',
  'ソフマップ 楽天市場店',
  'にこスマ 楽天市場店',
];

export function getGenreId(category) {
  if (GENRE_IDS[category]) return GENRE_IDS[category];
  if (/watch/i.test(category)) return GENRE_IDS.Watch;
  if (/ipad/i.test(category)) return GENRE_IDS.iPad;
  if (/mac/i.test(category)) return GENRE_IDS.Mac;
  return GENRE_IDS.iPhone;
}

export function calcMinPrice(launchPrice) {
  const n = Number(launchPrice);
  if (!Number.isFinite(n) || n <= 0) return 5000;
  return Math.max(Math.round(n * 0.15), 5000);
}

export function buildKeyword(productName, storage, condition = '中古') {
  const cleanName = String(productName ?? '').replace(/\s+/g, ' ').trim();
  const cleanStorage = storage && storage !== '-' ? String(storage).trim() : '';
  return [cleanName, cleanStorage, condition].filter(Boolean).join(' ');
}

export function buildRakutenWebSearchUrl({ productName, storage, category, launchPrice, condition = '中古' }) {
  const keyword = buildKeyword(productName, storage, condition);
  const genreId = getGenreId(category);
  const minPrice = calcMinPrice(launchPrice);
  const qs = new URLSearchParams({
    min: String(minPrice),
    nitem: NG_KEYWORD,
    s: '2',
  });
  return `https://search.rakuten.co.jp/search/mall/${encodeURIComponent(keyword)}/${genreId}/?${qs.toString()}`;
}

function hashCode(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function estimateFallbackUsedPrice({
  productName,
  storage = '',
  category = 'iPhone',
  launchPrice = 98800,
  releaseDate = '2023-09-22',
}) {
  const basePrice = Number(launchPrice) > 0 ? Number(launchPrice) : 98800;
  const minPrice = calcMinPrice(basePrice);
  const genreId = getGenreId(category);
  const keyword = buildKeyword(productName, storage, '中古');

  const relMs = Date.parse(`${releaseDate}T00:00:00Z`);
  const ageYears = Math.max(0, (Date.now() - (Number.isFinite(relMs) ? relMs : Date.now())) / (365.25 * 864e5));
  const catFactor =
    category === 'iPhone' ? 0.84 : category === 'iPad' ? 0.78 : category === 'Mac' ? 0.75 : 0.68;
  const decay = Math.pow(0.86, ageYears);
  const seed = hashCode(`${productName}:${storage}`);
  const jitter = ((seed % 7) - 3) * 0.008;
  const ratio = Math.min(0.9, Math.max(0.18, catFactor * decay + jitter));

  const usedPrice = Math.max(minPrice, Math.round((basePrice * ratio) / 1000) * 1000 - 200);
  const unusedPrice = Math.max(
    usedPrice + 3000,
    Math.min(
      Math.round((basePrice * 0.96) / 1000) * 1000 - 200,
      Math.round((usedPrice * 1.14) / 1000) * 1000 - 200,
    ),
  );

  return {
    keyword,
    genreId,
    minPrice,
    launchPrice: basePrice,
    used: {
      price: usedPrice,
      shopName: MOCK_SHOPS[seed % MOCK_SHOPS.length],
      itemName: `【中古】${productName} ${storage} 本体 A〜Bランク`.trim(),
      itemUrl: buildRakutenWebSearchUrl({ productName, storage, category, launchPrice: basePrice, condition: '中古' }),
    },
    unused: {
      price: unusedPrice,
      shopName: MOCK_SHOPS[(seed + 1) % MOCK_SHOPS.length],
      itemName: `【未使用品】${productName} ${storage} 本体 開封済み未使用`.trim(),
      itemUrl: buildRakutenWebSearchUrl({ productName, storage, category, launchPrice: basePrice, condition: '未使用' }),
    },
    resaleRate: Math.round((usedPrice / basePrice) * 100),
    source: 'mock',
    fetchedAt: new Date().toISOString(),
  };
}

function pickCheapestItem(items, minPrice) {
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

/**
 * 楽天市場 商品検索API を呼び出して純粋な本体最安値（中古・未使用品）を取得する関数
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
}) {
  const minPrice = calcMinPrice(launchPrice);
  const genreId = getGenreId(category);
  const keyword = buildKeyword(productName, storage, '中古');

  if (!appId) {
    return estimateFallbackUsedPrice({ productName, storage, category, launchPrice, releaseDate });
  }

  const fetchCondition = async (condition) => {
    const kw = buildKeyword(productName, storage, condition);
    const params = new URLSearchParams({
      applicationId: appId,
      format: 'json',
      formatVersion: '2',
      keyword: kw,
      NGKeyword: NG_KEYWORD,
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
    return pickCheapestItem(json?.Items ?? [], minPrice);
  };

  try {
    const usedOffer = await fetchCondition('中古');
    let unusedOffer = null;
    try {
      unusedOffer = await fetchCondition('未使用');
    } catch {
      /* ignore unused error */
    }
    if (!usedOffer) {
      return estimateFallbackUsedPrice({ productName, storage, category, launchPrice, releaseDate });
    }
    const basePrice = Number(launchPrice) > 0 ? Number(launchPrice) : null;
    return {
      keyword,
      genreId,
      minPrice,
      launchPrice: basePrice,
      used: usedOffer,
      unused: unusedOffer,
      resaleRate: basePrice ? Math.round((usedOffer.price / basePrice) * 100) : null,
      source: 'api',
      fetchedAt: new Date().toISOString(),
    };
  } catch (err) {
    console.warn(`[warn] Rakuten API 取得失敗 (${productName} ${storage}): ${err.message} -> フォールバック値を使用`);
    return estimateFallbackUsedPrice({ productName, storage, category, launchPrice, releaseDate });
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// CLIとして直接実行された場合のバッチ処理
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  (async () => {
    const appId = process.env.RAKUTEN_APP_ID;
    console.log(
      appId
        ? `RAKUTEN_APP_ID が設定されています。楽天市場API (${RAKUTEN_API_ENDPOINT}) から最安値を取得します...`
        : 'RAKUTEN_APP_ID が未設定のため、フォールバック（推定相場）モードで生成します...',
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
      });
      out[`${t.id}:${t.storage}`] = res;
      console.log(
        `✓ ${t.name} (${t.storage}) [${res.source}] 中古最安: ¥${res.used.price.toLocaleString()} (${res.used.shopName}) / 未使用: ${res.unused ? `¥${res.unused.price.toLocaleString()}` : '—'} / リセール率: ${res.resaleRate}%`,
      );
      if (appId) await sleep(1100); // 楽天APIレート制限対策 (1req/sec)
    }

    if (existsSync('public')) {
      mkdirSync('public', { recursive: true });
      writeFileSync('public/used-prices.json', JSON.stringify({ generatedAt: new Date().toISOString(), items: out }, null, 2));
      console.log('\npublic/used-prices.json に保存しました。');
    }
  })();
}
