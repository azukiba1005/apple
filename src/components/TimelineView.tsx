import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';
import {
  Download, FileSpreadsheet, LineChart as LineIcon, Link2,
} from 'lucide-react';
import {
  btnCls,
  buildDeviceTimeline,
  buildYenAxis,
  card,
  carrierColor,
  CatIcon,
  CurrentFxFairnessBadge,
  DeltaBadge,
  downloadFile,
  downloadXlsx,
  EmptyNote,
  excelBtnCls,
  FxRatePairChip,
  hasPrice,
  impliedRate,
  lastOf,
  marketRate,
  pricedSkus,
  ProductSkuPicker,
  rateDiffVal,
  SectionTitle,
  selectCls,
  sortCategories,
  SPEC_ROWS,
  specText,
  toCSV,
  useChartColors,
  useDark,
  yen,
  yenAxis,
  ymJp,
  type PricePoint,
  type Product,
  type Sel,
  type Sku,
  type XlsCell,
} from '../App';

/* =====================================================================================
 * 6. タブ2: 価格改定タイムライン＆推移グラフ
 * ===================================================================================== */

export const TimelineView = React.memo(function TimelineView({ products, toast }: { products: Product[]; toast: (m: string) => void }) {
  const priced = products.filter(hasPrice);
  return priced.length ? <TimelineInner products={priced} toast={toast} /> : <EmptyNote text="価格データのある機種がありません" />;
});

