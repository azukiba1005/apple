import React, { useEffect, useMemo, useState } from 'react';
import { ExternalLink, X } from 'lucide-react';
import {
  getSkuDiscontinuedInfo,
  lastOf,
  signedYen,
  yen,
  type Product,
  type Sku,
} from '../App';
import {
  buildMallSearchUrlsForSku,
  type UsedConditionRank,
  type UsedMarketData,
  type UsedShopOffer,
} from '../usedPrice';
import { MALL_META, toMoshimoUrl, type MoshimoPlatform } from '../utils/moshimo';

export interface MallSearchLinkSet {
  rakuten: string;
  yahoo: string;
  amazon: string;
}

/** 機種・容量の3大モール検索URL（すべて もしもアフィリエイト経由） */
export function resolveMallSearchLinks(product: Product, sku: Sku, usedInfo?: UsedMarketData | null): MallSearchLinkSet {
  const generated = buildMallSearchUrlsForSku(product, sku);
  return {
    rakuten: toMoshimoUrl(usedInfo?.rakutenSearchUrl || generated.rakuten, 'rakuten'),
    yahoo: toMoshimoUrl(usedInfo?.yahooSearchUrl || generated.yahoo, 'yahoo'),
    amazon: toMoshimoUrl(usedInfo?.amazonSearchUrl || generated.amazon, 'amazon'),
  };
}

const MALL_BUTTON_LABELS: Record<MoshimoPlatform, string> = {
  rakuten: '楽天市場で探す',
  yahoo: 'Yahoo!ショッピングで探す',
  amazon: 'Amazonで整備済品・新品を探す',
};

/** 3大モール横断検索ボタン（楽天市場・Yahoo!ショッピング・Amazon / もしもアフィリエイト経由） */
export function MallSearchButtons({
  links,
  platforms = ['rakuten', 'yahoo', 'amazon'],
  labels,
  size = 'md',
}: {
  links: MallSearchLinkSet;
  platforms?: MoshimoPlatform[];
  labels?: Partial<Record<MoshimoPlatform, string>>;
  size?: 'sm' | 'md';
}) {
  const pad = size === 'sm' ? 'px-3 py-1.5' : 'px-3.5 py-2';
  return (
    <div className="flex flex-wrap items-center gap-2">
      {platforms.map((pf) => (
        <a
          key={pf}
          href={links[pf]}
          target="_blank"
          rel="noopener noreferrer sponsored"
          className={`inline-flex items-center gap-1.5 rounded-full bg-white ${pad} text-xs font-medium text-zinc-700 transition hover:bg-zinc-200/70 hover:text-zinc-900 dark:bg-[#1c1d22] dark:text-zinc-200 dark:hover:bg-[#2c2f36]`}
        >
          <span className={`h-2 w-2 rounded-full ${MALL_META[pf].dotCls}`} />
          <span>{labels?.[pf] ?? MALL_BUTTON_LABELS[pf]}</span>
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      ))}
    </div>
  );
}

type ShopModalConditionFilter = 'all' | 'unused' | 'rankA_plus' | 'trusted';
type ShopModalMallFilter = 'all' | 'rakuten' | 'yahoo';
type ShopModalSortOrder = 'price_asc' | 'condition_desc';

const CONDITION_RANK_META: Record<
  UsedConditionRank,
  { label: string; shortLabel: string; dotCls: string; qualityOrder: number }
> = {
  unused: { label: '✨ 未使用品', shortLabel: '未使用品', dotCls: 'bg-[#649274]', qualityOrder: 5 },
  rankA: { label: 'Aランク（美品）', shortLabel: 'Aランク', dotCls: 'bg-zinc-500', qualityOrder: 4 },
  rankB: { label: 'Bランク（良品）', shortLabel: 'Bランク', dotCls: 'bg-zinc-400', qualityOrder: 3 },
  used: { label: '中古品', shortLabel: '中古', dotCls: 'bg-zinc-400', qualityOrder: 2 },
  rankC: { label: 'Cランク', shortLabel: 'Cランク', dotCls: 'bg-zinc-400', qualityOrder: 1 },
};

