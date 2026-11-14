import React, { useMemo, useState } from 'react';
import {
  ResponsiveContainer, ComposedChart, LineChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import {
  Coins, FileSpreadsheet,
} from 'lucide-react';
import {
  buildDeviceTimeline,
  card,
  carrierColor,
  compareProducts,
  CurrentFxFairnessBadge,
  DeltaBadge,
  downloadXlsx,
  EmptyNote,
  excelBtnCls,
  fairJpyVal,
  FxRatePairChip,
  impliedRate,
  lastOf,
  marketRate,
  pricedSkus,
  ProductSkuPicker,
  rateDiffVal,
  SectionTitle,
  Segmented,
  signedPct,
  signedRate,
  sortCategories,
  useChartColors,
  useDark,
  yen,
  yenAxis,
  ymJp,
  type PricePoint,
  type Product,
  type Sel,
  type XlsCell,
} from '../App';

/* =====================================================================================
 * 7. タブ3: 発売時価格 vs 為替レート分析
 * ===================================================================================== */

function verdict(prev: PricePoint, cur: PricePoint): { text: string; tone: 'up' | 'down' | 'flat' } {
  if (prev.usdPrice == null || cur.usdPrice == null) return { text: 'USD価格データなし', tone: 'flat' };
  const du = cur.usdPrice - prev.usdPrice, dj = cur.appleStorePrice - prev.appleStorePrice;
  if (du === 0 && dj > 0) return { text: 'USD据え置き／円建てのみ値上げ（為替の転嫁）', tone: 'up' };
  if (du > 0 && dj > 0) return { text: 'ドル建て価格自体が値上げ', tone: 'up' };
  if (du === 0 && dj < 0) return { text: 'USD据え置き／円建てのみ値下げ', tone: 'down' };
  if (du < 0 && dj < 0) return { text: 'ドル建て・円建てとも値下げ（型落ち等）', tone: 'down' };
  if (du < 0 && dj >= 0) return { text: 'ドルは値下げだが円建ては据え置き以上（円安を吸収）', tone: 'up' };
  if (du > 0 && dj <= 0) return { text: 'ドルは値上げだが円建ては据え置き以下（円高/調整）', tone: 'down' };
  return { text: '変動なし', tone: 'flat' };
}

export const LaunchFxView = React.memo(function LaunchFxView({ products, toast }: { products: Product[]; toast: (m: string) => void }) {
  const priced = products.filter((p) => pricedSkus(p).some((s) => s.priceHistory.some((h) => h.usdPrice)));
  return priced.length ? <FxInner products={priced} toast={toast} /> : <EmptyNote text="USD価格つきの機種がありません" />;
});
export const FxView = LaunchFxView;

function FxInner({ products, toast }: { products: Product[]; toast: (m: string) => void }) {
  const c = useChartColors();
  const dark = useDark();
  const cats = useMemo(() => sortCategories(Array.from(new Set(products.map((x) => x.category)))), [products]);
  const [catSel, setCat] = useState<string>(cats[0]);
  const cat = cats.includes(catSel) ? catSel : cats[0];
  const [sel, setSel] = useState<Sel>({ pid: products[0].id, sid: pricedSkus(products[0])[0].id });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());

  const toLaunchRow = (pr: Product) => {
    const ps = pricedSkus(pr)[0];
    const pt = ps.priceHistory[0];
    const curPt = lastOf(ps.priceHistory);
    const ar = impliedRate(pt);
    const mr = marketRate(pt);
    const diff = rateDiffVal(pt);
    const fair = fairJpyVal(curPt);
    return {
      id: pr.id, category: pr.category, name: pr.name, sku: ps.label, date: pt.date,
      jpy: pt.appleStorePrice, usd: pt.usdPrice, fx: mr, apple: ar, rateDiff: diff,
      currentFairJpy: fair, curPt, pt,
      premium: ar && mr ? (ar / mr - 1) * 100 : undefined,
      premiumRatio: ar && mr ? ar / mr - 1 : undefined,
    };
  };

  const launchRows = products.filter((x) => x.category === cat).sort(compareProducts).map(toLaunchRow);
  const pickedLaunch = useMemo(
    () => products.filter((x) => selectedIds.has(x.id)).sort(compareProducts).map(toLaunchRow),
    [products, selectedIds],
  );
  const targetLaunch = pickedLaunch.length > 0 ? pickedLaunch : launchRows;
  const allCatSelected = launchRows.length > 0 && launchRows.every((r) => selectedIds.has(r.id));

  const toggleLaunchOne = (id: string) => setSelectedIds((cur) => {
    const next = new Set(cur);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleLaunchCat = () => setSelectedIds((cur) => {
    const next = new Set(cur);
    if (allCatSelected) launchRows.forEach((r) => next.delete(r.id));
    else launchRows.forEach((r) => next.add(r.id));
    return next;
  });

  const exportLaunchExcel = () => {
    if (!targetLaunch.length) return;
    const rows: XlsCell[][] = [['カテゴリ', 'モデル', 'SKU', '発売日', '日本価格(税込)', 'USD価格', '市場為替(円/$)', 'Appleレート(円/$)', '為替比プレミアム']];
    targetLaunch.forEach((r) => {
      rows.push([
        r.category, r.name, r.sku, r.date,
        { v: r.jpy, k: 'yen' },
        r.usd != null ? { v: r.usd, k: 'int' } : '—',
        r.fx != null ? { v: r.fx, k: 'dec' } : '—',
        r.apple != null ? { v: r.apple, k: 'dec' } : '—',
        r.premiumRatio != null ? { v: r.premiumRatio, k: 'pct' } : '—',
      ]);
    });
    const today = new Date().toISOString().slice(0, 10);
    downloadXlsx(`apple-fx-launch-${today}.xlsx`, [{ name: '発売時価格と為替', rows, freezeRows: 1 }]);
    toast(`${pickedLaunch.length ? `選択した${pickedLaunch.length}機種` : `${cat} (${targetLaunch.length}機種)`}をExcelでダウンロードしました`);
  };

  const p = products.find((x) => x.id === sel.pid) ?? products[0];
  const sku = pricedSkus(p).find((s) => s.id === sel.sid) ?? pricedSkus(p)[0];
  const h = sku.priceHistory;
  const tl = useMemo(() => buildDeviceTimeline(p, sku), [p, sku]);
  const b = h[0]; const bAr = impliedRate(b);
  const idx = tl.points.map(( item ) => {
    const x = item.pt;
    return {
      t: item.t, JPY: (x.appleStorePrice / b.appleStorePrice) * 100,
      USD: x.usdPrice && b.usdPrice ? (x.usdPrice / b.usdPrice) * 100 : null,
      市場為替: x.exchangeRate && b.exchangeRate ? (x.exchangeRate / b.exchangeRate) * 100 : null,
      Appleレート: bAr && impliedRate(x) ? (impliedRate(x)! / bAr) * 100 : null,
    };
  });
  const tip = { background: c.tipBg, border: 'none', borderRadius: 12, color: c.text, boxShadow: '0 4px 16px rgba(0,0,0,0.12)' };

  const exportBreakdownExcel = () => {
    const rows: XlsCell[][] = [[
      '日付', '機種', 'SKU', 'イベント', '日本価格(税込)', '前回比差額(円)', '円価格指数(発売時=100)',
      'USD価格', 'USD指数(発売時=100)', '市場為替(円/$)', 'Appleレート(円/$)', '改定要因の判定',
    ]];
    h.forEach((pt, i) => {
      const prev = i > 0 ? h[i - 1] : null;
      const ar = impliedRate(pt);
      rows.push([
        pt.date, p.name, sku.label, pt.event,
        { v: pt.appleStorePrice, k: 'yen' },
        prev ? { v: pt.appleStorePrice - prev.appleStorePrice, k: 'yenDiff' } : '—',
        { v: (pt.appleStorePrice / b.appleStorePrice) * 100, k: 'dec' },
        pt.usdPrice != null ? { v: pt.usdPrice, k: 'int' } : '—',
        pt.usdPrice && b.usdPrice ? { v: (pt.usdPrice / b.usdPrice) * 100, k: 'dec' } : '—',
        pt.exchangeRate != null ? { v: pt.exchangeRate, k: 'dec' } : '—',
        ar != null ? { v: ar, k: 'dec' } : '—',
        prev ? verdict(prev, pt).text : '発売時',
      ]);
    });
    downloadXlsx(`apple-fx-${p.id}-${sku.id}.xlsx`, [{ name: '価格改定と為替内訳', rows, freezeRows: 1 }]);
    toast(`${p.name} (${sku.label}) の為替分析をExcelでダウンロードしました`);
  };

  return (
    <div className="space-y-5 sm:space-y-6">
      <div className={`${card} p-5 sm:p-6`}>
        <SectionTitle icon={<Coins className="h-5 w-5" />} title="歴代モデル 発売時価格 vs 為替レート" desc="Frankfurter API の実勢為替レート (marketUsdJpy) と、当時の消費税率 (5%/8%/10%) を除いた厳密な Apple独自レート (税抜円価格 ÷ USD価格) を比較します。" />
        <div className="mb-4 flex flex-wrap items-center gap-2.5">
          <span className="hidden sm:inline text-sm text-zinc-500">カテゴリ</span>
          <Segmented value={cat} onChange={setCat} options={cats.map((x) => ({ value: x, label: x }))} />
          <div className="ml-auto flex flex-wrap items-center gap-2.5">
            {pickedLaunch.length > 0 && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-zinc-200/80 px-3 py-1 text-xs font-semibold text-zinc-800 dark:bg-[#25272e] dark:text-zinc-200">
                {pickedLaunch.length}機種選択中
                <button onClick={() => setSelectedIds(new Set())} className="underline hover:no-underline">解除</button>
              </span>
            )}
            <button className={excelBtnCls} disabled={!targetLaunch.length} onClick={exportLaunchExcel}>
              <FileSpreadsheet className="h-4 w-4" />Excel{pickedLaunch.length > 0 ? ` (${pickedLaunch.length}件)` : ' (.xlsx)'}
            </button>
          </div>
        </div>
        <div className="h-64 sm:h-76">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={launchRows} margin={{ top: 10, right: 6, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={c.grid} strokeDasharray="3 3" />
              <XAxis dataKey="name" stroke={c.axis} fontSize={12} interval="preserveStartEnd" />
              <YAxis yAxisId="l" stroke={c.axis} fontSize={12} tickFormatter={yenAxis} width={58} />
              <YAxis yAxisId="r" orientation="right" stroke={c.axis} fontSize={12} domain={['auto', 'auto']} tickFormatter={(v) => `${v}円`} width={48} />
              <Tooltip contentStyle={tip} formatter={(v: any, n: any) => (n === '発売時価格(JPY)' ? yen(v) : typeof v === 'number' ? v.toFixed(1) : v)} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar yAxisId="l" dataKey="jpy" name="発売時価格(JPY)" fill={carrierColor('apple', dark)} fillOpacity={0.22} radius={[6, 6, 0, 0]} />
              <Line yAxisId="r" type="monotone" dataKey="fx" name="市場為替 (円/$)" stroke={carrierColor('softbank', dark)} strokeWidth={2.5} dot />
              <Line yAxisId="r" type="monotone" dataKey="apple" name="実質Appleレート (円/$)" stroke={carrierColor('docomo', dark)} strokeWidth={2.5} dot />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* スマホ向けカードリスト (md未満) */}
        <div className="mt-5 space-y-3 md:hidden">
          {launchRows.length > 0 && (
            <label className="flex cursor-pointer items-center gap-2.5 rounded-2xl bg-[#f5f5f7] px-3.5 py-2.5 text-xs font-semibold text-zinc-600 dark:bg-[#23252b] dark:text-zinc-300">
              <input type="checkbox" checked={allCatSelected} onChange={toggleLaunchCat} className="h-4 w-4 accent-zinc-900 dark:accent-zinc-200" />
              表示カテゴリの全モデルを選択 ({launchRows.length}機種)
            </label>
          )}
          {launchRows.map((r) => {
            const isSel = selectedIds.has(r.id);
            return (
              <div key={r.id} onClick={() => toggleLaunchOne(r.id)}
                className={`cursor-pointer rounded-2xl p-4 text-xs tabular-nums transition ${isSel ? 'bg-zinc-200/70 dark:bg-[#2b2d35]' : 'bg-[#f5f5f7] dark:bg-[#23252b]'}`}>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <input type="checkbox" checked={isSel} onChange={() => {}} onClick={(e) => e.stopPropagation()} className="h-4 w-4 shrink-0 accent-zinc-900 dark:accent-zinc-200" />
                    <span className="truncate text-sm font-bold text-zinc-900 dark:text-zinc-100">{r.name}</span>
                    <span className="shrink-0 text-xs text-zinc-500">({r.sku})</span>
                  </div>
                  <span className="shrink-0 text-xs text-zinc-500">{r.date}</span>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2.5 rounded-2xl bg-white p-3 dark:bg-[#1c1d22]">
                  <div>
                    <div className="text-xs text-zinc-500">発売時価格</div>
                    <div className="mt-0.5 text-sm font-bold text-zinc-900 dark:text-zinc-100">{yen(r.jpy)}</div>
                    <div className="text-xs text-zinc-500">{r.usd != null ? `US $${r.usd}` : '—'}</div>
                  </div>
                  <div>
                    <div className="text-xs text-zinc-500">市場 vs Appleレート</div>
                    <div className="mt-0.5 font-semibold text-zinc-800 dark:text-zinc-200">{r.fx != null ? `1ドル${r.fx.toFixed(1)}円` : '—'} vs {r.apple != null ? `${r.apple.toFixed(1)}円` : '—'}</div>
                    {r.rateDiff != null && <div className="text-xs text-zinc-500">差: {signedRate(r.rateDiff)}/ドル</div>}
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-zinc-500">為替比プレミアム</div>
                    <div className="mt-0.5 text-sm font-bold">{r.premium != null ? <span className={r.premium > 0 ? 'text-zinc-700 dark:text-zinc-300' : 'text-[#3d6b4e] dark:text-[#88b396]'}>{signedPct(r.premium)}</span> : '—'}</div>
                  </div>
                </div>
                <div className="mt-2.5">
                  <CurrentFxFairnessBadge pt={r.curPt} compact showFairPrice={true} />
                </div>
              </div>
            );
          })}
        </div>

        {/* PC/タブレット向けテーブル (md以上) */}
        <div className="mt-5 hidden overflow-x-auto md:block">
          <table className="w-full min-w-[780px] text-sm">
            <thead>
              <tr className="text-left text-xs text-zinc-500 dark:text-zinc-400">
                <th className="w-10 px-4 py-3">
                  <input type="checkbox" aria-label="表示カテゴリの全モデルを選択" checked={allCatSelected} onChange={toggleLaunchCat} className="h-4 w-4 accent-zinc-900 dark:accent-zinc-200" />
                </th>
                {['モデル', '発売日', '日本価格', 'USD価格', '当時の市場レート vs Apple適用レート', '為替比プレミアム', '今の為替から見た判定'].map((x) => <th key={x} className="px-4 py-3 font-semibold">{x}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200/40 dark:divide-white/[0.04]">
              {launchRows.map((r) => {
                const isSel = selectedIds.has(r.id);
                return (
                  <tr key={r.id} className={`tabular-nums text-zinc-800 transition dark:text-zinc-200 ${isSel ? 'bg-zinc-200/50 dark:bg-[#25272e]' : 'hover:bg-[#f5f5f7]/60 dark:hover:bg-[#23252b]/50'}`}>
                    <td className="px-4 py-3.5">
                      <input type="checkbox" aria-label={`${r.name} を選択`} checked={isSel} onChange={() => toggleLaunchOne(r.id)} className="h-4 w-4 accent-zinc-900 dark:accent-zinc-200" />
                    </td>
                    <td className="px-4 py-3.5 font-semibold text-zinc-900 dark:text-zinc-100">{r.name} <span className="text-xs font-normal text-zinc-500">{r.sku}</span></td>
                    <td className="px-4 py-3.5 text-zinc-600 dark:text-zinc-300">{r.date}</td>
                    <td className="px-4 py-3.5 font-semibold text-zinc-900 dark:text-zinc-100">{yen(r.jpy)}</td>
                    <td className="px-4 py-3.5 text-zinc-600 dark:text-zinc-300">{r.usd != null ? `$${r.usd}` : '—'}</td>
                    <td className="px-4 py-3.5"><FxRatePairChip pt={r.pt} compact /></td>
                    <td className="px-4 py-3.5">{r.premium != null ? <span className={r.premium > 0 ? 'font-semibold text-zinc-700 dark:text-zinc-300' : 'font-semibold text-[#3d6b4e] dark:text-[#88b396]'}>{signedPct(r.premium)}</span> : '—'}</td>
                    <td className="px-4 py-3.5"><CurrentFxFairnessBadge pt={r.curPt} compact showFairPrice={true} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className={`${card} p-5 sm:p-6`}>
        <h3 className="mb-3.5 text-base font-bold text-zinc-900 dark:text-zinc-100">価格改定の内訳: ドル建て据え置き？ それともドル自体が値上がり？</h3>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <ProductSkuPicker products={products} sel={{ pid: p.id, sid: sku.id }} onChange={setSel} />
          <button className={`${excelBtnCls} w-full sm:w-auto`} onClick={exportBreakdownExcel}><FileSpreadsheet className="h-4 w-4" />Excel (.xlsx)</button>
        </div>
        <div className="mt-5 h-60 sm:h-68">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={idx} margin={{ top: 10, right: 20, left: 4, bottom: 4 }}>
              <CartesianGrid stroke={c.grid} strokeDasharray="3 3" />
              <XAxis
                dataKey="t"
                type="number"
                scale="time"
                domain={[tl.minT, tl.maxT]}
                ticks={tl.xTicks}
                tickFormatter={tl.formatXTick}
                interval="preserveStartEnd"
                padding={{ left: 16, right: 24 }}
                stroke={c.axis}
                fontSize={12}
              />
              <YAxis stroke={c.axis} fontSize={12} domain={['auto', 'auto']} tickFormatter={(v) => `${Math.round(v)}`} width={40} />
              <Tooltip contentStyle={tip} labelFormatter={(t: any) => `${new Date(t).toISOString().slice(0, 10)} (${ymJp(Number(t))})`} formatter={(v: any) => (typeof v === 'number' ? v.toFixed(1) : v)} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line type="stepAfter" dataKey="JPY" name="円価格 (発売時=100)" stroke={carrierColor('apple', dark)} strokeWidth={3} dot />
              <Line type="stepAfter" dataKey="USD" name="USD価格" stroke={carrierColor('au', dark)} strokeWidth={2} dot connectNulls />
              <Line type="monotone" dataKey="市場為替" name="市場為替" stroke={carrierColor('softbank', dark)} strokeWidth={2} strokeDasharray="5 4" dot connectNulls />
              <Line type="monotone" dataKey="Appleレート" name="実質Appleレート" stroke={carrierColor('rakuten', dark)} strokeWidth={2} dot connectNulls />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-5 space-y-3">
          {h.map((pt, i) => {
            if (!i) return null;
            const prev = h[i - 1]; const v = verdict(prev, pt);
            const ar = impliedRate(pt); const pr = impliedRate(prev);
            return (
              <div key={pt.date} className="rounded-2xl bg-[#f5f5f7] p-4 dark:bg-[#23252b]">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-bold tabular-nums text-zinc-900 dark:text-zinc-100">{pt.date}</span>
                  <DeltaBadge diff={pt.appleStorePrice - prev.appleStorePrice} base={prev.appleStorePrice} />
                  <span className={`rounded-full px-3 py-1 text-xs font-semibold ${v.tone === 'down' ? 'bg-[#eaf2ed] text-[#3d6b4e] dark:bg-[#1e2b24] dark:text-[#88b396]' : 'bg-zinc-200/80 text-zinc-700 dark:bg-[#1c1d22] dark:text-zinc-300'}`}>{v.text}</span>
                </div>
                <div className="mt-2 grid gap-x-6 gap-y-1 text-xs sm:text-sm tabular-nums text-zinc-600 dark:text-zinc-400 sm:grid-cols-3">
                  <div>USD: {prev.usdPrice != null ? `$${prev.usdPrice}` : '—'} → {pt.usdPrice != null ? `$${pt.usdPrice}` : '—'}</div>
                  <div>市場為替: {prev.exchangeRate ?? '—'} → {pt.exchangeRate ?? '—'}</div>
                  <div>Appleレート: {pr ? pr.toFixed(1) : '—'} → {ar ? ar.toFixed(1) : '—'}</div>
                </div>
              </div>
            );
          })}
          {h.length < 2 && <div className="text-sm text-zinc-500">このSKUには改定履歴がありません (発売時のみ)。</div>}
        </div>
      </div>
    </div>
  );
}

export default LaunchFxView;