function TimelineInner({ products, toast }: { products: Product[]; toast: (m: string) => void }) {
  const c = useChartColors();
  const dark = useDark();
  const [sel, setSel] = useState<Sel>({ pid: products[0].id, sid: pricedSkus(products[0])[0].id });
  const p = products.find((x) => x.id === sel.pid) ?? products[0];
  const sku = pricedSkus(p).find((s) => s.id === sel.sid) ?? pricedSkus(p)[0];
  const h = sku.priceHistory;

  const events = h.map((pt, i) => ({ pt, diff: i ? pt.appleStorePrice - h[i - 1].appleStorePrice : 0, prev: i ? h[i - 1].appleStorePrice : pt.appleStorePrice }));
  const total = lastOf(h).appleStorePrice - h[0].appleStorePrice;
  const hikes = events.filter((e) => e.diff > 0), cuts = events.filter((e) => e.diff < 0);
  const maxHike = hikes.sort((a, b) => b.diff - a.diff)[0];
  const maxCut = cuts.sort((a, b) => a.diff - b.diff)[0];
  const tl = useMemo(() => buildDeviceTimeline(p, sku), [p, sku]);
  const yAxis = useMemo(() => buildYenAxis(tl.points.map((x) => x.price)), [tl.points]);
  const timelineEvents = useMemo(() => {
    const base = h.map((pt, i) => ({ pt, diff: i ? pt.appleStorePrice - h[i - 1].appleStorePrice : 0, prev: i ? h[i - 1].appleStorePrice : pt.appleStorePrice, isEnd: i === h.length - 1 && tl.isDiscontinued && tl.endDate === pt.date }));
    const lastPt = lastOf(tl.points);
    if (tl.isDiscontinued && lastPt && lastPt.date > lastOf(h).date) {
      base.push({ pt: lastPt.pt, diff: 0, prev: lastOf(h).appleStorePrice, isEnd: true });
    }
    return base;
  }, [h, tl]);

  // 一斉改定日
  const dateCounts = new Map<string, number>();
  products.forEach((pr) => { const s = pricedSkus(pr)[0]; s.priceHistory.forEach((x, i) => { if (i && x.appleStorePrice !== s.priceHistory[i - 1].appleStorePrice) dateCounts.set(x.date, (dateCounts.get(x.date) ?? 0) + 1); }); });
  const dates = Array.from(dateCounts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([d]) => d);
  const [day, setDay] = useState(dates.includes('2022-07-01') ? '2022-07-01' : dates[0] ?? '');
  const dayRows = products.map((pr) => {
    const s = pricedSkus(pr)[0]; const i = s.priceHistory.findIndex((x) => x.date === day);
    return i > 0 ? { pr, s, diff: s.priceHistory[i].appleStorePrice - s.priceHistory[i - 1].appleStorePrice, base: s.priceHistory[i - 1].appleStorePrice, ev: s.priceHistory[i].event } : null;
  }).filter(Boolean) as { pr: Product; s: Sku; diff: number; base: number; ev: string }[];

  const exportModelTimeline = () => {
    const rows: XlsCell[][] = [[
      '日付', '機種', 'SKU', 'イベント', '日本価格(税込)', '前回比差額(円)', '変動率',
      '米国価格(USD)', '市場為替(円/$)', '実質Appleレート(円/$)', '精度', '出典', '備考',
    ]];
    h.forEach((pt, i) => {
      const prev = i > 0 ? h[i - 1].appleStorePrice : null;
      const diff = prev != null ? pt.appleStorePrice - prev : null;
      const ar = impliedRate(pt);
      rows.push([
        pt.date, p.name, sku.label, pt.event,
        { v: pt.appleStorePrice, k: 'yen' },
        diff != null && diff !== 0 ? { v: diff, k: 'yenDiff' } : '—',
        prev != null && prev > 0 && diff !== 0 ? { v: pt.appleStorePrice / prev - 1, k: 'pct' } : '—',
        pt.usdPrice != null ? { v: pt.usdPrice, k: 'int' } : '—',
        pt.exchangeRate != null ? { v: pt.exchangeRate, k: 'dec' } : '—',
        ar != null ? { v: ar, k: 'dec' } : '—',
        pt.approx ? (pt.confidence === 'low' ? '要検証' : '概算') : pt.confidence === 'high' ? '出典確認済' : '',
        pt.source ?? '',
        pt.note ?? '',
      ]);
    });
    const specRows: XlsCell[][] = [
      ['項目', `${p.name} (${sku.label})`],
      ['カテゴリ', p.category],
      ['世代', p.generation || '—'],
      ['発売日', p.releaseDate || '—'],
      ['通信方式', sku.connectivity === '-' ? '共通 (本体仕様参照)' : sku.connectivity],
      ...SPEC_ROWS.map((r): XlsCell[] => [r.label, specText(p.specs[r.key])]),
    ];
    downloadXlsx(`apple-timeline-${p.id}-${sku.id}.xlsx`, [
      { name: '価格改定タイムライン', rows, freezeRows: 1 },
      { name: 'スペック', rows: specRows, freezeRows: 1, freezeCols: 1 },
    ]);
    toast(`${p.name} (${sku.label}) の履歴をExcelでダウンロードしました`);
  };

  const exportDayRevision = () => {
    if (!dayRows.length) return;
    const rows: XlsCell[][] = [['改定日', 'カテゴリ', '製品', 'SKU', 'イベント', '改定前(円)', '改定後(円)', '差額(円)', '変動率']];
    dayRows.forEach((r) => {
      rows.push([
        day, r.pr.category, r.pr.name, r.s.label, r.ev,
        { v: r.base, k: 'yen' },
        { v: r.base + r.diff, k: 'yen' },
        { v: r.diff, k: 'yenDiff' },
        r.base > 0 ? { v: r.diff / r.base, k: 'pct' } : '—',
      ]);
    });
    downloadXlsx(`apple-revision-${day}.xlsx`, [{ name: `一斉改定_${day}`, rows, freezeRows: 1 }]);
    toast(`${day} の改定データ(${dayRows.length}件)をExcelでダウンロードしました`);
  };

  return (
    <div className="space-y-5 sm:space-y-6">
      <div className={`${card} p-5 sm:p-6`}>
        <SectionTitle icon={<LineIcon className="h-5 w-5" />} title="価格改定タイムライン＆推移グラフ" desc="Apple Store 直販価格 (税込) の変動を、改定ごとの差額・変動率つきで可視化します。" />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <ProductSkuPicker products={products} sel={{ pid: p.id, sid: sku.id }} onChange={setSel} />
          <button className={`${excelBtnCls} w-full sm:w-auto`} onClick={exportModelTimeline}><FileSpreadsheet className="h-4 w-4" />Excel (.xlsx)</button>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {[
            { label: tl.isDiscontinued ? '発売時 → 販売終了時' : '発売時 → 現在', node: <DeltaBadge diff={total} base={h[0].appleStorePrice} />, sub: `${yen(h[0].appleStorePrice)} → ${yen(lastOf(h).appleStorePrice)}` },
            { label: '最大の値上げ', node: maxHike ? <DeltaBadge diff={maxHike.diff} base={maxHike.prev} /> : <span className="text-sm text-zinc-400">値上げなし</span>, sub: maxHike ? maxHike.pt.date : '' },
            { label: '最大の値下げ', node: maxCut ? <DeltaBadge diff={maxCut.diff} base={maxCut.prev} /> : <span className="text-sm text-zinc-400">値下げなし</span>, sub: maxCut ? maxCut.pt.date : '' },
          ].map((x) => (
            <div key={x.label} className="rounded-2xl bg-[#f5f5f7] p-4 dark:bg-[#23252b]">
              <div className="mb-1.5 text-xs font-semibold text-zinc-500 dark:text-zinc-400">{x.label}</div>{x.node}<div className="mt-1.5 text-xs tabular-nums text-zinc-500 dark:text-zinc-400">{x.sub}</div>
            </div>
          ))}
        </div>
        {h.length > 0 && (
          <div className="mt-3.5 rounded-2xl bg-[#f5f5f7] p-4 dark:bg-[#23252b]">
            <div className="flex flex-wrap items-center justify-between gap-2.5">
              <div className="text-xs sm:text-sm font-bold text-zinc-800 dark:text-zinc-100">
                現在のApple Store価格 × 今の為替レート判定 ({p.name} {sku.label})
              </div>
              <CurrentFxFairnessBadge pt={lastOf(h)} showFairPrice={true} />
            </div>
            <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-semibold text-zinc-500">発売時 ({h[0].date}):</span>
                <FxRatePairChip pt={h[0]} />
              </div>
              {h.length > 1 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-semibold text-zinc-500">最新/終売時 ({lastOf(h).date}):</span>
                  <FxRatePairChip pt={lastOf(h)} />
                </div>
              )}
            </div>
          </div>
        )}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2.5 rounded-xl bg-[#f5f5f7] px-4 py-2.5 text-xs text-zinc-600 dark:bg-[#23252b] dark:text-zinc-300">
          <div className="flex flex-wrap items-center gap-2 tabular-nums">
            <span className="font-semibold text-zinc-500 dark:text-zinc-400">表示期間:</span>
            <span className="font-bold text-zinc-800 dark:text-zinc-200">{tl.startDate} (発売)</span>
            <span>〜</span>
            <span className={`font-bold ${tl.isDiscontinued ? 'text-zinc-600 dark:text-zinc-300' : 'text-[#3d6b4e] dark:text-[#88b396]'}`}>
              {tl.endDate} ({tl.isDiscontinued ? '販売終了' : '現在販売中'})
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-3.5 text-xs text-zinc-500 dark:text-zinc-400">
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-[#68829e]" />発売</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-[#a66c75]" />値上げ</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-[#649274]" />値下げ</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-zinc-500" />{tl.isDiscontinued ? '販売終了' : '現在'}</span>
          </div>
        </div>
        <div className="mt-4 h-64 sm:h-76">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={tl.points} margin={{ top: 12, right: 20, left: 4, bottom: 4 }}>
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
              <YAxis
                stroke={c.axis}
                fontSize={12}
                domain={yAxis.domain}
                ticks={yAxis.ticks}
                tickFormatter={yenAxis}
                width={58}
              />
              <Tooltip
                contentStyle={{ background: c.tipBg, border: 'none', borderRadius: 12, color: c.text, boxShadow: '0 4px 16px rgba(0,0,0,0.12)' }}
                labelFormatter={(t: any) => `${new Date(t).toISOString().slice(0, 10)} (${ymJp(Number(t))})`}
                formatter={(v: any, _n: any, item: any) => [yen(v), item?.payload?.event]}
              />
              <Line
                type="stepAfter"
                dataKey="price"
                name="Apple Store"
                stroke={carrierColor('apple', dark)}
                strokeWidth={3}
                dot={(props: any) => {
                  const { cx, cy, payload, index } = props;
                  if (cx == null || cy == null) return <g key={index} />;
                  const fill = payload?.isStart
                    ? '#68829e'
                    : payload?.diff > 0
                      ? '#a66c75'
                      : payload?.diff < 0
                        ? '#649274'
                        : '#727682';
                  return <circle key={index} cx={cx} cy={cy} r={payload?.isEnd ? 5 : 4.5} fill={fill} stroke={c.tipBg} strokeWidth={2} />;
                }}
                activeDot={{ r: 6.5 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className={`${card} p-5 sm:p-6`}>
        <h3 className="mb-4 text-base font-bold text-zinc-900 dark:text-zinc-100">改定タイムライン — {p.name} {sku.label}</h3>
        <ol className="relative ml-3 space-y-5 border-l-2 border-zinc-200/70 dark:border-white/[0.08]">
          {timelineEvents.map(({ pt, diff, prev, isEnd }, i) => (
            <li key={pt.date + i} className="ml-5">
              <span className={`absolute -left-[9px] mt-1.5 h-4 w-4 rounded-full border-2 border-white dark:border-[#1c1d22] ${i === 0 ? 'bg-[#68829e]' : diff > 0 ? 'bg-[#a66c75]' : diff < 0 ? 'bg-[#649274]' : isEnd ? 'bg-zinc-500' : 'bg-zinc-400'}`} />
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-bold tabular-nums text-zinc-900 dark:text-zinc-100">{pt.date}</span>
                <span className="text-sm text-zinc-600 dark:text-zinc-300">{pt.event}</span>
                {pt.approx && <span className="rounded-md bg-zinc-200/70 px-2 py-0.5 text-xs font-semibold text-zinc-700 dark:bg-[#25272e] dark:text-zinc-300">{pt.confidence === 'low' ? '要検証' : '概算'}</span>}
                {pt.confidence === 'high' && <span className="rounded-md bg-[#eaf2ed] px-2 py-0.5 text-xs font-semibold text-[#3d6b4e] dark:bg-[#1e2b24] dark:text-[#88b396]">出典確認済</span>}
                {pt.source && <SourceLink src={pt.source} />}
              </div>
              {pt.note && <div className="mt-1 text-xs sm:text-sm text-zinc-500">{pt.note}</div>}
              <div className="mt-1.5 flex flex-wrap items-center gap-2.5">
                <span className="text-lg sm:text-xl font-bold tabular-nums text-zinc-900 dark:text-zinc-100">{yen(pt.appleStorePrice)}</span>
                {i > 0 && diff !== 0 && <DeltaBadge diff={diff} base={prev} />}
                {pt.usdPrice != null && <span className="text-xs sm:text-sm font-semibold tabular-nums text-zinc-500">US ${pt.usdPrice}</span>}
                {i === timelineEvents.length - 1 && <CurrentFxFairnessBadge pt={pt} compact showFairPrice={true} />}
              </div>
              <div className="mt-2">
                <FxRatePairChip pt={pt} />
              </div>
            </li>
          ))}
        </ol>
      </div>

      <div className={`${card} p-5 sm:p-6`}>
        <div className="mb-4 flex flex-wrap items-center gap-2.5 sm:gap-3.5">
          <h3 className="w-full sm:w-auto text-base font-bold text-zinc-900 dark:text-zinc-100">一斉改定ビュー: この日の各製品の価格差 (最小容量SKU)</h3>
          <select className={`${selectCls} min-w-0 flex-1 sm:flex-initial`} value={day} onChange={(e) => setDay(e.target.value)}>{dates.map((d) => <option key={d} value={d}>{d} ({dateCounts.get(d)}製品)</option>)}</select>
          <button className={`${excelBtnCls} sm:ml-auto`} disabled={!dayRows.length} onClick={exportDayRevision}><FileSpreadsheet className="h-4 w-4" />Excel (.xlsx)</button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {dayRows.map((r) => (
            <div key={r.pr.id} className="flex items-center justify-between gap-3 rounded-2xl bg-[#f5f5f7] p-4 dark:bg-[#23252b]">
              <div className="min-w-0">
                <div className="flex items-center gap-2 truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  <CatIcon cat={r.pr.category} className="h-4 w-4 shrink-0 text-zinc-500" />
                  <span className="truncate">{r.pr.name}</span>
                </div>
                <div className="mt-0.5 text-xs sm:text-sm tabular-nums text-zinc-500 dark:text-zinc-400">{r.s.label}: {yen(r.base)} → {yen(r.base + r.diff)}</div>
              </div>
              <DeltaBadge diff={r.diff} base={r.base} />
            </div>
          ))}
          {!dayRows.length && <div className="text-sm text-zinc-500">該当なし</div>}
        </div>
      </div>

      <AllEventsTable products={products} toast={toast} />
    </div>
  );
}

function SourceLink({ src }: { src: string }) {
  const isUrl = /^https?:\/\//.test(src);
  let host = src;
  try { if (isUrl) host = new URL(src).hostname.replace(/^www\./, ''); } catch { /* noop */ }
  return isUrl
    ? <a href={src} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-zinc-600 underline hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200"><Link2 className="h-3 w-3" />{host}</a>
    : <span className="text-xs text-zinc-500">出典: {src}</span>;
}

/** 1行インライン為替レート表示 (Apple適用レート + 市場レート + 割高/割安バッジ) */
function InlineFxRateCell({ pt, showMarket = true }: { pt?: PricePoint; showMarket?: boolean }) {
  if (!pt) return <span className="text-xs text-zinc-400">—</span>;
  const apl = impliedRate(pt);
  const mkt = marketRate(pt);
  const diff = rateDiffVal(pt);
  if (apl == null && mkt == null) return <span className="text-xs text-zinc-400">—</span>;

  return (
    <div className="inline-flex items-center gap-2 whitespace-nowrap tabular-nums">
      {apl != null ? (
        <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">
          Apple ¥{apl.toFixed(1)}/$
        </span>
      ) : (
        <span className="text-xs text-zinc-400">Apple —</span>
      )}
      {showMarket && mkt != null && (
        <span className="text-xs text-zinc-500 dark:text-zinc-400">
          （市場 ¥{mkt.toFixed(1)}）
        </span>
      )}
      {diff != null && (
        diff > 0.5 ? (
          <span className="inline-flex items-center rounded-md bg-zinc-200/70 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:bg-[#2c2f36] dark:text-zinc-300">
            +¥{diff.toFixed(1)} 割高
          </span>
        ) : diff < -0.5 ? (
          <span className="inline-flex items-center rounded-md bg-[#eaf2ed] px-2 py-0.5 text-xs font-semibold text-[#3d6b4e] dark:bg-[#1e2b24] dark:text-[#88b396]">
            -¥{Math.abs(diff).toFixed(1)} 割安
          </span>
        ) : (
          <span className="inline-flex items-center rounded-md bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:bg-[#25272e] dark:text-zinc-300">
            {diff >= 0 ? '+' : '-'}¥{Math.abs(diff).toFixed(1)} 適正
          </span>
        )
      )}
    </div>
  );
}

/** 出典・補足テキストをコンパクトなバッジ＋ホバー/クリックポップオーバーに収納 */
function SourcePopoverBadge({ pt }: { pt: PricePoint }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const sources = useMemo(() => {
    if (!pt.source) return [];
    return pt.source
      .split(/\s*[;/]\s*/)
      .map((s) => s.trim())
      .filter(Boolean);
  }, [pt.source]);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  if (!sources.length && !pt.note) {
    return <span className="text-xs text-zinc-400">—</span>;
  }

  return (
    <div
      ref={wrapRef}
      className="relative inline-block"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-600 transition hover:bg-zinc-200 hover:text-zinc-900 dark:bg-[#25272e] dark:text-zinc-300 dark:hover:bg-zinc-700/70 dark:hover:text-zinc-100"
      >
        <span>{sources.length > 0 ? `🔗 出典 (${sources.length})` : 'ℹ️ ソース'}</span>
      </button>

      {open && (
        <div className="absolute right-0 bottom-full z-40 mb-2 w-72 sm:w-80 rounded-2xl bg-white p-4 text-left text-xs shadow-xl dark:bg-[#1c1d22]">
          <div className="mb-2 flex items-center justify-between gap-2 pb-1.5">
            <span className="font-bold text-zinc-800 dark:text-zinc-100">📚 出典・エビデンス ({sources.length}件)</span>
            {pt.confidence === 'high' ? (
              <span className="rounded-md bg-[#eaf2ed] px-2 py-0.5 text-xs font-semibold text-[#3d6b4e] dark:bg-[#1e2b24] dark:text-[#88b396]">出典確認済</span>
            ) : pt.approx ? (
              <span className="rounded-md bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:bg-[#25272e] dark:text-zinc-300">概算・推定</span>
            ) : null}
          </div>
          {sources.length > 0 && (
            <ul className="space-y-1.5 text-xs text-zinc-600 dark:text-zinc-300">
              {sources.map((s, idx) => {
                const isUrl = /^https?:\/\//.test(s);
                return (
                  <li key={idx} className="flex items-start gap-1.5 break-all">
                    <span className="mt-0.5 text-zinc-400">•</span>
                    {isUrl ? (
                      <a href={s} target="_blank" rel="noreferrer" className="text-zinc-700 underline hover:text-zinc-950 dark:text-zinc-300 dark:hover:text-zinc-100">
                        {s}
                      </a>
                    ) : (
                      <span>{s}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {pt.note && (
            <div className="mt-2.5 rounded-xl bg-[#f5f5f7] p-2.5 text-xs leading-relaxed text-zinc-600 dark:bg-[#23252b] dark:text-zinc-300">
              <span className="font-semibold text-zinc-700 dark:text-zinc-200">補足: </span>
              {pt.note}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

type EvKind = 'all' | 'launch' | 'up' | 'down' | 'end';
type EvViewMode = 'grouped' | 'flat';
interface EvRow { key: string; date: string; product: Product; sku: Sku; event: string; kind: Exclude<EvKind, 'all'>; price: number; prev?: number; usd?: number; approx?: boolean; source?: string; pt: PricePoint }

/** 同一日付のイベント配列から見出し用の代表的なイベント名を生成 */
function summarizeDateGroupEvent(groupRows: EvRow[]): string {
  const uniqueEvents = Array.from(new Set(groupRows.map((r) => r.event.trim()).filter(Boolean)));
  if (uniqueEvents.length === 0) return '価格改定イベント';
  if (uniqueEvents.length === 1) {
    const ev = uniqueEvents[0];
    if (ev === '発売時') {
      const names = Array.from(new Set(groupRows.map((r) => r.product.name)));
      if (names.length === 1) return `${names[0]} 発売`;
      if (names.length <= 3) return `${names.join(' / ')} 発売`;
      return `${names[0]} ほか計${names.length}モデル 発売`;
    }
    return ev;
  }
  const hasEnd = uniqueEvents.some((e) => /販売終了|終売/.test(e));
  const nonEnd = uniqueEvents.filter((e) => !/販売終了|終売/.test(e));
  if (hasEnd && nonEnd.length === 1) {
    const base = nonEnd[0].replace(/（値下げ）|（値上げ）$/, '');
    return `${base}・販売終了`;
  }
  if (uniqueEvents.length <= 2) return uniqueEvents.join(' ／ ');
  return `${uniqueEvents[0]} ほか (${uniqueEvents.length}種別)`;
}

/** 全機種の価格イベント (発売・値上げ・値下げ・販売終了) を一覧化 */
function AllEventsTable({ products, toast }: { products: Product[]; toast: (m: string) => void }) {
  const [kind, setKind] = useState<EvKind>('all');
  const [viewMode, setViewMode] = useState<EvViewMode>('grouped');
  const [cat, setCat] = useState('');
  const [allSkus, setAllSkus] = useState(false);
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(150);
  const [sortDesc, setSortDesc] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const cats = useMemo(() => sortCategories(Array.from(new Set(products.map((p) => p.category)))), [products]);
  const rows = useMemo(() => {
    const out: EvRow[] = [];
    products.forEach((p) => {
      const skus = allSkus ? pricedSkus(p) : pricedSkus(p).slice(0, 1);
      skus.forEach((s) => s.priceHistory.forEach((h, i) => {
        const prev = i ? s.priceHistory[i - 1].appleStorePrice : undefined;
        const k: EvRow['kind'] = i === 0 ? 'launch' : /販売終了/.test(h.event) ? 'end' : prev != null && h.appleStorePrice > prev ? 'up' : prev != null && h.appleStorePrice < prev ? 'down' : 'end';
        out.push({ key: `${p.id}|${s.id}|${h.date}|${i}`, date: h.date, product: p, sku: s, event: h.event, kind: k, price: h.appleStorePrice, prev, usd: h.usdPrice, approx: h.approx, source: h.source, pt: h });
      }));
    });
    return out;
  }, [products, allSkus]);
  const sortFn = (a: EvRow, b: EvRow) => (sortDesc ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date)) || a.product.name.localeCompare(b.product.name);
  const ql = q.trim().toLowerCase();
  const filtered = rows
    .filter((r) => (kind === 'all' || r.kind === kind) && (!cat || r.product.category === cat) && (!ql || `${r.product.name} ${r.event}`.toLowerCase().includes(ql)))
    .sort(sortFn);
  const picked = useMemo(() => rows.filter((r) => selected.has(r.key)).sort(sortFn), [rows, selected, sortDesc]);
  const targetRows = picked.length > 0 ? picked : filtered;
  const allFilteredSelected = filtered.length > 0 && filtered.every((r) => selected.has(r.key));

  const visibleRows = useMemo(() => filtered.slice(0, limit), [filtered, limit]);

  const dateGroups = useMemo(() => {
    const map = new Map<string, EvRow[]>();
    visibleRows.forEach((r) => {
      const list = map.get(r.date);
      if (list) list.push(r);
      else map.set(r.date, [r]);
    });
    return Array.from(map.entries()).map(([date, items]) => {
      const modelCount = new Set(items.map((x) => x.product.id)).size;
      const mkt = items.map((x) => marketRate(x.pt)).find((v): v is number => v != null);
      const title = summarizeDateGroupEvent(items);
      return { date, items, modelCount, marketUsdJpy: mkt, title };
    });
  }, [visibleRows]);

  const toggleOne = (key: string) => setSelected((cur) => {
    const next = new Set(cur);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const toggleGroup = (items: EvRow[]) => setSelected((cur) => {
    const next = new Set(cur);
    const allIn = items.every((r) => next.has(r.key));
    if (allIn) items.forEach((r) => next.delete(r.key));
    else items.forEach((r) => next.add(r.key));
    return next;
  });
  const toggleFiltered = () => setSelected((cur) => {
    const next = new Set(cur);
    if (allFilteredSelected) filtered.forEach((r) => next.delete(r.key));
    else filtered.forEach((r) => next.add(r.key));
    return next;
  });

  const counts = { up: rows.filter((r) => r.kind === 'up').length, down: rows.filter((r) => r.kind === 'down').length, launch: rows.filter((r) => r.kind === 'launch').length, end: rows.filter((r) => r.kind === 'end').length };
  const kindBadge: Record<EvRow['kind'], string> = {
    launch: 'bg-zinc-200/80 text-zinc-700 dark:bg-[#2c2f36] dark:text-zinc-300',
    up: 'bg-zinc-200/80 text-zinc-700 dark:bg-[#2c2f36] dark:text-zinc-300',
    down: 'bg-[#eaf2ed] text-[#3d6b4e] dark:bg-[#1e2b24] dark:text-[#88b396]',
    end: 'bg-zinc-100 text-zinc-500 dark:bg-[#25272e] dark:text-zinc-400',
  };
  const kindLabel: Record<EvRow['kind'], string> = { launch: '発売', up: '値上げ', down: '値下げ', end: '販売終了' };

  const quickFilterPills: { value: EvKind; label: string; count: number }[] = [
    { value: 'all', label: 'すべて', count: rows.length },
    { value: 'up', label: '📈 値上げのみ', count: counts.up },
    { value: 'down', label: '📉 値下げのみ', count: counts.down },
    { value: 'end', label: '📦 販売終了のみ', count: counts.end },
    { value: 'launch', label: '🚀 発売時のみ', count: counts.launch },
  ];

  const exportCsv = () => {
    if (!targetRows.length) return;
    const head = ['日付', 'カテゴリ', '製品', 'SKU', '種別', 'イベント', '改定前(円)', '改定後(円)', '差額(円)', '変動率(%)', 'USD', '概算', '出典'];
    const lines = targetRows.map((r) => [r.date, r.product.category, r.product.name, r.sku.label, kindLabel[r.kind], r.event, r.prev ?? '', r.price, r.prev != null ? r.price - r.prev : '', r.prev ? ((r.price / r.prev - 1) * 100).toFixed(1) : '', r.usd ?? '', r.approx ? '概算' : '', r.source ?? '']);
    downloadFile('apple-price-events.csv', '\uFEFF' + toCSV([head, ...lines.map((l) => l.map(String))]), 'text/csv');
    toast(`${picked.length ? `選択した${picked.length}件` : `${targetRows.length}件`}をCSVでダウンロードしました`);
  };

  const exportExcel = () => {
    if (!targetRows.length) return;
    const xlsRows: XlsCell[][] = [['日付', 'カテゴリ', '製品', 'SKU', '種別', 'イベント', '改定前(円)', '改定後(円)', '差額(円)', '変動率', 'USD', '概算', '出典']];
    targetRows.forEach((r) => {
      const diff = r.prev != null ? r.price - r.prev : null;
      xlsRows.push([
        r.date, r.product.category, r.product.name, r.sku.label, kindLabel[r.kind], r.event,
        r.prev != null ? { v: r.prev, k: 'yen' } : '—',
        { v: r.price, k: 'yen' },
        diff != null && diff !== 0 ? { v: diff, k: 'yenDiff' } : '—',
        r.prev != null && r.prev > 0 && diff !== 0 ? { v: r.price / r.prev - 1, k: 'pct' } : '—',
        r.usd != null ? { v: r.usd, k: 'int' } : '—',
        r.approx ? '概算' : '',
        r.source ?? '',
      ]);
    });
    const today = new Date().toISOString().slice(0, 10);
    downloadXlsx(`apple-price-events-${today}.xlsx`, [{ name: '価格イベント一覧', rows: xlsRows, freezeRows: 1 }]);
    toast(`${picked.length ? `選択した${picked.length}件` : `${targetRows.length}件`}をExcelでダウンロードしました`);
  };

  return (
    <div className={`${card} p-5 sm:p-6`}>
      {/* 上段: タイトル & 表示モード切替 & 出力ボタン */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-100">
            全機種 価格イベント一覧 <span className="text-xs font-semibold text-zinc-500">({filtered.length}件)</span>
          </h3>
          <div className="inline-flex rounded-xl bg-zinc-200/70 p-1 dark:bg-[#23252b]">
            <button
              type="button"
              onClick={() => setViewMode('grouped')}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${viewMode === 'grouped' ? 'bg-white text-zinc-900 shadow-2xs dark:bg-[#1c1d22] dark:text-zinc-100' : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200'}`}
            >
              📅 日付・イベント別グループ表示
            </button>
            <button
              type="button"
              onClick={() => setViewMode('flat')}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${viewMode === 'flat' ? 'bg-white text-zinc-900 shadow-2xs dark:bg-[#1c1d22] dark:text-zinc-100' : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200'}`}
            >
              📋 フラット一覧表
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {picked.length > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-zinc-200/80 px-3 py-1 text-xs font-semibold text-zinc-800 dark:bg-[#25272e] dark:text-zinc-200">
              {picked.length}件選択中
              <button onClick={() => setSelected(new Set())} className="underline hover:no-underline">解除</button>
            </span>
          )}
          <button className={excelBtnCls} disabled={!targetRows.length} onClick={exportExcel}>
            <FileSpreadsheet className="h-4 w-4" />Excel{picked.length > 0 ? ` (${picked.length}件)` : ' (.xlsx)'}
          </button>
          <button className={btnCls} disabled={!targetRows.length} onClick={exportCsv}>
            <Download className="h-4 w-4" />CSV{picked.length > 0 ? ` (${picked.length}件)` : ''}
          </button>
        </div>
      </div>

      {/* 中段: クイックフィルターピル (1クリック絞り込み) */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {quickFilterPills.map((pill) => {
          const active = kind === pill.value;
          return (
            <button
              key={pill.value}
              type="button"
              onClick={() => { setKind(pill.value); setLimit(150); }}
              className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
                active
                  ? 'bg-zinc-900 text-zinc-100 shadow-2xs dark:bg-zinc-200 dark:text-zinc-900'
                  : 'bg-[#f5f5f7] text-zinc-600 hover:bg-zinc-200/70 dark:bg-[#23252b] dark:text-zinc-300 dark:hover:bg-[#2c2f36]'
              }`}
            >
              <span>{pill.label}</span>
              <span className={`rounded-full px-1.5 py-0.5 text-xs tabular-nums ${active ? 'bg-white/20 text-current dark:bg-zinc-900/15' : 'bg-zinc-200/70 text-zinc-500 dark:bg-[#1c1d22] dark:text-zinc-400'}`}>
                {pill.count}
              </span>
            </button>
          );
        })}

        <div className="ml-auto flex flex-wrap items-center gap-2.5">
          <select className={`${selectCls} py-1.5 text-xs`} value={cat} onChange={(e) => { setCat(e.target.value); setLimit(150); }}>
            <option value="">全カテゴリ</option>
            {cats.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <input
            value={q}
            onChange={(e) => { setQ(e.target.value); setLimit(150); }}
            placeholder="製品名・イベントで検索..."
            className={`${selectCls} w-44 sm:w-56 py-1.5 text-xs`}
          />
          <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs font-medium text-zinc-700 dark:text-zinc-300">
            <input type="checkbox" checked={allSkus} onChange={(e) => setAllSkus(e.target.checked)} className="h-4 w-4 accent-zinc-900 dark:accent-zinc-200" />
            全容量SKU
          </label>
          <button className={`${btnCls} py-1.5 text-xs`} onClick={() => setSortDesc(!sortDesc)}>
            {sortDesc ? '↓ 新しい順' : '↑ 古い順'}
          </button>
        </div>
      </div>

      {filtered.length === 0 && (
        <div className="rounded-2xl bg-[#f5f5f7] py-10 text-center text-sm text-zinc-500 dark:bg-[#23252b]">
          条件に一致する価格イベントがありません
        </div>
      )}
      {/* ==================== モードA: 日付・イベント別グループ表示 (デフォルト) ==================== */}
      {viewMode === 'grouped' && filtered.length > 0 && (
        <div className="space-y-4">
          {dateGroups.map((grp) => {
            const allGrpSelected = grp.items.every((r) => selected.has(r.key));
            return (
              <div
                key={grp.date}
                className="overflow-hidden rounded-2xl bg-[#f5f5f7]/80 dark:bg-[#23252b]/80"
              >
                {/* グループヘッダー（見出しバー） */}
                <div className="flex flex-wrap items-center justify-between gap-2.5 bg-zinc-200/50 px-4 py-3 text-xs dark:bg-[#282a32]">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <input
                      type="checkbox"
                      aria-label={`${grp.date} のイベントをすべて選択`}
                      checked={allGrpSelected}
                      onChange={() => toggleGroup(grp.items)}
                      className="h-4 w-4 accent-zinc-900 dark:accent-zinc-200"
                    />
                    <span className="font-bold tabular-nums text-zinc-900 dark:text-zinc-100">
                      📅 {grp.date}
                    </span>
                    <span className="text-zinc-300 dark:text-zinc-600">｜</span>
                    <span className="font-semibold text-zinc-800 dark:text-zinc-100">
                      {grp.title}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-zinc-500 dark:text-zinc-400 tabular-nums">
                    <span>
                      （対象: <strong className="font-semibold text-zinc-700 dark:text-zinc-200">{grp.modelCount}モデル</strong>
                      {grp.items.length > grp.modelCount ? `・${grp.items.length}SKU` : ''}
                      {grp.marketUsdJpy != null && (
                        <>
                          {' / '}当日市場レート: <strong className="font-semibold text-zinc-700 dark:text-zinc-200">$1 = ¥{grp.marketUsdJpy.toFixed(1)}</strong>
                        </>
                      )}
                      ）
                    </span>
                  </div>
                </div>

                {/* グループ内の各行 */}
                <div className="divide-y divide-zinc-200/40 dark:divide-white/[0.04]">
                  {grp.items.map((r) => {
                    const isSel = selected.has(r.key);
                    const hasDiff = r.prev != null && r.prev !== r.price;
                    return (
                      <div
                        key={r.key}
                        onClick={() => toggleOne(r.key)}
                        className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 text-xs sm:text-sm transition cursor-pointer sm:flex-nowrap ${
                          isSel
                            ? 'bg-zinc-200/60 dark:bg-[#2c2f38]'
                            : 'hover:bg-white/60 dark:hover:bg-[#282b33]'
                        }`}
                      >
                        {/* 左側: チェック + 機種名・容量 + 種別バッジ */}
                        <div className="flex min-w-0 items-center gap-2.5 sm:w-[34%] sm:shrink-0">
                          <input
                            type="checkbox"
                            checked={isSel}
                            onChange={() => {}}
                            onClick={(e) => { e.stopPropagation(); toggleOne(r.key); }}
                            className="h-4 w-4 shrink-0 accent-zinc-900 dark:accent-zinc-200"
                          />
                          <span className={`shrink-0 whitespace-nowrap rounded-lg px-2 py-0.5 text-xs font-semibold ${kindBadge[r.kind]}`}>
                            {kindLabel[r.kind]}
                          </span>
                          <CatIcon cat={r.product.category} className="h-4 w-4 shrink-0 text-zinc-400" />
                          <span className="truncate font-bold text-zinc-900 dark:text-zinc-100" title={r.product.name}>
                            {r.product.name}
                          </span>
                          <span className="shrink-0 text-xs font-medium text-zinc-500 dark:text-zinc-400">
                            {r.sku.label}
                          </span>
                          {r.approx && (
                            <span className="shrink-0 rounded-md bg-zinc-200/70 px-1.5 py-0.5 text-xs font-medium text-zinc-600 dark:bg-[#2c2f36] dark:text-zinc-300">
                              概算
                            </span>
                          )}
                        </div>

                        {/* 中央左: 価格推移 (¥124,800 → ¥139,800) + US$ */}
                        <div className="flex items-center gap-1.5 whitespace-nowrap tabular-nums sm:w-[24%] sm:shrink-0">
                          {hasDiff && (
                            <>
                              <span className="text-xs text-zinc-400 line-through">{yen(r.prev)}</span>
                              <span className="text-xs text-zinc-400">→</span>
                            </>
                          )}
                          <span className="text-sm font-bold text-zinc-900 dark:text-zinc-100">{yen(r.price)}</span>
                          {r.usd != null && (
                            <span className="text-xs text-zinc-400 dark:text-zinc-500">(${r.usd})</span>
                          )}
                        </div>

                        {/* 中央右: 差額バッジ (+¥15,000 / +12.0%) */}
                        <div className="flex items-center whitespace-nowrap sm:w-[16%] sm:shrink-0">
                          {hasDiff ? (
                            <DeltaBadge diff={r.price - r.prev!} base={r.prev!} />
                          ) : (
                            <span className="text-xs text-zinc-400">—</span>
                          )}
                        </div>

                        {/* 右側: Appleレート (市場レートはヘッダーにあるため省略) + 出典ポップオーバー */}
                        <div className="flex items-center justify-end gap-2.5 sm:ml-auto">
                          <InlineFxRateCell pt={r.pt} showMarket={false} />
                          <SourcePopoverBadge pt={r.pt} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ==================== モードB: フラット一覧表 ==================== */}
      {viewMode === 'flat' && filtered.length > 0 && (
        <div className="overflow-x-auto rounded-2xl bg-[#f5f5f7]/60 dark:bg-[#23252b]/60">
          <table className="w-full min-w-[920px] text-xs sm:text-sm">
            <thead>
              <tr className="bg-zinc-200/50 text-left text-xs text-zinc-500 dark:bg-[#282a32] dark:text-zinc-400">
                <th className="w-10 px-4 py-3">
                  <input type="checkbox" aria-label="表示中のすべてを選択" checked={allFilteredSelected} onChange={toggleFiltered} className="h-4 w-4 accent-zinc-900 dark:accent-zinc-200" />
                </th>
                <th className="whitespace-nowrap px-4 py-3 font-semibold">日付</th>
                <th className="whitespace-nowrap px-4 py-3 font-semibold">製品 / SKU</th>
                <th className="whitespace-nowrap px-4 py-3 font-semibold">種別</th>
                <th className="whitespace-nowrap px-4 py-3 font-semibold">イベント</th>
                <th className="whitespace-nowrap px-4 py-3 font-semibold">価格推移 (税込)</th>
                <th className="whitespace-nowrap px-4 py-3 font-semibold">差額</th>
                <th className="whitespace-nowrap px-4 py-3 font-semibold">Appleレート（市場レート）</th>
                <th className="whitespace-nowrap px-4 py-3 text-right font-semibold">出典</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200/40 dark:divide-white/[0.04]">
              {visibleRows.map((r) => {
                const isSel = selected.has(r.key);
                const hasDiff = r.prev != null && r.prev !== r.price;
                return (
                  <tr
                    key={r.key}
                    onClick={() => toggleOne(r.key)}
                    className={`cursor-pointer align-middle text-zinc-800 transition dark:text-zinc-200 ${
                      isSel ? 'bg-zinc-200/60 dark:bg-[#2c2f38]' : 'hover:bg-white/60 dark:hover:bg-[#282b33]'
                    }`}
                  >
                    <td className="px-4 py-3.5" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        aria-label={`${r.product.name} ${r.date} を選択`}
                        checked={isSel}
                        onChange={() => toggleOne(r.key)}
                        className="h-4 w-4 accent-zinc-900 dark:accent-zinc-200"
                      />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3.5 font-semibold tabular-nums text-zinc-700 dark:text-zinc-300">{r.date}</td>
                    <td className="whitespace-nowrap px-4 py-3.5">
                      <div className="flex items-center gap-2">
                        <CatIcon cat={r.product.category} className="h-4 w-4 shrink-0 text-zinc-400" />
                        <span className="font-bold text-zinc-900 dark:text-zinc-100">{r.product.name}</span>
                        <span className="text-xs text-zinc-500">({r.sku.label})</span>
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3.5">
                      <span className={`whitespace-nowrap rounded-lg px-2.5 py-0.5 text-xs font-semibold ${kindBadge[r.kind]}`}>
                        {kindLabel[r.kind]}
                      </span>
                    </td>
                    <td className="max-w-[240px] truncate px-4 py-3.5 text-zinc-600 dark:text-zinc-300" title={r.event}>
                      {r.event}
                      {r.approx && <span className="ml-1.5 rounded-md bg-zinc-200/70 px-1.5 py-0.5 text-xs font-medium text-zinc-600 dark:bg-[#2c2f36] dark:text-zinc-300">概算</span>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3.5 tabular-nums">
                      {hasDiff && <span className="text-xs text-zinc-400 line-through">{yen(r.prev)}</span>}
                      {hasDiff && <span className="mx-1 text-xs text-zinc-400">→</span>}
                      <span className="font-bold text-zinc-900 dark:text-zinc-100">{yen(r.price)}</span>
                      {r.usd != null && <span className="ml-1.5 text-xs text-zinc-400">(${r.usd})</span>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3.5">
                      {hasDiff ? <DeltaBadge diff={r.price - r.prev!} base={r.prev!} /> : <span className="text-zinc-400">—</span>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3.5">
                      <InlineFxRateCell pt={r.pt} showMarket={true} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3.5 text-right">
                      <SourcePopoverBadge pt={r.pt} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {filtered.length > limit && (
        <button className={`${btnCls} mt-4 w-full sm:w-auto`} onClick={() => setLimit(limit + 300)}>
          さらに表示 ({limit}/{filtered.length})
        </button>
      )}
    </div>
  );
}

export default TimelineView;
