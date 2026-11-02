import fs from 'fs';
import path from 'path';

// 環境変数の読み込みと空白除去
const RAKUTEN_APP_ID = (process.env.RAKUTEN_APP_ID || '').trim();
const YAHOO_APP_ID = (process.env.YAHOO_APP_ID || '').trim();
const RAW_RAKUTEN_AFF_ID = (process.env.RAKUTEN_AFFILIATE_ID || '').trim();
const YAHOO_VC_SID = (process.env.YAHOO_VC_SID || '').trim();
const YAHOO_VC_PID = (process.env.YAHOO_VC_PID || '').trim();
const YAHOO_MOSHIMO_AID = (process.env.YAHOO_MOSHIMO_AID || '').trim();

// 楽天アフィリエイトIDが正しい形式（xxxx.xxxx.xxxx.xxxx）か厳密チェック
const VALID_RAKUTEN_AFF_ID = /^[0-9a-zA-Z_]+\.[0-9a-zA-Z_]+\.[0-9a-zA-Z_]+\.[0-9a-zA-Z_]+$/.test(RAW_RAKUTEN_AFF_ID)
  ? RAW_RAKUTEN_AFF_ID
  : '';

const CACHE_FILE = path.resolve('data/prices/live-prices-cache.json');
const APPLEDB_FILE = path.resolve('data/appledb-main.json');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 大手中古ショップのホワイトリスト
const TRUSTED_SHOPS = [
  'イオシス', 'じゃんぱら', 'ゲオ', 'GEO', 'ソフマップ', 'リコレ', 'ビック', 'ヤマダ',
  'キタムラ', 'ブックオフ', 'BOOKOFF', 'ハードオフ', 'セカンドストリート', 'にこスマ',
  'エコたん', 'PCコンフル', 'モバックス', 'ムスビー', 'ワールドモバイル', 'アメモバ', '大黒屋', 'コメ兵'
];

// 除外ブラックリスト（AQUOS等の他機種・アクセサリー・ジャンクを完全排除）
const BLACKLIST_WORDS = [
  'AQUOS', 'Galaxy', 'Xperia', 'Pixel', 'arrows', 'OPPO', 'Xiaomi', 'Redmi', 'ZenFone', 'HUAWEI',
  'ケース', 'カバー', 'フィルム', 'ガラス', 'バンド', 'ベルト', 'ストラップ', '充電器', 'ケーブル',
  '用', '対応', '互換', '保護', '修理', 'バッテリー交換', 'ジャンク', '難あり', '訳あり', '画面割れ',
  '赤ロム', 'モック', '空箱', '箱のみ', 'レンタル', 'ふるさと納税', 'ダミー'
];

/**
 * 0. GitHub Actions用に data/appledb-main.json がなければ自動ダウンロード
 */
async function ensureAppleDbExists() {
  if (fs.existsSync(APPLEDB_FILE)) {
    console.log('✅ data/appledb-main.json は既に存在します。');
    return;
  }
  console.log('🌐 data/appledb-main.json が見つからないため、AppleDB APIから自動ダウンロード中...');
  const res = await fetch('https://api.appledb.dev/device/main.json');
  if (!res.ok) throw new Error(`AppleDB download failed: HTTP ${res.status}`);
  const text = await res.text();
  fs.mkdirSync(path.dirname(APPLEDB_FILE), { recursive: true });
  fs.writeFileSync(APPLEDB_FILE, text, 'utf-8');
  console.log(`✅ data/appledb-main.json を保存しました (${(text.length / 1024 / 1024).toFixed(1)} MB)`);
}

/**
 * 楽天API用のキーワード整形（400エラーの原因になる記号をすべて除去）
 */
