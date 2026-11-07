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
import type {
  UsedConditionRank,
  UsedMarketData,
  UsedShopOffer,
} from '../usedPrice';

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

  const allOffers: UsedShopOffer[] = useMemo(() => {
    const raw = usedInfo.usedPricing.offers ?? usedInfo.offers ?? [];
    return [...raw].sort((a, b) => a.price - b.price);
  }, [usedInfo]);

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
      label: '✨ 未使用品のみ',
      count: allOffers.filter((o) => o.conditionRank === 'unused').length,
    },
    {
      value: 'rankA_plus',
      label: '🅰️ 美品(Aランク)以上',
      count: allOffers.filter((o) => o.conditionRank === 'unused' || o.conditionRank === 'rankA').length,
    },
    {
      value: 'trusted',
      label: '✅ 大手ショップのみ',
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-3 sm:p-5 backdrop-blur-xs"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white text-zinc-900 shadow-2xl dark:bg-[#1c1d22] dark:text-zinc-100"
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
            className="shrink-0 rounded-xl bg-zinc-100 p-2 text-zinc-500 transition hover:bg-zinc-200 hover:text-zinc-900 dark:bg-[#25272e] dark:text-zinc-400 dark:hover:bg-zinc-700/70 dark:hover:text-zinc-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* 2. クイック絞り込み＆並び替えバー */}
        <div className="space-y-3 bg-[#f5f5f7] px-5 py-3.5 text-xs sm:px-6 dark:bg-[#23252b]">
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
                className="inline-flex rounded-xl bg-zinc-200/70 p-1 text-xs font-medium dark:bg-[#1c1d22]"
              >
                <button
                  type="button"
                  onClick={() => setSortOrder('price_asc')}
                  className={`rounded-lg px-3 py-1 transition ${
                    sortOrder === 'price_asc'
                      ? 'bg-white font-semibold text-zinc-900 shadow-2xs dark:bg-[#2b2d35] dark:text-zinc-100'
                      : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200'
                  }`}
                >
                  価格が安い順
                </button>
                <button
                  type="button"
                  onClick={() => setSortOrder('condition_desc')}
                  className={`rounded-lg px-3 py-1 transition ${
                    sortOrder === 'condition_desc'
                      ? 'bg-white font-semibold text-zinc-900 shadow-2xs dark:bg-[#2b2d35] dark:text-zinc-100'
                      : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200'
                  }`}
                >
                  状態が良い順
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* 3. ショップ別ランキングリスト（余白で区切るフラットリスト） */}
        <div className="flex-1 space-y-2.5 overflow-y-auto px-5 py-4 sm:px-6">
          {allOffers.length === 0 ? (
            <div className="py-12 text-center text-sm text-zinc-600 dark:text-zinc-300 space-y-3.5">
              <div className="font-bold text-zinc-900 dark:text-zinc-100">
                📊 参考推定相場: 約{yen(overallLowestPrice)}（実在庫データ未取得）
              </div>
              <p className="text-xs sm:text-sm text-zinc-500 dark:text-zinc-400">
                現在この機種のリアルタイム出品リストは未取得です。各モールの検索ページで実際の在庫・価格をご確認ください。
              </p>
              <div className="flex flex-wrap items-center justify-center gap-2.5 pt-1">
                <a
                  href={usedInfo.rakutenSearchUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-xl bg-zinc-100 px-3.5 py-2 text-xs font-medium text-zinc-700 transition hover:bg-zinc-200 hover:text-zinc-900 dark:bg-[#25272e] dark:text-zinc-200 dark:hover:bg-zinc-700/70"
                >
                  <span>楽天市場で実際の在庫を検索</span>
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
                <a
                  href={usedInfo.yahooSearchUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-xl bg-zinc-100 px-3.5 py-2 text-xs font-medium text-zinc-700 transition hover:bg-zinc-200 hover:text-zinc-900 dark:bg-[#25272e] dark:text-zinc-200 dark:hover:bg-zinc-700/70"
                >
                  <span>Yahoo!で実際の在庫を検索</span>
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
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
                  className={`flex flex-col gap-3 rounded-xl px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4 ${
                    isFirst
                      ? 'bg-[#eaf2ed]/45 dark:bg-[#1e2b24]/35'
                      : 'bg-[#f5f5f7]/80 dark:bg-[#23252b]/75'
                  }`}
                >
                  {/* 左〜中央: 順位バッジ ＋ モール・ショップ名 ＋ 状態バッジ＆商品タイトル */}
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      {/* 順位バッジ */}
                      <span
                        className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-0.5 text-xs font-bold tabular-nums ${
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
                      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-zinc-200/60 px-2 py-0.5 text-xs font-medium text-zinc-700 dark:bg-[#2c2f36] dark:text-zinc-300">
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
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-zinc-200/60 px-2 py-0.5 text-xs font-medium text-zinc-700 dark:bg-[#2c2f36] dark:text-zinc-300">
                          <span className="h-1.5 w-1.5 rounded-full bg-[#649274]" />
                          <span>✓ 大手認定</span>
                        </span>
                      )}
                    </div>

                    {/* 状態・特徴バッジ ＋ 商品タイトル（1行省略＋ホバー全文） */}
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-white px-2.5 py-0.5 text-xs font-medium text-zinc-700 dark:bg-[#1c1d22] dark:text-zinc-300">
                        <span className={`h-1.5 w-1.5 rounded-full ${condMeta.dotCls}`} />
                        <span>{condMeta.label}</span>
                      </span>
                      {offer.simFree && (
                        <span className="inline-flex shrink-0 items-center rounded-lg bg-zinc-200/60 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:bg-[#2c2f36] dark:text-zinc-300">
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
                      rel="noopener noreferrer"
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-zinc-900 px-3.5 py-2 text-xs font-semibold text-zinc-100 transition hover:bg-zinc-700 dark:bg-zinc-200 dark:text-zinc-900 dark:hover:bg-zinc-300"
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
        <div className="flex flex-wrap items-center justify-between gap-2 bg-[#f5f5f7] px-5 py-3 text-xs text-zinc-500 sm:px-6 dark:bg-[#18191e] dark:text-zinc-400">
          <span>
            ※厳密タイトル検証によりケース・フィルム・ジャンク品・別容量・別モデル（Pro/Max/mini等）を自動除外しています。在庫・価格は各ショップページでご確認ください。
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
