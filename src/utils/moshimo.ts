/**
 * もしもアフィリエイト（楽天市場・Yahoo!ショッピング・Amazon）フロントエンド用ユーティリティ
 *
 * 変換ロジック本体は scripts/lib/moshimo.mjs（Node バッチ・Cloudflare Functions と共通）。
 * ここではビルド時に埋め込まれた a_id（VITE_MOSHIMO_* もしくは MOSHIMO_*）を注入して利用する。
 * 環境変数未設定時は既定の提携ID（楽天市場: 5900939 / Yahoo!: 5900940）を使用。
 * Amazon は未提携のため既定値は空文字で、空の場合は通常のAmazon検索URLをそのまま返す。
 */
import {
  buildRawMallSearchUrls,
  detectMallPlatform,
  MOSHIMO_DEFAULT_AIDS,
  toMoshimoAffiliateUrl,
  unwrapAffiliateUrl,
  type MallKeywordOptions,
  type MallSearchUrls,
  type MoshimoPlatform,
} from '../../scripts/lib/moshimo.mjs';

export type { MallSearchUrls, MoshimoPlatform };
export { detectMallPlatform, unwrapAffiliateUrl };

const env = import.meta.env as unknown as Record<string, string | undefined>;
const pick = (...vals: Array<string | undefined>) => vals.map((v) => String(v ?? '').trim()).find(Boolean) ?? '';

/** ビルド時に解決された もしも a_id 一式 */
export const MOSHIMO_AIDS = Object.freeze({
  rakutenAid: pick(env.VITE_MOSHIMO_RAKUTEN_AID, env.MOSHIMO_RAKUTEN_AID, MOSHIMO_DEFAULT_AIDS.rakutenAid),
  yahooAid: pick(env.VITE_MOSHIMO_YAHOO_AID, env.MOSHIMO_YAHOO_AID, MOSHIMO_DEFAULT_AIDS.yahooAid),
  amazonAid: pick(env.VITE_MOSHIMO_AMAZON_AID, env.MOSHIMO_AMAZON_AID, MOSHIMO_DEFAULT_AIDS.amazonAid),
});

/** 任意のモールURL（旧楽天アフィリエイト/VCリンク含む）を もしも経由URLへ変換 */
export function toMoshimoUrl(targetUrl: string | null | undefined, platform?: MoshimoPlatform): string {
  return toMoshimoAffiliateUrl(targetUrl, { ...MOSHIMO_AIDS, platform });
}

export const toMoshimoRakutenUrl = (url: string | null | undefined) => toMoshimoUrl(url, 'rakuten');
export const toMoshimoYahooUrl = (url: string | null | undefined) => toMoshimoUrl(url, 'yahoo');
export const toMoshimoAmazonUrl = (url: string | null | undefined) => toMoshimoUrl(url, 'amazon');

/** 3大モールの検索URLを もしも経由で生成 */
export function buildMallSearchLinks(keyword: string, opts: MallKeywordOptions = {}): MallSearchUrls {
  const raw = buildRawMallSearchUrls(keyword, opts);
  return {
    rakuten: toMoshimoUrl(raw.rakuten, 'rakuten'),
    yahoo: toMoshimoUrl(raw.yahoo, 'yahoo'),
    amazon: toMoshimoUrl(raw.amazon, 'amazon'),
  };
}

/** UI 表示用のモールメタ情報（ドット色はサイト既存のソフトカラー） */
export const MALL_META: Record<MoshimoPlatform, { label: string; dotCls: string }> = {
  rakuten: { label: '楽天市場', dotCls: 'bg-[#a66c75]' },
  yahoo: { label: 'Yahoo!ショッピング', dotCls: 'bg-[#ad8755]' },
  amazon: { label: 'Amazon', dotCls: 'bg-[#6f7f95]' },
};
