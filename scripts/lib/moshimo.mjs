/**
 * もしもアフィリエイト「どこでもリンク」共通ユーティリティ（楽天市場・Yahoo!ショッピング・Amazon.co.jp）
 *
 * - Node.js バッチ（scripts/*.mjs）: process.env の MOSHIMO_* を自動参照
 * - Cloudflare Pages Functions   : `configureRuntimeEnv(context.env)` で env バインディングを注入
 * - Vite フロントエンド            : src/utils/moshimo.ts が import.meta.env の VITE_MOSHIMO_* を渡して利用
 *
 * 環境変数が未設定の場合は既定の提携ID（楽天市場: 5900939 / Yahoo!: 5900940）で変換する。
 * Amazon は未提携のため既定値は空文字で、その場合は もしも経由に変換せず元の targetUrl をそのまま返す。
 * 旧方式（楽天アフィリエイト hb.afl.rakuten.co.jp / バリューコマース）のラップURLは自動で剥がしてから変換する。
 */

export const MOSHIMO_CLICK_ENDPOINT = 'https://af.moshimo.com/af/c/click';

/** もしもアフィリエイト各プロモーションのID */
export const MOSHIMO_PROGRAMS = Object.freeze({
  rakuten: Object.freeze({ p_id: '54', pc_id: '54', pl_id: '27059', envKey: 'MOSHIMO_RAKUTEN_AID' }),
  yahoo: Object.freeze({ p_id: '1225', pc_id: '1925', pl_id: '27061', envKey: 'MOSHIMO_YAHOO_AID' }),
  amazon: Object.freeze({ p_id: '170', pc_id: '185', pl_id: '4062', envKey: 'MOSHIMO_AMAZON_AID' }),
});

/** 環境変数未設定時に使う既定の a_id（Amazon は未提携のため空文字＝変換しない） */
export const MOSHIMO_DEFAULT_AIDS = Object.freeze({
  rakutenAid: '5900939',
  yahooAid: '5900940',
  amazonAid: '',
});

/* ----------------------------------------------------------------------------
 * ランタイム環境変数（Node / Cloudflare Workers / ブラウザ 共通）
 * -------------------------------------------------------------------------- */

let runtimeEnvOverrides = {};

/**
 * Cloudflare Pages Functions など process.env が使えない環境向けに env を注入する。
 * 空文字・undefined のキーは無視（process.env 側の値を優先させない）。
 */
export function configureRuntimeEnv(env = {}) {
  const next = { ...runtimeEnvOverrides };
  for (const [k, v] of Object.entries(env ?? {})) {
    if (typeof v === 'string' || typeof v === 'number') next[k] = String(v).trim();
  }
  runtimeEnvOverrides = next;
  return runtimeEnvOverrides;
}

