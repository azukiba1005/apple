import React, { useMemo, useState } from 'react';
import {
  Apple,
  Check,
  ChevronDown,
  ChevronUp,
  Coins,
  ExternalLink,
  FileSpreadsheet,
  Headphones,
  Info,
  Laptop,
  Scale,
  Search,
  ShoppingBag,
  Smartphone,
  Sparkles,
  Tablet,
  Trophy,
  Watch,
  X,
} from 'lucide-react';
import {
  buildXlsx,
  DEFAULT_LATEST_USD_JPY,
  taxRateAt,
  type PricePoint,
} from './App';
import {
  ACCESSORIES_CATALOG,
  ACCESSORY_CATEGORIES,
  ACCESSORY_COMPARISON_PRESETS,
  DEVICE_COMPAT_GROUPS,
  type AccessoryCategoryId,
  type AccessoryItem,
  type AccessorySku,
  type AccessoryTier,
  type DeviceCompatGroupId,
} from './accessoriesData';

const yen = (n: number | null | undefined) =>
  n == null ? '—' : `¥${Math.round(n).toLocaleString('ja-JP')}`;
const signedYen = (n: number) =>
  `${n > 0 ? '+' : n < 0 ? '−' : '±'}¥${Math.abs(Math.round(n)).toLocaleString('ja-JP')}`;
const signedPct = (n: number) =>
  `${n > 0 ? '+' : n < 0 ? '−' : '±'}${Math.abs(n).toFixed(1)}%`;

const cardCls =
  'rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800/80 dark:bg-zinc-900/50';
const selectCls =
  'rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-sm text-zinc-900 outline-none focus:ring-2 focus:ring-zinc-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100';
const btnCls =
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-zinc-200 bg-zinc-100 px-3 py-1.5 text-xs sm:text-sm font-medium text-zinc-700 transition hover:bg-zinc-200 active:scale-[0.99] dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700';

type TierFilter = 'all' | AccessoryTier | 'beats-collab';
type SortKey = 'recommended' | 'price-asc' | 'price-desc' | 'hike-desc' | 'release-desc';

function evalAccessoryFx(sku: AccessorySku, latestUsdJpy = DEFAULT_LATEST_USD_JPY) {
  const lastPt: PricePoint | undefined = sku.priceHistory[sku.priceHistory.length - 1];
  const usd = sku.usdPrice ?? lastPt?.usdPrice;
  if (!usd || usd <= 0) return null;
  const tax = lastPt?.taxRate ?? (lastPt ? taxRateAt(lastPt.date) : 0.1);
  const impliedRate = Math.round((sku.currentPrice / (1 + tax) / usd) * 10) / 10;
  const fairJpy = Math.round(usd * latestUsdJpy * 1.1);
  const diffJpy = sku.currentPrice - fairJpy;
  const pctDiff = ((sku.currentPrice - fairJpy) / fairJpy) * 100;
  const status: 'bargain' | 'expensive' | 'fair' =
    pctDiff <= -2 ? 'bargain' : pctDiff >= 2 ? 'expensive' : 'fair';
  return { usd, impliedRate, fairJpy, diffJpy, pctDiff, status };
}