function sanitizeRakutenKeyword(str) {
  return str
    .normalize('NFKC')
    .replace(/[()（）+\/,\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 商品タイトルが本当にそのApple製品本体かを厳密判定
 */
function isValidProductTitle(rawTitle, modelName, storage) {
  if (!rawTitle) return false;
  const title = rawTitle.normalize('NFKC');
  const titleUpper = title.toUpperCase();

  // ブラックリスト語句が1つでもあれば除外
  for (const bad of BLACKLIST_WORDS) {
    if (titleUpper.includes(bad.toUpperCase())) return false;
  }

  // モデル名の厳密境界チェック（例: iPhone 14 で iPhone 14 Pro や Plus を除外）
  const cleanModel = modelName.normalize('NFKC').replace(/\(.*?\)/g, '').trim();
  const compactTitle = titleUpper.replace(/\s+/g, '');
  const compactModel = cleanModel.toUpperCase().replace(/\s+/g, '');

  if (!compactTitle.includes(compactModel)) return false;

  // 無印モデル検索時に Pro / Plus / Max / mini / e が付く別機種を除外
  const suffixes = ['PRO', 'PLUS', 'MAX', 'MINI', 'ULTRA'];
  for (const sfx of suffixes) {
    if (!compactModel.includes(sfx) && compactTitle.includes(compactModel + sfx)) {
      return false;
    }
  }

  // 容量チェック（GPSやサイズ表記以外の場合）
  if (storage && /(GB|TB)$/i.test(storage)) {
    const capMatch = storage.match(/(\d+\s*(?:GB|TB))/i);
    if (capMatch) {
      const cap = capMatch[1].toUpperCase().replace(/\s+/g, '');
      if (!compactTitle.includes(cap)) return false;
    }
  }
  return true;
}

/**
 * Yahoo!アフィリエイトURL変換
 */
function toYahooAffiliateUrl(rawUrl) {
  if (!rawUrl) return null;
  if (YAHOO_VC_SID && YAHOO_VC_PID) {
    return `https://ck.jp.ap.valuecommerce.com/servlet/referral?sid=${YAHOO_VC_SID}&pid=${YAHOO_VC_PID}&vc_url=${encodeURIComponent(rawUrl)}`;
  }
  if (YAHOO_MOSHIMO_AID) {
    return `https://af.moshimo.com/af/c/click?a_id=${YAHOO_MOSHIMO_AID}&p_id=1225&pc_id=1925&pl_id=18502&url=${encodeURIComponent(rawUrl)}`;
  }
  return rawUrl;
}

/**
 * 楽天市場APIで検索（400エラー時の詳細ログ出力＆自動フォールバック付き）
 */
async function searchRakuten(keyword, minPrice = 10000) {
  if (!RAKUTEN_APP_ID) return [];
  const cleanKw = sanitizeRakutenKeyword(keyword);

  const buildUrl = (useOptionalParams) => {
    const params = new URLSearchParams({
      applicationId: RAKUTEN_APP_ID,
      keyword: cleanKw,
      minPrice: String(Math.max(3000, Math.floor(minPrice))),
      sort: '+itemPrice',
      hits: '20',
      formatVersion: '2'
    });
    if (useOptionalParams) {
      params.set('NGKeyword', 'ケース フィルム カバー ジャンク 修理 レンタル');
      if (VALID_RAKUTEN_AFF_ID) {
        params.set('affiliateId', VALID_RAKUTEN_AFF_ID);
      }
    }
    return `https://app.rakuten.co.jp/services/api/IchibaItem/Search/20220601?${params.toString()}`;
  };

  let res = await fetch(buildUrl(true));

  // 万が一 400 Bad Request になった場合、原因を表示して最小パラメータで自動リトライ！
  if (res.status === 400) {
    const errBody = await res.json().catch(() => ({}));
    console.warn(`  [Rakuten 400 Retry] "${cleanKw}" -> 理由: ${errBody.error_description || JSON.stringify(errBody)}`);
    await sleep(600);
    res = await fetch(buildUrl(false));
  }

  if (!res.ok) {
    console.warn(`  [warn] 楽天市場API (${cleanKw}): HTTP ${res.status}`);
    return [];
  }

  const data = await res.json();
  return data.Items || [];
}

/**
 * Yahoo!ショッピングAPI (v3) で中古検索
 */
async function searchYahooUsed(modelName, storage, minPrice = 10000) {
  if (!YAHOO_APP_ID) return [];
  const cleanKw = `${modelName.replace(/\(.*?\)/g, '').trim()} ${storage} -ケース -フィルム -カバー -ジャンク -修理 -レンタル -互換`.trim();

  const params = new URLSearchParams({
    appid: YAHOO_APP_ID,
    query: cleanKw,
    condition: 'used',
    price_from: String(Math.max(3000, Math.floor(minPrice))),
    sort: '+price',
    results: '20'
  });

  const url = `https://shopping.yahooapis.jp/ShoppingWebService/V3/itemSearch?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = await res.json();
  return data.hits || [];
}

/**
 * 既存の価格ファイルから対象モデル一覧を読み込む
 */
function loadTargetModels() {
  const pricesDir = path.resolve('data/prices');
  const files = ['iphone-2022plus.json', 'iphone-2018-2021.json', 'ipad-modern.json', 'mac-apple-silicon.json', 'watch-airpods.json'];
  const models = [];

  for (const file of files) {
    const fp = path.join(pricesDir, file);
    if (!fs.existsSync(fp)) continue;
    try {
      const content = JSON.parse(fs.readFileSync(fp, 'utf-8'));
      const entries = Array.isArray(content) ? content : Object.entries(content).map(([k, v]) => ({ name: k, ...v }));
      for (const item of entries) {
        const name = item.name || item.model || item.id;
        if (!name || !Array.isArray(item.skus)) continue;
        models.push({ name, skus: item.skus });
      }
    } catch {}
  }
  return models;
}

async function main() {
  console.log('================================================================');
  console.log('📦 Apple Price Atlas 自動価格収集バッチ (改良安定版)');
  console.log(`  RAKUTEN_APP_ID      : ${RAKUTEN_APP_ID ? '設定済' : '未設定'}`);
  console.log(`  YAHOO_APP_ID        : ${YAHOO_APP_ID ? '設定済' : '未設定'}`);
  console.log(`  RAKUTEN_AFFILIATE_ID: ${VALID_RAKUTEN_AFF_ID ? '有効' : RAW_RAKUTEN_AFF_ID ? '形式不正のため自動無効化(400防止)' : '未設定'}`);
  console.log('================================================================');

  // 1. まず appledb-main.json を確実に用意する
  await ensureAppleDbExists();

  // 2. 既存キャッシュの読み込み
  let cache = { updatedAt: new Date().toISOString(), models: {} };
  if (fs.existsSync(CACHE_FILE)) {
    try {
      cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
      cache.models = cache.models || {};
    } catch {}
  }

  const targets = loadTargetModels();
  let rakutenSuccess = 0;
  let yahooSuccess = 0;

  for (const target of targets) {
    const modelName = target.name;
    cache.models[modelName] = cache.models[modelName] || { skus: {} };

    for (const sku of target.skus) {
      const storage = sku.storage || '';
      const launchPrice = sku.priceHistory?.[0]?.appleStoreJpy || 60000;
      const minValidPrice = Math.max(5000, Math.floor(launchPrice * 0.18));

      // --- A. 楽天市場 中古最安値 ---
      const rakutenItems = await searchRakuten(`${modelName} ${storage} 中古`, minValidPrice);
      await sleep(1100); // レート制限対策

      const validRakuten = rakutenItems
        .filter((it) => isValidProductTitle(it.itemName, modelName, storage))
        .map((it) => ({
          price: it.itemPrice,
          shopName: it.shopName,
          url: it.affiliateUrl || it.itemUrl,
          isTrusted: TRUSTED_SHOPS.some((s) => (it.shopName || '').includes(s)),
          updatedAt: new Date().toISOString().split('T')[0]
        }));

      validRakuten.sort((a, b) => (a.isTrusted === b.isTrusted ? a.price - b.price : a.isTrusted ? -1 : 1));
      const bestRakuten = validRakuten[0] || null;
      if (bestRakuten) rakutenSuccess++;

      // --- B. Yahoo!ショッピング 中古最安値 ---
      const yahooItems = await searchYahooUsed(modelName, storage, minValidPrice);
      await sleep(600);

      const validYahoo = yahooItems
        .filter((it) => isValidProductTitle(it.name, modelName, storage))
        .map((it) => ({
          price: it.price,
          shopName: it.seller?.name || 'Yahoo!ショップ',
          url: toYahooAffiliateUrl(it.url),
          isTrusted: TRUSTED_SHOPS.some((s) => (it.seller?.name || '').includes(s)),
          updatedAt: new Date().toISOString().split('T')[0]
        }));

      validYahoo.sort((a, b) => (a.isTrusted === b.isTrusted ? a.price - b.price : a.isTrusted ? -1 : 1));
      const bestYahoo = validYahoo[0] || null;
      if (bestYahoo) yahooSuccess++;

      // 最安値の統合判定
      const candidates = [
        bestRakuten ? { ...bestRakuten, platform: 'rakuten' } : null,
        bestYahoo ? { ...bestYahoo, platform: 'yahoo' } : null
      ].filter(Boolean);
      candidates.sort((a, b) => a.price - b.price);
      const lowest = candidates[0] || null;

      cache.models[modelName].skus[storage] = {
        usedPricing: {
          lowestPrice: lowest ? lowest.price : null,
          lowestPlatform: lowest ? lowest.platform : null,
          resaleValuePercent: lowest && launchPrice ? Math.round((lowest.price / launchPrice) * 100) : null,
          rakuten: bestRakuten,
          yahoo: bestYahoo
        }
      };
    }
  }

  cache.updatedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), 'utf-8');
  console.log(`✅ 完了！ 楽天中古取得: ${rakutenSuccess}件 / Yahoo!中古取得: ${yahooSuccess}件`);
}

main().catch((err) => {
  console.error('❌ エラー発生:', err);
  process.exit(1);
});