/** 環境変数を取得（注入値 → process.env の順。VITE_ 接頭辞版も許容） */
export function getRuntimeEnv(name, { allowVitePrefix = true } = {}) {
  const keys = allowVitePrefix ? [name, `VITE_${name}`] : [name];
  for (const key of keys) {
    const v = runtimeEnvOverrides[key];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  try {
    const procEnv = typeof process !== 'undefined' ? process.env : undefined;
    for (const key of keys) {
      const v = procEnv?.[key];
      if (v != null && String(v).trim()) return String(v).trim();
    }
  } catch {
    /* ignore (browser / worker) */
  }
  return '';
}

/** 現在の設定値から もしも a_id 一式を解決する */
export function resolveMoshimoConfig(explicit = {}) {
  return {
    rakutenAid:
      String(explicit.rakutenAid ?? '').trim() || getRuntimeEnv('MOSHIMO_RAKUTEN_AID') || MOSHIMO_DEFAULT_AIDS.rakutenAid,
    yahooAid:
      String(explicit.yahooAid ?? '').trim() || getRuntimeEnv('MOSHIMO_YAHOO_AID') || MOSHIMO_DEFAULT_AIDS.yahooAid,
    amazonAid:
      String(explicit.amazonAid ?? '').trim() || getRuntimeEnv('MOSHIMO_AMAZON_AID') || MOSHIMO_DEFAULT_AIDS.amazonAid,
  };
}

/* ----------------------------------------------------------------------------
 * URL 判定・旧アフィリエイトURLの除去
 * -------------------------------------------------------------------------- */

function safeParseUrl(raw) {
  try {
    return new URL(String(raw ?? '').trim());
  } catch {
    return null;
  }
}

/** URL のホストから対象モールを判定する */
export function detectMallPlatform(rawUrl) {
  const u = safeParseUrl(rawUrl);
  if (!u) return null;
  const host = u.hostname.toLowerCase();
  if (host === 'rakuten.co.jp' || host.endsWith('.rakuten.co.jp')) return 'rakuten';
  if (host === 'shopping.yahoo.co.jp' || host === 'store.shopping.yahoo.co.jp' || host.endsWith('.shopping.yahoo.co.jp')) {
    return 'yahoo';
  }
  if (host === 'paypaymall.yahoo.co.jp' || host.endsWith('.paypaymall.yahoo.co.jp')) return 'yahoo';
  if (host === 'amazon.co.jp' || host.endsWith('.amazon.co.jp') || host === 'amzn.asia' || host === 'amzn.to') {
    return 'amazon';
  }
  return null;
}

/** もしもアフィリエイトのラップURLかどうか */
export function isMoshimoUrl(rawUrl) {
  const u = safeParseUrl(rawUrl);
  return Boolean(u && u.hostname.toLowerCase() === 'af.moshimo.com');
}

/**
 * 旧アフィリエイトURL（楽天アフィリエイト / バリューコマース / もしも）を剥がして元の商品URLを返す。
 * 剥がせない場合は入力値をそのまま返す。
 */
export function unwrapAffiliateUrl(rawUrl) {
  let current = String(rawUrl ?? '').trim();
  for (let i = 0; i < 3; i++) {
    const u = safeParseUrl(current);
    if (!u) return current;
    const host = u.hostname.toLowerCase();
    let inner = null;
    if (host === 'hb.afl.rakuten.co.jp') inner = u.searchParams.get('pc') || u.searchParams.get('m');
    else if (host === 'ck.jp.ap.valuecommerce.com') inner = u.searchParams.get('vc_url');
    else if (host === 'af.moshimo.com') inner = u.searchParams.get('url');
    if (!inner) return current;
    current = inner.trim();
  }
  return current;
}

/* ----------------------------------------------------------------------------
 * もしもアフィリエイト URL 生成
 * -------------------------------------------------------------------------- */

/** 指定モールのもしも「どこでもリンク」URLを生成（a_id 空なら targetUrl をそのまま返す） */
export function buildMoshimoUrl(targetUrl, aId, platform) {
  const url = String(targetUrl ?? '').trim();
  const aid = String(aId ?? '').trim();
  const prog = MOSHIMO_PROGRAMS[platform];
  if (!url || !aid || !prog) return url;
  return (
    `${MOSHIMO_CLICK_ENDPOINT}?a_id=${encodeURIComponent(aid)}` +
    `&p_id=${prog.p_id}&pc_id=${prog.pc_id}&pl_id=${prog.pl_id}` +
    `&url=${encodeURIComponent(url)}`
  );
}

/**
 * 任意のモールURLを もしもアフィリエイト経由URLへ変換する共通関数。
 * @param {string} targetUrl 楽天市場 / Yahoo!ショッピング / Amazon の商品・検索URL（旧アフィリエイトURLも可）
 * @param {{ platform?: 'rakuten'|'yahoo'|'amazon', rakutenAid?: string, yahooAid?: string, amazonAid?: string }} [opts]
 */
export function toMoshimoAffiliateUrl(targetUrl, opts = {}) {
  const original = String(targetUrl ?? '').trim();
  if (!original) return original;

  const raw = unwrapAffiliateUrl(original);
  const platform = opts.platform || detectMallPlatform(raw);
  if (!platform || !MOSHIMO_PROGRAMS[platform]) return raw;

  const cfg = resolveMoshimoConfig(opts);
  const aid = platform === 'rakuten' ? cfg.rakutenAid : platform === 'yahoo' ? cfg.yahooAid : cfg.amazonAid;
  if (!aid) {
    // a_id 未設定（Amazon 未提携時など）: もしも経由に変換せず素のモールURLを返す
    return raw;
  }
  return buildMoshimoUrl(raw, aid, platform);
}

export const toMoshimoRakutenUrl = (url, opts = {}) => toMoshimoAffiliateUrl(url, { ...opts, platform: 'rakuten' });
export const toMoshimoYahooUrl = (url, opts = {}) => toMoshimoAffiliateUrl(url, { ...opts, platform: 'yahoo' });
export const toMoshimoAmazonUrl = (url, opts = {}) => toMoshimoAffiliateUrl(url, { ...opts, platform: 'amazon' });

/* ----------------------------------------------------------------------------
 * 3大モール 横断検索URL
 * -------------------------------------------------------------------------- */

/** 3大モールの素の検索URL（アフィリエイト変換前） */
export function buildRawMallSearchUrls(keyword, { rakutenKeyword, yahooKeyword, amazonKeyword } = {}) {
  const base = String(keyword ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
  const rk = String(rakutenKeyword ?? base).trim() || base;
  const yk = String(yahooKeyword ?? base).trim() || base;
  const ak = String(amazonKeyword ?? base).trim() || base;
  return {
    rakuten: `https://search.rakuten.co.jp/search/mall/${encodeURIComponent(rk)}/`,
    yahoo: `https://shopping.yahoo.co.jp/search?${new URLSearchParams({ p: yk }).toString()}`,
    amazon: `https://www.amazon.co.jp/s?${new URLSearchParams({ k: ak }).toString()}`,
  };
}

/** 3大モールの検索URLを もしもアフィリエイト経由で返す */
export function buildMoshimoMallSearchLinks(keyword, opts = {}) {
  const raw = buildRawMallSearchUrls(keyword, opts);
  return {
    rakuten: toMoshimoAffiliateUrl(raw.rakuten, { ...opts, platform: 'rakuten' }),
    yahoo: toMoshimoAffiliateUrl(raw.yahoo, { ...opts, platform: 'yahoo' }),
    amazon: toMoshimoAffiliateUrl(raw.amazon, { ...opts, platform: 'amazon' }),
  };
}
