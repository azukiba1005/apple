/**
 * 楽天市場 商品検索API (IchibaItem/Search/20220601) ＆
 * Yahoo!ショッピング 商品検索API (v3: ShoppingWebService/V3/itemSearch)
 * 横断中古最安値・リセールバリュー取得モジュール＆CLIスクリプト
 *
 * 【厳密フィルタリング＆大手ショップ優先仕様】
 * 1. Yahoo! API (results=20) / 楽天API (hits=20) から上位20件を取得
 * 2. isValidProductTitle() でモデル完全一致（Pro/Plus/Max/mini/e 等の誤爆防止）、
 *    ストレージ容量一致、他社Android端末・アクセサリー・ジャンク等の完全ブラックリスト除外を実施
 * 3. isTrustedShop() で大手中古ショップ（イオシス・じゃんぱら・ゲオ等）を判定し最優先で採用
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
  'ケース フィルム カバー ジャンク 修理 レンタル バッテリー';

export const YAHOO_NEGATIVE_TERMS =
  '-ケース -フィルム -カバー -ガラス -修理 -レンタル -ジャンク -バッテリー -交換 -バンド -ベルト -AQUOS -Galaxy -Xperia -Pixel -OPPO -Xiaomi -モック -空箱';

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

/** 2-3. 他社スマホ・アクセサリー・ジャンクの完全ブラックリスト */
export const TITLE_BLACKLIST = [
  'AQUOS', 'Galaxy', 'Xperia', 'Pixel', 'arrows', 'OPPO', 'Xiaomi', 'Redmi', 'ZenFone', 'HUAWEI',
  'ケース', 'カバー', 'フィルム', 'ガラス', 'バンド', 'ベルト', 'ストラップ', '充電器', 'ケーブル', 'アダプタ',
  '用', '対応', '互換', '保護', '修理', '交換', 'バッテリー交換',
  'ジャンク', '難あり', '訳あり', '画面割れ', '赤ロム', 'モック', '空箱', '箱のみ', 'レンタル', 'ふるさと納税',
];

const NORMALIZED_BLACKLIST = TITLE_BLACKLIST.map((w) => w.normalize('NFKC').toUpperCase());

/** 3. 信頼できる大手中古ショップキーワード一覧 */
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
  'カメラのキタムラ Yahoo!店',
];

/**
 * ショップ名が信頼できる大手中古ショップに該当するか判定する
 */
