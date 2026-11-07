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
  Scale,
  Search,
  ShoppingBag,
  Smartphone,
  Sparkles,
  Trophy,
  X,
} from 'lucide-react';
import {
  btnCls,
  buildXlsx,
  card as cardCls,
  DEFAULT_LATEST_USD_JPY,
  selectCls,
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
      <span className="inline-flex items-center gap-1.5 rounded-full bg-zinc-900 px-3 py-1 text-xs font-semibold text-zinc-100 dark:bg-zinc-200 dark:text-zinc-900">
        <Apple className="h-3.5 w-3.5" />
        {item.subTypeLabel}
      </span>
    );
  }
  if (item.subType === 'apple-owned-beats') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-zinc-100 px-3 py-1 text-xs font-semibold text-zinc-700 dark:bg-[#25272e] dark:text-zinc-300">
        <Headphones className="h-3.5 w-3.5" />
        {item.subTypeLabel}
      </span>
    );
  }
  if (item.subType === 'apple-store-partner') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-zinc-100 px-3 py-1 text-xs font-semibold text-zinc-700 dark:bg-[#25272e] dark:text-zinc-300">
        <Sparkles className="h-3.5 w-3.5" />
        {item.subTypeLabel}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-zinc-100 px-3 py-1 text-xs font-semibold text-zinc-700 dark:bg-[#25272e] dark:text-zinc-300">
      <Check className="h-3.5 w-3.5" />
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
    <div className="space-y-6">
      {/* 1. ヒーロー＆統計サマリー */}
      <section className={`${cardCls} p-5 sm:p-6`}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 rounded-full bg-zinc-100 px-3.5 py-1 text-xs font-semibold text-zinc-700 dark:bg-[#25272e] dark:text-zinc-300">
              <ShoppingBag className="h-3.5 w-3.5" />
              Apple 純正 ＆ 準純正（Apple Store公式取扱・MFi / Qi2 / Beats）完全網羅カタログ
            </div>
            <h1 className="text-lg sm:text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
              Apple 純正・準純正アクセサリー図鑑 ＆ 互換性・価格比較
            </h1>
            <p className="text-xs sm:text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
              Apple純正品（{summaryStats.genuineCount}シリーズ）と、Beats・Logicool・Belkin・Anker・Hermès等の準純正品（
              {summaryStats.semiCount}シリーズ / 全{summaryStats.totalSkuCount} SKU）の発売時価格・円安改定履歴・米国ドル換算・対応機種を一覧比較できます。
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => setGuideOpen((v) => !v)}
              className={btnCls}
            >
              <Info className="h-4 w-4 text-zinc-500" />
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
              <FileSpreadsheet className="h-4 w-4 text-[#487558] dark:text-[#88b396]" />
              <span>Excel (.xlsx) 出力</span>
            </button>
          </div>
        </div>

        {/* 純正 vs 準純正の定義ガイド（折りたたみ） */}
        {guideOpen && (
          <div className="mt-4 grid gap-3 rounded-2xl bg-[#f5f5f7] p-4 sm:grid-cols-4 dark:bg-[#23252b]">
            <div className="rounded-xl bg-white p-3.5 dark:bg-[#1c1d22]">
              <div className="text-xs sm:text-sm font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
                <Apple className="h-4 w-4" /> ① Apple 純正
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
                Apple自身が設計・販売。H2/U1チップやSmart Connector、Touch ID、25W MagSafeなどOSレベルの独自連携が最大の強み。
              </p>
            </div>
            <div className="rounded-xl bg-white p-3.5 dark:bg-[#1c1d22]">
              <div className="text-xs sm:text-sm font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
                <Headphones className="h-4 w-4" /> ② Beats / 公式コラボ
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
                Apple完全子会社の『Beats by Dre』や『Apple × Hermès / Nike』。H1チップや「探す」、サファイアクリスタル製カメラコントロールなどを共有。
              </p>
            </div>
            <div className="rounded-xl bg-white p-3.5 dark:bg-[#1c1d22]">
              <div className="text-xs sm:text-sm font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
                <Sparkles className="h-4 w-4" /> ③ Apple Store 公式パートナー
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
                Logicool（Combo Touch / Crayon）やBelkin（UltraGlass 2 / BoostCharge Pro）など、Appleと共同開発され直営店で販売される準純正品。
              </p>
            </div>
            <div className="rounded-xl bg-white p-3.5 dark:bg-[#1c1d22]">
              <div className="text-xs sm:text-sm font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
                <Check className="h-4 w-4" /> ④ MFi / Qi2 / Find My 認証
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
                Anker等の『Qi2 15W』『Made for Apple Watch』『Works with Apple Find My』公式認証モジュール搭載品。純正同等の安全性で高コスパ。
              </p>
            </div>
          </div>
        )}
      </section>

      {/* 2. フィルタバー（純正/準純正 × 所有デバイス逆引き × カテゴリ × 検索） */}
      <section className={`${cardCls} p-5 sm:p-6 space-y-4`}>
        <div className="flex flex-col gap-3.5 lg:flex-row lg:items-center lg:justify-between">
          {/* 区分セグメント */}
          <div className="flex flex-wrap items-center gap-2">
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
                  className={`rounded-xl px-3.5 py-2 text-xs sm:text-sm font-semibold transition ${
                    active
                      ? 'bg-zinc-900 text-zinc-100 shadow-2xs dark:bg-zinc-200 dark:text-zinc-900'
                      : 'bg-[#f5f5f7] text-zinc-600 hover:bg-zinc-200/70 dark:bg-[#23252b] dark:text-zinc-300 dark:hover:bg-[#2c2f36]'
                  }`}
                >
                  {t.label}
                </button>
              );
            })}
          </div>

          {/* 検索 ＆ 並び替え */}
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="relative flex-1 sm:w-64">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="製品名・型番・ブランド・機能で検索..."
                className="w-full rounded-xl bg-[#f5f5f7] pl-9 pr-8 py-2 text-sm text-zinc-900 outline-none focus:ring-2 focus:ring-zinc-400/50 dark:bg-[#23252b] dark:text-zinc-100"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600"
                >
                  <X className="h-4 w-4" />
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
        <div className="rounded-2xl bg-[#f5f5f7] p-4 dark:bg-[#23252b]">
          <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
            <label className="flex items-center gap-2 text-xs sm:text-sm font-semibold text-zinc-700 dark:text-zinc-300">
              <Smartphone className="h-4 w-4 text-zinc-500" />
              <span>お使いのApple機種から対応アクセサリーを逆引き（非対応ミス防止）:</span>
            </label>
            <select
              value={compatFilter}
              onChange={(e) => setCompatFilter(e.target.value as DeviceCompatGroupId | 'all')}
              className={`${selectCls} !bg-white dark:!bg-[#1c1d22] sm:min-w-[360px] font-medium`}
            >
              {DEVICE_COMPAT_GROUPS.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.label}
                </option>
              ))}
            </select>
          </div>
          {activeCompatMeta.warningTip && (
            <div className="mt-3 flex items-start gap-2 rounded-xl bg-white px-3.5 py-2.5 text-xs sm:text-sm text-zinc-700 dark:bg-[#1c1d22] dark:text-zinc-300">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-zinc-500" />
              <span>{activeCompatMeta.warningTip}</span>
            </div>
          )}
        </div>

        {/* カテゴリピル */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
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
                className={`whitespace-nowrap rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
                  active
                    ? 'bg-zinc-900 text-zinc-100 dark:bg-zinc-200 dark:text-zinc-900'
                    : 'bg-[#f5f5f7] text-zinc-600 hover:bg-zinc-200/70 dark:bg-[#23252b] dark:text-zinc-400 dark:hover:bg-[#2c2f36]'
                }`}
              >
                {cat.shortLabel} ({count})
              </button>
            );
          })}
        </div>
      </section>

      {/* 3. 「純正 vs 準純正」定番比較プリセット ＆ 横並び比較テーブル */}
      <section className={`${cardCls} p-5 sm:p-6 space-y-4`}>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base sm:text-lg font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
              <Scale className="h-5 w-5 text-zinc-500" />
              <span>純正 vs 準純正 徹底比較テーブル（ワンクリック対決プリセット）</span>
            </h2>
            <p className="mt-0.5 text-xs sm:text-sm text-zinc-500 dark:text-zinc-400">
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
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {ACCESSORY_COMPARISON_PRESETS.map((preset) => {
            const active = activePresetId === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => applyPreset(preset.id)}
                className={`text-left rounded-2xl p-4 transition ${
                  active
                    ? 'bg-zinc-900 text-zinc-100 shadow-2xs dark:bg-zinc-200 dark:text-zinc-900'
                    : 'bg-[#f5f5f7] text-zinc-800 hover:bg-zinc-200/70 dark:bg-[#23252b] dark:text-zinc-200 dark:hover:bg-[#2c2f36]'
                }`}
              >
                <div className="text-xs sm:text-sm font-bold line-clamp-1">
                  {preset.title}
                </div>
                <div className={`mt-1 text-xs line-clamp-1 ${active ? 'text-zinc-300 dark:text-zinc-600' : 'text-zinc-500 dark:text-zinc-400'}`}>
                  {preset.subtitle}
                </div>
              </button>
            );
          })}
        </div>

        {/* 結論アドバイス */}
        {activePreset && (
          <div className="rounded-2xl bg-[#eaf2ed]/75 p-4 text-xs sm:text-sm text-[#3d6b4e] dark:bg-[#1e2b24]/75 dark:text-[#88b396]">
            <div className="font-bold flex items-center gap-2 mb-1">
              <Trophy className="h-4 w-4 shrink-0" />
              <span>選び方の結論：{activePreset.title}</span>
            </div>
            <p className="leading-relaxed text-xs sm:text-sm">{activePreset.verdict}</p>
          </div>
        )}

        {/* 横並び比較テーブル */}
        {compareItems.length > 0 ? (
          <div className="overflow-x-auto rounded-2xl bg-[#f5f5f7]/60 dark:bg-[#23252b]/60">
            <table className="w-full min-w-[640px] border-collapse text-left text-xs sm:text-sm">
              <thead>
                <tr className="bg-zinc-200/50 dark:bg-[#282a32]">
                  <th className="w-40 px-4 py-3.5 font-semibold text-zinc-600 dark:text-zinc-400">比較項目</th>
                  {compareItems.map((item) => {
                    const sku = getActiveSku(item);
                    return (
                      <th key={item.id} className="px-4 py-3.5 align-top min-w-[210px]">
                        <div className="flex items-start justify-between gap-2">
                          <TierBadge item={item} />
                          <button
                            type="button"
                            onClick={() => toggleCompare(item.id)}
                            className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-200 hover:text-zinc-700 dark:hover:bg-zinc-700"
                            title="比較から外す"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                        <div className="mt-2 font-bold text-zinc-900 dark:text-zinc-100">
                          {item.name}
                        </div>
                        <div className="mt-0.5 text-xs font-normal text-zinc-500 dark:text-zinc-400">
                          {sku.label}
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200/40 dark:divide-white/[0.04]">
                <tr>
                  <td className="px-4 py-3.5 font-semibold text-zinc-600 dark:text-zinc-400">
                    現在価格 (税込)
                  </td>
                  {compareItems.map((item) => {
                    const sku = getActiveSku(item);
                    const minPrice = Math.min(...compareItems.map((x) => getActiveSku(x).currentPrice));
                    const isCheapest = sku.currentPrice === minPrice && compareItems.length > 1;
                    return (
                      <td key={item.id} className="px-4 py-3.5 tabular-nums">
                        <span
                          className={`text-base font-bold ${
                            isCheapest
                              ? 'text-[#3d6b4e] dark:text-[#88b396]'
                              : 'text-zinc-900 dark:text-zinc-100'
                          }`}
                        >
                          {yen(sku.currentPrice)}
                        </span>
                        {isCheapest && (
                          <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-[#eaf2ed] px-2.5 py-0.5 text-xs font-semibold text-[#3d6b4e] dark:bg-[#1e2b24] dark:text-[#88b396]">
                            <span className="h-1.5 w-1.5 rounded-full bg-[#649274]" />
                            最安
                          </span>
                        )}
                        {sku.marketEstimatePrice && (
                          <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                            EC実勢目安: 約{yen(sku.marketEstimatePrice)}
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
                <tr>
                  <td className="px-4 py-3.5 font-semibold text-zinc-600 dark:text-zinc-400">
                    発売時価格・改定差額
                  </td>
                  {compareItems.map((item) => {
                    const sku = getActiveSku(item);
                    const diff = sku.currentPrice - sku.launchPrice;
                    return (
                      <td key={item.id} className="px-4 py-3.5 tabular-nums text-xs sm:text-sm">
                        <div>発売時: {yen(sku.launchPrice)}</div>
                        {diff !== 0 ? (
                          <span className="text-zinc-600 dark:text-zinc-400 font-medium">
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
                  <td className="px-4 py-3.5 font-semibold text-zinc-600 dark:text-zinc-400">
                    米国価格・適用為替
                  </td>
                  {compareItems.map((item) => {
                    const sku = getActiveSku(item);
                    const fx = evalAccessoryFx(sku);
                    return (
                      <td key={item.id} className="px-4 py-3.5 tabular-nums text-xs sm:text-sm">
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
                  <td className="px-4 py-3.5 font-semibold text-zinc-600 dark:text-zinc-400">
                    接続・給電方式
                  </td>
                  {compareItems.map((item) => (
                    <td key={item.id} className="px-4 py-3.5 text-xs sm:text-sm leading-relaxed">
                      {item.connection}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="px-4 py-3.5 font-semibold text-zinc-600 dark:text-zinc-400">
                    主な特徴・強み
                  </td>
                  {compareItems.map((item) => (
                    <td key={item.id} className="px-4 py-3.5 text-xs sm:text-sm leading-relaxed">
                      {item.specs.specialFeatures ?? item.highlights[0]}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="px-4 py-3.5 font-semibold text-zinc-600 dark:text-zinc-400">
                    サイズ・重量・仕様
                  </td>
                  {compareItems.map((item) => (
                    <td key={item.id} className="px-4 py-3.5 text-xs sm:text-sm leading-relaxed">
                      {item.specs.dimensionsOrWeight ?? '—'}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="px-4 py-3.5 font-semibold text-zinc-600 dark:text-zinc-400">
                    認証・メーカー保証
                  </td>
                  {compareItems.map((item) => (
                    <td key={item.id} className="px-4 py-3.5 text-xs sm:text-sm leading-relaxed">
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
          <div className="rounded-2xl bg-[#f5f5f7] p-8 text-center text-xs sm:text-sm text-zinc-500 dark:bg-[#23252b] dark:text-zinc-400">
            上のプリセットを選ぶか、各アクセサリーカードの「比較に追加」ボタンを押すと最大4製品まで横並び比較できます。
          </div>
        )}
      </section>

      {/* 4. アクセサリーカード一覧 */}
      <section className="space-y-4">
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
                  className={`${cardCls} flex flex-col justify-between p-5 sm:p-6 transition`}
                >
                  <div className="space-y-3.5">
                    {/* ヘッダーバッジ列 */}
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <TierBadge item={item} />
                        {catMeta && (
                          <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-600 dark:bg-[#25272e] dark:text-zinc-300">
                            {catMeta.shortLabel}
                          </span>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => toggleCompare(item.id)}
                        className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition ${
                          inCompare
                            ? 'bg-zinc-900 text-zinc-100 dark:bg-zinc-200 dark:text-zinc-900'
                            : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-[#25272e] dark:text-zinc-200 dark:hover:bg-zinc-700/70'
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
                      <h3 className="mt-1 text-base sm:text-lg font-bold leading-snug text-zinc-900 dark:text-zinc-100">
                        {item.name}
                      </h3>
                    </div>

                    {/* SKU切替ピル (複数SKUある場合) */}
                    {item.skus.length > 1 && (
                      <div className="flex flex-wrap gap-2">
                        {item.skus.map((s) => {
                          const isSel = s.id === activeSku.id;
                          return (
                            <button
                              key={s.id}
                              type="button"
                              onClick={() =>
                                setSelectedSkuMap((prev) => ({ ...prev, [item.id]: s.id }))
                              }
                              className={`rounded-xl px-3 py-1.5 text-xs font-semibold transition ${
                                isSel
                                  ? 'bg-zinc-900 text-zinc-100 dark:bg-zinc-200 dark:text-zinc-900'
                                  : 'bg-[#f5f5f7] text-zinc-700 hover:bg-zinc-200/70 dark:bg-[#23252b] dark:text-zinc-300 dark:hover:bg-[#2c2f36]'
                              }`}
                            >
                              {s.label} ({yen(s.currentPrice)})
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {/* 価格ボックス */}
                    <div className="rounded-2xl bg-[#f5f5f7] p-4 dark:bg-[#23252b]">
                      <div className="flex flex-wrap items-baseline justify-between gap-2.5">
                        <div>
                          <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                            {item.tier === 'genuine' ? 'Apple Store 直販価格 (税込)' : '公式ストア価格 (税込)'}
                          </span>
                          <div className="flex flex-wrap items-baseline gap-2.5 mt-1">
                            <span className="text-xl sm:text-2xl font-bold tabular-nums text-zinc-900 dark:text-zinc-100">
                              {yen(activeSku.currentPrice)}
                            </span>
                            {priceDiff !== 0 && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-zinc-200/70 px-2.5 py-0.5 text-xs font-medium tabular-nums text-zinc-700 dark:bg-[#1c1d22] dark:text-zinc-300">
                                発売時 {yen(activeSku.launchPrice)} から {signedYen(priceDiff)}
                              </span>
                            )}
                          </div>
                        </div>

                        {activeSku.marketEstimatePrice && (
                          <div className="text-right">
                            <span className="text-xs text-zinc-500 dark:text-zinc-400">
                              EC・量販店 実勢目安
                            </span>
                            <div className="text-sm sm:text-base font-bold tabular-nums text-[#3d6b4e] dark:text-[#88b396]">
                              約{yen(activeSku.marketEstimatePrice)}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* 為替＆改定履歴トグル */}
                      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 pt-1 text-xs text-zinc-500 dark:text-zinc-400">
                        {fx ? (
                          <span className="inline-flex items-center gap-1.5 tabular-nums">
                            <Coins className="h-3.5 w-3.5 text-zinc-400" />
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
                            className="inline-flex items-center gap-1 font-semibold text-zinc-700 underline hover:text-zinc-950 dark:text-zinc-300 dark:hover:text-zinc-100"
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
                        <div className="mt-2.5 space-y-1.5 rounded-xl bg-white p-3 text-xs dark:bg-[#1c1d22]">
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
                    <div className="space-y-2 text-xs sm:text-sm">
                      <div>
                        <span className="font-semibold text-zinc-700 dark:text-zinc-300">主な対応機種: </span>
                        <span className="text-zinc-600 dark:text-zinc-400">
                          {item.compatDevices.join(' / ')}
                        </span>
                      </div>
                      {item.incompatibleNotice && (
                        <div className="rounded-xl bg-[#f5f5f7] px-3 py-2 text-xs font-medium text-zinc-700 dark:bg-[#23252b] dark:text-zinc-300">
                          ⚠️ {item.incompatibleNotice}
                        </div>
                      )}
                    </div>

                    {/* ハイライト箇条書き */}
                    <ul className="space-y-1.5 text-xs sm:text-sm text-zinc-700 dark:text-zinc-300">
                      {item.highlights.map((h, i) => (
                        <li key={i} className="flex items-start gap-2 leading-relaxed">
                          <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-zinc-400 dark:bg-zinc-500" />
                          <span>{h}</span>
                        </li>
                      ))}
                    </ul>

                    {/* ライバル比較メモ */}
                    {(item.comparisonNote || altItem) && (
                      <div className="rounded-2xl bg-[#f5f5f7] p-3.5 text-xs sm:text-sm dark:bg-[#23252b]">
                        {item.comparisonNote && (
                          <p className="text-zinc-600 dark:text-zinc-400 leading-relaxed">
                            💡 {item.comparisonNote}
                          </p>
                        )}
                        {altItem && (
                          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                            <span className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">
                              比較ライバル ({altItem.tier === 'genuine' ? 'Apple純正' : '準純正'}):
                            </span>
                            <button
                              type="button"
                              onClick={() => jumpToAlternative(altItem.id)}
                              className="text-xs font-bold text-zinc-800 underline hover:text-zinc-950 dark:text-zinc-200 dark:hover:text-zinc-100"
                            >
                              → {altItem.name} ({yen(altItem.skus[0].currentPrice)}) を見る
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* フッター：ショップ検索リンク */}
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-2 pt-3">
                    <span className="text-xs text-zinc-400 dark:text-zinc-500">
                      {item.certification}
                    </span>
                    <div className="flex flex-wrap items-center gap-2">
                      <a
                        href={`https://www.apple.com/jp/shop/accessories/all-accessories?fh=${encodeURIComponent(item.name)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-xl bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-700 transition hover:bg-zinc-200 dark:bg-[#25272e] dark:text-zinc-200 dark:hover:bg-zinc-700/70"
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
                        className="inline-flex items-center gap-1.5 rounded-xl bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-700 transition hover:bg-zinc-200 dark:bg-[#25272e] dark:text-zinc-200 dark:hover:bg-zinc-700/70"
                      >
                        <span className="h-2 w-2 rounded-full bg-[#a66c75]" />
                        <span>楽天市場</span>
                        <ExternalLink className="h-3 w-3" />
                      </a>
                      <a
                        href={`https://shopping.yahoo.co.jp/search?p=${encodeURIComponent(
                          `${item.brand} ${item.name}`,
                        )}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-xl bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-700 transition hover:bg-zinc-200 dark:bg-[#25272e] dark:text-zinc-200 dark:hover:bg-zinc-700/70"
                      >
                        <span className="h-2 w-2 rounded-full bg-[#ad8755]" />
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
