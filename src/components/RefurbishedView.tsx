import React, { useEffect, useMemo, useState } from 'react';
import {
  Apple,
  ExternalLink,
  Scale,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import {
  card,
  CatIcon,
  hasPrice,
  isProductDiscontinued,
  lastOf,
  pricedSkus,
  round1,
  secondaryActionBtnCls,
  SectionTitle,
  signedYen,
  yen,
  type Product,
  type Sel,
  type Sku,
  type Tab,
} from '../App';
import { estimateUsedMarketData } from '../usedPrice';
import { toMoshimoUrl } from '../utils/moshimo';

export type RefurbStockStatus = 'Live' | 'Reference';
export type RefurbCategoryFilter = 'all' | 'Mac' | 'iPad' | 'iPhone' | 'Apple Watch' | 'AirPods';
export type RefurbSortKey = 'price-asc' | 'discount-desc' | 'used-gap-asc';

export interface RefurbishedSpecs {
  soc?: string;
  ram?: string;
  weight?: string;
  releaseYear?: number;
  releaseDate?: string;
  display?: string;
  battery?: string;
  ports?: string;
  os?: string;
}

export interface RefurbishedItem {
  id: string;
  title: string;
  category: string;
  productId: string;
  productName: string;
  skuId: string;
  skuLabel: string;
  storage: string;
  connectivity: string;
  refurbishedPrice: number;
  originalNewPrice: number;
  isOriginalDiscontinued?: boolean;
  discountAmount: number;
  discountPercent: number;
  usedLowestPrice: number | null;
  usedShopName: string;
  usedUrl: string;
  usedPlatform?: 'rakuten' | 'yahoo';
  usedIsEstimated?: boolean;
  rakutenUsedPrice?: number | null;
  rakutenUsedUrl?: string;
  yahooUsedPrice?: number | null;
  yahooUsedUrl?: string;
  priceGapVsUsed: number | null;
  url: string;
  isLiveStock?: boolean;
  stockStatus: RefurbStockStatus;
  stockLabel: string;
  source?: string;
  publishedAt?: string;
  specs: RefurbishedSpecs;
}

export interface RefurbishedDataset {
  schemaVersion: 1;
  updatedAt: string;
  sources?: {
    refurbTrackerRss?: 'live' | 'fallback';
    appleOfficialWeb?: 'live' | 'fallback';
    liveCount?: number;
    referenceCount?: number;
    totalCount?: number;
  };
  items: RefurbishedItem[];
}

export const APPLE_REFURB_CATEGORY_URLS: Record<string, string> = {
  Mac: 'https://www.apple.com/jp/shop/refurbished/mac',
  iPad: 'https://www.apple.com/jp/shop/refurbished/ipad',
  iPhone: 'https://www.apple.com/jp/shop/refurbished/iphone',
  'Apple Watch': 'https://www.apple.com/jp/shop/refurbished/watch',
  AirPods: 'https://www.apple.com/jp/shop/refurbished/airpods',
};

export function isItemLiveStock(item: RefurbishedItem): boolean {
  if (typeof item.isLiveStock === 'boolean') return item.isLiveStock;
  return item.stockStatus === 'Live';
}

function calcClientRefurbPrice(newPrice: number): number {
  if (!Number.isFinite(newPrice) || newPrice <= 0) return 0;
  const raw = newPrice * 0.85;
  if (newPrice >= 100000) {
    return Math.round(raw / 1000) * 1000 - 200;
  }
  return Math.round(raw / 100) * 100;
}

/**
 * 参考推定データ（isLiveStock: false）として適切かどうかを判定する。
 * 発売から6ヶ月未満の最新モデルや超高額BTO構成（Mac Studio Ultra/Max等）を除外し、
 * 実際に整備済品として流通実績がある定番モデルの標準構成のみに厳選する。
 */
function isEligibleClientReferenceSku(p: Product, sku: Sku): boolean {
  const relStr = String(p.releaseDate ?? '').trim();
  if (!relStr || relStr < '2022-01-01') return false;
  const relMs = Date.parse(relStr);
  if (!Number.isFinite(relMs)) return false;
  const SIX_MONTHS_MS = 180 * 24 * 60 * 60 * 1000;
  if (Date.now() - relMs < SIX_MONTHS_MS) return false;

  const combinedText = `${p.name} ${p.id} ${p.specs.soc ?? ''}`.normalize('NFKC');
  if (
    /\b(M6|M5\s*(?:Pro|Max|Ultra)|A20|iPhone\s*(?:17|18|Duo|Air)|Series\s*(?:11|12)|SE\s*3|AirPods\s*(?:Pro\s*3|5|Max\s*2)|PROLED|MacBook\s*Neo)\b/i.test(
      combinedText,
    )
  ) {
    return false;
  }
  if (/Mac\s*Studio|Mac\s*Pro/i.test(p.name) || /\bM[1-6]\s*(?:Ultra|Max)\b/i.test(combinedText)) {
    return false;
  }

  const skuLabel = `${sku.label || ''} ${sku.storage || ''}`.normalize('NFKC');
  const macRamMatch = skuLabel.match(/\b(\d{1,3})\s*GB\s*[/／]/i);
  const specRamMatch = String(p.specs.ram || '').match(/(\d{1,3})\s*GB/i);
  const ramGb = macRamMatch
    ? parseInt(macRamMatch[1], 10)
    : specRamMatch
      ? parseInt(specRamMatch[1], 10)
      : 0;
  if (ramGb >= 36) return false;
  if (/\b([248])\s*TB\b/i.test(skuLabel)) return false;

  const dbNewPrice =
    sku.carriers.apple?.currentPrice ??
    (sku.priceHistory.length ? lastOf(sku.priceHistory).appleStorePrice : 0);
  if (!dbNewPrice || dbNewPrice <= 0 || dbNewPrice >= 350000) return false;

  return true;
}

/**
 * `./refurbished.json` ロード前やオフライン時でも即座に表示できるよう、
 * 現在の `products` カタログの定番モデル（発売6ヶ月以上＆標準構成のみ）から名寄せ済みの整備済相場リストを自動構築する
 */
export function buildClientFallbackRefurbishedItems(products: Product[]): RefurbishedItem[] {
  const targetProducts = products.filter(
    (p) =>
      hasPrice(p) &&
      ['Mac', 'iPad', 'iPhone', 'Apple Watch', 'AirPods'].includes(p.category),
  );

  const items: RefurbishedItem[] = [];
  for (const p of targetProducts) {
    const skus = pricedSkus(p)
      .filter((sku) => isEligibleClientReferenceSku(p, sku))
      .slice(0, 1);
    for (const sku of skus) {
      const dbNewPrice =
        sku.carriers.apple?.currentPrice ??
        (sku.priceHistory.length ? lastOf(sku.priceHistory).appleStorePrice : 0);
      if (!dbNewPrice || dbNewPrice <= 0) continue;

      const refurbishedPrice = calcClientRefurbPrice(dbNewPrice);
      const discountAmount = Math.max(0, dbNewPrice - refurbishedPrice);
      const discountPercent = round1((discountAmount / dbNewPrice) * 100);

      const usedInfo = estimateUsedMarketData(p, sku);
      const up = usedInfo.usedPricing;
      const usedLowestPrice = up.lowestPrice > 0 ? up.lowestPrice : null;
      const isYahoo = up.lowestPlatform === 'yahoo';
      const bestOffer = isYahoo ? (up.yahoo ?? up.rakuten) : (up.rakuten ?? up.yahoo);
      const usedIsEstimated = Boolean(usedInfo.isEstimated || up.isEstimated || !bestOffer?.shopName);
      const usedShopName =
        bestOffer?.shopName && bestOffer.shopName.trim()
          ? bestOffer.shopName.trim()
          : isYahoo
            ? 'Yahoo!ショッピング 最安相場'
            : '楽天市場 最安相場';
      const usedUrl =
        bestOffer?.url ||
        (isYahoo ? usedInfo.yahooSearchUrl : usedInfo.rakutenSearchUrl);
      const priceGapVsUsed =
        usedLowestPrice != null ? refurbishedPrice - usedLowestPrice : null;
      const releaseYear = parseInt(String(p.releaseDate ?? '').slice(0, 4), 10) || 2024;

      items.push({
        id: `refurb-${p.id}-${sku.id}`,
        title: `${p.name} ${sku.label} [整備済製品]`,
        category: p.category,
        productId: p.id,
        productName: p.name,
        skuId: sku.id,
        skuLabel: sku.label,
        storage: sku.storage || sku.label,
        connectivity: sku.connectivity,
        refurbishedPrice,
        originalNewPrice: dbNewPrice,
        isOriginalDiscontinued: isProductDiscontinued(p, sku),
        discountAmount,
        discountPercent,
        usedLowestPrice,
        usedShopName,
        usedUrl,
        usedPlatform: isYahoo ? 'yahoo' : 'rakuten',
        usedIsEstimated,
        rakutenUsedPrice: up.rakuten?.price ?? null,
        rakutenUsedUrl: up.rakuten?.url ?? usedInfo.rakutenSearchUrl,
        yahooUsedPrice: up.yahoo?.price ?? null,
        yahooUsedUrl: up.yahoo?.url ?? usedInfo.yahooSearchUrl,
        priceGapVsUsed,
        url: APPLE_REFURB_CATEGORY_URLS[p.category] ?? 'https://www.apple.com/jp/shop/refurbished',
        isLiveStock: false,
        stockStatus: 'Reference',
        stockLabel: '参考整備済相場（在庫なし）',
        source: 'catalog_reference',
        specs: {
          soc: p.specs.soc,
          ram: p.specs.ram,
          weight: p.specs.weight,
          releaseYear,
          releaseDate: p.releaseDate,
          display: p.specs.display,
          battery: p.specs.battery,
          ports: p.specs.ports,
          os: p.specs.os,
        },
      });
    }
  }
  return items;
}

export interface RefurbishedViewProps {
  products: Product[];
  refurbDataset: RefurbishedDataset | null;
  sels: Sel[];
  setSels: (s: Sel[]) => void;
  setTab: (t: Tab) => void;
  toast: (m: string) => void;
}

export const RefurbishedView = React.memo(function RefurbishedView({
  products,
  refurbDataset,
  sels,
  setSels,
  setTab,
  toast,
}: RefurbishedViewProps) {
  const [catFilter, setCatFilter] = useState<RefurbCategoryFilter>('all');
  const [sortKey, setSortKey] = useState<RefurbSortKey>('price-asc');
  const [searchQuery, setSearchQuery] = useState('');
  const [onlyBargainVsUsed, setOnlyBargainVsUsed] = useState(false);
  // デフォルトは「現在Apple公式に実在庫がある商品（isLiveStock: true）のみ」を表示
  const [showReferenceItems, setShowReferenceItems] = useState(false);

  // タブを開いた時に /api/refurbished（Apple公式 REFURB_GRID_BOOTSTRAP → Refurb Tracker RSS、エッジキャッシュ15分）から
  // リアルタイムの実在庫を取得。失敗時のみビルド時生成の ./refurbished.json にフォールバックする
  const [liveDataset, setLiveDataset] = useState<RefurbishedDataset | null>(null);
  const [liveStatus, setLiveStatus] = useState<'loading' | 'live' | 'fallback'>('loading');
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/refurbished');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as RefurbishedDataset;
        if (!Array.isArray(data?.items) || data.items.length === 0) throw new Error('empty');
        if (!cancelled) {
          setLiveDataset(data);
          setLiveStatus('live');
        }
      } catch {
        if (!cancelled) setLiveStatus('fallback');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // リアル在庫データを使用し、最新の products 情報（モデル・SKU）と名寄せ・同期補完する。
  // 推定データ（参考整備済相場）は「参考相場も表示」をONにした時のみ補完する
  const allItems = useMemo<RefurbishedItem[]>(() => {
    const dataset = liveDataset ?? refurbDataset;
    const baseItems =
      dataset?.items && dataset.items.length > 0
        ? dataset.items
        : showReferenceItems
          ? buildClientFallbackRefurbishedItems(products)
          : [];

    return baseItems.map((it) => {
      const live = isItemLiveStock(it);
      const matchedProd = products.find((p) => p.id === it.productId);
      const matchedSku = matchedProd?.skus.find((s) => s.id === it.skuId) ?? matchedProd?.skus[0];
      if (!matchedProd || !matchedSku) {
        return {
          ...it,
          isLiveStock: live,
          stockStatus: live ? 'Live' : 'Reference',
        };
      }

      const usedInfo = estimateUsedMarketData(matchedProd, matchedSku);
      const up = usedInfo.usedPricing;
      const usedLowestPrice =
        it.usedLowestPrice != null && it.usedLowestPrice > 0
          ? it.usedLowestPrice
          : up.lowestPrice > 0
            ? up.lowestPrice
            : null;
      const priceGapVsUsed =
        usedLowestPrice != null ? it.refurbishedPrice - usedLowestPrice : it.priceGapVsUsed;

      return {
        ...it,
        isLiveStock: live,
        stockStatus: live ? 'Live' : 'Reference',
        isOriginalDiscontinued:
          it.isOriginalDiscontinued ?? isProductDiscontinued(matchedProd, matchedSku),
        usedLowestPrice,
        priceGapVsUsed,
        specs: {
          soc: it.specs?.soc ?? matchedProd.specs.soc,
          ram: it.specs?.ram ?? matchedProd.specs.ram,
          weight: it.specs?.weight ?? matchedProd.specs.weight,
          releaseYear:
            it.specs?.releaseYear ??
            (parseInt(String(matchedProd.releaseDate ?? '').slice(0, 4), 10) || undefined),
          releaseDate: it.specs?.releaseDate ?? matchedProd.releaseDate,
          display: it.specs?.display ?? matchedProd.specs.display,
          battery: it.specs?.battery ?? matchedProd.specs.battery,
          ports: it.specs?.ports ?? matchedProd.specs.ports,
          os: it.specs?.os ?? matchedProd.specs.os,
        },
      };
    });
  }, [liveDataset, refurbDataset, products, showReferenceItems]);

  // 表示対象プール（デフォルトは isLiveStock === true の実在庫のみ、トグルON時のみ参考相場も合算）
  const activePool = useMemo(() => {
    return showReferenceItems ? allItems : allItems.filter((it) => isItemLiveStock(it));
  }, [allItems, showReferenceItems]);

  // カテゴリ別件数（現在のトグル状態に応じた件数）
  const categoryCounts = useMemo(() => {
    const counts: Record<RefurbCategoryFilter, number> = {
      all: activePool.length,
      Mac: 0,
      iPad: 0,
      iPhone: 0,
      'Apple Watch': 0,
      AirPods: 0,
    };
    for (const it of activePool) {
      if (it.category in counts) {
        counts[it.category as RefurbCategoryFilter]++;
      }
    }
    return counts;
  }, [activePool]);

  // 絞り込み＆ソート後のリスト
  const filteredAndSorted = useMemo(() => {
    const q = searchQuery.trim().normalize('NFKC').toLowerCase();
    const filtered = activePool.filter((it) => {
      if (catFilter !== 'all' && it.category !== catFilter) return false;
      if (onlyBargainVsUsed && (it.priceGapVsUsed == null || it.priceGapVsUsed > 15000)) {
        return false;
      }
      if (q) {
        const hay = `${it.title} ${it.productName} ${it.skuLabel} ${it.specs.soc ?? ''} ${it.specs.ram ?? ''}`
          .normalize('NFKC')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    return [...filtered].sort((a, b) => {
      if (sortKey === 'price-asc') {
        return a.refurbishedPrice - b.refurbishedPrice || b.discountAmount - a.discountAmount;
      }
      if (sortKey === 'discount-desc') {
        return b.discountAmount - a.discountAmount || b.discountPercent - a.discountPercent;
      }
      // 'used-gap-asc': 中古相場との差額が小さい順
      const gapA = a.priceGapVsUsed ?? Number.POSITIVE_INFINITY;
      const gapB = b.priceGapVsUsed ?? Number.POSITIVE_INFINITY;
      return gapA - gapB || a.refurbishedPrice - b.refurbishedPrice;
    });
  }, [activePool, catFilter, onlyBargainVsUsed, searchQuery, sortKey]);

  const stats = useMemo(() => {
    const liveCount = allItems.filter((i) => isItemLiveStock(i)).length;
    const refCount = allItems.length - liveCount;
    const under15kCount = activePool.filter(
      (i) => i.priceGapVsUsed != null && i.priceGapVsUsed <= 15000,
    ).length;
    const maxDiscount = activePool.reduce((m, i) => Math.max(m, i.discountAmount), 0);
    return { liveCount, refCount, under15kCount, maxDiscount };
  }, [allItems, activePool]);

  const handleAddToCompare = (item: RefurbishedItem) => {
    const existsProd = products.find((p) => p.id === item.productId);
    if (!existsProd) {
      toast(`${item.productName} のマスターデータが見つかりません`);
      return;
    }
    const targetSid =
      existsProd.skus.find((s) => s.id === item.skuId)?.id ?? existsProd.skus[0]?.id ?? item.skuId;
    const alreadyInSels = sels.some((s) => s.pid === existsProd.id);
    if (alreadyInSels) {
      setSels(sels.map((s) => (s.pid === existsProd.id ? { pid: existsProd.id, sid: targetSid } : s)));
      toast(`${existsProd.name} (${item.skuLabel}) の比較SKUを更新しました`);
    } else {
      setSels([...sels, { pid: existsProd.id, sid: targetSid }]);
      toast(`${existsProd.name} (${item.skuLabel}) をメイン比較表に追加しました`);
    }
  };

  const categoryTabs: { id: RefurbCategoryFilter; label: string }[] = [
    { id: 'all', label: 'すべて' },
    { id: 'Mac', label: 'Mac' },
    { id: 'iPad', label: 'iPad' },
    { id: 'iPhone', label: 'iPhone' },
    { id: 'Apple Watch', label: 'Apple Watch' },
    { id: 'AirPods', label: 'AirPods' },
  ];

  const sortOptions: { id: RefurbSortKey; label: string }[] = [
    { id: 'price-asc', label: '価格が安い順' },
    { id: 'discount-desc', label: '新品からの割引額が大きい順' },
    { id: 'used-gap-asc', label: '中古相場との差額が小さい順' },
  ];

  return (
    <div className="space-y-5 sm:space-y-6">
      {/* ヘッダー＆コントロールカード */}
      <div className={`${card} p-5 sm:p-6`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <SectionTitle
            icon={<Apple className="h-5 w-5" />}
            title="Apple認定整備済品 × 新品定価 × 中古最安値 完全比較"
            desc={`Apple公式整備済ページの現在庫（window.REFURB_GRID_BOOTSTRAP）・Refurb TrackerのRSSフィードと、当サイトDB（新品定価・詳細スペック・楽天/Yahoo!中古最安値）を自動名寄せして横断比較します。${liveStatus === 'loading' ? '（最新在庫を取得中…）' : liveStatus === 'live' ? '（リアルタイム取得）' : '（定期更新データを表示中）'}`}
          />
          <div className="flex flex-wrap items-center gap-2.5 ml-auto">
            <a
              href={
                catFilter !== 'all'
                  ? (APPLE_REFURB_CATEGORY_URLS[catFilter] ?? 'https://www.apple.com/jp/shop/refurbished')
                  : 'https://www.apple.com/jp/shop/refurbished'
              }
              target="_blank"
              rel="noopener noreferrer"
              className={secondaryActionBtnCls}
            >
              <Apple className="h-4 w-4 shrink-0" />
              <span>Apple公式 認定整備済製品ストア</span>
              <ExternalLink className="h-3.5 w-3.5 shrink-0" />
            </a>
          </div>
        </div>

        {/* サマリー統計バー */}
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-2xl bg-[#f5f5f7] px-4 py-3.5 dark:bg-[#23252b]">
            <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">現在Apple公式の実在庫数</div>
            <div className="mt-1 text-base sm:text-lg font-bold tabular-nums text-[#3d6b4e] dark:text-[#88b396]">
              {stats.liveCount} <span className="text-xs font-semibold text-zinc-500">構成</span>
            </div>
            <div className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
              {showReferenceItems
                ? `参考整備済相場 (+${stats.refCount}件) も表示中`
                : `定番モデルの参考相場: 別途 ${stats.refCount}件`}
            </div>
          </div>

          <div className="rounded-2xl bg-[#f5f5f7] px-4 py-3.5 dark:bg-[#23252b]">
            <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">新品定価からの最大割引額</div>
            <div className="mt-1 text-base sm:text-lg font-bold tabular-nums text-zinc-900 dark:text-zinc-100">
              −{yen(stats.maxDiscount)} <span className="text-xs font-semibold text-zinc-500">(約15% OFF〜)</span>
            </div>
            <div className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
              Apple純正パーツ交換・徹底クリーニング済
            </div>
          </div>

          <div className="rounded-2xl bg-[#f5f5f7] px-4 py-3.5 dark:bg-[#23252b]">
            <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">整備済品が圧倒的にお得な機種</div>
            <div className="mt-1 text-base sm:text-lg font-bold tabular-nums text-[#3d6b4e] dark:text-[#88b396]">
              {stats.under15kCount} <span className="text-xs font-semibold">モデル</span>
            </div>
            <div className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
              中古最安との差額 ＋¥15,000 以内
            </div>
          </div>

          <div className="rounded-2xl bg-[#f5f5f7] px-4 py-3.5 dark:bg-[#23252b]">
            <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Apple認定整備済品の特典</div>
            <div className="mt-1 text-sm font-bold text-zinc-900 dark:text-zinc-100">
              新品バッテリー・外装 ＆ 1年保証
            </div>
            <div className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
              AppleCare+ 加入可・全付属品同梱
            </div>
          </div>
        </div>

        {/* 上部フィルタ：カテゴリ絞り込み（すべて / Mac / iPad / iPhone / Apple Watch / AirPods） */}
        <div className="mt-5 space-y-3.5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-0.5">
              {categoryTabs.map((c) => {
                const active = catFilter === c.id;
                const count = categoryCounts[c.id] ?? 0;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setCatFilter(c.id)}
                    className={`inline-flex items-center gap-2 whitespace-nowrap rounded-xl px-3.5 py-2 text-xs sm:text-sm font-semibold transition ${
                      active
                        ? 'bg-zinc-900 text-zinc-100 shadow-2xs dark:bg-zinc-200 dark:text-zinc-900'
                        : 'bg-[#f5f5f7] text-zinc-700 hover:bg-zinc-200/70 dark:bg-[#23252b] dark:text-zinc-300 dark:hover:bg-[#2c2f36]'
                    }`}
                  >
                    {c.id !== 'all' && <CatIcon cat={c.id} className="h-3.5 w-3.5 shrink-0" />}
                    <span>{c.label}</span>
                    <span
                      className={`rounded-full px-1.5 py-0.5 text-xs font-bold tabular-nums ${
                        active
                          ? 'bg-white/20 text-zinc-100 dark:bg-zinc-900/15 dark:text-zinc-900'
                          : 'bg-zinc-200/70 text-zinc-600 dark:bg-[#1c1d22] dark:text-zinc-300'
                      }`}
                    >
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* キーワード検索 ＆ 1.5万円以内フィルタ ＆ 在庫なしモデルの参考整備済相場トグル */}
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="relative flex-1 sm:w-56 sm:flex-initial">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="モデル名・チップ(M3/M4/A18)で検索..."
                  className="w-full rounded-xl bg-[#f5f5f7] py-2 pl-9 pr-8 text-xs sm:text-sm text-zinc-900 outline-none focus:ring-2 focus:ring-zinc-400/50 dark:bg-[#23252b] dark:text-zinc-100"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    aria-label="検索クリア"
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>

              <button
                type="button"
                onClick={() => setOnlyBargainVsUsed((v) => !v)}
                className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl px-3.5 py-2 text-xs font-semibold transition ${
                  onlyBargainVsUsed
                    ? 'bg-zinc-900 text-zinc-100 dark:bg-zinc-200 dark:text-zinc-900'
                    : 'bg-[#f5f5f7] text-zinc-700 hover:bg-zinc-200/70 dark:bg-[#23252b] dark:text-zinc-300 dark:hover:bg-[#2c2f36]'
                }`}
              >
                <Sparkles className="h-3.5 w-3.5 shrink-0" />
                <span>中古差額1.5万円以内のみ</span>
              </button>

              <button
                type="button"
                aria-pressed={showReferenceItems}
                onClick={() => setShowReferenceItems((v) => !v)}
                className={`inline-flex items-center gap-2 whitespace-nowrap rounded-xl px-3.5 py-2 text-xs font-semibold transition ${
                  showReferenceItems
                    ? 'bg-zinc-900 text-zinc-100 shadow-2xs dark:bg-zinc-200 dark:text-zinc-900'
                    : 'bg-[#f5f5f7] text-zinc-700 hover:bg-zinc-200/70 dark:bg-[#23252b] dark:text-zinc-300 dark:hover:bg-[#2c2f36]'
                }`}
              >
                <span
                  className={`h-2 w-2 rounded-full ${
                    showReferenceItems ? 'bg-[#649274]' : 'bg-zinc-400 dark:bg-zinc-500'
                  }`}
                />
                <span>在庫なしモデルの参考整備済相場も表示</span>
                <span
                  className={`rounded-full px-1.5 py-0.5 text-xs font-bold tabular-nums ${
                    showReferenceItems
                      ? 'bg-white/20 text-zinc-100 dark:bg-zinc-900/15 dark:text-zinc-900'
                      : 'bg-zinc-200/70 text-zinc-600 dark:bg-[#1c1d22] dark:text-zinc-300'
                  }`}
                >
                  {showReferenceItems ? 'ON' : `OFF (+${stats.refCount}件)`}
                </span>
              </button>
            </div>
          </div>

          {/* 並び替え（価格が安い順 / 新品からの割引額が大きい順 / 中古相場との差額が小さい順） */}
          <div className="flex flex-wrap items-center justify-between gap-2.5 pt-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 mr-1">並び替え:</span>
              {sortOptions.map((opt) => {
                const active = sortKey === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setSortKey(opt.id)}
                    className={`inline-flex items-center gap-1 whitespace-nowrap rounded-xl px-3 py-1.5 text-xs font-semibold transition ${
                      active
                        ? 'bg-zinc-900 text-zinc-100 dark:bg-zinc-200 dark:text-zinc-900'
                        : 'bg-[#f5f5f7] text-zinc-600 hover:bg-zinc-200/70 dark:bg-[#23252b] dark:text-zinc-300 dark:hover:bg-[#2c2f36]'
                    }`}
                  >
                    <span>{opt.label}</span>
                  </button>
                );
              })}
            </div>
            <div className="text-xs sm:text-sm text-zinc-500 dark:text-zinc-400 tabular-nums">
              表示中 ({showReferenceItems ? '実在庫＋参考相場' : 'Apple公式 実在庫のみ'}):{' '}
              <strong className="font-bold text-zinc-900 dark:text-zinc-100">{filteredAndSorted.length}</strong> 件
            </div>
          </div>
        </div>
      </div>

      {/* アイテムカード一覧 */}
      {filteredAndSorted.length === 0 ? (
        <div className={`${card} p-8 sm:p-10 text-center space-y-3.5`}>
          <div className="text-sm sm:text-base font-semibold text-zinc-700 dark:text-zinc-200">
            {!showReferenceItems
              ? '現在この条件でApple公式ストアに実在庫がある認定整備済製品はありません。'
              : '条件に一致するApple認定整備済製品が見つかりませんでした。'}
          </div>
          <p className="text-xs sm:text-sm text-zinc-500 dark:text-zinc-400">
            {!showReferenceItems
              ? '「在庫なしモデルの参考整備済相場も表示」をONにすると、定番モデルの参考整備済相場（約15%OFF）と中古最安値を比較できます。'
              : 'カテゴリや検索キーワードを変更してお試しください。'}
          </p>
          {!showReferenceItems && stats.refCount > 0 && (
            <div className="pt-1">
              <button
                type="button"
                onClick={() => setShowReferenceItems(true)}
                className="inline-flex items-center gap-1.5 rounded-xl bg-zinc-900 px-4 py-2.5 text-xs font-bold text-zinc-100 shadow-2xs transition hover:bg-zinc-800 dark:bg-zinc-200 dark:text-zinc-900 dark:hover:bg-zinc-300"
              >
                <span>在庫なしモデルの参考整備済相場も表示（+{stats.refCount}件）</span>
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {filteredAndSorted.map((item) => {
            const inCompare = sels.some((s) => s.pid === item.productId && s.sid === item.skuId);
            const inCompareProduct = sels.some((s) => s.pid === item.productId);
            const gap = item.priceGapVsUsed;
            const isRefurbBargainVsUsed = gap != null && gap <= 15000;
            const isUsedMuchCheaper = gap != null && gap >= 30000;
            const isLive = isItemLiveStock(item);

            return (
              <div
                key={item.id}
                className={`${card} flex flex-col justify-between p-5 sm:p-6 transition`}
              >
                <div>
                  {/* 上部ステータス＆カテゴリ＆スペックバッジ */}
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-2.5 py-1 text-xs font-bold text-zinc-100 dark:bg-zinc-200 dark:text-zinc-900">
                        <CatIcon cat={item.category} className="h-3.5 w-3.5 shrink-0" />
                        <span>{item.category}</span>
                      </span>
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold ${
                          isLive
                            ? 'bg-[#eaf2ed] text-[#3d6b4e] dark:bg-[#1e2b24] dark:text-[#88b396]'
                            : 'bg-zinc-100 text-zinc-600 dark:bg-[#25272e] dark:text-zinc-300'
                        }`}
                      >
                        <span
                          className={`h-2 w-2 rounded-full ${
                            isLive ? 'bg-[#649274]' : 'bg-zinc-400'
                          }`}
                        />
                        <span>{item.stockLabel || (isLive ? 'Apple公式 在庫あり' : '参考整備済相場（在庫なし）')}</span>
                      </span>
                      {item.specs.releaseYear && (
                        <span className="rounded-lg bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-600 dark:bg-[#25272e] dark:text-zinc-300">
                          {item.specs.releaseYear}年発売
                        </span>
                      )}
                    </div>

                    {/* 割引率ピルバッジ */}
                    <span className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-3 py-1 text-xs font-bold tabular-nums text-zinc-800 dark:bg-[#25272e] dark:text-zinc-200">
                      新品比 −{yen(item.discountAmount)} ({item.discountPercent.toFixed(1)}% OFF)
                    </span>
                  </div>

                  {/* 製品名・SKU・正規化タイトル */}
                  <div className="mt-3">
                    <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                      <h3 className="text-base sm:text-lg font-bold leading-snug text-zinc-900 dark:text-zinc-100">
                        {item.productName}
                      </h3>
                      <span className="rounded-lg bg-zinc-100 px-2.5 py-0.5 text-xs font-semibold text-zinc-800 dark:bg-[#25272e] dark:text-zinc-200">
                        {item.skuLabel}
                      </span>
                    </div>
                    <p className="mt-1 text-xs sm:text-sm text-zinc-500 dark:text-zinc-400 line-clamp-1">
                      {item.title}
                    </p>
                  </div>

                  {/* 既存DB (products.json) から注入された詳細スペック */}
                  <div className="mt-3 flex flex-wrap gap-2 text-xs text-zinc-600 dark:text-zinc-300">
                    {item.specs.soc && (
                      <span className="inline-flex items-center gap-1 rounded-lg bg-[#f5f5f7] px-2.5 py-1 dark:bg-[#23252b]">
                        <span className="text-zinc-400">SoC:</span>
                        <strong className="font-semibold">{item.specs.soc.split(' (')[0]}</strong>
                      </span>
                    )}
                    {item.specs.ram && (
                      <span className="inline-flex items-center gap-1 rounded-lg bg-[#f5f5f7] px-2.5 py-1 dark:bg-[#23252b]">
                        <span className="text-zinc-400">RAM:</span>
                        <strong className="font-semibold">{item.specs.ram}</strong>
                      </span>
                    )}
                    {item.storage && (
                      <span className="inline-flex items-center gap-1 rounded-lg bg-[#f5f5f7] px-2.5 py-1 dark:bg-[#23252b]">
                        <span className="text-zinc-400">構成:</span>
                        <strong className="font-semibold">{item.storage}</strong>
                      </span>
                    )}
                    {item.connectivity && item.connectivity !== '-' && (
                      <span className="inline-flex items-center gap-1 rounded-lg bg-[#f5f5f7] px-2.5 py-1 dark:bg-[#23252b]">
                        <span className="text-zinc-400">通信:</span>
                        <strong className="font-semibold">{item.connectivity}</strong>
                      </span>
                    )}
                    {item.specs.weight && (
                      <span className="inline-flex items-center gap-1 rounded-lg bg-[#f5f5f7] px-2.5 py-1 dark:bg-[#23252b]">
                        <span className="text-zinc-400">重量:</span>
                        <strong className="font-semibold">{item.specs.weight.split(' / ')[0]}</strong>
                      </span>
                    )}
                  </div>

                  {/* ① Apple認定整備済品価格 / ② 参考：Apple新品定価 / ③ 当サイトの中古最安値 の3価格横並び表示 */}
                  <div className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                    {/* ① Apple認定整備済品価格（メイン表示） */}
                    <div className="rounded-xl bg-[#f5f5f7] p-3.5 dark:bg-[#25272e]">
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-xs font-bold text-zinc-900 dark:text-zinc-100">
                          ① Apple認定整備済品
                        </span>
                        <span className="rounded-md bg-zinc-900 px-1.5 py-0.5 text-xs font-bold text-zinc-100 dark:bg-zinc-200 dark:text-zinc-900">
                          {item.discountPercent.toFixed(0)}% OFF
                        </span>
                      </div>
                      <div className="mt-1.5 text-xl font-bold tabular-nums tracking-tight text-zinc-900 dark:text-zinc-100">
                        {yen(item.refurbishedPrice)}
                      </div>
                      <div className="mt-1 text-xs font-semibold tabular-nums text-[#3d6b4e] dark:text-[#88b396]">
                        新品比 −{yen(item.discountAmount)} ({item.discountPercent.toFixed(1)}% OFF)
                      </div>
                    </div>

                    {/* ② 参考：Apple新品定価（または終売時最終価格） */}
                    <div className="rounded-xl bg-[#f5f5f7]/70 p-3.5 dark:bg-[#23252b]/70">
                      <div className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">
                        ② 参考：{item.isOriginalDiscontinued ? '終売時最終価格' : 'Apple新品定価'}
                      </div>
                      <div className="mt-1.5 text-base sm:text-lg font-bold tabular-nums text-zinc-600 line-through decoration-zinc-400 dark:text-zinc-300">
                        {yen(item.originalNewPrice)}
                      </div>
                      <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                        {item.isOriginalDiscontinued
                          ? 'Apple Store新品は販売終了'
                          : 'Apple Store現行新品価格'}
                      </div>
                    </div>

                    {/* ③ 当サイトの中古最安値（イオシス・じゃんぱら等の楽天/Yahoo!最安） */}
                    <div className="rounded-xl bg-[#f5f5f7]/70 p-3.5 dark:bg-[#23252b]/70">
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">
                          ③ 当サイト中古最安値
                        </span>
                        {item.usedUrl && (
                          <a
                            href={toMoshimoUrl(item.usedUrl)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-0.5 text-xs font-semibold text-zinc-600 underline hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                          >
                            <span>詳細</span>
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                      </div>
                      <div className="mt-1.5 text-base sm:text-lg font-bold tabular-nums text-zinc-800 dark:text-zinc-100">
                        {item.usedLowestPrice != null ? yen(item.usedLowestPrice) : '—'}
                      </div>
                      <div className="mt-1 truncate text-xs text-zinc-500 dark:text-zinc-400" title={item.usedShopName}>
                        {gap != null
                          ? `整備済との差額: ${gap >= 0 ? `+${yen(gap)}` : signedYen(gap)}`
                          : item.usedShopName}
                      </div>
                    </div>
                  </div>

                  {/* 差額に応じたおすすめ判定バッジ */}
                  {item.usedLowestPrice != null && gap != null && (
                    <div className="mt-3.5">
                      {isRefurbBargainVsUsed ? (
                        <div className="rounded-xl bg-[#eaf2ed]/75 px-3.5 py-2.5 text-xs font-semibold leading-relaxed text-[#3d6b4e] dark:bg-[#1e2b24]/75 dark:text-[#88b396]">
                          <span className="mr-1.5 inline-block rounded-md bg-[#487558] px-2 py-0.5 text-xs font-bold text-zinc-100 dark:bg-[#649274] dark:text-zinc-950">
                            おすすめ
                          </span>
                          {gap > 0
                            ? `中古最安に＋${yen(gap)}足すだけでApple公式の新品バッテリー・外装・1年保証が付くため整備済品が圧倒的にお得！`
                            : `中古最安（${yen(item.usedLowestPrice)}）と同等以下の価格で、Apple公式の新品バッテリー・外装・1年保証が付くため整備済品が圧倒的にお得！`}
                        </div>
                      ) : isUsedMuchCheaper ? (
                        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[#f5f5f7] px-3.5 py-2.5 text-xs font-semibold leading-relaxed text-zinc-700 dark:bg-[#23252b] dark:text-zinc-300">
                          <div>
                            <span className="mr-1.5 inline-block rounded-md bg-zinc-700 px-2 py-0.5 text-xs font-bold text-zinc-100 dark:bg-zinc-300 dark:text-zinc-900">
                              コスパ比較
                            </span>
                            コスパ重視なら中古ショップ（{yen(item.usedLowestPrice)}）の方が大幅に安上がり
                            <span className="ml-1 text-xs font-normal text-zinc-500 dark:text-zinc-400">
                              （差額 −{yen(gap)} / {item.usedShopName}）
                            </span>
                          </div>
                          {item.usedUrl && (
                            <a
                              href={toMoshimoUrl(item.usedUrl)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 whitespace-nowrap text-xs font-bold text-zinc-900 underline hover:opacity-80 dark:text-zinc-100"
                            >
                              <span>中古最安を見る</span>
                              <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                            </a>
                          )}
                        </div>
                      ) : (
                        <div className="rounded-xl bg-[#f5f5f7] px-3.5 py-2.5 text-xs leading-relaxed text-zinc-600 dark:bg-[#23252b] dark:text-zinc-400">
                          中古最安（{yen(item.usedLowestPrice)}）との差額は{' '}
                          <strong className="font-bold text-zinc-800 dark:text-zinc-200">
                            ＋{yen(gap)}
                          </strong>
                          。初期費用を抑えるなら中古、新品バッテリー・外装＆Apple公式1年保証を重視するなら認定整備済品がおすすめです。
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* 下部アクションボタン: 「Apple公式整備済ページへ」 ＆ 「この機種をメイン比較表に追加」 */}
                <div className="mt-4 flex flex-wrap items-center gap-2.5 pt-2">
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl bg-zinc-900 px-3.5 py-2.5 text-xs font-bold text-zinc-100 shadow-2xs transition hover:bg-zinc-800 active:scale-[0.99] dark:bg-zinc-200 dark:text-zinc-900 dark:hover:bg-zinc-300"
                  >
                    <Apple className="h-3.5 w-3.5 shrink-0" />
                    <span>{isLive ? 'Apple公式整備済ページへ' : 'Apple公式で在庫を確認'}</span>
                    <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                  </a>

                  <button
                    type="button"
                    onClick={() => handleAddToCompare(item)}
                    className={`${secondaryActionBtnCls} flex-1 !py-2.5 ${
                      inCompare
                        ? '!bg-zinc-200/80 dark:!bg-zinc-700'
                        : ''
                    }`}
                  >
                    <span>
                      {inCompare
                        ? '✓ メイン比較表に追加済'
                        : inCompareProduct
                          ? '↻ この容量で比較表を更新'
                          : '＋ この機種をメイン比較表に追加'}
                    </span>
                  </button>

                  {inCompareProduct && (
                    <button
                      type="button"
                      onClick={() => {
                        setTab('compare');
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                      }}
                      className={`${secondaryActionBtnCls} !py-2.5`}
                      title="メイン比較表タブを開く"
                    >
                      <Scale className="h-3.5 w-3.5 shrink-0" />
                      <span>比較表へ</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});

export default RefurbishedView;