function downloadAccessoriesExcel(items: AccessoryItem[]) {
  const rows: (string | number | { v: string | number; k?: 'yen' | 'yenBest' | 'int' | 'dec' | 'pct' | 'yenDiff' })[][] = [
    [
      '区分',
      'サブ区分',
      'ブランド',
      'カテゴリ',
      '製品名',
      'モデル / SKU',
      '型番',
      '発売時価格(税込)',
      '現在価格(税込)',
      '実勢最安目安(税込)',
      '発売比差額',
      '米国価格(USD)',
      '実質Appleレート(円/$)',
      '接続・仕様',
      '主な対応機種',
      '認証・保証',
    ],
  ];

  items.forEach((item) => {
    const catLabel = ACCESSORY_CATEGORIES.find((c) => c.id === item.category)?.label ?? item.category;
    item.skus.forEach((sku) => {
      const diff = sku.currentPrice - sku.launchPrice;
      const fx = evalAccessoryFx(sku);
      rows.push([
        item.tier === 'genuine' ? 'Apple純正' : '準純正',
        item.subTypeLabel,
        item.brand,
        catLabel,
        item.name,
        sku.label,
        sku.modelNumber ?? '—',
        { v: sku.launchPrice, k: 'yen' },
        { v: sku.currentPrice, k: 'yen' },
        sku.marketEstimatePrice != null ? { v: sku.marketEstimatePrice, k: 'yenBest' } : '—',
        diff !== 0 ? { v: diff, k: 'yenDiff' } : '±¥0',
        fx?.usd != null ? { v: fx.usd, k: 'dec' } : '—',
        fx?.impliedRate != null ? { v: fx.impliedRate, k: 'dec' } : '—',
        item.connection,
        item.compatDevices.join(' / '),
        item.certification ?? '—',
      ]);
    });
  });

  const bytes = buildXlsx([{ name: 'Apple純正・準純正アクセサリー', rows, freezeRows: 1, freezeCols: 5 }]);
  const blob = new Blob([bytes], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `apple-accessories-atlas-${new Date().toISOString().slice(0, 10)}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function TierBadge({ item }: { item: AccessoryItem }) {
  if (item.tier === 'genuine') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-zinc-900 px-2.5 py-0.5 text-[11px] font-semibold text-white dark:bg-zinc-100 dark:text-zinc-900">
        <Apple className="h-3 w-3" />
        {item.subTypeLabel}
      </span>
    );
  }
  if (item.subType === 'apple-owned-beats') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-rose-300 bg-rose-50 px-2.5 py-0.5 text-[11px] font-semibold text-rose-800 dark:border-rose-800/80 dark:bg-rose-950/50 dark:text-rose-200">
        <Headphones className="h-3 w-3" />
        {item.subTypeLabel}
      </span>
    );
  }
  if (item.subType === 'apple-store-partner') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-sky-300 bg-sky-50 px-2.5 py-0.5 text-[11px] font-semibold text-sky-800 dark:border-sky-800/80 dark:bg-sky-950/50 dark:text-sky-200">
        <Sparkles className="h-3 w-3" />
        {item.subTypeLabel}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300 bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-800 dark:border-emerald-800/80 dark:bg-emerald-950/50 dark:text-emerald-200">
      <Check className="h-3 w-3" />
      {item.subTypeLabel}
    </span>
  );
}

export function AccessoriesView({ toast }: { toast: (m: string) => void }) {
  const [tierFilter, setTierFilter] = useState<TierFilter>('all');
  const [categoryFilter, setCategoryFilter] = useState<AccessoryCategoryId | 'all'>('all');
  const [compatFilter, setCompatFilter] = useState<DeviceCompatGroupId | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('recommended');
  const [selectedSkuMap, setSelectedSkuMap] = useState<Record<string, string>>({});
  const [compareIds, setCompareIds] = useState<string[]>([
    'apple-pencil-pro',
    'apple-pencil-usbc',
    'logicool-crayon-usbc',
  ]);
  const [activePresetId, setActivePresetId] = useState<string>('ipad-pencil-compare');
  const [expandedHistoryMap, setExpandedHistoryMap] = useState<Record<string, boolean>>({});
  const [guideOpen, setGuideOpen] = useState(false);

  const activeCompatMeta = useMemo(
    () => DEVICE_COMPAT_GROUPS.find((g) => g.id === compatFilter) ?? DEVICE_COMPAT_GROUPS[0],
    [compatFilter],
  );

  const getActiveSku = (item: AccessoryItem): AccessorySku => {
    const sid = selectedSkuMap[item.id];
    return item.skus.find((s) => s.id === sid) ?? item.skus[0];
  };

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().normalize('NFKC').toLowerCase();
    const list = ACCESSORIES_CATALOG.filter((item) => {
      if (tierFilter === 'genuine' && item.tier !== 'genuine') return false;
      if (tierFilter === 'semi-genuine' && item.tier !== 'semi-genuine') return false;
      if (
        tierFilter === 'beats-collab' &&
        item.subType !== 'apple-owned-beats' &&
        item.subType !== 'apple-collab' &&
        !item.brand.includes('Hermès') &&
        !item.brand.includes('Nike')
      ) {
        return false;
      }
      if (categoryFilter !== 'all' && item.category !== categoryFilter) return false;
      if (compatFilter !== 'all' && !item.compatGroups.includes(compatFilter)) return false;
      if (q) {
        const hay = [
          item.name,
          item.brand,
          item.subTypeLabel,
          item.connection,
          ...item.compatDevices,
          ...item.highlights,
          ...item.skus.map((s) => `${s.label} ${s.modelNumber ?? ''}`),
        ]
          .join(' ')
          .normalize('NFKC')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    const sorted = [...list];
    if (sortKey === 'price-asc') {
      sorted.sort((a, b) => getActiveSku(a).currentPrice - getActiveSku(b).currentPrice);
    } else if (sortKey === 'price-desc') {
      sorted.sort((a, b) => getActiveSku(b).currentPrice - getActiveSku(a).currentPrice);
    } else if (sortKey === 'hike-desc') {
      sorted.sort((a, b) => {
        const da = getActiveSku(a).currentPrice - getActiveSku(a).launchPrice;
        const db = getActiveSku(b).currentPrice - getActiveSku(b).launchPrice;
        return db - da;
      });
    } else if (sortKey === 'release-desc') {
      sorted.sort((a, b) => b.releaseDate.localeCompare(a.releaseDate));
    }
    return sorted;
  }, [tierFilter, categoryFilter, compatFilter, searchQuery, sortKey, selectedSkuMap]);

  const summaryStats = useMemo(() => {
    const genuineCount = ACCESSORIES_CATALOG.filter((x) => x.tier === 'genuine').length;
    const semiCount = ACCESSORIES_CATALOG.filter((x) => x.tier === 'semi-genuine').length;
    const totalSkuCount = ACCESSORIES_CATALOG.reduce((acc, x) => acc + x.skus.length, 0);
    return { total: ACCESSORIES_CATALOG.length, genuineCount, semiCount, totalSkuCount };
  }, []);

  const compareItems = useMemo(
    () =>
      compareIds
        .map((id) => ACCESSORIES_CATALOG.find((x) => x.id === id))
        .filter((x): x is AccessoryItem => Boolean(x)),
    [compareIds],
  );

  const activePreset = useMemo(
    () => ACCESSORY_COMPARISON_PRESETS.find((p) => p.id === activePresetId),
    [activePresetId],
  );

  const toggleCompare = (id: string) => {
    setActivePresetId('');
    setCompareIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 4) {
        toast('比較トレーは最大4製品までです（先頭を入れ替えました）');
        return [...prev.slice(1), id];
      }
      return [...prev, id];
    });
  };

  const applyPreset = (presetId: string) => {
    const preset = ACCESSORY_COMPARISON_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    setActivePresetId(preset.id);
    setCompareIds(preset.itemIds);
  };

  const jumpToAlternative = (altId: string) => {
    const alt = ACCESSORIES_CATALOG.find((x) => x.id === altId);
    if (!alt) return;
    setTierFilter('all');
    setCategoryFilter(alt.category);
    setCompatFilter('all');
    setSearchQuery('');
    const el = document.getElementById(`acc-card-${alt.id}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else {
      window.setTimeout(() => {
        document.getElementById(`acc-card-${alt.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 100);
    }
  };

  return (
    <div className="space-y-5">
      {/* 1. ヒーロー＆統計サマリー */}
      <section className={`${cardCls} p-4 sm:p-6`}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-1.5">
            <div className="inline-flex items-center gap-2 rounded-full bg-sky-500/10 px-3 py-1 text-xs font-semibold text-sky-600 dark:bg-sky-400/10 dark:text-sky-300">
              <ShoppingBag className="h-3.5 w-3.5" />
              Apple 純正 ＆ 準純正（Apple Store公式取扱・MFi / Qi2 / Beats）完全網羅カタログ
            </div>
            <h1 className="text-lg sm:text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
              Apple 純正・準純正アクセサリー図鑑 ＆ 互換性・価格比較
            </h1>
            <p className="text-xs sm:text-sm text-zinc-600 dark:text-zinc-400">
              Apple純正品（{summaryStats.genuineCount}シリーズ）と、Beats・Logicool・Belkin・Anker・Hermès等の準純正品（
              {summaryStats.semiCount}シリーズ / 全{summaryStats.totalSkuCount} SKU）の発売時価格・円安改定履歴・米国ドル換算・対応機種を一覧比較できます。
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setGuideOpen((v) => !v)}
              className={btnCls}
            >
              <Info className="h-4 w-4 text-sky-500" />
              <span>純正と準純正の違いとは？</span>
              {guideOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </button>
            <button
              type="button"
              onClick={() => {
                downloadAccessoriesExcel(filteredItems);
                toast(`アクセサリー一覧（${filteredItems.length}シリーズ）をExcel出力しました`);
              }}
              className={btnCls}
            >
              <FileSpreadsheet className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              <span>Excel (.xlsx) 出力</span>
            </button>
          </div>
        </div>

        {/* 純正 vs 準純正の定義ガイド（折りたたみ） */}
        {guideOpen && (
          <div className="mt-4 grid gap-3 rounded-xl border border-zinc-200/80 bg-zinc-50/80 p-3.5 sm:grid-cols-4 dark:border-zinc-800 dark:bg-zinc-950/60">
            <div className="rounded-lg bg-white p-3 border border-zinc-200/70 dark:bg-zinc-900 dark:border-zinc-800">
              <div className="text-xs font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
                <Apple className="h-3.5 w-3.5" /> ① Apple 純正
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-zinc-600 dark:text-zinc-400">
                Apple自身が設計・販売。H2/U1チップやSmart Connector、Touch ID、25W MagSafeなどOSレベルの独自連携が最大の強み。
              </p>
            </div>
            <div className="rounded-lg bg-white p-3 border border-zinc-200/70 dark:bg-zinc-900 dark:border-zinc-800">
              <div className="text-xs font-bold text-rose-700 dark:text-rose-300 flex items-center gap-1.5">
                <Headphones className="h-3.5 w-3.5" /> ② Beats / 公式コラボ
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-zinc-600 dark:text-zinc-400">
                Apple完全子会社の『Beats by Dre』や『Apple × Hermès / Nike』。H1チップや「探す」、サファイアクリスタル製カメラコントロールなどを共有。
              </p>
            </div>
            <div className="rounded-lg bg-white p-3 border border-zinc-200/70 dark:bg-zinc-900 dark:border-zinc-800">
              <div className="text-xs font-bold text-sky-700 dark:text-sky-300 flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5" /> ③ Apple Store 公式パートナー
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-zinc-600 dark:text-zinc-400">
                Logicool（Combo Touch / Crayon）やBelkin（UltraGlass 2 / BoostCharge Pro）など、Appleと共同開発され直営店で販売される準純正品。
              </p>
            </div>
            <div className="rounded-lg bg-white p-3 border border-zinc-200/70 dark:bg-zinc-900 dark:border-zinc-800">
              <div className="text-xs font-bold text-emerald-700 dark:text-emerald-300 flex items-center gap-1.5">
                <Check className="h-3.5 w-3.5" /> ④ MFi / Qi2 / Find My 認証
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-zinc-600 dark:text-zinc-400">
                Anker等の『Qi2 15W』『Made for Apple Watch』『Works with Apple Find My』公式認証モジュール搭載品。純正同等の安全性で高コスパ。
              </p>
            </div>
          </div>
        )}
      </section>

      {/* 2. フィルタバー（純正/準純正 × 所有デバイス逆引き × カテゴリ × 検索） */}
      <section className={`${cardCls} p-4 sm:p-5 space-y-4`}>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          {/* 区分セグメント */}
          <div className="flex flex-wrap items-center gap-1.5">
            {(
              [
                { id: 'all', label: `すべて (${ACCESSORIES_CATALOG.length})` },
                { id: 'genuine', label: `🍎 Apple純正のみ (${summaryStats.genuineCount})` },
                { id: 'semi-genuine', label: `✨ 準純正・公式パートナー (${summaryStats.semiCount})` },
                { id: 'beats-collab', label: '🎧 Beats・Hermès・Nike' },
              ] as { id: TierFilter; label: string }[]
            ).map((t) => {
              const active = tierFilter === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTierFilter(t.id)}
                  className={`rounded-xl px-3 py-1.5 text-xs sm:text-sm font-semibold transition ${
                    active
                      ? 'bg-zinc-900 text-white shadow-sm dark:bg-zinc-100 dark:text-zinc-900'
                      : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700'
                  }`}
                >
                  {t.label}
                </button>
              );
            })}
          </div>

          {/* 検索 ＆ 並び替え */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 sm:w-64">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="製品名・型番・ブランド・機能で検索..."
                className="w-full rounded-lg border border-zinc-300 bg-white pl-8 pr-7 py-1.5 text-sm text-zinc-900 outline-none focus:ring-2 focus:ring-zinc-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
              className={selectCls}
            >
              <option value="recommended">おすすめ・定番順</option>
              <option value="price-asc">価格が安い順</option>
              <option value="price-desc">価格が高い順</option>
              <option value="hike-desc">発売時からの値上げ額順</option>
              <option value="release-desc">発売日が新しい順</option>
            </select>
          </div>
        </div>

        {/* 所有デバイスからの逆引き互換性フィルタ */}
        <div className="rounded-xl border border-zinc-200/80 bg-zinc-50/70 p-3 dark:border-zinc-800 dark:bg-zinc-950/50">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <label className="flex items-center gap-1.5 text-xs font-bold text-zinc-700 dark:text-zinc-300">
              <Smartphone className="h-3.5 w-3.5 text-sky-500" />
              <span>お使いのApple機種から対応アクセサリーを逆引き（非対応ミス防止）:</span>
            </label>
            <select
              value={compatFilter}
              onChange={(e) => setCompatFilter(e.target.value as DeviceCompatGroupId | 'all')}
              className={`${selectCls} sm:min-w-[360px] font-medium`}
            >
              {DEVICE_COMPAT_GROUPS.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.label}
                </option>
              ))}
            </select>
          </div>
          {activeCompatMeta.warningTip && (
            <div className="mt-2 flex items-start gap-2 rounded-lg border border-amber-300/80 bg-amber-50/90 px-3 py-2 text-xs text-amber-900 dark:border-amber-800/70 dark:bg-amber-950/40 dark:text-amber-200">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <span>{activeCompatMeta.warningTip}</span>
            </div>
          )}
        </div>

        {/* カテゴリピル */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
          {ACCESSORY_CATEGORIES.map((cat) => {
            const active = categoryFilter === cat.id;
            const count =
              cat.id === 'all'
                ? ACCESSORIES_CATALOG.length
                : ACCESSORIES_CATALOG.filter((x) => x.category === cat.id).length;
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => setCategoryFilter(cat.id)}
                className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                  active
                    ? 'border-sky-500 bg-sky-500/15 text-sky-700 dark:border-sky-400 dark:bg-sky-400/20 dark:text-sky-200'
                    : 'border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800'
                }`}
              >
                {cat.shortLabel} ({count})
              </button>
            );
          })}
        </div>
      </section>

      {/* 3. 「純正 vs 準純正」定番比較プリセット ＆ 横並び比較テーブル */}
      <section className={`${cardCls} p-4 sm:p-6 space-y-4`}>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base sm:text-lg font-bold text-zinc-900 dark:text-zinc-50 flex items-center gap-2">
              <Scale className="h-5 w-5 text-sky-500" />
              <span>純正 vs 準純正 徹底比較テーブル（ワンクリック対決プリセット）</span>
            </h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              「純正を買うべきか、準純正で十分か？」迷いやすい定番ジャンルをワンクリックで横並び比較できます（各カードの「比較に追加」で自由に入れ替え可）。
            </p>
          </div>
          {compareIds.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setCompareIds([]);
                setActivePresetId('');
              }}
              className="self-start sm:self-auto text-xs font-medium text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
            >
              比較をクリア ({compareIds.length}/4)
            </button>
          )}
        </div>

        {/* プリセット選択ボタン */}
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {ACCESSORY_COMPARISON_PRESETS.map((preset) => {
            const active = activePresetId === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => applyPreset(preset.id)}
                className={`text-left rounded-xl border p-3 transition ${
                  active
                    ? 'border-sky-500 bg-sky-50/70 ring-1 ring-sky-500/40 dark:border-sky-400 dark:bg-sky-950/30'
                    : 'border-zinc-200/80 bg-zinc-50/60 hover:bg-zinc-100/80 dark:border-zinc-800 dark:bg-zinc-900/60 dark:hover:bg-zinc-800/80'
                }`}
              >
                <div className="text-xs font-bold text-zinc-900 dark:text-zinc-100 line-clamp-1">
                  {preset.title}
                </div>
                <div className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400 line-clamp-1">
                  {preset.subtitle}
                </div>
              </button>
            );
          })}
        </div>

        {/* 結論アドバイス */}
        {activePreset && (
          <div className="rounded-xl border border-emerald-300/80 bg-emerald-50/70 p-3.5 text-xs sm:text-sm text-emerald-950 dark:border-emerald-800/70 dark:bg-emerald-950/30 dark:text-emerald-100">
            <div className="font-bold flex items-center gap-1.5 mb-1">
              <Trophy className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              <span>選び方の結論：{activePreset.title}</span>
            </div>
            <p className="leading-relaxed text-xs sm:text-sm">{activePreset.verdict}</p>
          </div>
        )}

        {/* 横並び比較テーブル */}
        {compareItems.length > 0 ? (
          <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
            <table className="w-full min-w-[640px] border-collapse text-left text-xs sm:text-sm">
              <thead>
                <tr className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
                  <th className="w-36 p-3 font-semibold text-zinc-600 dark:text-zinc-400">比較項目</th>
                  {compareItems.map((item) => {
                    const sku = getActiveSku(item);
                    return (
                      <th key={item.id} className="p-3 align-top min-w-[200px]">
                        <div className="flex items-start justify-between gap-2">
                          <TierBadge item={item} />
                          <button
                            type="button"
                            onClick={() => toggleCompare(item.id)}
                            className="rounded p-0.5 text-zinc-400 hover:bg-zinc-200 hover:text-zinc-700 dark:hover:bg-zinc-800"
                            title="比較から外す"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <div className="mt-1.5 font-bold text-zinc-900 dark:text-zinc-100">
                          {item.name}
                        </div>
                        <div className="mt-0.5 text-[11px] font-normal text-zinc-500 dark:text-zinc-400">
                          {sku.label}
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                <tr>
                  <td className="p-3 font-semibold text-zinc-600 dark:text-zinc-400 bg-zinc-50/50 dark:bg-zinc-900/40">
                    現在価格 (税込)
                  </td>
                  {compareItems.map((item) => {
                    const sku = getActiveSku(item);
                    const minPrice = Math.min(...compareItems.map((x) => getActiveSku(x).currentPrice));
                    const isCheapest = sku.currentPrice === minPrice && compareItems.length > 1;
                    return (
                      <td key={item.id} className="p-3 tabular-nums">
                        <span
                          className={`text-base font-extrabold ${
                            isCheapest
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : 'text-zinc-900 dark:text-zinc-100'
                          }`}
                        >
                          {yen(sku.currentPrice)}
                        </span>
                        {isCheapest && (
                          <span className="ml-1.5 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                            最安
                          </span>
                        )}
                        {sku.marketEstimatePrice && (
                          <div className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                            EC実勢目安: 約{yen(sku.marketEstimatePrice)}
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
                <tr>
                  <td className="p-3 font-semibold text-zinc-600 dark:text-zinc-400 bg-zinc-50/50 dark:bg-zinc-900/40">
                    発売時価格・改定差額
                  </td>
                  {compareItems.map((item) => {
                    const sku = getActiveSku(item);
                    const diff = sku.currentPrice - sku.launchPrice;
                    return (
                      <td key={item.id} className="p-3 tabular-nums text-xs">
                        <div>発売時: {yen(sku.launchPrice)}</div>
                        {diff !== 0 ? (
                          <span className="text-rose-600 dark:text-rose-400 font-semibold">
                            {signedYen(diff)} ({signedPct((diff / sku.launchPrice) * 100)})
                          </span>
                        ) : (
                          <span className="text-zinc-400">価格据え置き (±¥0)</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
                <tr>
                  <td className="p-3 font-semibold text-zinc-600 dark:text-zinc-400 bg-zinc-50/50 dark:bg-zinc-900/40">
                    米国価格・適用為替
                  </td>
                  {compareItems.map((item) => {
                    const sku = getActiveSku(item);
                    const fx = evalAccessoryFx(sku);
                    return (
                      <td key={item.id} className="p-3 tabular-nums text-xs">
                        {fx ? (
                          <>
                            <div>US ${fx.usd} (税抜)</div>
                            <div className="text-zinc-500 dark:text-zinc-400">
                              実質レート: ¥{fx.impliedRate.toFixed(1)}/$
                            </div>
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                    );
                  })}
                </tr>
                <tr>
                  <td className="p-3 font-semibold text-zinc-600 dark:text-zinc-400 bg-zinc-50/50 dark:bg-zinc-900/40">
                    接続・給電方式
                  </td>
                  {compareItems.map((item) => (
                    <td key={item.id} className="p-3 text-xs leading-relaxed">
                      {item.connection}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="p-3 font-semibold text-zinc-600 dark:text-zinc-400 bg-zinc-50/50 dark:bg-zinc-900/40">
                    主な特徴・強み
                  </td>
                  {compareItems.map((item) => (
                    <td key={item.id} className="p-3 text-xs leading-relaxed">
                      {item.specs.specialFeatures ?? item.highlights[0]}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="p-3 font-semibold text-zinc-600 dark:text-zinc-400 bg-zinc-50/50 dark:bg-zinc-900/40">
                    サイズ・重量・仕様
                  </td>
                  {compareItems.map((item) => (
                    <td key={item.id} className="p-3 text-xs leading-relaxed">
                      {item.specs.dimensionsOrWeight ?? '—'}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="p-3 font-semibold text-zinc-600 dark:text-zinc-400 bg-zinc-50/50 dark:bg-zinc-900/40">
                    認証・メーカー保証
                  </td>
                  {compareItems.map((item) => (
                    <td key={item.id} className="p-3 text-xs leading-relaxed">
                      <div className="font-medium text-zinc-800 dark:text-zinc-200">
                        {item.certification ?? '—'}
                      </div>
                      <div className="text-zinc-500 dark:text-zinc-400">
                        {item.specs.warrantyOrSupport ?? ''}
                      </div>
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-zinc-300 p-6 text-center text-xs sm:text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
            上のプリセットを選ぶか、各アクセサリーカードの「比較に追加」ボタンを押すと最大4製品まで横並び比較できます。
          </div>
        )}
      </section>

      {/* 4. アクセサリーカード一覧 */}
      <section className="space-y-3">
        <div className="flex items-center justify-between px-1">
          <div className="text-xs sm:text-sm font-semibold text-zinc-600 dark:text-zinc-400">
            該当アクセサリー: <strong className="text-zinc-900 dark:text-zinc-100">{filteredItems.length}</strong> シリーズ
          </div>
        </div>

        {filteredItems.length === 0 ? (
          <div className={`${cardCls} p-10 text-center text-sm text-zinc-500`}>
            条件に一致するアクセサリーが見つかりませんでした。フィルタや検索ワードを変更してください。
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {filteredItems.map((item) => {
              const activeSku = getActiveSku(item);
              const priceDiff = activeSku.currentPrice - activeSku.launchPrice;
              const fx = evalAccessoryFx(activeSku);
              const inCompare = compareIds.includes(item.id);
              const histExpanded = Boolean(expandedHistoryMap[item.id]);
              const altItem = item.recommendedAlternativeId
                ? ACCESSORIES_CATALOG.find((x) => x.id === item.recommendedAlternativeId)
                : undefined;
              const catMeta = ACCESSORY_CATEGORIES.find((c) => c.id === item.category);

              return (
                <article
                  key={item.id}
                  id={`acc-card-${item.id}`}
                  className={`${cardCls} flex flex-col justify-between p-4 sm:p-5 transition hover:border-zinc-300 dark:hover:border-zinc-700`}
                >
                  <div className="space-y-3">
                    {/* ヘッダーバッジ列 */}
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <TierBadge item={item} />
                        {catMeta && (
                          <span className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-[11px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                            {catMeta.shortLabel}
                          </span>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => toggleCompare(item.id)}
                        className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-semibold transition ${
                          inCompare
                            ? 'border-sky-500 bg-sky-500 text-white'
                            : 'border-zinc-200 bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200'
                        }`}
                      >
                        {inCompare ? <Check className="h-3.5 w-3.5" /> : <Scale className="h-3.5 w-3.5" />}
                        <span>{inCompare ? '比較中' : '比較に追加'}</span>
                      </button>
                    </div>

                    {/* タイトル ＆ ブランド */}
                    <div>
                      <div className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">
                        {item.brand} ・ 発売日 {item.releaseDate}
                        {activeSku.modelNumber ? ` ・ 型番 ${activeSku.modelNumber}` : ''}
                      </div>
                      <h3 className="mt-0.5 text-base sm:text-lg font-bold leading-snug text-zinc-900 dark:text-zinc-50">
                        {item.name}
                      </h3>
                    </div>

                    {/* SKU切替ピル (複数SKUある場合) */}
                    {item.skus.length > 1 && (
                      <div className="flex flex-wrap gap-1.5">
                        {item.skus.map((s) => {
                          const isSel = s.id === activeSku.id;
                          return (
                            <button
                              key={s.id}
                              type="button"
                              onClick={() =>
                                setSelectedSkuMap((prev) => ({ ...prev, [item.id]: s.id }))
                              }
                              className={`rounded-lg border px-2.5 py-1 text-xs font-semibold transition ${
                                isSel
                                  ? 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900'
                                  : 'border-zinc-200 bg-zinc-50 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800/70 dark:text-zinc-300'
                              }`}
                            >
                              {s.label} ({yen(s.currentPrice)})
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {/* 価格ボックス */}
                    <div className="rounded-xl border border-zinc-200/80 bg-zinc-50/80 p-3 dark:border-zinc-800 dark:bg-zinc-950/50">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <div>
                          <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                            {item.tier === 'genuine' ? 'Apple Store 直販価格 (税込)' : '公式ストア価格 (税込)'}
                          </span>
                          <div className="flex items-baseline gap-2 mt-0.5">
                            <span className="text-xl sm:text-2xl font-extrabold tabular-nums text-zinc-900 dark:text-zinc-50">
                              {yen(activeSku.currentPrice)}
                            </span>
                            {priceDiff !== 0 && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/10 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-rose-600 dark:text-rose-400">
                                発売時 {yen(activeSku.launchPrice)} から {signedYen(priceDiff)}
                              </span>
                            )}
                          </div>
                        </div>

                        {activeSku.marketEstimatePrice && (
                          <div className="text-right">
                            <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
                              EC・量販店 実勢目安
                            </span>
                            <div className="text-sm font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                              約{yen(activeSku.marketEstimatePrice)}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* 為替＆改定履歴トグル */}
                      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-zinc-200/70 pt-2 text-xs text-zinc-500 dark:border-zinc-800/80 dark:text-zinc-400">
                        {fx ? (
                          <span className="inline-flex items-center gap-1.5 tabular-nums">
                            <Coins className="h-3.5 w-3.5 text-amber-500" />
                            <span>
                              米国 ${fx.usd} ・ 実質Appleレート{' '}
                              <strong className="text-zinc-700 dark:text-zinc-200">
                                ¥{fx.impliedRate.toFixed(1)}/$
                              </strong>
                            </span>
                          </span>
                        ) : (
                          <span />
                        )}
                        {activeSku.priceHistory.length > 1 && (
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedHistoryMap((prev) => ({
                                ...prev,
                                [item.id]: !prev[item.id],
                              }))
                            }
                            className="inline-flex items-center gap-1 font-semibold text-sky-600 hover:underline dark:text-sky-400"
                          >
                            <span>価格改定履歴 ({activeSku.priceHistory.length}回)</span>
                            {histExpanded ? (
                              <ChevronUp className="h-3.5 w-3.5" />
                            ) : (
                              <ChevronDown className="h-3.5 w-3.5" />
                            )}
                          </button>
                        )}
                      </div>

                      {histExpanded && (
                        <div className="mt-2 space-y-1 border-t border-zinc-200/70 pt-2 text-xs dark:border-zinc-800">
                          {activeSku.priceHistory.map((pt, idx) => (
                            <div
                              key={`${pt.date}-${idx}`}
                              className="flex items-center justify-between gap-2 tabular-nums"
                            >
                              <span className="text-zinc-600 dark:text-zinc-400">
                                {pt.date}：{pt.event}
                              </span>
                              <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                                {yen(pt.appleStorePrice)}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* 対応機種 ＆ 非対応注意アラート */}
                    <div className="space-y-1.5 text-xs">
                      <div>
                        <span className="font-bold text-zinc-700 dark:text-zinc-300">主な対応機種: </span>
                        <span className="text-zinc-600 dark:text-zinc-400">
                          {item.compatDevices.join(' / ')}
                        </span>
                      </div>
                      {item.incompatibleNotice && (
                        <div className="rounded-lg border border-rose-300/80 bg-rose-50/80 px-2.5 py-1.5 text-[11px] font-medium text-rose-800 dark:border-rose-900/70 dark:bg-rose-950/40 dark:text-rose-200">
                          ⚠️ {item.incompatibleNotice}
                        </div>
                      )}
                    </div>

                    {/* ハイライト箇条書き */}
                    <ul className="space-y-1 text-xs text-zinc-700 dark:text-zinc-300">
                      {item.highlights.map((h, i) => (
                        <li key={i} className="flex items-start gap-1.5 leading-relaxed">
                          <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-sky-500" />
                          <span>{h}</span>
                        </li>
                      ))}
                    </ul>

                    {/* ライバル比較メモ */}
                    {(item.comparisonNote || altItem) && (
                      <div className="rounded-xl border border-zinc-200/80 bg-zinc-50/70 p-2.5 text-xs dark:border-zinc-800 dark:bg-zinc-900/60">
                        {item.comparisonNote && (
                          <p className="text-zinc-600 dark:text-zinc-400 leading-relaxed">
                            💡 {item.comparisonNote}
                          </p>
                        )}
                        {altItem && (
                          <div className="mt-1.5 flex items-center justify-between gap-2">
                            <span className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400">
                              比較ライバル ({altItem.tier === 'genuine' ? 'Apple純正' : '準純正'}):
                            </span>
                            <button
                              type="button"
                              onClick={() => jumpToAlternative(altItem.id)}
                              className="text-xs font-bold text-sky-600 hover:underline dark:text-sky-400"
                            >
                              → {altItem.name} ({yen(altItem.skus[0].currentPrice)}) を見る
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* フッター：ショップ検索リンク */}
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-zinc-200/80 pt-3 dark:border-zinc-800">
                    <span className="text-[11px] text-zinc-400 dark:text-zinc-500">
                      {item.certification}
                    </span>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <a
                        href={`https://www.apple.com/jp/shop/accessories/all-accessories?fh=${encodeURIComponent(item.name)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
                      >
                        <span>Apple Store</span>
                        <ExternalLink className="h-3 w-3" />
                      </a>
                      <a
                        href={`https://search.rakuten.co.jp/search/mall/${encodeURIComponent(
                          `${item.brand} ${item.name}`,
                        )}/`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-rose-700 hover:bg-rose-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-rose-300"
                      >
                        <span>楽天市場</span>
                        <ExternalLink className="h-3 w-3" />
                      </a>
                      <a
                        href={`https://shopping.yahoo.co.jp/search?p=${encodeURIComponent(
                          `${item.brand} ${item.name}`,
                        )}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-amber-700 hover:bg-amber-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-amber-300"
                      >
                        <span>Yahoo!</span>
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
