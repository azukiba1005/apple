import React, { useMemo, useRef, useState } from 'react';
import {
  Check, ExternalLink, Link2, Scale, Sparkles,
} from 'lucide-react';
import {
  appleStoreUrlForCategory,
  btnCls,
  card,
  CarrierBadge,
  CARRIER_META,
  CARRIER_STORE_URLS,
  carrierValue,
  CatIcon,
  computePerformanceScore,
  copyText,
  hasPrice,
  isProductDiscontinued,
  lastOf,
  pricedSkus,
  secondaryActionBtnCls,
  SectionTitle,
  Segmented,
  Toggle,
  yen,
  type BudgetCategoryFilter,
  type CarrierId,
  type PerformanceScoreBreakdown,
  type Product,
  type Sel,
  type Sku,
  type Tab,
} from '../App';
import {
  estimateUsedMarketData,
  type UsedMarketData,
} from '../usedPrice';
import { toMoshimoUrl } from '../utils/moshimo';

/* =====================================================================================
 * 7.5 タブ4: 💰 予算から逆算！最高スペック検索 (BudgetView)
 * ===================================================================================== */

const QUICK_BUDGETS = [
  { value: 30000, label: '3万円以内' },
  { value: 50000, label: '5万円以内' },
  { value: 80000, label: '8万円以内' },
  { value: 100000, label: '10万円以内' },
  { value: 150000, label: '15万円以内' },
  { value: 200000, label: '20万円以内' },
] as const;

const BUDGET_CAT_OPTIONS: { value: BudgetCategoryFilter; label: string }[] = [
  { value: 'all', label: 'すべて' },
  { value: 'iPhone', label: 'iPhone' },
  { value: 'iPad', label: 'iPad' },
  { value: 'Mac', label: 'Mac' },
  { value: 'Apple Watch', label: 'Apple Watch' },
  { value: 'AirPods', label: 'AirPods' },
];

interface BudgetCandidate {
  p: Product;
  sku: Sku;
  score: PerformanceScoreBreakdown;
  usedInfo: UsedMarketData;
  lowestUsedPrice: number;
  unusedPrice: number | null;
  appleNewPrice: number | null;
  isCurrentlySoldNew: boolean;
  bestCarrierReturn: { cid: CarrierId; effectiveCost: number; programName: string } | null;
  qualifyingPrice: number;
  qualifyingRoute: 'used' | 'unused' | 'new' | 'program';
  qualifyingRouteLabel: string;
  qualifyingShopName: string;
  qualifyingUrl: string;
}

