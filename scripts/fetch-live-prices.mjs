/**
 * 4大キャリア最新端末価格 ＆ 楽天市場・Yahoo!ショッピング中古最安値 自動収集モジュール＆CLIスクリプト
 * 出力先: data/cache/live-prices-cache.json
 *
 * 1. 楽天モバイル（新品キャリア価格）の取得:
 *    - APIキー不要の楽天市場 公開検索ページ抽出で「楽天モバイル公式 楽天市場店」（item.rakuten.co.jp/rakutenmobile/）の
 *      新品一括価格と商品URLを取得（取得不可時は既存データを維持）
 * 2. docomo / au / SoftBank のキャリア価格取得（Playwright + フォールバック設計）:
 *    - Playwright (Chromium) を使用し、各キャリアの公式オンラインショップ価格一覧ページから
 *      「通常一括価格」と「2年返却プログラム適用時の実質負担額」の取得を試行
 *    - HTML構造変更やWAFブロック等で取得できなかった項目はエラーで止めず既存マスターデータを維持
 * 3. 楽天市場 ＆ Yahoo!ショッピングの中古最安値取得（楽天公式API / RAKUTEN_APP_ID は不使用）:
 *    - 楽天市場: APIキー不要の公開検索ページ（search.rakuten.co.jp）HTML から JSON / ld+json / 商品要素を軽量抽出
 *      （RAKUTEN_PROXY_URL 設定時は `{RAKUTEN_PROXY_URL}?url=...` の中継プロキシ経由で取得）
 *    - Yahoo!ショッピング: 商品検索API v3（YAHOO_CLIENT_ID / YAHOO_APP_ID）をメインに在庫・最安値を取得
 *    - 厳密タイトル検証 (`isValidProductTitle`) ＋ 大手中古ショップ優先ロジック (`isTrustedShop`)
 *    - 楽天側が0件でも処理を止めず、Yahoo!実在庫＋もしも経由の楽天/Amazon検索リンクで補完
 *    - 全リンクを もしもアフィリエイト（楽天市場・Yahoo!・Amazon）経由URLへ変換
 *    - レートリミット回避のため 1リクエストごとに `1200ms` のウェイトを挿入
 */
import { readFileSync, readdirSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  buildRawMallSearchUrls,
  getRuntimeEnv,
  resolveMoshimoConfig,
  toMoshimoAffiliateUrl,
} from './lib/moshimo.mjs';

export {
  configureRuntimeEnv,
  toMoshimoAffiliateUrl,
  toMoshimoRakutenUrl,
  toMoshimoYahooUrl,
  toMoshimoAmazonUrl,
  buildMoshimoMallSearchLinks,
} from './lib/moshimo.mjs';

// ローカルの .env があれば自動で読み込む（Edge環境等での例外を安全に回避）
try {
  if (typeof existsSync === 'function' && existsSync('.env')) {
    for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '').trim();
      }
    }
  }
} catch {
  /* ignore in non-Node / worker runtimes */
}

/* ============================================================================
 * 0. 楽天市場・Yahoo!ショッピング 中古検索＆厳密タイトル検証ユーティリティ
 * ============================================================================ */

/** 楽天市場 公開検索ページ（APIキー不要） */
export const RAKUTEN_SEARCH_BASE = 'https://search.rakuten.co.jp/search/mall';
/** 一般的なブラウザの User-Agent（楽天市場 公開検索ページ取得用） */
export const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
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
  AirPods: '502835',
};

