/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CF_BEACON_TOKEN?: string;
  readonly VITE_GA_MEASUREMENT_ID?: string;
  /** もしもアフィリエイト a_id（楽天市場 / Yahoo!ショッピング / Amazon） */
  readonly VITE_MOSHIMO_RAKUTEN_AID?: string;
  readonly VITE_MOSHIMO_YAHOO_AID?: string;
  readonly VITE_MOSHIMO_AMAZON_AID?: string;
  readonly MOSHIMO_RAKUTEN_AID?: string;
  readonly MOSHIMO_YAHOO_AID?: string;
  readonly MOSHIMO_AMAZON_AID?: string;
  /** Yahoo!ショッピング Client ID（旧 YAHOO_APP_ID も可） */
  readonly YAHOO_CLIENT_ID?: string;
  readonly YAHOO_APP_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