export const BudgetSearchModal = React.memo(function BudgetSearchModal({
  products,
  sels,
  setSels,
  setTab,
  maxPrice,
  setMaxPrice,
  catFilter,
  setCatFilter,
  mnp,
  toast,
}: {
  products: Product[];
  sels: Sel[];
  setSels: (s: Sel[]) => void;
  setTab: (t: Tab) => void;
  maxPrice: number;
  setMaxPrice: (n: number) => void;
  catFilter: BudgetCategoryFilter;
  setCatFilter: (c: BudgetCategoryFilter) => void;
  mnp: boolean;
  toast: (m: string) => void;
}) {
  const [includeUsed, setIncludeUsed] = useState(true);
  const [onlyNew, setOnlyNew] = useState(false);
  const [includeProgram, setIncludeProgram] = useState(false);
  const [urlCopied, setUrlCopied] = useState(false);
  const urlCopyTimer = useRef<number>();

  // カテゴリでフィルタされた製品群
  const targetProducts = useMemo(() => {
    const priced = products.filter(hasPrice);
    if (catFilter === 'all') return priced;
    return priced.filter((p) => p.category === catFilter);
  }, [products, catFilter]);

  // 全SKUの評価データ構築
  const allSkuEvaluations = useMemo(() => {
    const list: {
      p: Product;
      sku: Sku;
      score: PerformanceScoreBreakdown;
      usedInfo: UsedMarketData;
      lowestUsedPrice: number;
      isYahooLowest: boolean;
      bestUsedOffer: UsedMarketData['usedPricing']['rakuten'];
      unusedOffer: UsedMarketData['unused'];
      appleNewPrice: number | null;
      isCurrentlySoldNew: boolean;
      bestCarrierReturn: { cid: CarrierId; effectiveCost: number; programName: string } | null;
    }[] = [];

    for (const p of targetProducts) {
      const skus = pricedSkus(p);
      for (const sku of skus) {
        const score = computePerformanceScore(p, sku);
        const usedInfo = estimateUsedMarketData(p, sku);
        const up = usedInfo.usedPricing;
        const lowestUsedPrice = up.lowestPrice;
        const isYahooLowest = up.lowestPlatform === 'yahoo';
        const bestUsedOffer = isYahooLowest ? up.yahoo ?? up.rakuten : up.rakuten ?? up.yahoo;
        const unusedOffer = usedInfo.unused;
        const isCurrentlySoldNew = !isProductDiscontinued(p, sku);
        const rawApplePrice =
          sku.carriers.apple?.currentPrice ??
          (sku.priceHistory.length ? lastOf(sku.priceHistory).appleStorePrice : null);
        const appleNewPrice = isCurrentlySoldNew ? rawApplePrice : null;

        const carrierReturns = (['docomo', 'au', 'softbank', 'rakuten'] as CarrierId[])
          .map((cid) => {
            const cp = sku.carriers[cid];
            if (!cp?.returnProgram) return null;
            const eff = carrierValue(cp, 'return', mnp) ?? cp.returnProgram.effectiveCost;
            return { cid, effectiveCost: eff, programName: cp.returnProgram.name };
          })
          .filter((x): x is { cid: CarrierId; effectiveCost: number; programName: string } => x !== null)
          .sort((a, b) => a.effectiveCost - b.effectiveCost);

        list.push({
          p,
          sku,
          score,
          usedInfo,
          lowestUsedPrice,
          isYahooLowest,
          bestUsedOffer,
          unusedOffer,
          appleNewPrice,
          isCurrentlySoldNew,
          bestCarrierReturn: carrierReturns[0] ?? null,
        });
      }
    }
    return list;
  }, [targetProducts, mnp]);

  // 1. 🏆 部門1: 予算内で買える「最高スペック王」（主に中古・未使用品・新品一括）
  const bestOverallUsedOrNew = useMemo(() => {
    const byProduct = new Map<string, BudgetCandidate>();
    for (const item of allSkuEvaluations) {
      const options: {
        price: number;
        route: 'used' | 'unused' | 'new';
        label: string;
        shop: string;
        url: string;
      }[] = [];
      if (item.appleNewPrice != null && item.appleNewPrice <= maxPrice) {
        options.push({
          price: item.appleNewPrice,
          route: 'new',
          label: 'Apple Store新品',
          shop: 'Apple Store',
          url: appleStoreUrlForCategory(item.p.category),
        });
      }
      if (item.unusedOffer && item.unusedOffer.price <= maxPrice) {
        options.push({
          price: item.unusedOffer.price,
          route: 'unused',
          label: 'EC未使用品',
          shop: item.unusedOffer.shopName,
          url: item.unusedOffer.itemUrl,
        });
      }
      if (item.lowestUsedPrice <= maxPrice && item.bestUsedOffer) {
        const isEst = Boolean(item.usedInfo.isEstimated || item.usedInfo.source === 'mock' || item.usedInfo.usedPricing.isEstimated);
        options.push({
          price: item.lowestUsedPrice,
          route: 'used',
          label: isEst ? '中古参考推定相場' : `${item.isYahooLowest ? 'Yahoo!中古' : '楽天中古'}`,
          shop: isEst ? '' : item.bestUsedOffer.shopName,
          url: item.bestUsedOffer.url,
        });
      }
      if (!options.length) continue;
      const chosen =
        options.find((o) => o.route === 'used') ??
        options.find((o) => o.route === 'unused') ??
        options[0];

      const cand: BudgetCandidate = {
        p: item.p,
        sku: item.sku,
        score: item.score,
        usedInfo: item.usedInfo,
        lowestUsedPrice: item.lowestUsedPrice,
        unusedPrice: item.unusedOffer?.price ?? null,
        appleNewPrice: item.appleNewPrice,
        isCurrentlySoldNew: item.isCurrentlySoldNew,
        bestCarrierReturn: item.bestCarrierReturn,
        qualifyingPrice: chosen.price,
        qualifyingRoute: chosen.route,
        qualifyingRouteLabel: chosen.label,
        qualifyingShopName: chosen.shop,
        qualifyingUrl: chosen.url,
      };

      const prev = byProduct.get(item.p.id);
      if (
        !prev ||
        cand.score.total > prev.score.total ||
        (cand.score.total === prev.score.total && cand.qualifyingPrice < prev.qualifyingPrice)
      ) {
        byProduct.set(item.p.id, cand);
      }
    }
    return Array.from(byProduct.values()).sort(
      (a, b) => b.score.total - a.score.total || a.qualifyingPrice - b.qualifyingPrice,
    );
  }, [allSkuEvaluations, maxPrice]);

  // 2. ✨ 部門2: 予算内で買える「新品（Apple Store直販）」最高モデル（＋あと少し出せば買えるガイド）
  const { bestNewWithinBudget, nearestNewAboveBudget } = useMemo(() => {
    const newItems = allSkuEvaluations.filter((x) => x.appleNewPrice != null && x.isCurrentlySoldNew);
    const withinByProduct = new Map<string, (typeof newItems)[number]>();
    for (const item of newItems) {
      if (item.appleNewPrice! <= maxPrice) {
        const prev = withinByProduct.get(item.p.id);
        if (
          !prev ||
          item.score.total > prev.score.total ||
          (item.score.total === prev.score.total && item.appleNewPrice! < prev.appleNewPrice!)
        ) {
          withinByProduct.set(item.p.id, item);
        }
      }
    }
    const sortedWithin = Array.from(withinByProduct.values()).sort(
      (a, b) => b.score.total - a.score.total || a.appleNewPrice! - b.appleNewPrice!,
    );
    const above = newItems
      .filter((x) => x.appleNewPrice! > maxPrice)
      .sort((a, b) => a.appleNewPrice! - b.appleNewPrice! || b.score.total - a.score.total);
    return {
      bestNewWithinBudget: sortedWithin[0] ?? null,
      nearestNewAboveBudget: above[0] ?? null,
    };
  }, [allSkuEvaluations, maxPrice]);

  // 3. 📱 部門3: キャリア2年返却なら手が届く「ワンランク上の最新機」
  const bestProgramWithinBudget = useMemo(() => {
    const progItems = allSkuEvaluations.filter(
      (x) => x.bestCarrierReturn != null && x.bestCarrierReturn.effectiveCost <= maxPrice,
    );
    const byProduct = new Map<string, (typeof progItems)[number]>();
    for (const item of progItems) {
      const prev = byProduct.get(item.p.id);
      if (
        !prev ||
        item.score.total > prev.score.total ||
        (item.score.total === prev.score.total &&
          item.bestCarrierReturn!.effectiveCost < prev.bestCarrierReturn!.effectiveCost)
      ) {
        byProduct.set(item.p.id, item);
      }
    }
    return (
      Array.from(byProduct.values()).sort(
        (a, b) =>
          b.score.total - a.score.total ||
          a.bestCarrierReturn!.effectiveCost - b.bestCarrierReturn!.effectiveCost,
      )[0] ?? null
    );
  }, [allSkuEvaluations, maxPrice]);

  // 購入方法フィルターを適用したメインランキング一覧 (製品ごとに最高スコアの予算内SKUを抽出)
  const filteredRanking = useMemo(() => {
    const byProduct = new Map<string, BudgetCandidate>();
    for (const item of allSkuEvaluations) {
      const routes: {
        price: number;
        route: 'used' | 'unused' | 'new' | 'program';
        label: string;
        shop: string;
        url: string;
      }[] = [];

      if (onlyNew) {
        if (item.appleNewPrice != null && item.appleNewPrice <= maxPrice) {
          routes.push({
            price: item.appleNewPrice,
            route: 'new',
            label: 'Apple Store新品',
            shop: 'Apple Store',
            url: appleStoreUrlForCategory(item.p.category),
          });
        }
      } else {
        if (item.appleNewPrice != null && item.appleNewPrice <= maxPrice) {
          routes.push({
            price: item.appleNewPrice,
            route: 'new',
            label: 'Apple Store新品',
            shop: 'Apple Store',
            url: appleStoreUrlForCategory(item.p.category),
          });
        }
        if (includeUsed) {
          if (item.lowestUsedPrice <= maxPrice && item.bestUsedOffer) {
            const isEst = Boolean(item.usedInfo.isEstimated || item.usedInfo.source === 'mock' || item.usedInfo.usedPricing.isEstimated);
            routes.push({
              price: item.lowestUsedPrice,
              route: 'used',
              label: isEst ? '中古参考推定相場' : item.isYahooLowest ? 'Yahoo!中古' : '楽天中古',
              shop: isEst ? '' : item.bestUsedOffer.shopName,
              url: item.bestUsedOffer.url,
            });
          }
          if (item.unusedOffer && item.unusedOffer.price <= maxPrice) {
            routes.push({
              price: item.unusedOffer.price,
              route: 'unused',
              label: 'EC未使用品',
              shop: item.unusedOffer.shopName,
              url: item.unusedOffer.itemUrl,
            });
          }
        }
        if (
          includeProgram &&
          item.bestCarrierReturn &&
          item.bestCarrierReturn.effectiveCost <= maxPrice
        ) {
          routes.push({
            price: item.bestCarrierReturn.effectiveCost,
            route: 'program',
            label: `${CARRIER_META[item.bestCarrierReturn.cid].label} 2年返却`,
            shop: CARRIER_META[item.bestCarrierReturn.cid].label,
            url: CARRIER_STORE_URLS[item.bestCarrierReturn.cid],
          });
        }
      }

      if (!routes.length) continue;
      routes.sort((a, b) => a.price - b.price);
      const chosen = routes[0];

      const cand: BudgetCandidate = {
        p: item.p,
        sku: item.sku,
        score: item.score,
        usedInfo: item.usedInfo,
        lowestUsedPrice: item.lowestUsedPrice,
        unusedPrice: item.unusedOffer?.price ?? null,
        appleNewPrice: item.appleNewPrice,
        isCurrentlySoldNew: item.isCurrentlySoldNew,
        bestCarrierReturn: item.bestCarrierReturn,
        qualifyingPrice: chosen.price,
        qualifyingRoute: chosen.route,
        qualifyingRouteLabel: chosen.label,
        qualifyingShopName: chosen.shop,
        qualifyingUrl: chosen.url,
      };

      const prev = byProduct.get(item.p.id);
      if (
        !prev ||
        cand.score.total > prev.score.total ||
        (cand.score.total === prev.score.total && cand.qualifyingPrice < prev.qualifyingPrice)
      ) {
        byProduct.set(item.p.id, cand);
      }
    }

    return Array.from(byProduct.values())
      .sort((a, b) => b.score.total - a.score.total || a.qualifyingPrice - b.qualifyingPrice)
      .slice(0, 18);
  }, [allSkuEvaluations, maxPrice, includeUsed, onlyNew, includeProgram]);

  const addOneToCompare = (pid: string, sid: string, name: string, label: string) => {
    const exists = sels.some((s) => s.pid === pid);
    if (exists) {
      setSels(sels.map((s) => (s.pid === pid ? { pid, sid } : s)));
      toast(`${name} (${label}) の容量を更新しました`);
    } else {
      setSels([...sels, { pid, sid }]);
      toast(`${name} (${label}) を比較リストに追加しました`);
    }
  };

  const compareTopThree = () => {
    const top3 = filteredRanking.slice(0, 3);
    if (!top3.length) return;
    setSels(top3.map((c) => ({ pid: c.p.id, sid: c.sku.id })));
    setTab('compare');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    toast(`予算${yen(maxPrice)}以内の最高スペック上位${top3.length}機種を比較テーブルに反映しました`);
  };

  const copyBudgetShareUrl = async () => {
    const ok = await copyText(window.location.href);
    if (ok) {
      setUrlCopied(true);
      window.clearTimeout(urlCopyTimer.current);
      urlCopyTimer.current = window.setTimeout(() => setUrlCopied(false), 2000);
      toast('予算検索ページのURLをコピーしました');
    }
  };

  const topUsed1 = bestOverallUsedOrNew[0] ?? null;
  const topUsed2 =
    bestOverallUsedOrNew[1] &&
    topUsed1 &&
    Math.abs(bestOverallUsedOrNew[1].score.total - topUsed1.score.total) <= 6
      ? bestOverallUsedOrNew[1]
      : null;

  return (
    <div className="space-y-5 sm:space-y-6">
      {/* 予算指定コントロールカード */}
      <div className={`${card} p-5 sm:p-6`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <SectionTitle
            icon={<Sparkles className="h-5 w-5" />}
            title="💰 予算から逆算！最高スペック検索"
            desc="指定した予算上限の中で、SoC世代・RAM・ProMotion・サポート残年数から「最もスペックが高いApple製品」を自動ランキング抽出します。"
          />
          <div className="flex flex-wrap items-center gap-2.5 ml-auto">
            <button
              type="button"
              onClick={copyBudgetShareUrl}
              className={`${btnCls} ${
                urlCopied
                  ? '!bg-zinc-200/80 dark:!bg-zinc-700'
                  : ''
              }`}
            >
              {urlCopied ? (
                <>
                  <Check className="h-4 w-4 shrink-0 text-[#487558] dark:text-[#88b396]" />
                  <span>コピー済</span>
                </>
              ) : (
                <>
                  <Link2 className="h-4 w-4 shrink-0" />
                  <span>この予算検索URLをコピー</span>
                </>
              )}
            </button>
            <button
              type="button"
              disabled={!filteredRanking.length}
              onClick={compareTopThree}
              className={btnCls}
            >
              <Scale className="h-4 w-4 shrink-0" />
              <span>上位3機種をまとめて横並び比較する</span>
            </button>
          </div>
        </div>

        {/* クイック予算選択ボタン + スライダー */}
        <div className="mt-4 rounded-2xl bg-[#f5f5f7] p-4 sm:p-5 dark:bg-[#23252b]">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <div className="flex items-baseline gap-2.5">
              <span className="text-xs sm:text-sm font-medium text-zinc-500 dark:text-zinc-400">予算上限:</span>
              <span className="text-2xl sm:text-3xl font-bold tabular-nums text-zinc-900 dark:text-zinc-100">
                {yen(maxPrice)}
              </span>
              <span className="text-xs sm:text-sm text-zinc-500 dark:text-zinc-400">以内（税込）</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {QUICK_BUDGETS.map((b) => (
                <button
                  key={b.value}
                  type="button"
                  onClick={() => setMaxPrice(b.value)}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                    maxPrice === b.value
                      ? 'bg-[#1d1d1f] text-white dark:bg-white dark:text-[#1d1d1f]'
                      : 'bg-white text-zinc-700 hover:bg-zinc-200/70 dark:bg-[#1c1d22] dark:text-zinc-300 dark:hover:bg-[#2c2f36]'
                  }`}
                >
                  {b.label}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4">
            <input
              type="range"
              min={10000}
              max={300000}
              step={5000}
              value={maxPrice}
              onChange={(e) => setMaxPrice(Number(e.target.value))}
              aria-label="予算上限スライダー"
              className="h-2 w-full cursor-pointer appearance-none rounded-full bg-zinc-200 accent-zinc-900 dark:bg-[#18191e] dark:accent-zinc-200"
            />
            <div className="mt-1.5 flex justify-between text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
              <span>¥10,000</span>
              <span>¥50,000</span>
              <span>¥100,000</span>
              <span>¥150,000</span>
              <span>¥200,000</span>
              <span>¥250,000</span>
              <span>¥300,000</span>
            </div>
          </div>

          <div className="mt-4 flex flex-col gap-3.5 pt-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">カテゴリ:</span>
              <Segmented<BudgetCategoryFilter>
                value={catFilter}
                onChange={setCatFilter}
                options={BUDGET_CAT_OPTIONS}
              />
            </div>

            <div className="flex flex-wrap items-center gap-4 text-xs sm:text-sm">
              <Toggle
                size="sm"
                checked={includeUsed && !onlyNew}
                disabled={onlyNew}
                onChange={setIncludeUsed}
                label="中古・未使用品を含む"
              />
              <Toggle
                size="sm"
                checked={onlyNew}
                onChange={(checked) => {
                  setOnlyNew(checked);
                  if (checked) setIncludeProgram(false);
                }}
                label="Apple直販（新品）のみ"
              />
              <Toggle
                size="sm"
                checked={includeProgram && !onlyNew}
                disabled={onlyNew}
                onChange={setIncludeProgram}
                label="キャリア2年返却（実質負担額）を含める"
              />
            </div>
          </div>
        </div>
      </div>

      {/* 予算内ベスト3の部門別ハイライトカード（ソフトコントラスト・枠線レス統一） */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* 1. 予算内で買える「最高スペック王」（主に中古・未使用品） */}
        <div className={`${card} flex flex-col justify-between p-5 sm:p-6`}>
          <div>
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-semibold text-zinc-700 dark:bg-[#25272e] dark:text-zinc-300">
                <span className="h-1.5 w-1.5 rounded-full bg-[#649274]" />
                予算内「最高スペック」
              </span>
              {topUsed1 && (
                <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-semibold tabular-nums text-zinc-600 dark:bg-[#25272e] dark:text-zinc-300">
                  性能スコア {topUsed1.score.total}点
                </span>
              )}
            </div>
            {topUsed1 ? (
              <>
                <div className="mt-3">
                  <div className="text-base sm:text-lg font-bold text-zinc-900 dark:text-zinc-100">
                    {topUsed1.p.name} ({topUsed1.sku.label})
                    {topUsed2 ? ` / ${topUsed2.p.name} (${topUsed2.sku.label})` : ''}
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-baseline gap-2">
                    <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                      {topUsed1.qualifyingRouteLabel}
                    </span>
                    <span className="text-xl sm:text-2xl font-bold tabular-nums text-zinc-900 dark:text-zinc-100">
                      {yen(topUsed1.qualifyingPrice)}
                    </span>
                    <span className="text-xs font-medium tabular-nums text-[#3d6b4e] dark:text-[#88b396]">
                      （予算残り {yen(maxPrice - topUsed1.qualifyingPrice)}）
                    </span>
                  </div>
                </div>
                <p className="mt-3 text-xs sm:text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                  搭載チップ「{topUsed1.score.socLabel}」{topUsed1.score.ramGb ? `・RAM ${topUsed1.score.ramGb}GB` : ''}
                  ・{topUsed1.score.releaseYear}年発売（想定サポート残約
                  {topUsed1.score.remainingSupportYears}年）。
                </p>
              </>
            ) : (
              <p className="mt-3 text-xs sm:text-sm text-zinc-500">
                現在の予算（{yen(maxPrice)}）内で購入できる該当カテゴリの製品が見つかりません。
              </p>
            )}
          </div>
          {topUsed1 && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 pt-2">
              <button
                type="button"
                onClick={() =>
                  addOneToCompare(topUsed1.p.id, topUsed1.sku.id, topUsed1.p.name, topUsed1.sku.label)
                }
                className={secondaryActionBtnCls}
              >
                <span>
                  {sels.some((s) => s.pid === topUsed1.p.id)
                    ? '✓ 比較リストに追加済'
                    : '＋ 比較リストに追加'}
                </span>
              </button>
              <a
                href={toMoshimoUrl(topUsed1.qualifyingUrl)}
                target="_blank"
                rel="noopener noreferrer"
                className={secondaryActionBtnCls}
              >
                <span>
                  {topUsed1.qualifyingRoute === 'used' && topUsed1.usedInfo.isEstimated
                    ? '実際の在庫を検索'
                    : '最安ショップを見る'}
                </span>
                <ExternalLink className="h-3.5 w-3.5 shrink-0" />
              </a>
            </div>
          )}
        </div>

        {/* 2. 予算内で買える「新品（Apple Store直販）」最高モデル */}
        <div className={`${card} flex flex-col justify-between p-5 sm:p-6`}>
          <div>
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-semibold text-zinc-700 dark:bg-[#25272e] dark:text-zinc-300">
                <span className="h-1.5 w-1.5 rounded-full bg-[#649274]" />
                予算内「Apple直販新品」最高機
              </span>
              {bestNewWithinBudget && (
                <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-semibold tabular-nums text-zinc-600 dark:bg-[#25272e] dark:text-zinc-300">
                  性能スコア {bestNewWithinBudget.score.total}点
                </span>
              )}
            </div>
            {bestNewWithinBudget ? (
              <>
                <div className="mt-3">
                  <div className="text-base sm:text-lg font-bold text-zinc-900 dark:text-zinc-100">
                    {bestNewWithinBudget.p.name} ({bestNewWithinBudget.sku.label})
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-baseline gap-2">
                    <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                      Apple Store直販（新品）
                    </span>
                    <span className="text-xl sm:text-2xl font-bold tabular-nums text-zinc-900 dark:text-zinc-100">
                      {yen(bestNewWithinBudget.appleNewPrice)}
                    </span>
                    <span className="text-xs font-medium tabular-nums text-[#3d6b4e] dark:text-[#88b396]">
                      （予算残り {yen(maxPrice - (bestNewWithinBudget.appleNewPrice ?? 0))}）
                    </span>
                  </div>
                </div>
                <p className="mt-3 text-xs sm:text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                  新品・メーカー保証・バッテリー100%で選べる予算内最高性能（
                  {bestNewWithinBudget.score.socLabel}
                  {bestNewWithinBudget.score.ramGb ? ` / RAM ${bestNewWithinBudget.score.ramGb}GB` : ''}
                  ）。
                </p>
              </>
            ) : nearestNewAboveBudget ? (
              <div className="mt-3 text-xs sm:text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">
                <div className="font-semibold text-zinc-800 dark:text-zinc-200">
                  予算 {yen(maxPrice)} 以内の現行Apple Store新品はありません
                </div>
                <p className="mt-1.5">
                  あと{' '}
                  <strong className="font-bold tabular-nums text-zinc-900 dark:text-zinc-100">
                    ＋{yen((nearestNewAboveBudget.appleNewPrice ?? 0) - maxPrice)}
                  </strong>{' '}
                  で{' '}
                  <strong className="font-bold text-zinc-900 dark:text-zinc-100">
                    {nearestNewAboveBudget.p.name} ({nearestNewAboveBudget.sku.label})
                  </strong>{' '}
                  新品（{yen(nearestNewAboveBudget.appleNewPrice)}）に届きます。
                </p>
              </div>
            ) : (
              <p className="mt-3 text-xs sm:text-sm text-zinc-500">
                該当カテゴリで現行販売中の新品モデルデータがありません。
              </p>
            )}
          </div>
          {(bestNewWithinBudget ?? nearestNewAboveBudget) && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 pt-2">
              {(() => {
                const target = (bestNewWithinBudget ?? nearestNewAboveBudget)!;
                return (
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        addOneToCompare(target.p.id, target.sku.id, target.p.name, target.sku.label)
                      }
                      className={secondaryActionBtnCls}
                    >
                      <span>
                        {sels.some((s) => s.pid === target.p.id)
                          ? '✓ 比較リストに追加済'
                          : '＋ 比較リストに追加'}
                      </span>
                    </button>
                    <a
                      href={appleStoreUrlForCategory(target.p.category)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={secondaryActionBtnCls}
                    >
                      <span>Apple Storeで見る</span>
                      <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                    </a>
                  </>
                );
              })()}
            </div>
          )}
        </div>

        {/* 3. キャリア2年返却なら手が届く「ワンランク上の最新機」 */}
        <div className={`${card} flex flex-col justify-between p-5 sm:p-6`}>
          <div>
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-semibold text-zinc-700 dark:bg-[#25272e] dark:text-zinc-300">
                <span className="h-1.5 w-1.5 rounded-full bg-zinc-500" />
                キャリア2年返却の最高機
              </span>
              {bestProgramWithinBudget && (
                <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-semibold tabular-nums text-zinc-600 dark:bg-[#25272e] dark:text-zinc-300">
                  性能スコア {bestProgramWithinBudget.score.total}点
                </span>
              )}
            </div>
            {bestProgramWithinBudget && bestProgramWithinBudget.bestCarrierReturn ? (
              <>
                <div className="mt-3">
                  <div className="text-base sm:text-lg font-bold text-zinc-900 dark:text-zinc-100">
                    {bestProgramWithinBudget.p.name} ({bestProgramWithinBudget.sku.label})
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-baseline gap-2">
                    <CarrierBadge id={bestProgramWithinBudget.bestCarrierReturn.cid} small />
                    <span className="text-xl sm:text-2xl font-bold tabular-nums text-zinc-900 dark:text-zinc-100">
                      実質 {yen(bestProgramWithinBudget.bestCarrierReturn.effectiveCost)}
                    </span>
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">
                      （月約{yen(Math.round(bestProgramWithinBudget.bestCarrierReturn.effectiveCost / 24))}）
                    </span>
                  </div>
                </div>
                <p className="mt-3 text-xs sm:text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                  一括だと新品 {yen(bestProgramWithinBudget.appleNewPrice)}・中古{' '}
                  {yen(bestProgramWithinBudget.lowestUsedPrice)} の上位機ですが、
                  {CARRIER_META[bestProgramWithinBudget.bestCarrierReturn.cid].label}「
                  {bestProgramWithinBudget.bestCarrierReturn.programName}」なら2年実質{' '}
                  {yen(bestProgramWithinBudget.bestCarrierReturn.effectiveCost)}。
                </p>
              </>
            ) : (
              <p className="mt-3 text-xs sm:text-sm text-zinc-500">
                選択中のカテゴリ・予算条件では、キャリア2年返却プログラムの対象モデルがありません。
              </p>
            )}
          </div>
          {bestProgramWithinBudget && bestProgramWithinBudget.bestCarrierReturn && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 pt-2">
              <button
                type="button"
                onClick={() =>
                  addOneToCompare(
                    bestProgramWithinBudget.p.id,
                    bestProgramWithinBudget.sku.id,
                    bestProgramWithinBudget.p.name,
                    bestProgramWithinBudget.sku.label,
                  )
                }
                className={secondaryActionBtnCls}
              >
                <span>
                  {sels.some((s) => s.pid === bestProgramWithinBudget.p.id)
                    ? '✓ 比較リストに追加済'
                    : '＋ 比較リストに追加'}
                </span>
              </button>
              <a
                href={CARRIER_STORE_URLS[bestProgramWithinBudget.bestCarrierReturn.cid]}
                target="_blank"
                rel="noopener noreferrer"
                className={secondaryActionBtnCls}
              >
                <span>
                  {CARRIER_META[bestProgramWithinBudget.bestCarrierReturn.cid].label}公式を見る
                </span>
                <ExternalLink className="h-3.5 w-3.5 shrink-0" />
              </a>
            </div>
          )}
        </div>
      </div>

      {/* 予算内スペックランキング一覧 */}
      <div className={`${card} p-5 sm:p-6`}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-base sm:text-lg font-bold text-zinc-900 dark:text-zinc-100">
              📊 予算 {yen(maxPrice)} 以内のスペック性能ランキング（上位{filteredRanking.length}機種）
            </h3>
            <p className="mt-0.5 text-xs sm:text-sm text-zinc-500 dark:text-zinc-400">
              同一機種で複数の容量が予算内に収まる場合、より大容量のSKUを自動選択してランキングしています。
            </p>
          </div>
          {filteredRanking.length > 0 && (
            <button
              type="button"
              onClick={compareTopThree}
              className={btnCls}
            >
              <Scale className="h-4 w-4 shrink-0" />
              <span>上位3機種をまとめて横並び比較する</span>
            </button>
          )}
        </div>

        {!filteredRanking.length ? (
          <div className="rounded-2xl bg-[#f5f5f7] p-8 text-center text-sm text-zinc-500 dark:bg-[#23252b] dark:text-zinc-400">
            指定した予算（{yen(maxPrice)}）・フィルター条件に一致する製品がありません。予算上限を上げるか、「中古・未使用品を含む」をONにしてください。
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {filteredRanking.map((item, idx) => {
              const inCompare = sels.some((s) => s.pid === item.p.id);
              return (
                <div
                  key={`${item.p.id}__${item.sku.id}`}
                  className="flex flex-col justify-between rounded-2xl bg-[#f5f5f7]/80 p-4 sm:p-5 transition hover:bg-[#ececef] dark:bg-[#23252b] dark:hover:bg-[#282b32]"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="inline-flex h-6 min-w-[2rem] shrink-0 items-center justify-center rounded-full bg-white px-2 text-xs font-bold tabular-nums text-zinc-700 dark:bg-[#1c1d22] dark:text-zinc-200">
                          #{idx + 1}
                        </span>
                        <CatIcon cat={item.p.category} className="h-4 w-4 shrink-0 text-zinc-400" />
                        <span className="truncate text-sm sm:text-base font-bold text-zinc-900 dark:text-zinc-100">
                          {item.p.name}
                        </span>
                      </div>
                      <span className="shrink-0 rounded-full bg-white px-2.5 py-0.5 text-xs font-semibold tabular-nums text-zinc-600 dark:bg-[#1c1d22] dark:text-zinc-300">
                        スコア {item.score.total}
                      </span>
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                      <span className="rounded-md bg-white px-2 py-0.5 font-medium text-zinc-700 dark:bg-[#1c1d22] dark:text-zinc-300">
                        {item.sku.label}
                      </span>
                      <span>{item.score.socLabel}</span>
                      {item.score.ramGb > 0 && <span>・RAM {item.score.ramGb}GB</span>}
                      <span>・{item.score.releaseYear}年（残{item.score.remainingSupportYears}年）</span>
                    </div>

                    <div className="mt-3.5 rounded-2xl bg-white p-3.5 dark:bg-[#1c1d22]">
                      <div className="flex items-baseline justify-between gap-2">
                        <div>
                          <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                            {item.qualifyingRouteLabel}
                          </span>
                          <div className="text-lg sm:text-xl font-bold tabular-nums text-zinc-900 dark:text-zinc-100">
                            {yen(item.qualifyingPrice)}
                          </div>
                        </div>
                        <div className="text-right">
                          <span className="text-xs text-zinc-400">予算との差額</span>
                          <div className="text-xs font-semibold tabular-nums text-[#3d6b4e] dark:text-[#88b396]">
                            残り {yen(maxPrice - item.qualifyingPrice)}
                          </div>
                        </div>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
                        <span>中古最安: {yen(item.lowestUsedPrice)}</span>
                        {item.unusedPrice != null && <span>未使用: {yen(item.unusedPrice)}</span>}
                        {item.appleNewPrice != null && <span>Apple新品: {yen(item.appleNewPrice)}</span>}
                      </div>
                    </div>
                  </div>

                  <div className="mt-3.5 flex items-center justify-between gap-2.5">
                    <button
                      type="button"
                      onClick={() =>
                        addOneToCompare(item.p.id, item.sku.id, item.p.name, item.sku.label)
                      }
                      className={`${secondaryActionBtnCls} flex-1 ${
                        inCompare
                          ? '!bg-zinc-200/80 dark:!bg-zinc-700'
                          : ''
                      }`}
                    >
                      <span>{inCompare ? '✓ 比較リストに追加済' : '＋ 比較リストに追加'}</span>
                    </button>
                    <a
                      href={toMoshimoUrl(item.qualifyingUrl)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={secondaryActionBtnCls}
                    >
                      <span>購入先</span>
                      <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
});

export const BudgetView = BudgetSearchModal;
export default BudgetSearchModal;