export const YAHOO_GENRE_CATEGORY_IDS = {
  iPhone: '38338',        // スマホ本体
  iPad: '38340',          // タブレット本体
  Mac: '2514',            // Macノート
  'Apple Watch': '49950', // スマートウォッチ
  Watch: '49950',
  AirPods: '49014',       // イヤホン、ヘッドホン
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

  const isWatchProd = /WATCH/i.test(normProd) || category === 'Apple Watch' || category === 'Watch';
  const isAirPodsProd = /^AIRPODS/i.test(normProd) || category === 'AirPods';

  // [条件3] ブラックリスト文字列が1つでも含まれる場合は無条件で除外
  // ただし Apple Watch 本体の公式名称に含まれる「アルミニウムケース / スポーツバンド」や
  // AirPods 本体の公式名称に含まれる「MagSafe充電ケース / ワイヤレス充電ケース」は除外しない
  for (const word of NORMALIZED_BLACKLIST) {
    if (!upperTitle.includes(word)) continue;
    if (isAirPodsProd && word === 'ケース') {
      const hasOfficialChargingCase = /充電ケース|CHARGING\s*CASE/i.test(upperTitle);
      const isCaseOnlyOrCover = /ケースのみ|ケース単体|充電ケースのみ|保護ケース|シリコン|レザー|クリア|カラビナ|カバー/i.test(upperTitle);
      if (hasOfficialChargingCase && !isCaseOnlyOrCover) continue;
    }
    if (isWatchProd && (word === 'ケース' || word === 'バンド' || word === 'ベルト')) {
      const hasWatchBodyTerm = /GPS|CELLULAR|セルラー|アルミニウムケース|チタニウムケース|ステンレススチールケース|APPLE\s*WATCH本体/i.test(upperTitle);
      const isBandOrCaseOnly = /バンドのみ|ベルトのみ|ケースのみ|交換バンド|交換ベルト|保護ケース|カバー|フィルム/i.test(upperTitle);
      if (hasWatchBodyTerm && !isBandOrCaseOnly) continue;
    }
    return false;
  }

  if (isAirPodsProd && /片耳|右耳のみ|左耳のみ|Lのみ|Rのみ|イヤーチップのみ|ダストガード/i.test(upperTitle)) {
    return false;
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
  } else if (isAirPodsProd) {
    if (!upperTitle.includes('AIRPODS')) return false;
    const wantPro = /\bPRO\b/i.test(normProd);
    const wantMax = /\bMAX\b/i.test(normProd);
    if (wantPro !== /\bPRO\b/i.test(upperTitle)) return false;
    if (wantMax !== /\bMAX\b/i.test(upperTitle)) return false;

    if (wantPro) {
      if (/3\b|第3世代|3rd/i.test(normProd)) {
        if (!/PRO\s*3|第\s*3\s*世代|3\s*世代|3RD/i.test(upperTitle)) return false;
      } else if (/2nd|第2世代/i.test(normProd)) {
        if (!/PRO\s*2|第\s*2\s*世代|2\s*世代|2ND|MTJV3|MQD83/i.test(upperTitle)) return false;
      } else if (/1st|第1世代/i.test(normProd)) {
        if (/PRO\s*[23]|第\s*[23]\s*世代|[23]\s*世代|2ND|3RD/i.test(upperTitle)) return false;
      }
    } else if (wantMax) {
      if (/Max\s*2/i.test(normProd) && !/MAX\s*2|第\s*2\s*世代/i.test(upperTitle)) return false;
    } else {
      const numMatch = normProd.match(/AirPods\s*(\d+)/i) || normProd.match(/\((\d+)(?:st|nd|rd|th)\s+generation\)/i);
      if (numMatch) {
        const genNum = numMatch[1];
        const genRe = new RegExp(`(AIRPODS\\s*${genNum}|第\\s*${genNum}\\s*世代|${genNum}\\s*世代|${genNum}(?:ST|ND|RD|TH))`, 'i');
        if (!genRe.test(upperTitle)) return false;
      }
      if (/Active\s*Noise\s*Cancellation/i.test(normProd)) {
        if (!/ノイズキャンセリング|ANC|MXP93/i.test(upperTitle)) return false;
      } else if (/^AirPods\s*4$/i.test(normProd)) {
        if (/ノイズキャンセリング|ANC|MXP93/i.test(upperTitle)) return false;
      }
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

export function getRakutenGenreId(category) {
  if (RAKUTEN_GENRE_IDS[category]) return RAKUTEN_GENRE_IDS[category];
  if (/airpods/i.test(category)) return RAKUTEN_GENRE_IDS.AirPods;
  if (/watch/i.test(category)) return RAKUTEN_GENRE_IDS.Watch;
  if (/ipad/i.test(category)) return RAKUTEN_GENRE_IDS.iPad;
  if (/mac/i.test(category)) return RAKUTEN_GENRE_IDS.Mac;
  return RAKUTEN_GENRE_IDS.iPhone;
}

export function getYahooGenreCategoryId(category) {
  if (YAHOO_GENRE_CATEGORY_IDS[category]) return YAHOO_GENRE_CATEGORY_IDS[category];
  if (/airpods/i.test(category)) return YAHOO_GENRE_CATEGORY_IDS.AirPods;
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

/** 検索向けに製品名をクリーン化 */
export function cleanSearchProductName(productName) {
  return String(productName ?? '')
    .normalize('NFKC')
    .replace(/\((\d+)(?:st|nd|rd|th)\s+generation\)/gi, '第$1世代')
    .replace(/with\s+Active\s+Noise\s+Cancellation/gi, 'アクティブノイズキャンセリング')
    .replace(/with\s+Wireless\s+Charging\s+Case/gi, 'ワイヤレス充電ケース')
    .replace(/with\s+USB-C/gi, 'USB-C')
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

export function buildYahooQuery(productName, storage, category = '') {
  const cleanName = cleanSearchProductName(productName);
  const cleanStorage = extractStorageToken(storage, category);
  return [`"${cleanName}"`, cleanStorage, YAHOO_NEGATIVE_TERMS].filter(Boolean).join(' ');
}

/** 楽天市場 公開検索ページのURL（アフィリエイト変換前・価格が安い順 s=2） */
export function buildRakutenRawSearchUrl({
  productName,
  storage,
  category,
  launchPrice,
  condition = '中古',
  keyword: explicitKeyword = '',
  withFilters = true,
  /** 'price' = 価格が安い順 (s=2) / 'standard' = 楽天標準順（関連度） */
  sort = 'price',
}) {
  const keyword = explicitKeyword || buildRakutenKeyword(productName, storage, condition, category);
  // 楽天市場はスペースを「+」表記に正規化して 301 リダイレクトするため、最初から「+」で組み立てる
  const kwPath = encodeURIComponent(keyword).replace(/%20/g, '+');
  const qs = new URLSearchParams();
  if (sort === 'price') qs.set('s', '2');
  if (withFilters) {
    qs.set('min', String(calcMinPrice(launchPrice)));
    qs.set('nitem', RAKUTEN_NG_KEYWORD);
    const genreId = getRakutenGenreId(category);
    return `${RAKUTEN_SEARCH_BASE}/${kwPath}/${genreId}/?${qs.toString()}`;
  }
  return `${RAKUTEN_SEARCH_BASE}/${kwPath}/?${qs.toString()}`;
}

/** 楽天市場の検索URL（もしもアフィリエイト経由） */
export function buildRakutenWebSearchUrl(opts) {
  return toMoshimoAffiliateUrl(buildRakutenRawSearchUrl(opts), { platform: 'rakuten' });
}

export function buildYahooRawSearchUrl({ productName, storage, category, launchPrice }) {
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
  return `https://shopping.yahoo.co.jp/search?${qs.toString()}`;
}

/** Yahoo!ショッピングの検索URL（もしもアフィリエイト経由） */
export function buildYahooWebSearchUrl(opts) {
  return toMoshimoAffiliateUrl(buildYahooRawSearchUrl(opts), { platform: 'yahoo' });
}

/** Amazon.co.jp の検索URL（整備済品・新品、もしもアフィリエイト経由） */
export function buildAmazonWebSearchUrl({ productName, storage, category }) {
  const cleanName = cleanSearchProductName(productName);
  const cleanStorage = extractStorageToken(storage, category);
  const keyword = ['Apple', cleanName, cleanStorage].filter(Boolean).join(' ');
  const raw = buildRawMallSearchUrls(keyword).amazon;
  return toMoshimoAffiliateUrl(raw, { platform: 'amazon' });
}

/**
 * 3大モール横断の検索結果ページ直リンク（もしもアフィリエイト経由）。
 * 楽天市場の抽出が0件だった場合などのフォールバックボタンとして返す。
 */
export function buildMallFallbackLinks({ productName, storage, category, launchPrice }) {
  return {
    rakuten: {
      label: '楽天市場で在庫を見る',
      url: buildRakutenWebSearchUrl({ productName, storage, category, launchPrice, condition: '中古' }),
    },
    yahoo: {
      label: 'Yahoo!ショッピングで探す',
      url: buildYahooWebSearchUrl({ productName, storage, category, launchPrice }),
    },
    amazon: {
      label: 'Amazonで在庫を見る',
      url: buildAmazonWebSearchUrl({ productName, storage, category }),
    },
  };
}

/** Yahoo!ショッピング Client ID（YAHOO_CLIENT_ID 優先・旧 YAHOO_APP_ID も許容） */
export function resolveYahooClientId(explicit = '') {
  return String(explicit ?? '').trim() || getRuntimeEnv('YAHOO_CLIENT_ID') || getRuntimeEnv('YAHOO_APP_ID');
}

/** モール別に もしもアフィリエイトURLへ変換（platform: 'rakuten' | 'yahoo' | 'amazon'） */
export function toMallAffiliateUrl(rawUrl, platform) {
  return toMoshimoAffiliateUrl(String(rawUrl ?? ''), platform ? { platform } : {});
}

function hashCode(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function inferConditionRank(title, defaultRank = 'used') {
  const norm = String(title ?? '').normalize('NFKC');
  if (/未使用|新古|未開封/i.test(norm)) return 'unused';
  if (/Aランク|ランクA|超美品|極美品|美品|Sランク|ランクS/i.test(norm)) return 'rankA';
  if (/Bランク|ランクB|良品/i.test(norm)) return 'rankB';
  if (/Cランク|ランクC/i.test(norm)) return 'rankC';
  return defaultRank;
}

export function inferSimFree(title) {
  const norm = String(title ?? '').normalize('NFKC');
  return /SIMフリー|SIMロック解除/i.test(norm);
}

export function mergeAndSortShopOffers(offerLists = [], maxOffers = 15) {
  const seen = new Set();
  const merged = [];
  for (const list of offerLists) {
    if (!Array.isArray(list)) continue;
    for (const raw of list) {
      if (!raw || !Number.isFinite(Number(raw.price)) || Number(raw.price) <= 0) continue;
      const platform = raw.platform === 'yahoo' ? 'yahoo' : 'rakuten';
      const price = Number(raw.price);
      const title = String(raw.title || raw.itemName || '').trim();
      const shopName = String(raw.shopName || (platform === 'yahoo' ? 'Yahoo!ショッピング店' : '楽天市場ショップ')).trim();
      const dedupeKey = `${platform}:${price}:${shopName}:${title.slice(0, 48)}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      const isTrusted =
        typeof raw.isTrusted === 'boolean'
          ? raw.isTrusted
          : typeof raw.isTrustedShop === 'boolean'
            ? raw.isTrustedShop
            : isTrustedShop(shopName);
      const conditionRank = raw.conditionRank || inferConditionRank(title, 'used');
      const simFree = typeof raw.simFree === 'boolean' ? raw.simFree : inferSimFree(title);
      const url = toMallAffiliateUrl(String(raw.url || ''), platform);
      merged.push({
        platform,
        price,
        title,
        shopName,
        isTrusted,
        conditionRank,
        simFree,
        url,
      });
    }
  }
  merged.sort((a, b) => a.price - b.price);
  return merged.slice(0, maxOffers);
}

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

  const rakutenSearchUrl = buildRakutenWebSearchUrl({ productName, storage, category, launchPrice: basePrice, condition: '中古' });
  const yahooSearchUrl = buildYahooWebSearchUrl({ productName, storage, category, launchPrice: basePrice });
  const unusedSearchUrl = buildRakutenWebSearchUrl({ productName, storage, category, launchPrice: basePrice, condition: '未使用' });

  const rakutenOffer = {
    price: rakutenPrice,
    shopName: '',
    url: rakutenSearchUrl,
    updatedAt: today,
    itemName: '',
    isTrustedShop: false,
    source: 'mock',
    offers: [],
  };

  const yahooOffer = {
    price: yahooPrice,
    shopName: '',
    url: yahooSearchUrl,
    updatedAt: today,
    itemName: '',
    isTrustedShop: false,
    source: 'mock',
    offers: [],
  };

  const unusedOffer = {
    price: unusedPrice,
    shopName: '',
    url: unusedSearchUrl,
    updatedAt: today,
    itemName: '',
    isTrustedShop: false,
    source: 'mock',
    offers: [],
  };

  return { rakutenOffer, yahooOffer, unusedOffer, offers: [], isEstimated: true };
}

function selectBestValidatedCandidate(candidates, offers = []) {
  if (!candidates.length) return null;
  const sorted = [...candidates].sort((a, b) => a.price - b.price);
  const trusted = sorted.filter((c) => c.isTrustedShop);
  if (trusted.length > 0) {
    return {
      ...trusted[0],
      generalFallbackPrice: sorted[0].price < trusted[0].price ? sorted[0].price : undefined,
      offers,
    };
  }
  return {
    ...sorted[0],
    isReferenceGeneralShop: true,
    offers,
  };
}

export function extractValidatedRakutenOffers(
  items,
  minPrice,
  productName,
  storage = '',
  category = '',
  defaultRank = 'used',
) {
  if (!Array.isArray(items)) return [];
  const offers = [];
  // 楽天市場 公開検索ページ抽出結果（{ itemName, itemPrice, shopName, itemUrl }）
  for (const raw of items.slice(0, RAKUTEN_SCRAPE_MAX_ITEMS * 3)) {
    const it = raw?.Item ?? raw;
    if (!it) continue;
    const price = Number(it.itemPrice ?? it.price);
    const title = String(it.itemName ?? it.title ?? '');
    const shopName = String(it.shopName || '楽天市場ショップ');
    if (!Number.isFinite(price) || price < minPrice) continue;
    if (!isValidProductTitle(title, productName, storage, category)) continue;
    offers.push({
      platform: 'rakuten',
      price,
      title,
      shopName,
      isTrusted: isTrustedShop(shopName),
      conditionRank: inferConditionRank(title, defaultRank),
      simFree: inferSimFree(title),
      url: toMallAffiliateUrl(String(it.itemUrl || it.url || ''), 'rakuten'),
    });
  }
  return mergeAndSortShopOffers([offers], 15);
}

export function pickCheapestRakutenItem(
  items,
  minPrice,
  productName,
  storage = '',
  category = '',
  today = new Date().toISOString().slice(0, 10),
  defaultRank = 'used',
) {
  if (!Array.isArray(items)) return null;
  const offers = extractValidatedRakutenOffers(items, minPrice, productName, storage, category, defaultRank);
  const candidates = offers.map((o) => ({
    price: o.price,
    shopName: o.shopName,
    url: o.url,
    updatedAt: today,
    itemName: o.title,
    isTrustedShop: o.isTrusted,
    source: 'api',
  }));
  return selectBestValidatedCandidate(candidates, offers);
}

export function extractValidatedYahooOffers(
  hits,
  minPrice,
  productName,
  storage = '',
  category = '',
  defaultRank = 'used',
) {
  if (!Array.isArray(hits)) return [];
  const offers = [];
  for (const hit of hits.slice(0, 20)) {
    if (!hit) continue;
    const price = Number(hit.price);
    const title = String(hit.name ?? '');
    const shopName = String(hit.seller?.name || 'Yahoo!ショッピング店');
    if (!Number.isFinite(price) || price < minPrice) continue;
    if (!isValidProductTitle(title, productName, storage, category)) continue;
    offers.push({
      platform: 'yahoo',
      price,
      title,
      shopName,
      isTrusted: isTrustedShop(shopName),
      conditionRank: inferConditionRank(title, defaultRank),
      simFree: inferSimFree(title),
      url: toMallAffiliateUrl(String(hit.url || ''), 'yahoo'),
    });
  }
  return mergeAndSortShopOffers([offers], 15);
}

export function pickCheapestYahooItem(
  hits,
  minPrice,
  productName,
  storage = '',
  category = '',
  today = new Date().toISOString().slice(0, 10),
  defaultRank = 'used',
) {
  if (!Array.isArray(hits)) return null;
  const offers = extractValidatedYahooOffers(hits, minPrice, productName, storage, category, defaultRank);
  const candidates = offers.map((o) => ({
    price: o.price,
    shopName: o.shopName,
    url: o.url,
    updatedAt: today,
    itemName: o.title,
    isTrustedShop: o.isTrusted,
    source: 'api',
  }));
  return selectBestValidatedCandidate(candidates, offers);
}

/* ============================================================================
 * 楽天市場: APIキー不要の公開検索ページ抽出（楽天公式API / RAKUTEN_APP_ID は不使用）
 *   - https://search.rakuten.co.jp/search/mall/{keyword}/?s=2 を一般ブラウザUAで取得
 *   - RAKUTEN_PROXY_URL 設定時は `{RAKUTEN_PROXY_URL}?url={encodeURIComponent(検索URL)}` を経由
 *   - HTML 内の埋め込み JSON（window.__INITIAL_STATE__ 等）/ ld+json / 商品要素（searchresultitem）から
 *     「商品タイトル」「価格」「ショップ名」「商品URL」を軽量な正規表現で抽出
 * ========================================================================== */

export const RAKUTEN_FETCH_TIMEOUT_MS = 9000;
export const RAKUTEN_SCRAPE_MAX_ITEMS = 45;
/** 連続でこの回数「取得失敗 or 0件抽出」になったら、その実行中は楽天抽出を停止して Yahoo!/検索リンクで補完 */
export const RAKUTEN_SCRAPE_MAX_CONSECUTIVE_FAILURES = 4;

const rakutenScrapeState = { consecutiveFailures: 0, disabledReason: null, lastStatus: null };

export function isRakutenScrapeDisabled() {
  return Boolean(rakutenScrapeState.disabledReason);
}

export function getRakutenScrapeState() {
  return { ...rakutenScrapeState };
}

export function resetRakutenScrapeState() {
  rakutenScrapeState.consecutiveFailures = 0;
  rakutenScrapeState.disabledReason = null;
  rakutenScrapeState.lastStatus = null;
}

function noteRakutenScrapeResult(ok, reason = '') {
  if (ok) {
    rakutenScrapeState.consecutiveFailures = 0;
    return;
  }
  rakutenScrapeState.consecutiveFailures += 1;
  if (
    !rakutenScrapeState.disabledReason &&
    rakutenScrapeState.consecutiveFailures >= RAKUTEN_SCRAPE_MAX_CONSECUTIVE_FAILURES
  ) {
    rakutenScrapeState.disabledReason = reason || 'consecutive failures';
    console.warn(
      `[warn] 楽天市場 公開検索ページの抽出が連続${rakutenScrapeState.consecutiveFailures}回失敗しました (${rakutenScrapeState.disabledReason})\n` +
        '       → HTML仕様変更・IP制限の可能性があります。以降は Yahoo!ショッピング実在庫＋もしも経由の楽天/Amazon検索リンクで補完します。\n' +
        '       → 継続的にブロックされる場合は RAKUTEN_PROXY_URL（Xserver等の中継プロキシ）を設定してください。',
    );
  }
}

/** RAKUTEN_PROXY_URL（任意）を解決 */
export function resolveRakutenProxyUrl(explicit = '') {
  return String(explicit ?? '').trim() || getRuntimeEnv('RAKUTEN_PROXY_URL', { allowVitePrefix: false });
}

/** 実際に fetch するURL（プロキシ設定時は `{proxy}?url=...`） */
export function buildRakutenFetchUrl(searchUrl, proxyUrl = '') {
  const proxy = resolveRakutenProxyUrl(proxyUrl);
  if (!proxy) return searchUrl;
  const sep = proxy.includes('?') ? '&' : '?';
  return `${proxy}${sep}url=${encodeURIComponent(searchUrl)}`;
}

async function fetchWithTimeout(url, init = {}, timeoutMs = RAKUTEN_FETCH_TIMEOUT_MS) {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    return await fetch(url, ctrl ? { ...init, signal: ctrl.signal } : init);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const HTML_ENTITY_MAP = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', yen: '¥' };

export function decodeHtmlEntities(s) {
  return String(s ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return HTML_ENTITY_MAP[code.toLowerCase()] ?? m;
  });
}

function stripTags(s) {
  return decodeHtmlEntities(String(s ?? '').replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

/** "39,800円" / 39800 / { value: 39800 } などから価格(数値)を取り出す */
export function parseYenPrice(v) {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? Math.round(v) : null;
  if (typeof v === 'object') {
    return parseYenPrice(v.value ?? v.amount ?? v.price ?? v.min ?? v.minPrice ?? v.low ?? v.lowPrice ?? null);
  }
  const m = String(v).normalize('NFKC').match(/\d[\d,]*/);
  if (!m) return null;
  const n = Number(m[0].replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** 楽天市場の商品ページURLか判定し、クエリ等を除いた正規URLを返す（対象外は空文字） */
export function normalizeRakutenItemUrl(raw) {
  const s = decodeHtmlEntities(String(raw ?? '').trim()).replace(/\\\//g, '/');
  const m = s.match(/^(?:https?:)?\/\/item\.rakuten\.co\.jp\/([^/?#\s"']+)\/([^/?#\s"']+)\/?/i);
  if (!m) return '';
  return `https://item.rakuten.co.jp/${m[1]}/${m[2]}/`;
}

function shopCodeFromItemUrl(url) {
  const m = String(url ?? '').match(/item\.rakuten\.co\.jp\/([^/?#]+)/i);
  return m ? m[1] : '';
}

function firstNonEmptyString(...vals) {
  for (const v of vals) {
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

function toRakutenItemCandidate(o) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  const itemUrl = normalizeRakutenItemUrl(
    firstNonEmptyString(o.itemUrl, o.itemURL, o.url, o.link, o.href, o.itemLink, o.productUrl, o['@id']),
  );
  if (!itemUrl) return null;
  const itemName = firstNonEmptyString(o.itemName, o.name, o.title, o.productName, o.itemTitle);
  if (!itemName) return null;
  const itemPrice = parseYenPrice(
    o.itemPrice ?? o.price ?? o.salePrice ?? o.minPrice ?? o.priceWithTax ?? o.offers?.price ?? o.offers?.lowPrice ?? o.priceInfo,
  );
  if (!itemPrice) return null;
  const shopName = firstNonEmptyString(
    o.shopName,
    o.shop?.name,
    o.shop?.shopName,
    o.merchantName,
    o.merchant?.name,
    o.seller?.name,
    o.offers?.seller?.name,
  );
  return { itemName: decodeHtmlEntities(itemName), itemPrice, shopName: decodeHtmlEntities(shopName), itemUrl };
}

function collectRakutenItemCandidates(node, out, depth = 0, budget = { n: 0 }) {
  if (!node || depth > 40 || out.length >= RAKUTEN_SCRAPE_MAX_ITEMS * 2 || ++budget.n > 200000) return;
  if (Array.isArray(node)) {
    for (const v of node) if (v && typeof v === 'object') collectRakutenItemCandidates(v, out, depth + 1, budget);
    return;
  }
  if (typeof node !== 'object') return;
  const cand = toRakutenItemCandidate(node);
  if (cand) out.push(cand);
  for (const v of Object.values(node)) {
    if (v && typeof v === 'object') collectRakutenItemCandidates(v, out, depth + 1, budget);
  }
}

/** `marker` 直後の最初の `{` から対応する `}` までの JSON 文字列を取り出す（文字列リテラル考慮） */
function extractBalancedJson(text, startIdx) {
  const open = text.indexOf('{', startIdx);
  if (open < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return text.slice(open, i + 1);
    }
  }
  return null;
}

function tryParseJson(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/** 1-A: 埋め込み JSON（window.__INITIAL_STATE__ / __NEXT_DATA__ / application/json） */
function extractFromEmbeddedJson(html) {
  const out = [];
  const markers = ['window.__INITIAL_STATE__', '__INITIAL_STATE__', 'window.__NUXT__', 'window.__PRELOADED_STATE__'];
  for (const marker of markers) {
    let idx = html.indexOf(marker);
    let guard = 0;
    while (idx >= 0 && guard++ < 3) {
      const json = extractBalancedJson(html, idx + marker.length);
      const parsed = json ? tryParseJson(json) : null;
      if (parsed) collectRakutenItemCandidates(parsed, out);
      idx = html.indexOf(marker, idx + marker.length);
    }
    if (out.length) return out;
  }
  const scriptRe = /<script[^>]+type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = scriptRe.exec(html))) {
    const parsed = tryParseJson(m[1].trim());
    if (parsed) collectRakutenItemCandidates(parsed, out);
  }
  return out;
}

/** 1-B: ld+json（ItemList / Product） */
function extractFromLdJson(html) {
  const out = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    const parsed = tryParseJson(m[1].trim());
    if (parsed) collectRakutenItemCandidates(parsed, out);
  }
  return out;
}

/** 1-C: 商品アイテム要素（searchresultitem）を軽量正規表現で抽出 */
function extractFromItemBlocks(html) {
  const out = [];
  const parts = html.split(/<div[^>]+class=["'][^"']*\bsearchresultitem\b[^"']*["'][^>]*>/i);
  for (const rawChunk of parts.slice(1, RAKUTEN_SCRAPE_MAX_ITEMS + 1)) {
    const chunk = rawChunk.slice(0, 20000);
    const urlM = chunk.match(/href=["']((?:https?:)?\/\/item\.rakuten\.co\.jp\/[^"']+)["']/i);
    const itemUrl = urlM ? normalizeRakutenItemUrl(urlM[1]) : '';
    if (!itemUrl) continue;

    let itemName = '';
    const titleAttr =
      chunk.match(/<a[^>]+href=["'](?:https?:)?\/\/item\.rakuten\.co\.jp\/[^"']+["'][^>]*\btitle=["']([^"']+)["']/i) ||
      chunk.match(/<a[^>]+\btitle=["']([^"']+)["'][^>]*href=["'](?:https?:)?\/\/item\.rakuten\.co\.jp\//i);
    if (titleAttr) itemName = stripTags(titleAttr[1]);
    if (!itemName) {
      const h2 = chunk.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
      if (h2) itemName = stripTags(h2[1]);
    }
    if (!itemName) {
      const alt = chunk.match(/<img[^>]+\balt=["']([^"']{8,})["']/i);
      if (alt) itemName = stripTags(alt[1]);
    }
    if (!itemName) continue;

    const priceM =
      chunk.match(/class=["'][^"']*\bprice[^"']*["'][^>]*>\s*(?:<[^>]+>\s*)*([\d,]{3,})/i) ||
      chunk.match(/class=["'][^"']*\bimportant\b[^"']*["'][^>]*>\s*([\d,]{3,})/i) ||
      chunk.match(/([\d,]{3,})\s*(?:<[^>]+>\s*)*円/);
    const itemPrice = priceM ? parseYenPrice(priceM[1]) : null;
    if (!itemPrice) continue;

    let shopName = '';
    const shopM = chunk.match(/href=["'](?:https?:)?\/\/www\.rakuten\.co\.jp\/[^/"'?]+\/?[^"']*["'][^>]*>([\s\S]*?)<\/a>/i);
    if (shopM) shopName = stripTags(shopM[1]);

    out.push({ itemName, itemPrice, shopName, itemUrl });
  }
  return out;
}

/**
 * 楽天市場 公開検索ページ HTML から商品リストを抽出する（3方式を合算・URL重複排除）。
 * @returns {{ itemName: string, itemPrice: number, shopName: string, itemUrl: string }[]}
 */
export function parseRakutenSearchHtml(html) {
  const text = String(html ?? '');
  if (!text) return [];
  const merged = new Map();
  for (const list of [extractFromEmbeddedJson(text), extractFromLdJson(text), extractFromItemBlocks(text)]) {
    for (const it of list) {
      const prev = merged.get(it.itemUrl);
      if (!prev) merged.set(it.itemUrl, { ...it });
      else if (!prev.shopName && it.shopName) prev.shopName = it.shopName;
    }
    if (merged.size >= RAKUTEN_SCRAPE_MAX_ITEMS) break;
  }
  return [...merged.values()].slice(0, RAKUTEN_SCRAPE_MAX_ITEMS).map((it) => ({
    ...it,
    shopName: it.shopName || shopCodeFromItemUrl(it.itemUrl) || '楽天市場ショップ',
  }));
}

/**
 * 楽天市場 公開検索ページを取得して抽出する（失敗しても例外を投げない）。
 * @returns {Promise<{ status: 'ok'|'empty'|'error'|'disabled', items: any[], httpStatus?: number, error?: string }>}
 */
export async function scrapeRakutenSearch({ searchUrl, proxyUrl = '' }) {
  if (isRakutenScrapeDisabled()) return { status: 'disabled', items: [] };
  if (typeof process !== 'undefined' && process.env?.SKIP_RAKUTEN_SCRAPE === '1') {
    return { status: 'disabled', items: [] };
  }
  const fetchUrl = buildRakutenFetchUrl(searchUrl, proxyUrl);
  try {
    const res = await fetchWithTimeout(fetchUrl, {
      headers: {
        'User-Agent': BROWSER_USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ja,en-US;q=0.8,en;q=0.6',
        'Cache-Control': 'no-cache',
      },
      redirect: 'follow',
    });
    if (!res.ok) {
      noteRakutenScrapeResult(false, `HTTP ${res.status}`);
      rakutenScrapeState.lastStatus = 'error';
      return { status: 'error', items: [], httpStatus: res.status, error: `HTTP ${res.status}` };
    }
    const html = await res.text();
    const items = parseRakutenSearchHtml(html);
    noteRakutenScrapeResult(items.length > 0, items.length > 0 ? '' : 'no items parsed');
    rakutenScrapeState.lastStatus = items.length > 0 ? 'ok' : 'empty';
    return { status: items.length > 0 ? 'ok' : 'empty', items, httpStatus: res.status };
  } catch (err) {
    const msg = String(err?.name === 'AbortError' ? 'timeout' : (err?.message ?? err));
    noteRakutenScrapeResult(false, msg);
    rakutenScrapeState.lastStatus = 'error';
    return { status: 'error', items: [], error: msg };
  }
}

/**
 * 楽天市場（APIキー不要）から中古/未使用の有効出品を取得して最安候補を返す。
 * @returns {Promise<{ offer: object|null, status: string, rawCount: number, searchUrl: string }>}
 */
export async function searchRakutenMarketOffers({
  productName,
  storage = '',
  category = 'iPhone',
  launchPrice = 98800,
  condition = '中古',
  proxyUrl = '',
}) {
  const minPrice = calcMinPrice(launchPrice);
  const defaultRank = condition === '未使用' ? 'unused' : 'used';
  const today = new Date().toISOString().slice(0, 10);
  const base = { productName, storage, category, launchPrice, condition };
  const pick = (items) =>
    items.length > 0
      ? pickCheapestRakutenItem(items, minPrice, productName, storage, category, today, defaultRank)
      : null;

  // ① 価格が安い順（s=2）
  const priceUrl = buildRakutenRawSearchUrl({ ...base, sort: 'price' });
  const first = await scrapeRakutenSearch({ searchUrl: priceUrl, proxyUrl });
  let items = first.items;
  let offer = pick(items);
  let lastStatus = first.status;
  let usedUrl = priceUrl;

  // ② 安い順だと旧機種・別モデルが上位を占めて有効出品が少ない場合は「標準順（関連度）」も取得して合算
  if ((first.status === 'ok' || first.status === 'empty') && (offer?.offers?.length ?? 0) < 3) {
    const standardUrl = buildRakutenRawSearchUrl({ ...base, sort: 'standard' });
    const second = await scrapeRakutenSearch({ searchUrl: standardUrl, proxyUrl });
    if (second.items.length > 0) {
      const seen = new Set(items.map((it) => it.itemUrl));
      items = [...items, ...second.items.filter((it) => !seen.has(it.itemUrl))];
      offer = pick(items);
      usedUrl = standardUrl;
    }
    lastStatus = items.length > 0 ? 'ok' : second.status;

    // ③ ジャンル/価格フィルタ付きURLで1件も抽出できない場合は、フィルタなしの標準検索で最終確認
    if (items.length === 0 && second.status === 'empty') {
      const plainUrl = buildRakutenRawSearchUrl({ ...base, sort: 'standard', withFilters: false });
      const third = await scrapeRakutenSearch({ searchUrl: plainUrl, proxyUrl });
      items = third.items;
      offer = pick(items);
      lastStatus = third.status;
      usedUrl = plainUrl;
    }
  }

  return {
    offer,
    status: offer ? 'ok' : lastStatus === 'ok' ? 'filtered_empty' : lastStatus,
    rawCount: items.length,
    searchUrl: usedUrl,
  };
}

/** 楽天市場（APIキー不要）の最安候補のみを返すショートハンド */
export async function fetchFromRakutenMarket(opts) {
  const { offer } = await searchRakutenMarketOffers(opts);
  return offer;
}

/* ============================================================================
 * Yahoo!ショッピング 商品検索API v3（YAHOO_CLIENT_ID / 旧 YAHOO_APP_ID）
 * ========================================================================== */

export async function fetchFromYahooApi({
  productName,
  storage = '',
  category = 'iPhone',
  launchPrice = 98800,
  yahooAppId = '',
}) {
  const cleanYahooAppId = resolveYahooClientId(yahooAppId);
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

  const res = await fetchWithTimeout(`${YAHOO_API_ENDPOINT}?${params.toString()}`, {}, 10000);
  if (!res.ok) throw new Error(`Yahoo! Shopping API HTTP ${res.status}`);
  const json = await res.json();
  return pickCheapestYahooItem(json?.hits ?? [], priceFrom, productName, storage, category);
}


export function buildUsedPricingObject({
  rakutenOffer,
  yahooOffer,
  unusedOffer = null,
  launchPrice,
}) {
  const baseLaunch = Number(launchPrice) > 0 ? Number(launchPrice) : null;

  const rIsApi = rakutenOffer?.source === 'api' || rakutenOffer?.source === 'live';
  const yIsApi = yahooOffer?.source === 'api' || yahooOffer?.source === 'live';
  const uIsApi = unusedOffer?.source === 'api' || unusedOffer?.source === 'live';
  const rTrusted = rIsApi && Boolean(rakutenOffer?.isTrustedShop);
  const yTrusted = yIsApi && Boolean(yahooOffer?.isTrustedShop);

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

  const formatOffer = (offer, platform = 'rakuten') => {
    if (!offer) return null;
    const isRealApi = offer.source === 'api' || offer.source === 'live';
    return {
      price: offer.price,
      shopName: isRealApi ? String(offer.shopName ?? '') : '',
      url: toMallAffiliateUrl(offer.url, platform),
      updatedAt: offer.updatedAt,
      isTrustedShop: isRealApi ? Boolean(offer.isTrustedShop) : false,
      ...(isRealApi && offer.itemName ? { itemName: offer.itemName } : {}),
      source: isRealApi ? 'api' : 'mock',
    };
  };

  const toSingleShopOffer = (offer, platform = 'rakuten', defaultRank = 'used') => {
    const isRealApi = offer?.source === 'api' || offer?.source === 'live';
    if (!isRealApi || !offer || !Number.isFinite(Number(offer.price))) return [];
    if (Array.isArray(offer.offers) && offer.offers.length > 0) return offer.offers;
    const title = String(offer.itemName || offer.title || `${offer.shopName || ''} 出品`).trim();
    return [
      {
        platform,
        price: Number(offer.price),
        title,
        shopName: String(offer.shopName || (platform === 'yahoo' ? 'Yahoo!ショッピング店' : '楽天市場ショップ')),
        isTrusted: Boolean(offer.isTrustedShop),
        conditionRank: inferConditionRank(title, defaultRank),
        simFree: inferSimFree(title),
        url: toMallAffiliateUrl(offer.url, platform),
      },
    ];
  };

  const anyApi = rIsApi || yIsApi || uIsApi;
  const offerGroups = anyApi
    ? [
        ...(rIsApi ? [toSingleShopOffer(rakutenOffer, 'rakuten', 'used')] : []),
        ...(yIsApi ? [toSingleShopOffer(yahooOffer, 'yahoo', 'used')] : []),
        ...(uIsApi ? [toSingleShopOffer(unusedOffer, 'rakuten', 'unused')] : []),
      ]
    : [];

  const offers = mergeAndSortShopOffers(offerGroups, 15);

  return {
    lowestPrice,
    lowestPlatform,
    resaleValuePercent,
    isEstimated: !anyApi,
    rakuten: formatOffer(rakutenOffer, 'rakuten'),
    yahoo: formatOffer(yahooOffer, 'yahoo'),
    ...(uIsApi && unusedOffer ? { unused: formatOffer(unusedOffer, 'rakuten') } : {}),
    offers,
  };
}

/**
 * 楽天市場（APIキー不要の公開検索ページ抽出）＆ Yahoo!ショッピングAPI 横断検索メイン関数
 * （Cloudflare Pages Functions / Vite dev server 用）
 *
 * - 楽天公式API（RAKUTEN_APP_ID）は使用しない
 * - 楽天側が HTML仕様変更・IP制限等で0件でもエラーで止めず、Yahoo!の実在庫を最安値として返し、
 *   楽天市場・Amazon は もしもアフィリエイト経由の検索結果ページ直リンク（mallLinks）で補完する
 */
export async function searchRakutenUsedPrice({
  productName,
  storage = '',
  category = 'iPhone',
  launchPrice = 98800,
  releaseDate = '2023-09-22',
  yahooAppId = '',
  /** 任意: Xserver等の中継プロキシURL（未設定時は RAKUTEN_PROXY_URL → 直接fetch） */
  proxyUrl = '',
  /** 連続する楽天市場ページ取得の間に挿入する待機時間(ms)（アクセス集中の回避） */
  rakutenGapMs = 0,
}) {
  const minPrice = calcMinPrice(launchPrice);
  const genreId = getRakutenGenreId(category);
  const keyword = buildRakutenKeyword(productName, storage, '中古', category);
  const fallback = estimatePlatformOffers({ productName, storage, category, launchPrice, releaseDate });
  const resolvedYahooId = resolveYahooClientId(yahooAppId);

  let rakutenOffer = null;
  let yahooOffer = null;
  let unusedOffer = null;
  let rakutenStatus = 'skipped';
  let yahooStatus = resolvedYahooId ? 'pending' : 'not_configured';

  const tasks = [
    (async () => {
      try {
        const used = await searchRakutenMarketOffers({
          productName,
          storage,
          category,
          launchPrice,
          condition: '中古',
          proxyUrl,
        });
        rakutenOffer = used.offer;
        rakutenStatus = used.status;
      } catch (err) {
        rakutenStatus = 'error';
        console.warn(`[warn] 楽天市場 抽出 (${productName} ${storage}): ${err?.message ?? err}`);
      }
      if (isRakutenScrapeDisabled()) return;
      if (rakutenGapMs > 0) await new Promise((r) => setTimeout(r, rakutenGapMs));
      try {
        unusedOffer = await fetchFromRakutenMarket({
          productName,
          storage,
          category,
          launchPrice,
          condition: '未使用',
          proxyUrl,
        });
      } catch {
        /* ignore */
      }
    })(),
  ];

  if (resolvedYahooId) {
    tasks.push(
      (async () => {
        try {
          yahooOffer = await fetchFromYahooApi({
            productName,
            storage,
            category,
            launchPrice,
            yahooAppId: resolvedYahooId,
          });
          yahooStatus = yahooOffer ? 'ok' : 'empty';
        } catch (err) {
          yahooStatus = 'error';
          console.warn(`[warn] Yahoo API (${productName} ${storage}): ${err?.message ?? err}`);
        }
      })(),
    );
  }

  await Promise.all(tasks);

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
  const unusedIsApi = unusedOffer?.source === 'api';
  const mallLinks = buildMallFallbackLinks({ productName, storage, category, launchPrice });
  const hasRakutenOffers = (usedPricing.offers ?? []).some((o) => o.platform === 'rakuten');

  return {
    keyword,
    genreId,
    minPrice,
    launchPrice: Number(launchPrice) > 0 ? Number(launchPrice) : null,
    usedPricing,
    offers: usedPricing.offers ?? [],
    isEstimated: !anyApi,
    used: {
      price: usedPricing.lowestPrice,
      shopName: anyApi ? bestOffer.shopName : '',
      itemName: anyApi ? (bestOffer.itemName ?? '') : '',
      itemUrl: bestOffer.url,
      isTrustedShop: anyApi ? Boolean(bestOffer.isTrustedShop) : false,
    },
    unused: unusedIsApi && unusedOffer
      ? {
          price: unusedOffer.price,
          shopName: unusedOffer.shopName,
          itemName: unusedOffer.itemName ?? '',
          itemUrl: unusedOffer.url,
          isTrustedShop: Boolean(unusedOffer.isTrustedShop),
        }
      : null,
    resaleRate: usedPricing.resaleValuePercent,
    source: anyApi ? 'api' : 'mock',
    /** 各モールの取得状況（rakuten: ok / filtered_empty / empty / error / disabled, yahoo: ok / empty / error / not_configured） */
    sourceStatus: { rakuten: rakutenStatus, yahoo: yahooStatus },
    /** もしもアフィリエイト経由の3大モール検索結果ページ直リンク（常に付与） */
    mallLinks,
    /** 楽天市場の実出品が0件だった場合に表示すべき直リンクボタン（楽天市場・Amazon） */
    fallbackLinks: hasRakutenOffers ? [] : [mallLinks.rakuten, mallLinks.amazon],
    rakutenSearchUrl: mallLinks.rakuten.url,
    yahooSearchUrl: mallLinks.yahoo.url,
    amazonSearchUrl: mallLinks.amazon.url,
    fetchedAt: new Date().toISOString(),
  };
}

export const searchCrossPlatformUsedPrice = searchRakutenUsedPrice;

/* ============================================================================
 * 1. キャリア価格・中古最安値バッチ収集 (`data/cache/live-prices-cache.json`)
 * ============================================================================ */

export const LIVE_CACHE_PATH = 'data/cache/live-prices-cache.json';
export const CATALOG_DIR = 'data/catalog';
export const API_WAIT_MS = 1200;
const TODAY = new Date().toISOString().slice(0, 10);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
  iPad: { docomo: 1.15, au: 1.13, softbank: 1.155 },
  'Apple Watch': { docomo: 1.15, au: 1.13, softbank: 1.145, rakuten: 1.055 },
  AirPods: { docomo: 1.0, au: 1.0, softbank: 1.0, rakuten: 1.0 },
};

const round10 = (n) => Math.round(n / 10) * 10;

/**
 * 既存のマスターデータ（`data/catalog/*.json`, `public/products.json`, `data/cache/live-prices-cache.json`）を統合して
 * 安全なフォールバック用ベースラインを構築する
 */
export function loadMasterBaseline() {
  const masterProducts = new Map();
  const priceResearchByFamily = new Map();
  const detailProductsFromCatalog = [];

  // 1) data/catalog/*.json から Apple Store 価格履歴と詳細データ(detail)を読み込む
  if (existsSync(CATALOG_DIR)) {
    for (const f of readdirSync(CATALOG_DIR).filter((f) => f.endsWith('.json'))) {
      try {
        const ds = JSON.parse(readFileSync(`${CATALOG_DIR}/${f}`, 'utf8'));
        for (const [fam, entry] of Object.entries(ds.families ?? {})) {
          priceResearchByFamily.set(fam, entry);
          if (entry.detail) {
            detailProductsFromCatalog.push(entry.detail);
          }
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

  // 3) カタログ内の detail 製品データを補完
  for (const d of detailProductsFromCatalog) {
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

  // 4) 既存の data/cache/live-prices-cache.json があればフォールバックソースとして保持
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

const RESEARCHED_CARRIER_PRICES = {
  'iPhone 17|256GB': { docomo: 199793, au: 186800, softbank: 199440, rakuten: 176800 },
  'iPhone 17|512GB': { docomo: 234883, au: 224800, softbank: 239040, rakuten: 211800 },
  'iPhone Air|256GB': { docomo: 215490, au: 204800, softbank: 214560, rakuten: 194800 },
  'iPhone Air|512GB': { docomo: 252890, au: 242800, softbank: 254160, rakuten: 229800 },
  'iPhone Air|1TB': { docomo: 290290, au: 280800, softbank: 293760, rakuten: 264800 },
  'iPhone 17 Pro|256GB': { docomo: 234960, au: 224800, softbank: 234720, rakuten: 214800 },
  'iPhone 17 Pro|512GB': { docomo: 274560, au: 262800, softbank: 275040, rakuten: 249800 },
  'iPhone 17 Pro|1TB': { docomo: 314160, au: 300800, softbank: 315360, rakuten: 284800 },
  'iPhone 17 Pro Max|256GB': { docomo: 254760, au: 244800, softbank: 254880, rakuten: 234800 },
  'iPhone 17 Pro Max|512GB': { docomo: 294360, au: 282800, softbank: 295200, rakuten: 269800 },
  'iPhone 17 Pro Max|1TB': { docomo: 333960, au: 320800, softbank: 335520, rakuten: 304800 },
  'iPhone 17 Pro Max|2TB': { docomo: 399960, au: 388800, softbank: 403200, rakuten: 369800 },
  'iPhone 16e|128GB': { docomo: 118910, au: 112800, softbank: 116640, rakuten: 110800 },
  'iPhone 16e|256GB': { docomo: 140690, au: 132800, softbank: 136800, rakuten: 130100 },
  'iPhone 16e|512GB': { docomo: 182930, au: 172800, softbank: 177120, rakuten: 166800 },
  'iPhone 17e|256GB': { docomo: 119900, au: 114800, softbank: 118800, rakuten: 109800 },
  'iPhone 17e|512GB': { docomo: 159500, au: 152800, softbank: 158400, rakuten: 146800 },
  'iPad (10th generation)|64GB': { docomo: 97680, au: 96000, softbank: 97920 },
  'iPad (10th generation)|256GB': { docomo: 127380, au: 125400, softbank: 127440 },
  'iPad (第10世代)|64GB': { docomo: 97680, au: 96000, softbank: 97920 },
  'iPad (第10世代)|256GB': { docomo: 127380, au: 125400, softbank: 127440 },
  'iPad (A16)|128GB': { docomo: 115500, au: 113400, softbank: 115920 },
  'iPad (A16)|256GB': { docomo: 134970, au: 132800, softbank: 135360 },
  'iPad (A16)|512GB': { docomo: 175560, au: 172800, softbank: 176400 },
  'iPad mini (6th generation)|64GB': { docomo: 127380, au: 125400, softbank: 128160 },
  'iPad mini (6th generation)|256GB': { docomo: 157410, au: 154800, softbank: 157680 },
  'iPad mini (A17 Pro)|128GB': { docomo: 144870, au: 142200, softbank: 145440 },
  'iPad mini (A17 Pro)|256GB': { docomo: 164340, au: 161400, softbank: 164880 },
  'iPad mini (A17 Pro)|512GB': { docomo: 204600, au: 201000, softbank: 205200 },
  'iPad mini (A20 Pro)|128GB': { docomo: 173140, au: 168800, softbank: 180720 },
  'iPad mini (A20 Pro)|256GB': { docomo: 193380, au: 189800, softbank: 202320 },
  'iPad mini (A20 Pro)|512GB': { docomo: 234960, au: 228800, softbank: 246240 },
  'iPad Air 11-inch (M2)|128GB': { docomo: 143550, au: 141000, softbank: 144000 },
  'iPad Air 11-inch (M2)|256GB': { docomo: 162030, au: 159000, softbank: 162720 },
  'iPad Air 11-inch (M2)|512GB': { docomo: 203280, au: 199800, softbank: 203760 },
  'iPad Air 11-inch (M2)|1TB': { docomo: 244860, au: 240600, softbank: 245520 },
  'iPad Air 11インチ (M2)|128GB': { docomo: 143550, au: 141000, softbank: 144000 },
  'iPad Air 13-inch (M2)|128GB': { docomo: 178200, au: 175200, softbank: 178560 },
  'iPad Air 13-inch (M2)|256GB': { docomo: 196680, au: 193200, softbank: 197280 },
  'iPad Air 13-inch (M2)|512GB': { docomo: 237930, au: 234000, softbank: 238320 },
  'iPad Air 13-inch (M2)|1TB': { docomo: 279180, au: 274800, softbank: 279360 },
  'iPad Air 11-inch (M3)|128GB': { docomo: 179190, au: 176400, softbank: 179280 },
  'iPad Air 11-inch (M3)|256GB': { docomo: 198660, au: 195600, softbank: 199440 },
  'iPad Air 11-inch (M3)|512GB': { docomo: 238920, au: 235200, softbank: 239760 },
  'iPad Air 11-inch (M3)|1TB': { docomo: 279180, au: 274800, softbank: 279360 },
  'iPad Air 13-inch (M3)|128GB': { docomo: 225390, au: 221400, softbank: 226080 },
  'iPad Air 13-inch (M3)|256GB': { docomo: 244860, au: 240600, softbank: 245520 },
  'iPad Air 13-inch (M3)|512GB': { docomo: 285120, au: 280200, softbank: 285840 },
  'iPad Air 13-inch (M3)|1TB': { docomo: 325380, au: 319800, softbank: 326160 },
  'iPad Pro 11-inch (M4)|256GB': { docomo: 235620, au: 231600, softbank: 236160 },
  'iPad Pro 11-inch (M4)|512GB': { docomo: 276870, au: 272400, softbank: 277920 },
  'iPad Pro 11-inch (M4)|1TB': { docomo: 355080, au: 349200, softbank: 355680 },
  'iPad Pro 11-inch (M4)|2TB': { docomo: 433290, au: 426000, softbank: 434160 },
  'iPad Pro 13-inch (M4)|256GB': { docomo: 293040, au: 288000, softbank: 293760 },
  'iPad Pro 13-inch (M4)|512GB': { docomo: 334620, au: 328800, softbank: 335520 },
  'iPad Pro 13-inch (M4)|1TB': { docomo: 412830, au: 405600, softbank: 413280 },
  'iPad Pro 13-inch (M4)|2TB': { docomo: 491040, au: 482400, softbank: 491760 },
  'iPad Pro 11-inch (M5)|256GB': { docomo: 282810, au: 277800, softbank: 283680 },
  'iPad Pro 11-inch (M5)|512GB': { docomo: 323070, au: 317400, softbank: 324000 },
  'iPad Pro 11-inch (M5)|1TB': { docomo: 403590, au: 396600, softbank: 404640 },
  'iPad Pro 11-inch (M5)|2TB': { docomo: 484110, au: 475800, softbank: 485280 },
  'iPad Pro 13-inch (M5)|256GB': { docomo: 351780, au: 345600, softbank: 352800 },
  'iPad Pro 13-inch (M5)|512GB': { docomo: 392040, au: 385200, softbank: 393120 },
  'iPad Pro 13-inch (M5)|1TB': { docomo: 472560, au: 464400, softbank: 473760 },
  'iPad Pro 13-inch (M5)|2TB': { docomo: 553080, au: 543600, softbank: 554400 },
  'Apple Watch SE (2nd generation)|40mm': { docomo: 49390, au: 48400, softbank: 48960, rakuten: 44800 },
  'Apple Watch SE (2nd generation)|44mm': { docomo: 54890, au: 53900, softbank: 54720, rakuten: 49800 },
  'Apple Watch Series 10|42mm': { docomo: 87890, au: 86800, softbank: 87120, rakuten: 80800 },
  'Apple Watch Series 10|46mm': { docomo: 93500, au: 92400, softbank: 92880, rakuten: 85800 },
  'Apple Watch Series 11|42mm': { docomo: 103290, au: 101400, softbank: 102960, rakuten: 94800 },
  'Apple Watch Series 11|46mm': { docomo: 109010, au: 107000, softbank: 108720, rakuten: 99800 },
  'Apple Watch Series 12|42mm': { docomo: 103290, au: 101400, softbank: 102960, rakuten: 94800 },
  'Apple Watch Series 12|46mm': { docomo: 109010, au: 107000, softbank: 108720, rakuten: 99800 },
  'Apple Watch Ultra 2|49mm': { docomo: 152130, au: 148800, softbank: 150480, rakuten: 136800 },
  'Apple Watch Ultra 3|49mm': { docomo: 164230, au: 161400, softbank: 164160, rakuten: 150800 },
  'Apple Watch Ultra 4|49mm': { docomo: 164230, au: 161400, softbank: 164160, rakuten: 150800 },
  'Apple Watch SE 3|40mm': { docomo: 58630, au: 57400, softbank: 58320, rakuten: 53800 },
  'Apple Watch SE 3|44mm': { docomo: 64350, au: 63000, softbank: 64080, rakuten: 58800 },
  'AirPods Pro (2nd generation)|標準': { docomo: 39800, au: 39800, softbank: 39800, rakuten: 39800 },
  'AirPods Pro 3|標準': { docomo: 42800, au: 42800, softbank: 42800, rakuten: 42800 },
  'AirPods 4|標準': { docomo: 23800, au: 23800, softbank: 23800, rakuten: 23800 },
  'AirPods 4 with Active Noise Cancellation|標準': { docomo: 32800, au: 32800, softbank: 32800, rakuten: 32800 },
  'AirPods Max|標準': { docomo: 84800, au: 84800, softbank: 84800, rakuten: 84800 },
  'AirPods Max with USB-C|標準': { docomo: 84800, au: 84800, softbank: 84800, rakuten: 84800 },
  'AirPods Max 2|標準': { docomo: 89800, au: 89800, softbank: 89800, rakuten: 89800 },
  'AirPods 5|標準': { docomo: 23800, au: 23800, softbank: 23800, rakuten: 23800 },
  'AirPods 5 with Wireless Charging Case|標準': { docomo: 27800, au: 27800, softbank: 27800, rakuten: 27800 },
};

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
    'iphone-17',
    'iphone-air',
    'iphone-17-pro',
    'iphone-17-pro-max',
    'iphone-17e',
    'iphone-18-pro',
    'iphone-18-pro-max',
    'iphone-duo',
    'iphone-se-3rd-generation',
    'ipad-10',
    'ipad-a16',
    'ipad-air-5th-generation',
    'ipad-air-11-m2',
    'ipad-air-13-inch-m2',
    'ipad-air-11-inch-m3',
    'ipad-air-13-inch-m3',
    'ipad-air-11-inch-m4',
    'ipad-air-13-inch-m4',
    'ipad-pro-11-inch-m4',
    'ipad-pro-13-inch-m4',
    'ipad-pro-11-inch-m5',
    'ipad-pro-13-inch-m5',
    'ipad-mini-6th-generation',
    'ipad-mini-a17-pro',
    'ipad-mini-a20-pro',
    'watch-s10',
    'apple-watch-series-8',
    'apple-watch-series-9',
    'apple-watch-series-11',
    'apple-watch-series-12',
    'apple-watch-ultra',
    'apple-watch-ultra-2',
    'apple-watch-ultra-3',
    'apple-watch-ultra-4',
    'apple-watch-se-2nd-generation',
    'apple-watch-se-3',
    'airpods-2nd-generation',
    'airpods-3rd-generation',
    'airpods-4',
    'airpods-4-with-active-noise-cancellation',
    'airpods-5',
    'airpods-5-with-wireless-charging-case',
    'airpods-pro-1st-generation',
    'airpods-pro-2nd-generation',
    'airpods-pro-3',
    'airpods-max',
    'airpods-max-with-usb-c',
    'airpods-max-2',
    'mba-13-m2',
    'macbook-air-13-inch-m3-2024',
    'macbook-air-15-inch-m3-2024',
    'macbook-air-13-inch-m4-2025',
    'macbook-air-15-inch-m4-2025',
    'macbook-air-13-inch-m5-2026',
    'macbook-air-15-inch-m5-2026',
    'macbook-neo',
    'imac-24-inch-m6-2026',
    'macbook-pro-14-inch-m6',
    'macbook-pro-14-inch-proled-xdr-m5-pro',
    'macbook-pro-14-inch-proled-xdr-m5-max',
    'macbook-pro-16-inch-proled-xdr-m5-pro',
    'macbook-pro-16-inch-proled-xdr-m5-max',
  ]);

  const targets = [];
  for (const p of masterProducts.values()) {
    if (
      p.detail ||
      TARGET_IDS.has(p.id) ||
      (p.releaseDate >= '2022-01-01' && ['iPhone', 'iPad', 'Apple Watch', 'AirPods'].includes(p.category))
    ) {
      targets.push(p);
    }
  }
  return targets;
}

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
    product.category === 'AirPods' ||
    (product.category === 'iPad' && /Cellular/i.test(sku.connectivity || '')) ||
    (product.category === 'Apple Watch' && /Cellular/i.test(sku.connectivity || ''));

  if (!isCarrierTarget) {
    return result;
  }

  const multMap = CARRIER_MULTIPLIER_DEFAULT[product.category] ?? null;
  const sizeOrStor =
    product.category === 'Apple Watch'
      ? (String(sku.label ?? '').match(/(\d+mm)/i)?.[1] ?? sku.storage)
      : (sku.storage || sku.label);
  const researched = RESEARCHED_CARRIER_PRICES[`${product.name}|${sizeOrStor}`] ?? null;
  const isAirPods = product.category === 'AirPods';
  const hasReturnProgram = !isAirPods;

  for (const carrierId of ['docomo', 'au', 'softbank', 'rakuten']) {
    if (product.category === 'iPad' && carrierId === 'rakuten') continue;
    const prog = CARRIER_PROGRAM_DEFAULT[carrierId];

    if (existingCarriers[carrierId] || cachedCarriers[carrierId]) {
      const base = structuredClone(existingCarriers[carrierId] ?? cachedCarriers[carrierId]);
      if (isAirPods) {
        base.mnpPrice = null;
        base.programEffective2Yr = null;
        base.returnProgram = null;
      } else if (hasReturnProgram && !base.returnProgram && prog) {
        const cur = base.currentPrice ?? currentApplePrice;
        const eff = round10(cur * (1 - prog.residualRatio));
        base.programEffective2Yr = eff;
        base.returnProgram = {
          name: prog.name,
          months: prog.months,
          effectiveCost: eff,
          residualValue: Math.max(cur - eff, 0),
        };
      }
      result[carrierId] = base;
    } else if (multMap) {
      const mult = multMap[carrierId] ?? 1.1;
      const researchedPrice = researched?.[carrierId] ?? null;
      const launchPrice = researchedPrice ?? round10(launchApplePrice * mult);
      const currentPrice = researchedPrice ?? round10(currentApplePrice * mult);
      const mnpPrice =
        product.category === 'iPhone' ? Math.max(0, currentPrice - prog.mnpDiscount) : null;
      const effCost = hasReturnProgram ? round10(currentPrice * (1 - prog.residualRatio)) : null;
      result[carrierId] = {
        launchPrice,
        currentPrice,
        mnpPrice,
        programEffective2Yr: effCost,
        returnProgram: hasReturnProgram
          ? {
              name: prog.name,
              months: prog.months,
              effectiveCost: effCost,
              residualValue: Math.max(currentPrice - effCost, 0),
            }
          : null,
        note: researchedPrice ? '各社公式オンラインショップ価格表に基づく一括価格' : 'マスターデータ由来の推定・基準価格',
      };
    }
  }

  if (result.rakuten?.url) {
    result.rakuten.url = toMallAffiliateUrl(result.rakuten.url, 'rakuten');
  }

  return result;
}

export async function fetchRakutenMobileOfficialPrice({
  productName,
  storage = '',
  connectivity = '-',
  category = 'iPhone',
  launchPrice = 98800,
  proxyUrl = '',
}) {
  if (isRakutenScrapeDisabled()) return null;

  if (category === 'Mac' || category === 'iPad') return null;
  if (category === 'Apple Watch' && !/Cellular/i.test(connectivity)) return null;

  const cleanName = cleanSearchProductName(productName);
  const cleanStorage = extractStorageToken(storage, category);
  const keyword = ['楽天モバイル', cleanName, cleanStorage]
    .filter(Boolean)
    .join(' ')
    .replace(/[()（）+/,-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const minFloor = category === 'AirPods' ? 10000 : category === 'Apple Watch' ? 18000 : 25000;
  const defaultLaunch = category === 'AirPods' ? 23800 : category === 'Apple Watch' ? 42800 : 80000;
  const minNewPrice = Math.max(Math.round((Number(launchPrice) || defaultLaunch) * 0.5), minFloor);

  // APIキー不要: 楽天市場 公開検索ページから「楽天モバイル公式 楽天市場店（/rakutenmobile/）」の出品のみ抽出
  const searchUrl = `${RAKUTEN_SEARCH_BASE}/${encodeURIComponent(keyword).replace(/%20/g, '+')}/?${new URLSearchParams({
    min: String(minNewPrice),
    s: '2',
  }).toString()}`;
  const scraped = await scrapeRakutenSearch({ searchUrl, proxyUrl });
  const items = scraped.items.filter((it) => /item\.rakuten\.co\.jp\/rakutenmobile\//i.test(it.itemUrl));
  if (items.length === 0) return null;

  const validItems = [];
  for (const raw of items) {
    const it = raw?.Item ?? raw;
    if (!it) continue;
    const price = Number(it.itemPrice);
    const title = String(it.itemName ?? '');
    if (!Number.isFinite(price) || price < minNewPrice) continue;
    if (!isValidProductTitle(title, productName, storage, category)) continue;

    if (category === 'Apple Watch') {
      const wantCell = /Cellular/i.test(connectivity);
      const hasCellInTitle = /Cellular|セルラー/i.test(title);
      if (wantCell !== hasCellInTitle && /GPS/i.test(title)) continue;
    }

    const isStandalone = /単品|本体のみ|回線セットなし|SIMフリー/i.test(title) && !/回線セット|プランセット/i.test(title);
    validItems.push({
      price,
      url: toMallAffiliateUrl(String(it.itemUrl || ''), 'rakuten'),
      itemName: title,
      shopName: String(it.shopName || '楽天モバイル公式 楽天市場店'),
      isStandalone,
      updatedAt: TODAY,
    });
  }

  if (validItems.length === 0) return null;

  validItems.sort((a, b) => Number(b.isStandalone) - Number(a.isStandalone) || a.price - b.price);
  const picked = validItems[0];

  return {
    currentPrice: picked.price,
    url: picked.url,
    itemName: picked.itemName,
    shopName: picked.shopName,
    updatedAt: picked.updatedAt,
    source: 'rakutenmobile_scrape',
  };
}

function parseCarrierBlocksForSku(blocks, productName, storage, carrierId) {
  const normProd = cleanSearchProductName(productName).toUpperCase();
  const storToken = extractStorageToken(storage).toUpperCase();

  for (const text of blocks) {
    const normText = String(text ?? '').normalize('NFKC');
    const upperText = normText.toUpperCase();
    if (!isValidProductTitle(normText, productName, storToken)) continue;
    if (!upperText.includes(normProd) && !upperText.includes(productName.toUpperCase())) continue;

    const yenMatches = [...normText.matchAll(/(?:¥|￥)?\s*(\d{1,3}(?:,\d{3})+)\s*円?/g)]
      .map((m) => Number(m[1].replace(/,/g, '')))
      .filter((n) => Number.isFinite(n) && n >= 1000 && n <= 450000);

    if (yenMatches.length === 0) continue;

    const totalCandidates = yenMatches.filter((n) => n >= 40000 && n <= 450000);
    const currentPrice = totalCandidates.length > 0 ? Math.max(...totalCandidates) : null;

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

export function mergeLiveCarrierPrice(baseCarrierObj, liveData, carrierId, category = '') {
  if (!liveData || typeof liveData.currentPrice !== 'number' || liveData.currentPrice <= 0) {
    return baseCarrierObj;
  }

  const isAirPods = category === 'AirPods';
  const progDefault = CARRIER_PROGRAM_DEFAULT[carrierId];
  const merged = structuredClone(
    baseCarrierObj ?? {
      launchPrice: liveData.currentPrice,
      currentPrice: liveData.currentPrice,
      mnpPrice: isAirPods ? null : Math.max(0, liveData.currentPrice - (progDefault?.mnpDiscount ?? 20000)),
      programEffective2Yr: null,
      returnProgram: null,
    },
  );

  const prevDiscount =
    merged.mnpPrice != null && merged.currentPrice > merged.mnpPrice
      ? merged.currentPrice - merged.mnpPrice
      : (progDefault?.mnpDiscount ?? 20000);

  merged.currentPrice = liveData.currentPrice;
  if (isAirPods) {
    merged.mnpPrice = null;
    merged.programEffective2Yr = null;
    merged.returnProgram = null;
  } else if (merged.mnpPrice !== null) {
    merged.mnpPrice = Math.max(0, liveData.currentPrice - prevDiscount);
  }

  if (!isAirPods && typeof liveData.effectiveCost === 'number' && liveData.effectiveCost > 0) {
    const residualValue = Math.max(0, liveData.currentPrice - liveData.effectiveCost);
    merged.programEffective2Yr = liveData.effectiveCost;
    merged.returnProgram = {
      name: merged.returnProgram?.name ?? progDefault?.name ?? '2年返却プログラム',
      months: merged.returnProgram?.months ?? progDefault?.months ?? 24,
      effectiveCost: liveData.effectiveCost,
      residualValue,
    };
  } else if (!isAirPods && merged.returnProgram && merged.returnProgram.effectiveCost > 0) {
    const ratio = progDefault?.residualRatio ?? 0.5;
    const eff = round10(liveData.currentPrice * (1 - ratio));
    merged.programEffective2Yr = eff;
    merged.returnProgram = {
      ...merged.returnProgram,
      effectiveCost: eff,
      residualValue: round10(liveData.currentPrice * ratio),
    };
  }

  if (liveData.url) merged.url = liveData.url;
  if (liveData.shopName) merged.shopName = liveData.shopName;
  if (liveData.updatedAt) merged.updatedAt = liveData.updatedAt;
  if (liveData.source) merged.source = liveData.source;

  return merged;
}

export async function runFetchLivePrices() {
  const yahooAppId = resolveYahooClientId();
  const proxyUrl = resolveRakutenProxyUrl();
  const moshimo = resolveMoshimoConfig();
  const flag = (name, resolved) =>
    getRuntimeEnv(name) ? `設定済 (${resolved})` : resolved ? `既定値 (${resolved})` : '未設定 (もしも変換なし・元URLのまま)';

  console.log('================================================================');
  console.log('📦 Apple Price Atlas 自動価格収集バッチ (scripts/fetch-live-prices.mjs)');
  console.log('  楽天市場            : APIキー不要の公開検索ページ抽出（楽天公式APIは不使用）');
  console.log(`  RAKUTEN_PROXY_URL   : ${proxyUrl ? '設定済 (中継プロキシ経由)' : '未設定 (直接fetch)'}`);
  console.log(`  YAHOO_CLIENT_ID     : ${yahooAppId ? '設定済' : '未設定 (既存データ/推定フォールバック)'}`);
  console.log(`  MOSHIMO_RAKUTEN_AID : ${flag('MOSHIMO_RAKUTEN_AID', moshimo.rakutenAid)}`);
  console.log(`  MOSHIMO_YAHOO_AID   : ${flag('MOSHIMO_YAHOO_AID', moshimo.yahooAid)}`);
  console.log(`  MOSHIMO_AMAZON_AID  : ${flag('MOSHIMO_AMAZON_AID', moshimo.amazonAid)}`);
  console.log('================================================================\n');

  const { masterProducts, previousCache } = loadMasterBaseline();
  const targetProducts = selectTargetProducts(masterProducts);

  const scrapedCarriers = await scrapeAllCarriersWithPlaywright(targetProducts);

  const rakutenMobileQueryCache = new Map();
  const usedPriceQueryCache = new Map();

  let rakutenMobileHits = 0;
  let usedApiHits = 0;
  let rakutenScrapeHits = 0;
  let yahooApiHits = 0;
  const cacheProductsOut = {};

  for (const product of targetProducts) {
    const prevProdCache = previousCache?.products?.[product.id] ?? null;
    const skusOut = {};

    for (const sku of product.skus ?? []) {
      const prevSkuCache = prevProdCache?.skus?.[sku.id] ?? null;
      const launchPrice =
        sku.priceHistory?.[0]?.appleStorePrice ?? sku.carriers?.apple?.launchPrice ?? 98800;
      const storageTerm =
        product.category === 'Apple Watch' ? (sku.label || sku.storage) : (sku.storage || sku.label);

      const carriers = buildFallbackCarrierPrices(product, sku, prevSkuCache);

      for (const cid of ['docomo', 'au', 'softbank']) {
        const liveScraped = scrapedCarriers[cid]?.get(`${product.id}:${sku.id}`);
        if (liveScraped && carriers[cid]) {
          carriers[cid] = mergeLiveCarrierPrice(carriers[cid], liveScraped, cid, product.category);
        }
      }

      const normStorageKey = extractStorageToken(storageTerm, product.category) || storageTerm;
      const rmKey = `${product.name}|${normStorageKey}|${sku.connectivity || '-'}`;
      let rmLive = null;
      const isRakutenEligible =
        product.category === 'iPhone' ||
        product.category === 'AirPods' ||
        (product.category === 'Apple Watch' && /Cellular/i.test(sku.connectivity || ''));
      if (!isRakutenScrapeDisabled() && isRakutenEligible) {
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
              proxyUrl,
            });
            if (rmLive) rakutenMobileHits++;
          } catch (err) {
            console.warn(`[warn] 楽天モバイル公式 楽天市場店 抽出 (${product.name} ${storageTerm}): ${err.message}`);
          }
          rakutenMobileQueryCache.set(rmKey, rmLive);
          if (!isRakutenScrapeDisabled()) await sleep(API_WAIT_MS);
        }
      }
      if (rmLive && isRakutenEligible) {
        carriers.rakuten = mergeLiveCarrierPrice(carriers.rakuten, rmLive, 'rakuten', product.category);
      }

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

        // 楽天市場: APIキー不要の公開検索ページ抽出（0件・失敗時も止めずに Yahoo!/既存データで補完）
        if (!isRakutenScrapeDisabled()) {
          try {
            rakutenOffer = await fetchFromRakutenMarket({
              productName: product.name,
              storage: storageTerm,
              category: product.category,
              launchPrice,
              condition: '中古',
              proxyUrl,
            });
          } catch (err) {
            console.warn(`[warn] 楽天市場 抽出 中古 (${product.name} ${storageTerm}): ${err.message}`);
          }
          if (rakutenOffer) rakutenScrapeHits++;
          if (!isRakutenScrapeDisabled()) await sleep(API_WAIT_MS);

          if (!isRakutenScrapeDisabled()) {
            try {
              unusedOffer = await fetchFromRakutenMarket({
                productName: product.name,
                storage: storageTerm,
                category: product.category,
                launchPrice,
                condition: '未使用',
                proxyUrl,
              });
            } catch {
              /* ignore */
            }
            if (!isRakutenScrapeDisabled()) await sleep(API_WAIT_MS);
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
          if (yahooOffer) yahooApiHits++;
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

      if (usedPricing) {
        // 旧アフィリエイト（楽天アフィリエイト/VC）URLが残っていても もしも経由へ統一
        if (usedPricing.rakuten?.url) {
          usedPricing.rakuten.url = toMallAffiliateUrl(usedPricing.rakuten.url, 'rakuten');
        }
        if (usedPricing.yahoo?.url) {
          usedPricing.yahoo.url = toMallAffiliateUrl(usedPricing.yahoo.url, 'yahoo');
        }
        if (usedPricing.unused?.url) {
          usedPricing.unused.url = toMallAffiliateUrl(usedPricing.unused.url, 'rakuten');
        }
        if (Array.isArray(usedPricing.offers)) {
          usedPricing.offers = usedPricing.offers.slice(0, 15).map((offer) => ({
            ...offer,
            url: toMallAffiliateUrl(offer.url, offer.platform === 'yahoo' ? 'yahoo' : 'rakuten'),
          }));
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
      rakutenMobileScrape: rakutenMobileHits > 0 ? 'scraped' : 'fallback',
      carrierScraping: {
        docomo: scrapedCarriers.docomo.size > 0 ? 'scraped' : 'fallback',
        au: scrapedCarriers.au.size > 0 ? 'scraped' : 'fallback',
        softbank: scrapedCarriers.softbank.size > 0 ? 'scraped' : 'fallback',
      },
      usedPricesApi: {
        rakuten: rakutenScrapeHits > 0 ? 'scraped' : 'fallback',
        yahoo: yahooAppId && yahooApiHits > 0 ? 'api' : 'fallback',
      },
    },
    products: cacheProductsOut,
  };

  mkdirSync('data/cache', { recursive: true });
  writeFileSync(LIVE_CACHE_PATH, JSON.stringify(output, null, 2));

  // public/used-prices.json も最新の中古最安値データと同期して保存
  try {
    const usedPricesPath = 'public/used-prices.json';
    let existingUsedJson = { generatedAt: output.updatedAt, items: {} };
    if (existsSync(usedPricesPath)) {
      try {
        const parsed = JSON.parse(readFileSync(usedPricesPath, 'utf8'));
        if (parsed && typeof parsed === 'object') {
          existingUsedJson = { ...parsed, items: { ...(parsed.items ?? {}) } };
        }
      } catch {
        /* ignore */
      }
    }
    existingUsedJson.generatedAt = output.updatedAt;
    for (const [pid, prod] of Object.entries(cacheProductsOut)) {
      for (const [sid, skuObj] of Object.entries(prod.skus ?? {})) {
        if (!skuObj?.usedPricing) continue;
        const itemKey = `${pid}:${skuObj.storage || skuObj.label || sid}`;
        const prevItem = existingUsedJson.items?.[itemKey] ?? {};
        existingUsedJson.items[itemKey] = {
          ...prevItem,
          keyword: prevItem.keyword || `${prod.name} ${skuObj.storage || skuObj.label} 中古`.trim(),
          genreId: prevItem.genreId || RAKUTEN_GENRE_IDS[prod.category] || '560202',
          usedPricing: skuObj.usedPricing,
          offers: skuObj.usedPricing.offers ?? [],
          isEstimated: Boolean(skuObj.usedPricing.isEstimated),
          resaleRate: skuObj.usedPricing.resaleValuePercent ?? prevItem.resaleRate ?? 0,
          source: skuObj.usedPricing.isEstimated ? 'mock' : 'api',
          fetchedAt: output.updatedAt,
        };
      }
    }
    mkdirSync('public', { recursive: true });
    writeFileSync(usedPricesPath, JSON.stringify(existingUsedJson, null, 2));
  } catch (err) {
    console.warn(`[warn] public/used-prices.json の同期保存に失敗: ${err.message}`);
  }

  console.log(`\n✅ ${LIVE_CACHE_PATH} を更新しました。`);
  console.log(
    `   対象モデル: ${Object.keys(cacheProductsOut).length}機種 / 楽天モバイル実取得: ${rakutenMobileHits}件 / キャリアスクレイピング: docomo=${scrapedCarriers.docomo.size}, au=${scrapedCarriers.au.size}, softbank=${scrapedCarriers.softbank.size} / 中古実取得: ${usedApiHits}件 (楽天抽出=${rakutenScrapeHits}, Yahoo!API=${yahooApiHits})`,
  );

  return output;
}

if (typeof process !== 'undefined' && process.argv?.[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runFetchLivePrices().catch((err) => {
    console.error('[error] scripts/fetch-live-prices.mjs failed:', err);
    process.exitCode = 1;
  });
}

