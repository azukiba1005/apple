export type MoshimoPlatform = 'rakuten' | 'yahoo' | 'amazon';

export interface MoshimoAidOptions {
  rakutenAid?: string;
  yahooAid?: string;
  amazonAid?: string;
}

export interface MoshimoUrlOptions extends MoshimoAidOptions {
  platform?: MoshimoPlatform;
}

export interface MallSearchUrls {
  rakuten: string;
  yahoo: string;
  amazon: string;
}

export interface MallKeywordOptions {
  rakutenKeyword?: string;
  yahooKeyword?: string;
  amazonKeyword?: string;
}

export declare const MOSHIMO_CLICK_ENDPOINT: string;
export declare const MOSHIMO_DEFAULT_AIDS: Readonly<Required<MoshimoAidOptions>>;
export declare const MOSHIMO_PROGRAMS: Readonly<
  Record<MoshimoPlatform, Readonly<{ p_id: string; pc_id: string; pl_id: string; envKey: string }>>
>;

export declare function configureRuntimeEnv(env?: Record<string, unknown>): Record<string, string>;
export declare function getRuntimeEnv(name: string, opts?: { allowVitePrefix?: boolean }): string;
export declare function resolveMoshimoConfig(explicit?: MoshimoAidOptions): Required<MoshimoAidOptions>;
export declare function detectMallPlatform(rawUrl: string | null | undefined): MoshimoPlatform | null;
export declare function isMoshimoUrl(rawUrl: string | null | undefined): boolean;
export declare function unwrapAffiliateUrl(rawUrl: string | null | undefined): string;
export declare function buildMoshimoUrl(targetUrl: string, aId: string, platform: MoshimoPlatform): string;
export declare function toMoshimoAffiliateUrl(targetUrl: string | null | undefined, opts?: MoshimoUrlOptions): string;
export declare function toMoshimoRakutenUrl(url: string | null | undefined, opts?: MoshimoAidOptions): string;
export declare function toMoshimoYahooUrl(url: string | null | undefined, opts?: MoshimoAidOptions): string;
export declare function toMoshimoAmazonUrl(url: string | null | undefined, opts?: MoshimoAidOptions): string;
export declare function buildRawMallSearchUrls(keyword: string, opts?: MallKeywordOptions): MallSearchUrls;
export declare function buildMoshimoMallSearchLinks(
  keyword: string,
  opts?: MallKeywordOptions & MoshimoAidOptions,
): MallSearchUrls;