export function isTrustedShop(shopName) {
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
export function isValidProductTitle(title, productName, storage = '', category = '') {
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
      // iPhone 数字 または X/XS/XR
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
          // iPhone 16e 等
          const eRe = new RegExp(`IPHONE\\s*${modelCode}\\s*E(?![A-Z0-9])`, 'i');
          if (!eRe.test(upperTitle)) return false;
        } else {
          // 該当モデル番号が含まれ、直後に別の数字や 'e' が続かないことを確認
          const baseRe = new RegExp(`IPHONE\\s*${modelCode}(?![0-9A-Z]|\\s*E\\b)`, 'i');
          if (!baseRe.test(upperTitle)) return false;
          // 直後に Pro / Plus / Max / mini / e が続く別機種を除外
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

        // 別のiPhoneナンバーが併記されているタイトル（比較・複数機種表記）を除外
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

    // 世代指定がある場合 (例: "iPad (第10世代)" / "iPad (10th generation)")
    const genMatch = normProd.match(/第(\d+)世代|(\d+)(?:st|nd|rd|th)\s+generation/i);
    if (genMatch) {
      const genNum = genMatch[1] || genMatch[2];
      const genRe = new RegExp(`(第\\s*${genNum}\\s*世代|${genNum}\\s*世代|${genNum}TH|第${genNum})`, 'i');
      if (!genRe.test(upperTitle)) return false;
    }

    // Mチップ指定がある場合 (例: "(M2)")
    const chipMatch = normProd.match(/\b(M\d+)\b/i);
    if (chipMatch) {
      const chip = chipMatch[1].toUpperCase();
      if (!new RegExp(`\\b${chip}\\b`, 'i').test(upperTitle)) return false;
    }

    // インチ指定がある場合 (例: "11インチ" / "11-inch" / "12.9-inch")
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
    // その他カテゴリは製品名キーワードが含まれるか確認
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

    // 他のストレージ容量が含まれている場合は除外（Macの8GB/16GB RAM表記は除く）
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

/** 検索向けに製品名をクリーン化（例: "iPad (10th generation)" → "iPad 第10世代", 記号 ()（）+/,- を半角スペースへ置換） */
export function cleanSearchProductName(productName) {
  return String(productName ?? '')
    .normalize('NFKC')
    .replace(/\((\d+)(?:st|nd|rd|th)\s+generation\)/gi, '第$1世代')
    .replace(/(\d+(?:\.\d+)?)\s*-?\s*inch\b/gi, '$1インチ')
    .replace(/[()（）+/,-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractStorageToken(storage, category = '') {
  if (/watch/i.test(category)) {
    const mm = String(storage ?? '').match(/\b(\d+mm)\b/i);
    return mm ? mm[1] : '';
  }
  const m = String(storage ?? '').normalize('NFKC').match(/\b(\d+\s*(?:GB|TB))\b/i);
  return m ? m[1].replace(/\s+/g, '') : '';
}

/** 楽天APIのkeyword向けに記号 ()（）+/,- を半角スペースへ置換し連続スペースを1つに圧縮 */
export function sanitizeRakutenKeyword(rawKeyword) {
  return String(rawKeyword ?? '')
    .normalize('NFKC')
    .replace(/[()（）+/,-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

export function buildRakutenKeyword(productName, storage, condition = '中古', category = '') {
  const cleanName = cleanSearchProductName(productName);
  const cleanStorage = extractStorageToken(storage, category);
  return sanitizeRakutenKeyword([cleanName, cleanStorage, condition].filter(Boolean).join(' '));
}

/** Yahoo!ショッピングAPI (v3) 用クエリ（フレーズ/必須ワード＋マイナス検索） */
export function buildYahooQuery(productName, storage, category = '') {
  const cleanName = cleanSearchProductName(productName);
  const cleanStorage = extractStorageToken(storage, category);
  return [`"${cleanName}"`, cleanStorage, YAHOO_NEGATIVE_TERMS].filter(Boolean).join(' ');
}

export function buildRakutenWebSearchUrl({
  productName,
  storage,
  category,
  launchPrice,
  condition = '中古',
  affiliateId = process.env.RAKUTEN_AFFILIATE_ID,
}) {
  const keyword = buildRakutenKeyword(productName, storage, condition, category);
  const genreId = getRakutenGenreId(category);
  const minPrice = calcMinPrice(launchPrice);
  const qs = new URLSearchParams({
    min: String(minPrice),
    nitem: RAKUTEN_NG_KEYWORD,
    s: '2',
  });
  const rawUrl = `https://search.rakuten.co.jp/search/mall/${encodeURIComponent(keyword)}/${genreId}/?${qs.toString()}`;
  return toRakutenAffiliateUrl(rawUrl, affiliateId);
}

export function buildYahooWebSearchUrl({ productName, storage, category, launchPrice }) {
  const cleanName = cleanSearchProductName(productName);
  const cleanStorage = extractStorageToken(storage, category);
  const p = [cleanName, cleanStorage, '中古', '-ケース', '-フィルム', '-ジャンク'].filter(Boolean).join(' ');
  const cid = getYahooGenreCategoryId(category);
  const pf = calcMinPrice(launchPrice);
  const qs = new URLSearchParams({
    p,
    cid,
    pf: String(pf),
    used: '1',
    X: '2',
  });
  const rawUrl = `https://shopping.yahoo.co.jp/search?${qs.toString()}`;
  return toYahooAffiliateUrl(rawUrl);
}

/**
 * 楽天アフィリエイトIDを正規化・検証する (ドット区切りの4ブロック: ^[0-9a-f]+\.[0-9a-f]+\.[0-9a-f]+\.[0-9a-f]+$)
 * 不正な形式の場合は空文字を返す
 */
export function normalizeRakutenAffiliateId(raw = process.env.RAKUTEN_AFFILIATE_ID) {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  return /^[0-9a-f]+\.[0-9a-f]+\.[0-9a-f]+\.[0-9a-f]+$/i.test(s) ? s : '';
}

/**
 * 楽天アプリケーションIDを正規化する（前後の空白や改行を除去）
 */
export function normalizeRakutenAppId(raw = process.env.RAKUTEN_APP_ID) {
  return String(raw ?? '').trim();
}

/**
 * 楽天市場の商品URL・検索URLを楽天アフィリエイトURLに変換する
 */
export function toRakutenAffiliateUrl(rawUrl, affiliateId = process.env.RAKUTEN_AFFILIATE_ID) {
  const url = String(rawUrl ?? '').trim();
  const aid = normalizeRakutenAffiliateId(affiliateId) || String(affiliateId ?? '').trim();
  if (!url || !aid) return url;
  if (url.includes('hb.afl.rakuten.co.jp')) return url;
  return `https://hb.afl.rakuten.co.jp/hgc/${encodeURIComponent(aid)}/?pc=${encodeURIComponent(url)}&m=${encodeURIComponent(url)}`;
}

/**
 * Yahoo!ショッピングの商品URL・検索URLをバリューコマースまたはもしもアフィリエイトURLに変換する
 */
export function toYahooAffiliateUrl(
  rawUrl,
  {
    vcSid = process.env.YAHOO_VC_SID,
    vcPid = process.env.YAHOO_VC_PID,
    moshimoAid = process.env.YAHOO_MOSHIMO_AID,
  } = {},
) {
  const url = String(rawUrl ?? '').trim();
  if (!url) return url;
  if (url.includes('ck.jp.ap.valuecommerce.com') || url.includes('af.moshimo.com')) return url;
  const sid = String(vcSid ?? '').trim();
  const pid = String(vcPid ?? '').trim();
  const maid = String(moshimoAid ?? '').trim();
  if (sid && pid) {
    return `https://ck.jp.ap.valuecommerce.com/servlet/referral?sid=${encodeURIComponent(sid)}&pid=${encodeURIComponent(pid)}&vc_url=${encodeURIComponent(url)}`;
  }
  if (maid) {
    return `https://af.moshimo.com/af/c/click?a_id=${encodeURIComponent(maid)}&p_id=1225&pc_id=1925&pl_id=18502&url=${encodeURIComponent(url)}`;
  }
  return url;
}

function hashCode(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/**
 * 推定相場ジェネレータ（APIキー未設定時・該当在庫0件時のフォールバック）
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

  const rakutenShop = MOCK_RAKUTEN_SHOPS[seed % MOCK_RAKUTEN_SHOPS.length];
  const yahooShop = MOCK_YAHOO_SHOPS[seed % MOCK_YAHOO_SHOPS.length];
  const unusedShop = MOCK_RAKUTEN_SHOPS[(seed + 1) % MOCK_RAKUTEN_SHOPS.length];

  const rakutenOffer = {
    price: rakutenPrice,
    shopName: rakutenShop,
    url: buildRakutenWebSearchUrl({ productName, storage, category, launchPrice: basePrice, condition: '中古' }),
    updatedAt: today,
    itemName: `${productName} ${storage} SIMフリー 本体`.trim(),
    isTrustedShop: true,
    source: 'mock',
  };

  const yahooOffer = {
    price: yahooPrice,
    shopName: yahooShop,
    url: buildYahooWebSearchUrl({ productName, storage, category, launchPrice: basePrice }),
    updatedAt: today,
    itemName: `${productName} ${storage} SIMフリー 本体`.trim(),
    isTrustedShop: true,
    source: 'mock',
  };

  const unusedOffer = {
    price: unusedPrice,
    shopName: unusedShop,
    url: buildRakutenWebSearchUrl({ productName, storage, category, launchPrice: basePrice, condition: '未使用' }),
    updatedAt: today,
    itemName: `${productName} ${storage} 未使用品 本体`.trim(),
    isTrustedShop: true,
    source: 'mock',
  };

  return { rakutenOffer, yahooOffer, unusedOffer };
}

/**
 * 候補リストから「大手ショップ (`isTrustedShop: true`) の最安値」を最優先で採用し、
 * 大手ショップが0件の場合のみ「一般ショップの最安値（参考価格）」を採用する
 */
function selectBestValidatedCandidate(candidates) {
  if (!candidates.length) return null;
  const sorted = [...candidates].sort((a, b) => a.price - b.price);
  const trusted = sorted.filter((c) => c.isTrustedShop);
  if (trusted.length > 0) {
    return {
      ...trusted[0],
      generalFallbackPrice: sorted[0].price < trusted[0].price ? sorted[0].price : undefined,
    };
  }
  return {
    ...sorted[0],
    isReferenceGeneralShop: true,
  };
}

/** 楽天APIレスポンス上位20件から厳密タイトル検証＋大手ショップ優先で最安1件を抽出 */
export function pickCheapestRakutenItem(
  items,
  minPrice,
  productName,
  storage = '',
  category = '',
  today = new Date().toISOString().slice(0, 10),
) {
  if (!Array.isArray(items)) return null;
  const candidates = [];
  for (const raw of items.slice(0, 20)) {
    const it = raw?.Item ?? raw;
    if (!it) continue;
    const price = Number(it.itemPrice);
    const title = String(it.itemName ?? '');
    const shopName = String(it.shopName || '楽天市場ショップ');
    if (!Number.isFinite(price) || price < minPrice) continue;
    if (!isValidProductTitle(title, productName, storage, category)) continue;
    candidates.push({
      price,
      shopName,
      url: toRakutenAffiliateUrl(String(it.affiliateUrl || it.itemUrl || '')),
      updatedAt: today,
      itemName: title,
      isTrustedShop: isTrustedShop(shopName),
      source: 'api',
    });
  }
  return selectBestValidatedCandidate(candidates);
}

/**
 * Yahoo!ショッピングAPI (v3) レスポンスの上位20件から
 * 厳密タイトル検証 (`isValidProductTitle`) ＋大手ショップ優先 (`isTrustedShop`) で最安1件を採用する
 */
export function pickCheapestYahooItem(
  hits,
  minPrice,
  productName,
  storage = '',
  category = '',
  today = new Date().toISOString().slice(0, 10),
) {
  if (!Array.isArray(hits)) return null;
  const candidates = [];
  for (const hit of hits.slice(0, 20)) {
    if (!hit) continue;
    const price = Number(hit.price);
    const title = String(hit.name ?? '');
    const shopName = String(hit.seller?.name || 'Yahoo!ショッピング店');
    if (!Number.isFinite(price) || price < minPrice) continue;
    if (!isValidProductTitle(title, productName, storage, category)) continue;
    candidates.push({
      price,
      shopName,
      url: toYahooAffiliateUrl(String(hit.url || '')),
      updatedAt: today,
      itemName: title,
      isTrustedShop: isTrustedShop(shopName),
      source: 'api',
    });
  }
  return selectBestValidatedCandidate(candidates);
}

let useSimplifiedRakutenParams = false;
let rakutenApiFatalError = null;

export function isRakutenApiDisabled() {
  return Boolean(rakutenApiFatalError);
}

/**
 * 楽天商品検索API (IchibaItem/Search/20220601) 共通呼び出しヘルパー
 * - affiliateId / keyword / NGKeyword を事前検証・サニタイズ
 * - HTTP 400 発生時は error_description を出力し、affiliateId や genreId を外した最小パラメータで1回自動リトライ
 */
export async function callRakutenIchibaSearch({
  appId = process.env.RAKUTEN_APP_ID?.trim(),
  affiliateId = process.env.RAKUTEN_AFFILIATE_ID?.trim(),
  accessKey = process.env.RAKUTEN_ACCESS_KEY?.trim(),
  keyword = '',
  shopCode = '',
  genreId = '',
  minPrice = 0,
  hits = 20,
}) {
  const cleanAppId = normalizeRakutenAppId(appId);
  if (!cleanAppId || rakutenApiFatalError) return null;

  const cleanKeyword = sanitizeRakutenKeyword(keyword);
  if (!cleanKeyword) return null;

  const cleanAffId = normalizeRakutenAffiliateId(affiliateId);
  const cleanAccessKey = String(accessKey ?? '').trim();
  const endpoint = cleanAccessKey ? RAKUTEN_OPENAPI_ENDPOINT : RAKUTEN_API_ENDPOINT;

  const buildParams = (simplified = false) => {
    const p = new URLSearchParams({
      applicationId: cleanAppId,
      format: 'json',
      formatVersion: '2',
      keyword: cleanKeyword,
      availability: '1',
      hits: String(hits),
    });
    if (shopCode) p.set('shopCode', shopCode);
    if (!simplified) {
      if (genreId) p.set('genreId', genreId);
      if (RAKUTEN_NG_KEYWORD) p.set('NGKeyword', RAKUTEN_NG_KEYWORD);
      if (minPrice > 0) p.set('minPrice', String(minPrice));
      p.set('sort', '+itemPrice');
      if (cleanAffId) p.set('affiliateId', cleanAffId);
    }
    if (cleanAccessKey) p.set('accessKey', cleanAccessKey);
    return p;
  };

  const primaryParams = buildParams(useSimplifiedRakutenParams);
  let res = await fetch(`${endpoint}?${primaryParams.toString()}`);

  if (res.status === 400 && !useSimplifiedRakutenParams) {
    const errBody = await res.json().catch(() => null);
    const errDesc = errBody?.error_description || errBody?.error || 'Bad Request';
    console.warn(`[warn] Rakuten API HTTP 400 (${cleanKeyword}): ${errDesc} → 最小パラメータで自動リトライします`);

    if (/applicationId|accessKey|client_id/i.test(errDesc)) {
      rakutenApiFatalError = errDesc;
      return null;
    }

    // affiliateId や genreId を外した最小パラメータで1回自動リトライ
    const retryParams = buildParams(true);
    res = await fetch(`${endpoint}?${retryParams.toString()}`);
    if (res.ok) {
      return await res.json();
    }
  }

  if (!res.ok) {
    const errBody = await res.json().catch(() => null);
    const errDesc = errBody?.error_description || errBody?.error || `HTTP ${res.status}`;
    console.warn(`[warn] Rakuten API エラー (${cleanKeyword}): ${errDesc}`);
    if (/applicationId|accessKey|client_id/i.test(errDesc)) {
      rakutenApiFatalError = errDesc;
    }
    return null;
  }

  return await res.json();
}

/**
 * 楽天市場API 単体呼び出し (hits=20)
 */
export async function fetchFromRakutenApi({
  productName,
  storage = '',
  category = 'iPhone',
  launchPrice = 98800,
  condition = '中古',
  appId = process.env.RAKUTEN_APP_ID?.trim(),
  affiliateId = process.env.RAKUTEN_AFFILIATE_ID?.trim(),
  accessKey = process.env.RAKUTEN_ACCESS_KEY?.trim(),
}) {
  const cleanAppId = String(appId ?? '').trim();
  if (!cleanAppId || rakutenApiFatalError) return null;
  const minPrice = calcMinPrice(launchPrice);
  const genreId = getRakutenGenreId(category);
  const kw = buildRakutenKeyword(productName, storage, condition, category);
  const json = await callRakutenIchibaSearch({
    appId: cleanAppId,
    affiliateId,
    accessKey,
    keyword: kw,
    genreId,
    minPrice,
    hits: 20,
  });
  if (!json) return null;
  return pickCheapestRakutenItem(json?.Items ?? [], minPrice, productName, storage, category);
}

/**
 * Yahoo!ショッピング 商品検索API (v3) 単体呼び出し (results=20)
 * エンドポイント: https://shopping.yahooapis.jp/ShoppingWebService/V3/itemSearch
 */
export async function fetchFromYahooApi({
  productName,
  storage = '',
  category = 'iPhone',
  launchPrice = 98800,
  yahooAppId = process.env.YAHOO_APP_ID?.trim(),
}) {
  const cleanYahooAppId = String(yahooAppId ?? '').trim();
  if (!cleanYahooAppId) return null;
  const priceFrom = calcMinPrice(launchPrice);
  const genreCategoryId = getYahooGenreCategoryId(category);
  const query = buildYahooQuery(productName, storage, category);

  const params = new URLSearchParams({
    appid: cleanYahooAppId,
    query,
    condition: 'used',
    genre_category_id: genreCategoryId,
    price_from: String(priceFrom),
    sort: '+price',
    results: '20',
  });

  const res = await fetch(`${YAHOO_API_ENDPOINT}?${params.toString()}`);
  if (!res.ok) throw new Error(`Yahoo! Shopping API HTTP ${res.status}`);
  const json = await res.json();
  return pickCheapestYahooItem(json?.hits ?? [], priceFrom, productName, storage, category);
}

/**
 * 楽天とYahoo!の結果から横断比較データ `usedPricing` を組み立てる
 * - 実APIから取得できたオファーを優先
 * - 両方とも実API（または両方ともフォールバック）の場合は、大手ショップ (`isTrustedShop: true`) を優先したうえで最安値を比較
 */
export function buildUsedPricingObject({
  rakutenOffer,
  yahooOffer,
  unusedOffer = null,
  launchPrice,
}) {
  const baseLaunch = Number(launchPrice) > 0 ? Number(launchPrice) : null;

  const rIsApi = rakutenOffer?.source === 'api';
  const yIsApi = yahooOffer?.source === 'api';
  const rTrusted = Boolean(rakutenOffer?.isTrustedShop);
  const yTrusted = Boolean(yahooOffer?.isTrustedShop);

  let lowestPlatform = 'rakuten';
  let lowestPrice = rakutenOffer?.price ?? yahooOffer?.price ?? 0;

  const pickCheaper = () => {
    if (rTrusted && !yTrusted) {
      lowestPlatform = 'rakuten';
      lowestPrice = rakutenOffer.price;
    } else if (!rTrusted && yTrusted) {
      lowestPlatform = 'yahoo';
      lowestPrice = yahooOffer.price;
    } else if (yahooOffer.price < rakutenOffer.price) {
      lowestPlatform = 'yahoo';
      lowestPrice = yahooOffer.price;
    } else {
      lowestPlatform = 'rakuten';
      lowestPrice = rakutenOffer.price;
    }
  };

  if (rIsApi && yIsApi) {
    pickCheaper();
  } else if (rIsApi && !yIsApi) {
    lowestPlatform = 'rakuten';
    lowestPrice = rakutenOffer.price;
  } else if (!rIsApi && yIsApi) {
    lowestPlatform = 'yahoo';
    lowestPrice = yahooOffer.price;
  } else if (rakutenOffer && yahooOffer) {
    pickCheaper();
  } else if (yahooOffer) {
    lowestPlatform = 'yahoo';
    lowestPrice = yahooOffer.price;
  }

  const resaleValuePercent =
    baseLaunch && lowestPrice > 0 ? Math.round((lowestPrice / baseLaunch) * 100) : null;

  const formatOffer = (offer, platform = 'rakuten') =>
    offer
      ? {
          price: offer.price,
          shopName: offer.shopName,
          url: platform === 'yahoo' ? toYahooAffiliateUrl(offer.url) : toRakutenAffiliateUrl(offer.url),
          updatedAt: offer.updatedAt,
          isTrustedShop: Boolean(offer.isTrustedShop),
          ...(offer.itemName ? { itemName: offer.itemName } : {}),
          ...(offer.source ? { source: offer.source } : {}),
        }
      : null;

  return {
    lowestPrice,
    lowestPlatform,
    resaleValuePercent,
    rakuten: formatOffer(rakutenOffer, 'rakuten'),
    yahoo: formatOffer(yahooOffer, 'yahoo'),
    ...(unusedOffer ? { unused: formatOffer(unusedOffer, 'rakuten') } : {}),
  };
}

/**
 * 楽天市場 ＆ Yahoo!ショッピング 横断検索メイン関数
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
  const keyword = buildRakutenKeyword(productName, storage, '中古', category);
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
    used: {
      price: usedPricing.lowestPrice,
      shopName: bestOffer.shopName,
      itemName: bestOffer.itemName ?? '',
      itemUrl: bestOffer.url,
      isTrustedShop: Boolean(bestOffer.isTrustedShop),
    },
    unused: finalUnused
      ? {
          price: finalUnused.price,
          shopName: finalUnused.shopName,
          itemName: finalUnused.itemName ?? '',
          itemUrl: finalUnused.url,
          isTrustedShop: Boolean(finalUnused.isTrustedShop),
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
      { id: 'watch-s10', name: 'Apple Watch Series 10', category: 'Apple Watch', releaseDate: '2024-09-20', storage: '42mm GPS', launchPrice: 59800 },
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
        `✓ ${t.name} (${t.storage}) 最安: ¥${up.lowestPrice.toLocaleString()} [${up.lowestPlatform.toUpperCase()}] (楽天: ¥${up.rakuten?.price.toLocaleString()} ${up.rakuten?.isTrustedShop ? '✅大手' : '※一般'} / Yahoo: ¥${up.yahoo?.price.toLocaleString()} ${up.yahoo?.isTrustedShop ? '✅大手' : '※一般'}) リセール率: ${up.resaleValuePercent}%`,
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
