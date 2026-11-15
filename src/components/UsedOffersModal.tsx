import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, ExternalLink, RefreshCw, SlidersHorizontal, X } from 'lucide-react';
import {
  ApplePrice,
  getSkuDiscontinuedInfo,
  lastOf,
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
import { toMoshimoUrl, type MoshimoPlatform } from '../utils/moshimo';

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
          className={`liquid-glass-card inline-flex items-center gap-1.5 whitespace-nowrap rounded-full ${pad} text-xs font-medium text-[#1d1d1f] transition hover:bg-white/80 active:scale-[0.98]`}
        >
          <span>{labels?.[pf] ?? MALL_BUTTON_LABELS[pf]}</span>
          <ExternalLink className="h-3.5 w-3.5 text-[#6e6e73]" strokeWidth={1.5} />
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
  { shortLabel: string; qualityOrder: number }
> = {
  unused: { shortLabel: '未使用', qualityOrder: 5 },
  rankA: { shortLabel: 'Aランク', qualityOrder: 4 },
  rankB: { shortLabel: 'Bランク', qualityOrder: 3 },
  used: { shortLabel: '中古', qualityOrder: 2 },
  rankC: { shortLabel: 'Cランク', qualityOrder: 1 },
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
 * 中古ショップ価格比較モーダル（iOSネイティブ風 Liquid Glass ボトムシート）
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
  const [filtersOpen, setFiltersOpen] = useState(false);

  // スワイプ／ドラッグ閉鎖ステート
  const [dragY, setDragY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const dragSessionRef = useRef<{
    startY: number;
    startTime: number;
    pointerId?: number;
    fromScrollArea: boolean;
    active: boolean;
  } | null>(null);
  const closeTimerRef = useRef<number>();

  const dismissSheet = useCallback(() => {
    if (isClosing) return;
    setIsDragging(false);
    setIsClosing(true);
    window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = window.setTimeout(() => {
      onClose();
    }, 240);
  }, [isClosing, onClose]);

  useEffect(() => {
    return () => window.clearTimeout(closeTimerRef.current);
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismissSheet();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [dismissSheet]);

  const finishDrag = useCallback(
    (currentY: number, startTime: number) => {
      const elapsed = Math.max(1, performance.now() - startTime);
      const velocity = currentY / elapsed; // px/ms
      if (currentY >= 90 || (velocity > 0.55 && currentY > 24)) {
        dismissSheet();
      } else {
        setIsDragging(false);
        setDragY(0);
      }
      dragSessionRef.current = null;
    },
    [dismissSheet],
  );

  const isInteractiveTarget = (target: EventTarget | null) =>
    target instanceof HTMLElement && Boolean(target.closest('button, a, input, select, label'));

  // ヘッダー＆ドラッグバー用 Touch Events
  const handleHeaderTouchStart = (e: React.TouchEvent) => {
    if (isClosing || e.touches.length !== 1 || isInteractiveTarget(e.target)) return;
    dragSessionRef.current = {
      startY: e.touches[0].clientY,
      startTime: performance.now(),
      fromScrollArea: false,
      active: true,
    };
    setIsDragging(true);
  };

  const handleHeaderTouchMove = (e: React.TouchEvent) => {
    const sess = dragSessionRef.current;
    if (!sess || !sess.active || sess.fromScrollArea || e.touches.length !== 1) return;
    const dy = Math.max(0, e.touches[0].clientY - sess.startY);
    setDragY(dy);
  };

  const handleHeaderTouchEnd = () => {
    const sess = dragSessionRef.current;
    if (!sess || !sess.active || sess.fromScrollArea) return;
    finishDrag(dragY, sess.startTime);
  };

  // ヘッダー＆ドラッグバー用 Pointer Events（マウス／トラックパッド操作）
  const handleHeaderPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'touch' || e.button !== 0 || isClosing || isInteractiveTarget(e.target)) return;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    dragSessionRef.current = {
      startY: e.clientY,
      startTime: performance.now(),
      pointerId: e.pointerId,
      fromScrollArea: false,
      active: true,
    };
    setIsDragging(true);
  };

  const handleHeaderPointerMove = (e: React.PointerEvent) => {
    const sess = dragSessionRef.current;
    if (!sess || !sess.active || sess.pointerId !== e.pointerId) return;
    const dy = Math.max(0, e.clientY - sess.startY);
    setDragY(dy);
  };

  const handleHeaderPointerUp = (e: React.PointerEvent) => {
    const sess = dragSessionRef.current;
    if (!sess || !sess.active || sess.pointerId !== e.pointerId) return;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    finishDrag(dragY, sess.startTime);
  };

  // スクロール領域が最上部（scrollTop <= 0）での下方向プルによるシート閉鎖
  const handleScrollTouchStart = (e: React.TouchEvent) => {
    if (isClosing || e.touches.length !== 1) return;
    const sc = scrollRef.current;
    if (!sc || sc.scrollTop > 0) return;
    dragSessionRef.current = {
      startY: e.touches[0].clientY,
      startTime: performance.now(),
      fromScrollArea: true,
      active: false,
    };
  };

  const handleScrollTouchMove = (e: React.TouchEvent) => {
    const sess = dragSessionRef.current;
    if (!sess || !sess.fromScrollArea || e.touches.length !== 1) return;
    const sc = scrollRef.current;
    const dy = e.touches[0].clientY - sess.startY;
    if (!sess.active) {
      if (sc && sc.scrollTop <= 0 && dy > 6) {
        sess.active = true;
        sess.startY = e.touches[0].clientY;
        sess.startTime = performance.now();
        setIsDragging(true);
      } else if (dy < 0) {
        dragSessionRef.current = null;
      }
      return;
    }
    setDragY(Math.max(0, dy));
  };

  const handleScrollTouchEnd = () => {
    const sess = dragSessionRef.current;
    if (!sess || !sess.fromScrollArea) return;
    if (sess.active) {
      finishDrag(dragY, sess.startTime);
    } else {
      dragSessionRef.current = null;
    }
  };

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

  const activeFilterCount =
    (condFilter !== 'all' ? 1 : 0) +
    (mallFilter !== 'all' ? 1 : 0) +
    (sortOrder !== 'price_asc' ? 1 : 0);

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

  const mallFilterOptions: { value: ShopModalMallFilter; label: string }[] = [
    { value: 'all', label: 'すべて' },
    { value: 'rakuten', label: '楽天市場' },
    { value: 'yahoo', label: 'Yahoo!ショッピング' },
  ];

  const backdropFade = isClosing ? 0 : Math.max(0, 1 - dragY / 320);

  const sheetStyle: React.CSSProperties = isClosing
    ? {
        transform: 'translateY(100%)',
        transition: 'transform 0.24s cubic-bezier(0.32, 0.72, 0, 1)',
      }
    : isDragging
      ? {
          transform: `translateY(${dragY}px)`,
          transition: 'none',
        }
      : {
          transform: 'translateY(0px)',
          transition: 'transform 0.34s cubic-bezier(0.32, 0.72, 0, 1)',
        };

  return (
    <div
      data-export-ignore="true"
      role="dialog"
      aria-modal="true"
      aria-label={`${product.name} (${sku.label}) の中古・未使用品`}
      onClick={dismissSheet}
      style={{ opacity: backdropFade, transition: isDragging ? 'none' : 'opacity 0.24s ease' }}
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/15 p-0 backdrop-blur-[4px] sm:items-center sm:p-5"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={sheetStyle}
        className="liquid-glass animate-sheet-up flex max-h-[88dvh] w-full max-w-3xl flex-col overflow-hidden rounded-t-[28px] text-[#1d1d1f] sm:rounded-[28px]"
      >
        {/* ドラッグ可能エリア: iOS標準ドラッグインジケーター ＋ 極小2行固定ヘッダー */}
        <div
          onTouchStart={handleHeaderTouchStart}
          onTouchMove={handleHeaderTouchMove}
          onTouchEnd={handleHeaderTouchEnd}
          onPointerDown={handleHeaderPointerDown}
          onPointerMove={handleHeaderPointerMove}
          onPointerUp={handleHeaderPointerUp}
          onPointerCancel={handleHeaderPointerUp}
          className="shrink-0 touch-none select-none border-b border-black/[0.06]"
        >
          {/* iOS標準ドラッグインジケーター */}
          <div className="flex cursor-grab justify-center pt-2.5 pb-1 active:cursor-grabbing sm:hidden" aria-hidden="true">
            <div className="h-1 w-9 rounded-full bg-black/15" />
          </div>

          <div className="px-4 pt-1.5 pb-3 sm:px-6 sm:pt-4 sm:pb-3.5">
            {/* 1行目: 機種名 ＋ 閉じるボタン */}
            <div className="flex items-center justify-between gap-3">
              <h2 className="min-w-0 truncate text-base font-semibold tracking-tight text-[#1d1d1f] sm:text-lg">
                {product.name} ({sku.label}) の中古・未使用品
              </h2>
              <button
                type="button"
                aria-label="モーダルを閉じる"
                onClick={dismissSheet}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-black/[0.06] text-[#6e6e73] transition hover:bg-black/10 hover:text-[#1d1d1f]"
              >
                <X className="h-4 w-4" strokeWidth={1.5} />
              </button>
            </div>

            {/* 2行目: 最安価格（定価比） ＋ 絞り込み・並び替えボタン ＋ 再取得ボタン */}
            <div className="mt-2 flex items-center justify-between gap-2">
              <div className="min-w-0 truncate text-xs text-[#6e6e73] tabular-nums sm:text-sm">
                <span>最安 </span>
                <ApplePrice
                  value={overallLowestPrice}
                  className="text-sm font-semibold text-[#1d1d1f] sm:text-base"
                />
                {maxSavingsVsNew != null && maxSavingsVsNew > 0 && (
                  <span className="ml-1 text-xs text-[#6e6e73]">
                    （{discInfo.isDiscontinued ? '終売定価比' : '定価比'} −{yen(maxSavingsVsNew)}）
                  </span>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  aria-expanded={filtersOpen}
                  onClick={() => setFiltersOpen((v) => !v)}
                  className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium transition ${
                    filtersOpen || activeFilterCount > 0
                      ? 'bg-[#1d1d1f] text-white'
                      : 'bg-white/60 text-[#1d1d1f] border border-white/80 hover:bg-white/80'
                  }`}
                >
                  <SlidersHorizontal className="h-3 w-3" strokeWidth={1.5} />
                  <span>絞り込み・並び替え{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}</span>
                  <ChevronDown
                    className={`h-3.5 w-3.5 transition-transform duration-200 ${filtersOpen ? 'rotate-180' : ''}`}
                    strokeWidth={1.5}
                  />
                </button>

                <button
                  type="button"
                  onClick={onRefreshLive}
                  disabled={isLoadingLive}
                  aria-label="最新在庫を再取得"
                  title="最新在庫を再取得"
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/80 bg-white/60 text-[#6e6e73] transition hover:bg-white/80 hover:text-[#1d1d1f] disabled:opacity-50"
                >
                  <RefreshCw
                    className={`h-3.5 w-3.5 ${isLoadingLive ? 'animate-spin' : ''}`}
                    strokeWidth={1.5}
                  />
                </button>
              </div>
            </div>

            {/* 折りたたみ式フィルターアコーディオン（デフォルト非表示） */}
            <div
              className={`grid transition-all duration-200 ease-out ${
                filtersOpen ? 'mt-3 grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
              }`}
            >
              <div className="overflow-hidden">
                <div className="space-y-2.5 border-t border-black/[0.06] pt-3 text-xs">
                  {/* 状態・店舗 */}
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="mr-1 whitespace-nowrap text-xs font-medium text-[#6e6e73]">状態・店舗</span>
                    {condFilterOptions.map((opt) => {
                      const active = condFilter === opt.value;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => setCondFilter(opt.value)}
                          className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium transition ${
                            active
                              ? 'bg-[#1d1d1f] text-white'
                              : 'bg-white/60 text-[#6e6e73] border border-white/80 hover:text-[#1d1d1f]'
                          }`}
                        >
                          <span>{opt.label}</span>
                          <span className={`tabular-nums ${active ? 'text-white/75' : 'text-[#6e6e73]/75'}`}>
                            {opt.count}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  {/* モール ＋ 並び替え */}
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="mr-1 whitespace-nowrap text-xs font-medium text-[#6e6e73]">モール</span>
                      {mallFilterOptions.map((opt) => {
                        const active = mallFilter === opt.value;
                        return (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() => setMallFilter(opt.value)}
                            className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium transition ${
                              active
                                ? 'bg-[#1d1d1f] text-white'
                                : 'bg-white/60 text-[#6e6e73] border border-white/80 hover:text-[#1d1d1f]'
                            }`}
                          >
                            {opt.label}
                          </button>
                        );
                      })}
                    </div>

                    <div
                      role="group"
                      aria-label="出品リストの並び替え"
                      className="inline-flex rounded-full bg-black/[0.06] p-0.5 text-xs font-medium"
                    >
                      <button
                        type="button"
                        onClick={() => setSortOrder('price_asc')}
                        className={`whitespace-nowrap rounded-full px-2.5 py-1 transition ${
                          sortOrder === 'price_asc'
                            ? 'bg-white/90 font-semibold text-[#1d1d1f] shadow-[0_1px_4px_rgba(0,0,0,0.1)]'
                            : 'text-[#6e6e73] hover:text-[#1d1d1f]'
                        }`}
                      >
                        価格が安い順
                      </button>
                      <button
                        type="button"
                        onClick={() => setSortOrder('condition_desc')}
                        className={`whitespace-nowrap rounded-full px-2.5 py-1 transition ${
                          sortOrder === 'condition_desc'
                            ? 'bg-white/90 font-semibold text-[#1d1d1f] shadow-[0_1px_4px_rgba(0,0,0,0.1)]'
                            : 'text-[#6e6e73] hover:text-[#1d1d1f]'
                        }`}
                      >
                        状態が良い順
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* スクロール領域: 半透明ガラスカード一覧 ＋ 末尾に3大モール検索＆注記 */}
        <div
          ref={scrollRef}
          onTouchStart={handleScrollTouchStart}
          onTouchMove={handleScrollTouchMove}
          onTouchEnd={handleScrollTouchEnd}
          className="flex-1 space-y-2.5 overflow-y-auto px-4 py-3 sm:px-6 sm:py-4"
        >
          {allOffers.length > 0 && !hasRakutenOffers && (
            <div className="liquid-glass-card flex flex-col gap-2 rounded-2xl p-3.5 text-xs text-[#6e6e73] sm:flex-row sm:items-center sm:justify-between">
              <span>
                楽天市場の出品は現在取得できませんでした。Yahoo!ショッピングの実在庫を最安値として表示しています。
              </span>
              <MallSearchButtons
                links={mallLinks}
                platforms={['rakuten', 'amazon']}
                labels={{ rakuten: '楽天市場で見る', amazon: 'Amazonで見る' }}
                size="sm"
              />
            </div>
          )}

          {allOffers.length === 0 ? (
            <div className="space-y-3.5 py-10 text-center text-sm text-[#6e6e73]">
              <div className="font-semibold text-[#1d1d1f]">
                参考推定相場: 約{yen(overallLowestPrice)}（実在庫データ未取得）
              </div>
              <p className="text-xs text-[#6e6e73]">
                現在この機種のリアルタイム出品リストは未取得です。各モールの検索ページで実際の在庫・価格をご確認ください。
              </p>
              <div className="flex justify-center pt-1">
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
          ) : filteredOffers.length === 0 ? (
            <div className="py-10 text-center text-sm text-[#6e6e73]">
              <p>選択した絞り込み条件に一致する出品がありません。</p>
              <button
                type="button"
                onClick={() => {
                  setCondFilter('all');
                  setMallFilter('all');
                }}
                className="mt-2.5 font-semibold text-[#1d1d1f] underline underline-offset-2"
              >
                フィルタをリセットして全{allOffers.length}件を表示
              </button>
            </div>
          ) : (
            filteredOffers.map((offer, idx) => {
              const rank = idx + 1;
              const condMeta = CONDITION_RANK_META[offer.conditionRank] ?? CONDITION_RANK_META.used;
              const mallLabel = offer.platform === 'yahoo' ? 'Yahoo!' : '楽天市場';

              return (
                <a
                  key={`${offer.platform}-${offer.price}-${offer.shopName}-${idx}`}
                  href={offer.url}
                  target="_blank"
                  rel="noopener noreferrer sponsored"
                  className="liquid-glass-card block rounded-2xl p-3.5 transition hover:bg-white/80 active:scale-[0.99]"
                >
                  {/* 1行目: 順位ピル ＋ ショップ名 ＋ モール名 ｜ 価格 ＋ シェブロン */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <span
                        className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums ${
                          rank === 1
                            ? 'bg-[#1d1d1f] text-white'
                            : 'bg-black/[0.06] text-[#6e6e73]'
                        }`}
                      >
                        {rank}位
                      </span>
                      <span className="truncate text-sm font-semibold text-[#1d1d1f]">
                        {offer.shopName}
                      </span>
                      <span className="shrink-0 whitespace-nowrap text-xs text-[#6e6e73]">
                        {mallLabel}
                      </span>
                    </div>

                    <div className="flex shrink-0 items-center gap-1">
                      <ApplePrice
                        value={offer.price}
                        className="text-base font-bold text-[#1d1d1f]"
                      />
                      <ChevronRight className="h-4 w-4 text-[#6e6e73]/60" strokeWidth={1.5} />
                    </div>
                  </div>

                  {/* 2行目: 状態ランク ＋ SIMフリー ＋ 1行省略タイトル */}
                  <div className="mt-1.5 flex min-w-0 items-center gap-1.5">
                    <span className="shrink-0 whitespace-nowrap rounded-md bg-black/[0.05] px-2 py-0.5 text-[11px] text-[#6e6e73]">
                      {condMeta.shortLabel}
                    </span>
                    {offer.simFree && (
                      <span className="shrink-0 whitespace-nowrap rounded-md bg-black/[0.05] px-2 py-0.5 text-[11px] text-[#6e6e73]">
                        SIMフリー
                      </span>
                    )}
                    <span
                      className="min-w-0 truncate text-xs text-[#6e6e73]"
                      title={offer.title}
                    >
                      {offer.title}
                    </span>
                  </div>
                </a>
              );
            })
          )}

          {/* スクロール末尾: 3大モール横断検索 ＋ 注意書き */}
          <div className="space-y-3 border-t border-black/[0.06] pt-4 pb-2">
            <div className="space-y-2">
              <div className="text-xs font-medium text-[#6e6e73]">3大モールで探す</div>
              <MallSearchButtons links={mallLinks} size="sm" />
            </div>
            <div className="space-y-1 text-[11px] leading-relaxed text-[#6e6e73]">
              <p>
                ※厳密タイトル検証によりケース・フィルム・ジャンク品・別容量・別モデル（Pro/Max/mini等）を自動除外しています。在庫・価格は各ショップページでご確認ください。リンクはもしもアフィリエイト経由です（PR）。
              </p>
              <p className="font-medium tabular-nums">
                表示中: {filteredOffers.length}件 / 全{allOffers.length}件
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});

export const UsedShopOffersModal = UsedOffersModal;
export default UsedOffersModal;