export interface UsedOffersModalProps {
  product: Product;
  sku: Sku;
  usedInfo: UsedMarketData;
  isLoadingLive: boolean;
  onRefreshLive: () => void;
  onClose: () => void;
}

/**
 * 🏪 中古ショップ価格比較モーダル（ポップアップ画面）
 * 選択した機種・容量の楽天市場＆Yahoo!ショッピングの中古・未使用品出品リスト（最大15件）を
 * 状態ランク・モール・価格順で一覧比較できるソフトコントラスト＆枠線レスUIモーダル
 */
export const UsedOffersModal = React.memo(function UsedOffersModal({
  product,
  sku,
  usedInfo,
  isLoadingLive,
  onRefreshLive,
  onClose,
}: UsedOffersModalProps) {
  const [condFilter, setCondFilter] = useState<ShopModalConditionFilter>('all');
  const [mallFilter, setMallFilter] = useState<ShopModalMallFilter>('all');
  const [sortOrder, setSortOrder] = useState<ShopModalSortOrder>('price_asc');

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  // 個別出品リンクもすべて もしもアフィリエイト経由へ（旧 楽天アフィリエイト/VC リンクも置換）
  const allOffers: UsedShopOffer[] = useMemo(() => {
    const raw = usedInfo.usedPricing.offers ?? usedInfo.offers ?? [];
    return [...raw]
      .map((o) => ({ ...o, url: toMoshimoUrl(o.url, o.platform === 'yahoo' ? 'yahoo' : 'rakuten') }))
      .sort((a, b) => a.price - b.price);
  }, [usedInfo]);

  const mallLinks = useMemo(() => resolveMallSearchLinks(product, sku, usedInfo), [product, sku, usedInfo]);
  const hasRakutenOffers = allOffers.some((o) => o.platform === 'rakuten');

  const discInfo = useMemo(() => getSkuDiscontinuedInfo(product, sku), [product, sku]);
  const refApplePrice = useMemo(() => {
    return (
      sku.carriers.apple?.currentPrice ??
      (sku.priceHistory.length ? lastOf(sku.priceHistory).appleStorePrice : usedInfo.launchPrice)
    );
  }, [sku, usedInfo.launchPrice]);

  const overallLowestPrice = allOffers.length > 0 ? allOffers[0].price : usedInfo.usedPricing.lowestPrice;
  const maxSavingsVsNew =
    refApplePrice != null && overallLowestPrice > 0 ? refApplePrice - overallLowestPrice : null;

  const filteredOffers = useMemo(() => {
    const filtered = allOffers.filter((offer) => {
      if (mallFilter !== 'all' && offer.platform !== mallFilter) return false;
      if (condFilter === 'unused' && offer.conditionRank !== 'unused') return false;
      if (
        condFilter === 'rankA_plus' &&
        offer.conditionRank !== 'unused' &&
        offer.conditionRank !== 'rankA'
      ) {
        return false;
      }
      if (condFilter === 'trusted' && !offer.isTrusted) return false;
      return true;
    });

    if (sortOrder === 'condition_desc') {
      return [...filtered].sort((a, b) => {
        const qa = CONDITION_RANK_META[a.conditionRank]?.qualityOrder ?? 2;
        const qb = CONDITION_RANK_META[b.conditionRank]?.qualityOrder ?? 2;
        if (qb !== qa) return qb - qa;
        return a.price - b.price;
      });
    }
    return [...filtered].sort((a, b) => a.price - b.price);
  }, [allOffers, condFilter, mallFilter, sortOrder]);

  const topFilteredPrice = filteredOffers.length > 0 ? Math.min(...filteredOffers.map((o) => o.price)) : overallLowestPrice;

  const condFilterOptions: { value: ShopModalConditionFilter; label: string; count: number }[] = [
    { value: 'all', label: 'すべて', count: allOffers.length },
    {
      value: 'unused',
      label: '未使用品のみ',
      count: allOffers.filter((o) => o.conditionRank === 'unused').length,
    },
    {
      value: 'rankA_plus',
      label: 'Aランク以上',
      count: allOffers.filter((o) => o.conditionRank === 'unused' || o.conditionRank === 'rankA').length,
    },
    {
      value: 'trusted',
      label: '大手ショップのみ',
      count: allOffers.filter((o) => o.isTrusted).length,
    },
  ];

  const mallFilterOptions: { value: ShopModalMallFilter; label: string; dotCls?: string }[] = [
    { value: 'all', label: 'すべて' },
    { value: 'rakuten', label: '楽天市場', dotCls: 'bg-[#a66c75]' },
    { value: 'yahoo', label: 'Yahoo!ショッピング', dotCls: 'bg-[#ad8755]' },
  ];

  return (
    <div
      data-export-ignore="true"
      role="dialog"
      aria-modal="true"
      aria-label={`${product.name} (${sku.label}) の中古・未使用品 ショップ比較`}
      onClick={onClose}
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/30 p-0 backdrop-blur-[2px] sm:items-center sm:p-5"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="liquid-glass liquid-glass-strong animate-sheet-up flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-t-3xl text-[#1d1d1f] sm:max-h-[90vh] sm:rounded-3xl dark:text-zinc-100"
      >
        {/* 1. モーダルヘッダー */}
        <div className="flex items-start justify-between gap-4 px-5 py-4 sm:px-6 sm:py-5">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="inline-flex items-center gap-2 text-base sm:text-lg font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
                <span aria-hidden="true">🏪</span>
                <span>
                  {product.name} ({sku.label}) の中古・未使用品 ショップ比較
                </span>
              </span>
              {maxSavingsVsNew != null && maxSavingsVsNew > 0 && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[#eaf2ed] px-3 py-1 text-xs font-semibold tabular-nums text-[#3d6b4e] dark:bg-[#1e2b24] dark:text-[#88b396]">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#649274]" />
                  {discInfo.isDiscontinued ? '終売最終定価比' : '定価比'} 最大 −{yen(maxSavingsVsNew)} お得
                </span>
              )}
              {usedInfo.source === 'mock' && (
                <span className="rounded-md bg-zinc-100 px-2.5 py-0.5 text-xs font-medium text-zinc-500 dark:bg-[#25272e] dark:text-zinc-400">
                  相場推定リスト
                </span>
              )}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs sm:text-sm text-zinc-500 dark:text-zinc-400 tabular-nums">
              <span>
                横断最安: <strong className="font-bold text-zinc-900 dark:text-zinc-100">{yen(overallLowestPrice)}</strong>
              </span>
              {refApplePrice != null && (
                <span>
                  {discInfo.isDiscontinued ? '終売時Apple直販価格' : 'Apple Store新品定価'}:{' '}
                  <strong className="font-semibold text-zinc-700 dark:text-zinc-300">{yen(refApplePrice)}</strong>
                </span>
              )}
              {usedInfo.usedPricing.resaleValuePercent != null && (
                <span>
                  リセール残価率: <strong className="font-semibold text-zinc-700 dark:text-zinc-300">{usedInfo.usedPricing.resaleValuePercent}%</strong>
                </span>
              )}
              {isLoadingLive ? (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-zinc-600 dark:text-zinc-300">
                  ⏳ 楽天・Yahoo!の最新出品リストを取得中...
                </span>
              ) : (
                <button
                  type="button"
                  onClick={onRefreshLive}
                  className="inline-flex items-center gap-1 text-xs font-medium text-zinc-500 underline underline-offset-2 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                >
                  🔄 最新在庫を再取得
                </button>
              )}
            </div>
          </div>
          <button
            type="button"
            aria-label="モーダルを閉じる"
            onClick={onClose}
            className="shrink-0 rounded-full bg-black/[0.05] p-2 text-[#6e6e73] transition hover:bg-black/[0.09] hover:text-[#1d1d1f] dark:bg-white/10 dark:text-zinc-400 dark:hover:bg-white/15 dark:hover:text-zinc-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* 2. クイック絞り込み＆並び替えバー */}
        <div className="space-y-3 bg-black/[0.03] px-5 py-3.5 text-xs sm:px-6 dark:bg-white/[0.04]">
          {/* 上段: 状態フィルタ */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-1 text-xs font-semibold text-zinc-500 dark:text-zinc-400">状態・店舗:</span>
            {condFilterOptions.map((opt) => {
              const active = condFilter === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setCondFilter(opt.value)}
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition ${
                    active
                      ? 'bg-zinc-900 text-zinc-100 shadow-2xs dark:bg-zinc-200 dark:text-zinc-900'
                      : 'bg-white text-zinc-600 hover:bg-zinc-200/70 hover:text-zinc-900 dark:bg-[#1c1d22] dark:text-zinc-300 dark:hover:bg-[#2c2f36]'
                  }`}
                >
                  <span>{opt.label}</span>
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-xs tabular-nums ${
                      active
                        ? 'bg-white/20 text-current dark:bg-zinc-900/15'
                        : 'bg-zinc-100 text-zinc-500 dark:bg-[#25272e] dark:text-zinc-400'
                    }`}
                  >
                    {opt.count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* 下段: モールフィルタ ＋ 並び替え */}
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="mr-1 text-xs font-semibold text-zinc-500 dark:text-zinc-400">モール:</span>
              {mallFilterOptions.map((opt) => {
                const active = mallFilter === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setMallFilter(opt.value)}
                    className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition ${
                      active
                        ? 'bg-zinc-900 text-zinc-100 shadow-2xs dark:bg-zinc-200 dark:text-zinc-900'
                        : 'bg-white text-zinc-600 hover:bg-zinc-200/70 hover:text-zinc-900 dark:bg-[#1c1d22] dark:text-zinc-300 dark:hover:bg-[#2c2f36]'
                    }`}
                  >
                    {opt.dotCls && <span className={`h-2 w-2 rounded-full ${opt.dotCls}`} />}
                    <span>{opt.label}</span>
                  </button>
                );
              })}
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">並び替え:</span>
              <div
                role="group"
                aria-label="出品リストの並び替え"
                className="inline-flex rounded-full bg-[#767680]/[0.12] p-0.5 text-xs font-medium dark:bg-[#767680]/[0.24]"
              >
                <button
                  type="button"
                  onClick={() => setSortOrder('price_asc')}
                  className={`rounded-full px-3 py-1 transition ${
                    sortOrder === 'price_asc'
                      ? 'bg-white font-semibold text-[#1d1d1f] shadow-[0_3px_8px_rgba(0,0,0,0.12)] dark:bg-[#636366] dark:text-white'
                      : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200'
                  }`}
                >
                  価格が安い順
                </button>
                <button
                  type="button"
                  onClick={() => setSortOrder('condition_desc')}
                  className={`rounded-full px-3 py-1 transition ${
                    sortOrder === 'condition_desc'
                      ? 'bg-white font-semibold text-[#1d1d1f] shadow-[0_3px_8px_rgba(0,0,0,0.12)] dark:bg-[#636366] dark:text-white'
                      : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200'
                  }`}
                >
                  状態が良い順
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* 2.5 3大モール横断検索（もしもアフィリエイト経由） */}
        <div className="flex flex-wrap items-center gap-2 bg-black/[0.03] px-5 pb-3.5 text-xs sm:px-6 dark:bg-white/[0.04]">
          <span className="mr-1 text-xs font-semibold text-zinc-500 dark:text-zinc-400">3大モールで探す:</span>
          <MallSearchButtons links={mallLinks} size="sm" />
        </div>

        {/* 3. ショップ別ランキングリスト（余白で区切るフラットリスト） */}
        <div className="flex-1 space-y-2.5 overflow-y-auto px-5 py-4 sm:px-6">
          {allOffers.length > 0 && !hasRakutenOffers && (
            <div className="flex flex-col gap-2.5 rounded-2xl bg-white/70 px-4 py-3 text-xs text-zinc-600 sm:flex-row sm:items-center sm:justify-between dark:bg-[#23252b]/75 dark:text-zinc-300">
              <span>
                楽天市場の出品は現在取得できませんでした。Yahoo!ショッピングの実在庫を最安値として表示しています。
              </span>
              <MallSearchButtons
                links={mallLinks}
                platforms={['rakuten', 'amazon']}
                labels={{ rakuten: '楽天市場で在庫を見る', amazon: 'Amazonで在庫を見る' }}
                size="sm"
              />
            </div>
          )}
          {allOffers.length === 0 ? (
            <div className="py-12 text-center text-sm text-zinc-600 dark:text-zinc-300 space-y-3.5">
              <div className="font-bold text-zinc-900 dark:text-zinc-100">
                📊 参考推定相場: 約{yen(overallLowestPrice)}（実在庫データ未取得）
              </div>
              <p className="text-xs sm:text-sm text-zinc-500 dark:text-zinc-400">
                現在この機種のリアルタイム出品リストは未取得です。各モールの検索ページで実際の在庫・価格をご確認ください。
              </p>
              <div className="flex justify-center pt-1">
                <div className="rounded-2xl bg-[#f5f5f7] p-2 dark:bg-[#23252b]">
                  <MallSearchButtons
                    links={mallLinks}
                    labels={{
                      rakuten: '楽天市場で在庫を見る',
                      yahoo: 'Yahoo!ショッピングで在庫を見る',
                      amazon: 'Amazonで在庫を見る',
                    }}
                  />
                </div>
              </div>
            </div>
          ) : filteredOffers.length === 0 ? (
            <div className="py-12 text-center text-sm text-zinc-500 dark:text-zinc-400">
              <p>選択した絞り込み条件に一致する出品がありません。</p>
              <button
                type="button"
                onClick={() => {
                  setCondFilter('all');
                  setMallFilter('all');
                }}
                className="mt-2.5 font-semibold text-zinc-800 underline underline-offset-2 hover:text-zinc-950 dark:text-zinc-200 dark:hover:text-zinc-100"
              >
                フィルタをリセットして全{allOffers.length}件を表示
              </button>
            </div>
          ) : (
            filteredOffers.map((offer, idx) => {
              const rank = idx + 1;
              const isFirst = rank === 1 && sortOrder === 'price_asc';
              const condMeta = CONDITION_RANK_META[offer.conditionRank] ?? CONDITION_RANK_META.used;
              const diffFromTop = offer.price - topFilteredPrice;
              const diffFromApple = refApplePrice != null ? offer.price - refApplePrice : null;

              return (
                <div
                  key={`${offer.platform}-${offer.price}-${offer.shopName}-${idx}`}
                  className={`flex flex-col gap-3 rounded-2xl px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4 ${
                    isFirst
                      ? 'bg-[#e8f8ec]/70 dark:bg-[#34c759]/[0.08]'
                      : 'bg-white/70 dark:bg-white/[0.04]'
                  }`}
                >
                  {/* 左〜中央: 順位バッジ ＋ モール・ショップ名 ＋ 状態バッジ＆商品タイトル */}
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      {/* 順位バッジ */}
                      <span
                        className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-bold tabular-nums ${
                          rank === 1
                            ? 'bg-zinc-900 text-zinc-100 dark:bg-zinc-200 dark:text-zinc-900'
                            : rank <= 3
                              ? 'bg-zinc-200/80 text-zinc-800 dark:bg-[#2c2f36] dark:text-zinc-200'
                              : 'bg-zinc-100 text-zinc-600 dark:bg-[#25272e] dark:text-zinc-400'
                        }`}
                      >
                        {rank === 1 && <span className="h-1.5 w-1.5 rounded-full bg-[#649274]" />}
                        <span>{rank === 1 ? '1位 (最安)' : `${rank}位`}</span>
                      </span>

                      {/* モールバッジ ([楽天] or [Yahoo!]) */}
                      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-zinc-200/60 px-2 py-0.5 text-xs font-medium text-zinc-700 dark:bg-[#2c2f36] dark:text-zinc-300">
                        <span
                          className={`h-2 w-2 rounded-full ${
                            offer.platform === 'yahoo' ? 'bg-[#ad8755]' : 'bg-[#a66c75]'
                          }`}
                        />
                        <span>{offer.platform === 'yahoo' ? 'Yahoo!' : '楽天'}</span>
                      </span>

                      {/* ショップ名 */}
                      <span className="truncate text-sm font-bold text-zinc-900 dark:text-zinc-100">
                        {offer.shopName}
                      </span>

                      {/* 大手認定バッジ */}
                      {offer.isTrusted && (
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-zinc-200/60 px-2 py-0.5 text-xs font-medium text-zinc-700 dark:bg-[#2c2f36] dark:text-zinc-300">
                          <span className="h-1.5 w-1.5 rounded-full bg-[#649274]" />
                          <span>✓ 大手認定</span>
                        </span>
                      )}
                    </div>

                    {/* 状態・特徴バッジ ＋ 商品タイトル（1行省略＋ホバー全文） */}
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-white px-2.5 py-0.5 text-xs font-medium text-zinc-700 dark:bg-[#1c1d22] dark:text-zinc-300">
                        <span className={`h-1.5 w-1.5 rounded-full ${condMeta.dotCls}`} />
                        <span>{condMeta.label}</span>
                      </span>
                      {offer.simFree && (
                        <span className="inline-flex shrink-0 items-center rounded-full bg-zinc-200/60 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:bg-[#2c2f36] dark:text-zinc-300">
                          SIMフリー
                        </span>
                      )}
                      <span
                        className="min-w-0 truncate text-xs sm:text-sm text-zinc-500 dark:text-zinc-400"
                        title={offer.title}
                      >
                        {offer.title}
                      </span>
                    </div>
                  </div>

                  {/* 右側: 価格＆差額 ＋ 購入リンクボタン */}
                  <div className="flex items-center justify-between gap-3.5 sm:shrink-0 sm:justify-end">
                    <div className="text-left sm:text-right tabular-nums">
                      <div className="text-base sm:text-lg font-bold text-zinc-900 dark:text-zinc-100">
                        {yen(offer.price)}
                      </div>
                      <div className="text-xs text-zinc-500 dark:text-zinc-400">
                        {diffFromTop === 0 ? (
                          diffFromApple != null && diffFromApple < 0 ? (
                            <span>（最安 / 定価比 {signedYen(diffFromApple)}）</span>
                          ) : (
                            <span>（第1位・最安基準）</span>
                          )
                        ) : (
                          <span>（第1位との差 +{yen(diffFromTop)}）</span>
                        )}
                      </div>
                    </div>

                    <a
                      href={offer.url}
                      target="_blank"
                      rel="noopener noreferrer sponsored"
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[#0071e3] px-4 py-2 text-xs font-semibold text-white transition hover:bg-[#0077ed]"
                    >
                      <span>ショップで見る</span>
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* 4. モーダルフッター */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-black/[0.06] px-5 py-3 text-xs text-[#6e6e73] sm:px-6 dark:border-white/10 dark:text-zinc-400">
          <span>
            ※厳密タイトル検証によりケース・フィルム・ジャンク品・別容量・別モデル（Pro/Max/mini等）を自動除外しています。在庫・価格は各ショップページでご確認ください。リンクはもしもアフィリエイト経由です（PR）。
          </span>
          <span className="font-medium tabular-nums">
            表示中: {filteredOffers.length}件 / 全{allOffers.length}件
          </span>
        </div>
      </div>
    </div>
  );
});

export const UsedShopOffersModal = UsedOffersModal;
export default UsedOffersModal;
