// AppleDB の全商用モデル → public/products.json を生成するビルドスクリプト
//   curl -sSL -o data/appledb-main.json https://api.appledb.dev/device/main.json
//   node data/build-products.mjs
// 処理: ① AppleDB から対象カテゴリの全モデルを製品ファミリー単位に集約 (internal 除外/未発売除外)
//       ② presets.mjs で基本スペック・発売時価格を補完  ③ data/detail/*.json の詳細データで上書き統合
//       ④ data/prices/*.json (日本 Apple Store 価格履歴リサーチ) で SKU・価格改定履歴を統合
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { IPHONE, IPAD, WATCH, AIRPODS, MAC } from './presets.mjs';
import {
  estimatePlatformOffers,
  buildUsedPricingObject,
  toRakutenAffiliateUrl,
  toYahooAffiliateUrl,
} from './fetch-used-prices.mjs';

const APPLEDB_PATH = 'data/appledb-main.json';
if (!existsSync(APPLEDB_PATH)) {
  console.log('[info] data/appledb-main.json が存在しないため api.appledb.dev から取得します...');
  const res = await fetch('https://api.appledb.dev/device/main.json');
  if (!res.ok) {
    throw new Error(`Failed to fetch AppleDB main.json: HTTP ${res.status}`);
  }
  const text = await res.text();
  mkdirSync('data', { recursive: true });
  writeFileSync(APPLEDB_PATH, text);
}
const db = JSON.parse(readFileSync(APPLEDB_PATH, 'utf8'));
const TODAY = new Date().toISOString().slice(0, 10);
const first = (v) => (Array.isArray(v) ? v[0] : v);
const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);

/* ---------- 為替(概算)・消費税 ---------- */
const FX = [['2007-06-01', 123], ['2008-07-01', 106], ['2009-07-01', 95], ['2010-06-01', 90], ['2011-06-01', 80], ['2012-06-01', 79], ['2013-06-01', 97], ['2014-06-01', 102],
  ['2015-06-01', 123], ['2016-06-01', 106], ['2017-06-01', 111], ['2018-06-01', 110], ['2019-06-01', 108], ['2020-06-01', 107], ['2021-06-01', 110], ['2022-03-01', 116],
  ['2022-07-01', 136], ['2022-10-01', 147], ['2023-06-01', 140], ['2024-01-01', 146], ['2024-07-01', 158], ['2025-01-01', 156], ['2025-09-01', 148], ['2026-06-01', 150]];
function fxAt(date) {
  const t = Date.parse(date);
  if (t <= Date.parse(FX[0][0])) return FX[0][1];
  for (let i = 1; i < FX.length; i++) {
    const [d1, r1] = FX[i - 1], [d2, r2] = FX[i];
    if (t <= Date.parse(d2)) return Math.round((r1 + ((r2 - r1) * (t - Date.parse(d1))) / (Date.parse(d2) - Date.parse(d1))) * 10) / 10;
  }
  return FX.at(-1)[1];
}
const taxAt = (date) => (date < '2014-04-01' ? 0.05 : date < '2019-10-01' ? 0.08 : 0.1);

/* ---------- ファミリー正規化 ---------- */
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
function classify(x) {
  const n = x.name;
  switch (x.type) {
    case 'iPhone':
      return { cat: 'iPhone', family: n.replace(/\s*\((CDMA|GSM|GSM, 2012|China mainland|US|Global)\)\s*$/, '').trim() };
    case 'iPad': case 'iPad mini': case 'iPad Air': case 'iPad Pro': {
      let s = n.replace(/\s*\((1 or 2 TB|1TB|Mid 2012|VZ|MM|TD-LTE|GSM|CDMA)\)/g, '');
      const cell = /Cellular|3G/.test(s);
      s = s.replace(/\s*Wi-Fi(\s*\+\s*(Cellular|3G))?/, '').replace(/\s+/g, ' ').trim();
      return { cat: 'iPad', family: s, conn: cell ? 'Wi-Fi + Cellular' : 'Wi-Fi' };
    }
    case 'Apple Watch': {
      const m = n.match(/^(.*)\(([^()]*mm)\)\s*$/);
      if (!m) return { cat: 'Apple Watch', family: n, size: null, conn: 'GPS + Cellular' };
      const parts = m[2].split(',').map((p) => p.trim());
      const size = parts.find((p) => /mm$/.test(p));
      const conn = parts.find((p) => /^GPS/.test(p)) ?? 'GPS';
      const rest = parts.filter((p) => p !== size && p !== conn);
      return { cat: 'Apple Watch', family: (m[1].trim() + (rest.length ? ` (${rest.join(', ')})` : '')).trim(), size, conn };
    }
    case 'AirPods': {
      const lr = /\((Left|Right)/.test(n);
      if (!lr && !/AirPods Max/.test(n)) return null; // 充電ケース単体は除外
      return { cat: 'AirPods', family: n.replace(/\s*\((Left|Right)(?:,\s*([^)]*))?\)/, (_m, _l, rest) => (rest ? ` (${rest})` : '')).trim() };
    }
    case 'MacBook': case 'MacBook Air': case 'MacBook Pro': case 'iMac': case 'Mac mini': case 'Mac Pro': case 'Mac Studio': case 'MacBook Neo':
      if (/Developer Transition Kit/.test(n)) return null;
      return { cat: 'Mac', family: n, macType: x.type };
    default: return null;
  }
}

/* ---------- AppleDB → グループ ---------- */
const groups = new Map();
for (const x of db) {
  if (x.internal || !x.released) continue;
  const rel = first(x.released);
  if (!rel || rel > TODAY) continue; // 未発売(将来日付)は除外
  const c = classify(x);
  if (!c) continue;
  const key = `${c.cat}|${c.family}`;
  if (!groups.has(key)) groups.set(key, { ...c, devices: [], variants: [] });
  const g = groups.get(key);
  g.devices.push(x);
  g.variants.push({ conn: c.conn, size: c.size });
}

/* ---------- スペック構築 ---------- */
/* Mac のチップ違い派生モデル用フォールバック (筐体が同じなら重量・画面・端子は共通) */
function macFallback(n) {
  const mbp = (d, w, bat) => [d, null, w, 'Thunderbolt ×3 / HDMI / SDXC / MagSafe 3', bat, null, null, null];
  if (/^MacBook Pro.*14-inch.*(M[3-9]|Pro|Max)/.test(n) && /M\d/.test(n)) return mbp('14.2"', '1,600g', null);
  if (/^MacBook Pro.*16-inch.*(M[3-9]|Pro|Max)/.test(n) && /M\d/.test(n)) return mbp('16.2"', '2,140g', null);
  if (/^MacBook Pro 14-inch \(M/.test(n)) return mbp('14.2"', '1,550g', null);
  if (/^MacBook Air \(13-inch, M[4-9]/.test(n)) return ['13.6"', '16GB', '1,240g', 'Thunderbolt/USB 4 ×2 + MagSafe 3', '53.8Wh', null, null, null];
  if (/^MacBook Air \(15-inch, M[4-9]/.test(n)) return ['15.3"', '16GB', '1,510g', 'Thunderbolt/USB 4 ×2 + MagSafe 3', '66.5Wh', null, null, null];
  if (/^Mac Studio/.test(n)) return ['—', null, /Ultra/.test(n) ? '3,640g' : '2,700g', 'Thunderbolt ×4-6 / USB-A ×2 / HDMI / 10Gb Ethernet', null, null, null, null];
  if (/^MacBook Pro \(13-inch, 2020/.test(n)) return ['13.3"', null, '1,400g', 'Thunderbolt 3 ×2-4', '58Wh', null, null, null];
  if (/^MacBook Air \(Retina, 13-inch, 2020/.test(n)) return ['13.3"', null, '1,290g', 'Thunderbolt 3 ×2', '49.9Wh', null, null, null];
  if (/^MacBook Pro \(16-inch, 2019/.test(n)) return ['16"', null, '2,000g', 'Thunderbolt 3 ×4', '100Wh', null, null, null];
  if (/^iMac \(Retina 5K, 27-inch, 2020/.test(n)) return ['27" 5K', null, '8,920g', 'Thunderbolt 3 ×2 / USB-A ×4 / Ethernet', null, null, null, null];
  return undefined;
}

const info = (x, t) => x.info?.find((i) => i.type === t) ?? {};
const PRESETS = { iPhone: IPHONE, iPad: IPAD, 'Apple Watch': WATCH, AirPods: AIRPODS, Mac: MAC };
const cellularGen = (cat, date) => (cat === 'iPhone'
  ? (date < '2008-07-01' ? '2G (EDGE)' : date < '2012-09-01' ? '3G (HSPA)' : date < '2020-10-01' ? 'LTE' : '5G')
  : (date < '2012-03-01' ? '3G (HSPA)' : date < '2020-10-01' ? 'LTE' : date < '2022-10-01' ? 'LTE' : '5G (Sub-6)'));
const yenStr = (n) => `¥${n.toLocaleString('ja-JP')}`;

function buildProduct(g) {
  const devs = g.devices.slice().sort((a, b) => first(a.released).localeCompare(first(b.released)));
  const rel = first(devs[0].released);
  const pre = PRESETS[g.cat]?.[g.family] ?? (g.cat === 'Mac' ? macFallback(g.family) : undefined);
  const withInfo = devs.find((d) => d.info);
  const cores = withInfo ? info(withInfo, 'Cores') : {}, mem = withInfo ? info(withInfo, 'Memory') : {}, pow = withInfo ? info(withInfo, 'Power') : {}, con = withInfo ? info(withInfo, 'Connectivity') : {};
  const specs = {};
  const put = (k, v) => { if (v !== undefined && v !== null && v !== '') specs[k] = v; };

  const socRaw = devs.find((d) => d.soc)?.soc;
  put('soc', socRaw ? (cores.CPU_Core_Count ? `${socRaw} (${cores.CPU_Core_Count}コアCPU${cores.GPU_Core_Count ? ` / ${cores.GPU_Core_Count}コアGPU` : ''}${cores.Neural_Engine_Core_Count ? ` / Neural Engine ${cores.Neural_Engine_Core_Count}コア` : ''})` : socRaw) : undefined);
  const inch = g.family.match(/(\d+(?:\.\d+)?)-inch/)?.[1];
  const disp = pre?.[0] && pre[0] !== '—' ? (/インチ|"/.test(pre[0]) ? pre[0].replace('"', 'インチ').replace('インチ ', 'インチ ') : pre[0]) : inch ? `${inch}インチ` : undefined;
  put('display', disp);
  put('ram', pre?.[1] ?? (mem.RAM ? String(mem.RAM).split(' ')[0] : undefined));
  put('weight', pre?.[2]);
  put('ports', pre?.[3] ?? (con.Ports ? String(con.Ports).replace(/^1x /, '') : undefined));
  put('battery', pow.Battery_Capacity ? `${pow.Battery_Capacity}${pow.Battery_Life ? ` (最大${parseInt(pow.Battery_Life)}時間)` : ''}` : pre?.[4] ?? undefined);
  if (pre?.[4] && /mAh$/.test(pre[4]) && !pow.Battery_Capacity) put('battery', pre[4]);
  const conns = [];
  if (g.cat === 'iPhone') conns.push(cellularGen('iPhone', rel));
  if (g.cat === 'iPad') conns.push(g.variants.some((v) => v.conn === 'Wi-Fi + Cellular') ? `Wi-Fi / Cellular: ${cellularGen('iPad', rel)}` : 'Wi-Fi');
  if (g.cat === 'Apple Watch') conns.push(g.variants.some((v) => /Cellular/.test(v.conn)) ? 'GPS / LTE (Cellularモデル)' : 'GPS');
  if (g.cat === 'AirPods') conns.push('Bluetooth');
  if (g.cat === 'Mac') conns.push('Wi-Fi / Bluetooth');
  if (con.Cellular?.length) conns[0] = String(con.Cellular[0]);
  if (con['Wi-Fi']) conns.push(con['Wi-Fi']);
  if (con.Bluetooth) conns.push(`Bluetooth ${con.Bluetooth}`);
  put('connectivity', conns);
  const colors = [...new Set(devs.flatMap((d) => (d.colors ?? []).map((c) => c.name)))];
  put('colors', colors.length ? colors.join(' / ') : undefined);
  put('modelNumbers', [...new Set(devs.flatMap((d) => d.model ?? []))].slice(0, 8).join(', '));
  put('identifier', [...new Set(devs.flatMap((d) => d.identifier ?? []))].join(';'));
  put('appledb', `https://appledb.dev/device-selection/${encodeURIComponent(devs[0].name)}`);
  const discs = devs.map((d) => [].concat(d.discontinued ?? []).filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s)).sort().at(-1));
  if (discs.every(Boolean)) put('discontinued', addDays(discs.sort().at(-1), 1));
  const jpy = pre?.[5], usd = pre?.[6];
  if (jpy) put('launchPriceJpy', `${yenStr(jpy)} (税込・発売時最小構成)`);
  if (usd) put('launchPriceUsd', `$${usd}`);

  /* SKU */
  const fx = fxAt(rel), tax = taxAt(rel);
  const stor = (mem.Storage?.[0]) ?? pre?.[7];
  const pricePoint = () => ({
    date: rel, event: '発売時', appleStorePrice: jpy, usdPrice: usd ?? undefined, exchangeRate: fx, taxRate: tax, approx: true, note: 'プリセット値(概算・要検証): 発売時の最小構成',
  });
  const mkSku = (id, label, storage, connectivity, priced) => ({
    id, label, storage: storage ?? '', connectivity,
    priceHistory: priced && jpy ? [pricePoint()] : [], carriers: {},
  });
  let skus;
  if (g.cat === 'iPad') {
    const hasCell = g.variants.some((v) => v.conn === 'Wi-Fi + Cellular'), hasWifi = g.variants.some((v) => v.conn === 'Wi-Fi') || !hasCell;
    skus = [];
    if (hasWifi) skus.push(mkSku('wifi', `${stor ?? '最小容量'} Wi-Fi`, stor, 'Wi-Fi', true));
    if (hasCell) skus.push(mkSku('cell', `${stor ?? '最小容量'} Wi-Fi + Cellular`, stor, 'Wi-Fi + Cellular', !hasWifi));
  } else if (g.cat === 'Apple Watch') {
    const seen = new Map();
    for (const v of g.variants) seen.set(`${v.size ?? ''}|${v.conn}`, v);
    const list = [...seen.values()].sort((a, b) => parseInt(a.size ?? 0) - parseInt(b.size ?? 0) || a.conn.localeCompare(b.conn));
    const baseKey = list.find((v) => v.conn === 'GPS') ?? list[0];
    skus = list.map((v) => mkSku(slug(`${v.size ?? 'std'}-${v.conn}`), `${v.size ?? '標準'} ${v.conn}`, stor, v.conn, v === baseKey));
    if (!skus.length) skus = [mkSku('base', '標準', stor, 'GPS', true)];
  } else if (g.cat === 'Mac') {
    skus = [mkSku('base', [pre?.[1], pre?.[7]].filter(Boolean).join(' / ') || '標準構成', pre?.[7], '-', true)];
  } else {
    skus = [mkSku('base', stor ? `${stor}〜` : '標準', stor, '-', true)];
  }

  const year = rel.slice(0, 4);
  return { id: slug(g.family), category: g.cat, name: g.family, generation: `${year}年発売${g.macType ? ` (${g.macType})` : ''}`, releaseDate: rel, specs, skus, detail: false, _family: g.family };
}

const products = [...groups.values()].map(buildProduct);
const ids = new Set();
products.forEach((p) => { let id = p.id, n = 2; while (ids.has(id)) id = `${p.id}-${n++}`; p.id = id; ids.add(id); });

/* ---------- ③ 詳細データで上書き統合 ---------- */
// 詳細データ側に identifier が無い製品用の明示マッピング (詳細ID → AppleDB ファミリー名)
const DETAIL_MATCH = { 'ipad-air-11-m2': 'iPad Air 11-inch (M2)', 'mba-13-m2': 'MacBook Air (M2, 2022)', 'ipad-10': 'iPad (10th generation)', 'watch-s10': 'Apple Watch Series 10' };
const report = [];
for (const f of readdirSync('data/detail').filter((f) => f.endsWith('.json'))) {
  const ds = JSON.parse(readFileSync(`data/detail/${f}`, 'utf8'));
  for (const d of ds.products) {
    const idents = String(d.specs?.identifier ?? '').split(';').filter(Boolean);
    let idx = products.findIndex((p) => idents.length && String(p.specs.identifier ?? '').split(';').some((i) => idents.includes(i)));
    if (idx < 0 && DETAIL_MATCH[d.id]) idx = products.findIndex((p) => p.name === DETAIL_MATCH[d.id]);
    if (idx < 0) idx = products.findIndex((p) => p.name === d.name);
    if (idx >= 0) {
      const g = products[idx];
      products[idx] = { ...g, ...d, id: d.id, specs: { ...g.specs, ...d.specs }, skus: d.skus, detail: true, _family: g._family };
      report.push(`✓ 詳細統合 ${f}: ${d.name} ← ${g.name}`);
    } else {
      products.push({ ...d, detail: true });
      report.push(`＋ 詳細追加 ${f}: ${d.name} (AppleDB に対応なし)`);
    }
  }
}

/* ---------- ④ 価格リサーチデータ (data/prices/*.json) で価格履歴を統合 ---------- */
// families のキーは AppleDB ファミリー名 (= _family)。detail 製品はキャリア価格を保持したまま priceHistory だけ差し替える。
const storBytes = (s) => { const m = String(s).match(/([\d.]+)\s*(TB|GB|MB)/i); return m ? parseFloat(m[1]) * ({ TB: 1e6, GB: 1e3, MB: 1 }[m[2].toUpperCase()]) : 0; };
const skuLabel = (r) => [r.size, r.storage && r.storage !== '-' ? r.storage : '', r.connectivity && r.connectivity !== '-' ? r.connectivity : ''].filter(Boolean).join(' ') || '標準';
const EVENT_ALIAS = [
  [/^部材(コスト)?高騰に伴う価格改定（値上げ）$/, '部品コスト高騰に伴う価格改定（値上げ）'],
  [/^Apple ?Store ?(で )?SIM ?フリー(版)?販売開始$/, 'Apple Store で SIM フリー版販売開始'],
];
const normEvent = (e) => EVENT_ALIAS.reduce((s, [re, to]) => (re.test(s) ? to : s), String(e ?? '').trim());
// 販売終了で価格不明 (jpy:null) の点は直前の価格を引き継ぎ approx 扱いにする
const fillEnd = (hist) => {
  const hs = hist.filter((h) => /^\d{4}-\d{2}-\d{2}$/.test(h.date)).sort((a, b) => a.date.localeCompare(b.date));
  let last = null;
  return hs.map((h) => {
    if (typeof h.jpy === 'number') { last = h.jpy; return h; }
    if (/販売終了/.test(h.event) && last != null) return { ...h, jpy: last, confidence: h.confidence === 'high' ? 'medium' : (h.confidence ?? 'low'), note: [h.note, '終了時価格不明のため直前価格を表示'].filter(Boolean).join(' / ') };
    return h;
  });
};
const toPoints = (hist) => fillEnd(hist)
  .filter((h) => typeof h.jpy === 'number')
  .map((h) => ({
    date: h.date, event: normEvent(h.event), appleStorePrice: h.jpy,
    ...(typeof h.usd === 'number' ? { usdPrice: h.usd } : {}),
    exchangeRate: fxAt(h.date), taxRate: h.taxRate ?? taxAt(h.date),
    ...(h.confidence !== 'high' ? { approx: true } : {}),
    ...(h.confidence ? { confidence: h.confidence } : {}),
    ...(h.note ? { note: h.note } : {}), ...(h.source ? { source: h.source } : {}),
  }));
const priceStats = { families: 0, skus: 0, points: 0, unmatched: [] };
if (existsSync('data/prices')) {
  for (const f of readdirSync('data/prices').filter((f) => f.endsWith('.json') && f !== 'live-prices-cache.json')) {
    let ds;
    try { ds = JSON.parse(readFileSync(`data/prices/${f}`, 'utf8')); } catch (e) { report.push(`✗ ${f}: JSON 解析失敗 ${e.message}`); continue; }
    for (const [fam, entry] of Object.entries(ds.families ?? {})) {
      const p = products.find((x) => x._family === fam) ?? products.find((x) => x.name === fam);
      if (!p) { priceStats.unmatched.push(`${f}:${fam}`); continue; }
      const rs = (entry.skus ?? []).filter((r) => Array.isArray(r.history));
      if (!rs.length) continue;
      priceStats.families++;
      const sorted = rs.slice().sort((a, b) => parseInt(a.size ?? 0) - parseInt(b.size ?? 0) || String(a.connectivity).localeCompare(String(b.connectivity)) || storBytes(a.storage) - storBytes(b.storage));
      const newSkus = sorted.map((r) => {
        const priceHistory = toPoints(r.history);
        priceStats.skus++; priceStats.points += priceHistory.length;
        const usdOnly = r.history.filter((h) => h.jpy == null && typeof h.usd === 'number');
        return {
          id: slug(`${r.size ?? ''}-${r.storage ?? ''}-${r.connectivity ?? ''}`) || 'base', label: skuLabel(r), storage: r.storage === '-' ? '' : (r.storage ?? ''),
          connectivity: r.connectivity ?? '-', priceHistory, carriers: {},
          ...(usdOnly.length && !priceHistory.length ? { note: `日本 Apple Store 未販売。米国価格 $${usdOnly[0].usd}` } : {}),
        };
      });
      if (p.detail) {
        // 既存 SKU (キャリア価格つき) は label または storage+connectivity で突き合わせて priceHistory を差し替え
        const matchDetailSku = (n, s) => {
          if (n.label && s.label && n.label === s.label) return true;
          const nNorm = String(n.label ?? '').replace(/\s+|SSD/gi, '').toUpperCase();
          const sNorm = String(s.label ?? '').replace(/\s+|SSD/gi, '').toUpperCase();
          if (nNorm && nNorm === sNorm) return true;
          const connMatch = n.connectivity === s.connectivity || n.connectivity === '-' || s.connectivity === '-';
          return Boolean(n.storage && s.storage && n.storage === s.storage && connMatch);
        };
        const merged = p.skus.map((s) => {
          const hit = newSkus.find((n) => matchDetailSku(n, s));
          if (!hit || !hit.priceHistory.length) return s;
          const ph = hit.priceHistory;
          // キャリア価格(推定モデル値)は Apple 価格の補正比率でスケール
          const oldCur = s.priceHistory.at(-1)?.appleStorePrice, newCur = ph.at(-1).appleStorePrice;
          const k = oldCur ? newCur / oldCur : 1;
          const r10 = (n) => Math.round(n / 10) * 10;
          const carriers = Object.fromEntries(Object.entries(s.carriers).filter(([id]) => id !== 'apple').map(([id, c]) => {
            const cur = r10(c.currentPrice * k), disc = c.mnpPrice != null ? c.currentPrice - c.mnpPrice : null;
            const rp = c.returnProgram ? { ...c.returnProgram, effectiveCost: r10(c.returnProgram.effectiveCost * k), ...(c.returnProgram.residualValue != null ? { residualValue: r10(c.returnProgram.residualValue * k) } : {}) } : c.returnProgram;
            return [id, { ...c, currentPrice: cur, mnpPrice: disc != null ? cur - disc : c.mnpPrice, returnProgram: rp }];
          }));
          return { ...s, priceHistory: ph, carriers: { ...carriers, apple: { launchPrice: ph[0].appleStorePrice, currentPrice: newCur, mnpPrice: null, returnProgram: null } } };
        });
        const extra = newSkus.filter((n) => !p.skus.some((s) => matchDetailSku(n, s)));
        p.skus = [...merged, ...extra];
      } else {
        p.skus = newSkus;
      }
      // 発売時価格(最小構成)を specs に反映
      const launches = p.skus.map((s) => s.priceHistory[0]).filter(Boolean).sort((a, b) => a.date.localeCompare(b.date) || a.appleStorePrice - b.appleStorePrice);
      if (launches.length) {
        const l0 = launches.filter((l) => l.date === launches[0].date).sort((a, b) => a.appleStorePrice - b.appleStorePrice)[0];
        p.specs.launchPriceJpy = `${yenStr(l0.appleStorePrice)} (税込・発売時最小構成)`;
        if (l0.usdPrice) p.specs.launchPriceUsd = `$${l0.usdPrice}`;
      }
      p.priceResearched = true;
    }
  }
}

/* ---------- ⑤ 最新価格キャッシュ (data/prices/live-prices-cache.json) を最優先マージ ---------- */
let liveCache = null;
const LIVE_CACHE_FILE = 'data/prices/live-prices-cache.json';
if (existsSync(LIVE_CACHE_FILE)) {
  try {
    liveCache = JSON.parse(readFileSync(LIVE_CACHE_FILE, 'utf8'));
    report.push(`✓ 最新価格キャッシュ統合: ${LIVE_CACHE_FILE} (updatedAt: ${liveCache.updatedAt ?? 'unknown'})`);
  } catch (e) {
    report.push(`✗ ${LIVE_CACHE_FILE}: JSON 解析失敗 ${e.message}`);
  }
}

function findCachedSku(cachedProd, sku) {
  if (!cachedProd?.skus) return null;
  if (cachedProd.skus[sku.id]) return cachedProd.skus[sku.id];
  const skuEntries = Object.values(cachedProd.skus);
  return (
    skuEntries.find(
      (cs) =>
        cs.storage === sku.storage &&
        (cs.connectivity === sku.connectivity || cs.connectivity === '-' || sku.connectivity === '-'),
    ) ??
    skuEntries.find((cs) => cs.label && cs.label === sku.label) ??
    null
  );
}

products.forEach((p) => {
  delete p._family;
  const cachedProd =
    liveCache?.products?.[p.id] ??
    Object.values(liveCache?.products ?? {}).find((cp) => cp.name === p.name) ??
    null;

  p.skus.forEach((s) => {
    const launchPrice = s.priceHistory?.[0]?.appleStorePrice ?? s.carriers?.apple?.launchPrice ?? null;
    const cachedSku = findCachedSku(cachedProd, s);

    // 1) キャリア最新価格を最優先でマージ
    if (cachedSku?.carriers && typeof cachedSku.carriers === 'object') {
      const mergedCarriers = { ...(s.carriers ?? {}) };
      for (const [cid, cVal] of Object.entries(cachedSku.carriers)) {
        if (!cVal) continue;
        const prev = mergedCarriers[cid] ?? {};
        mergedCarriers[cid] = {
          ...prev,
          ...cVal,
          launchPrice: cVal.launchPrice ?? prev.launchPrice ?? launchPrice,
          returnProgram: cVal.returnProgram !== undefined ? cVal.returnProgram : (prev.returnProgram ?? null),
        };
        if (cid === 'rakuten' && mergedCarriers[cid].url) {
          mergedCarriers[cid].url = toRakutenAffiliateUrl(mergedCarriers[cid].url);
        }
      }
      s.carriers = mergedCarriers;
    }

    // 2) 中古最安値 (usedPricing) を最優先でマージ（キャッシュにないSKUは推定フォールバック）
    if (cachedSku?.usedPricing && cachedSku.usedPricing.lowestPrice > 0) {
      const cu = structuredClone(cachedSku.usedPricing);
      if (cu.rakuten?.url) cu.rakuten.url = toRakutenAffiliateUrl(cu.rakuten.url);
      if (cu.yahoo?.url) cu.yahoo.url = toYahooAffiliateUrl(cu.yahoo.url);
      if (cu.unused?.url) cu.unused.url = toRakutenAffiliateUrl(cu.unused.url);
      if (launchPrice && cu.lowestPrice > 0) {
        cu.resaleValuePercent = Math.round((cu.lowestPrice / launchPrice) * 100);
      }
      s.usedPricing = cu;
    } else {
      const offers = estimatePlatformOffers({
        productName: p.name,
        storage: s.storage || s.label,
        category: p.category,
        launchPrice: launchPrice || 98800,
        releaseDate: p.releaseDate,
      });
      s.usedPricing = buildUsedPricingObject({
        rakutenOffer: offers.rakutenOffer,
        yahooOffer: offers.yahooOffer,
        unusedOffer: offers.unusedOffer,
        launchPrice,
      });
    }
  });
});

/* ---------- ⑥ デバイス種別・発売日・グレード・容量順ソート ---------- */
const CATEGORY_ORDER = ['iPhone', 'iPad', 'Apple Watch', 'Mac', 'AirPods'];
const catRank = (c) => {
  const idx = CATEGORY_ORDER.indexOf(c);
  return idx >= 0 ? idx : CATEGORY_ORDER.length;
};

function skuConnRank(conn = '') {
  const c = String(conn).toUpperCase();
  if (!c || c === '-') return 0;
  if (c === 'WI-FI' || c === 'GPS') return 1;
  if (c.includes('CELLULAR')) return 2;
  return 3;
}

function skuRamRank(label = '', storage = '') {
  const m = `${label} ${storage}`.match(/(\d+)\s*GB\s*[/／]/i);
  return m ? parseInt(m[1], 10) : 0;
}

function skuStorRank(label = '', storage = '') {
  const s = `${storage} ${label}`;
  const matches = [...s.matchAll(/([\d.]+)\s*(TB|GB|MB)/gi)];
  if (!matches.length) return 0;
  const last = matches.at(-1);
  return parseFloat(last[1]) * ({ TB: 1e6, GB: 1e3, MB: 1 }[last[2].toUpperCase()] ?? 1);
}

function skuMmRank(label = '') {
  const m = String(label).match(/(\d+)\s*mm/i);
  return m ? parseInt(m[1], 10) : 0;
}

function compareSkus(a, b) {
  return (
    skuMmRank(a.label) - skuMmRank(b.label) ||
    skuConnRank(a.connectivity) - skuConnRank(b.connectivity) ||
    skuRamRank(a.label, a.storage) - skuRamRank(b.label, b.storage) ||
    skuStorRank(a.label, a.storage) - skuStorRank(b.label, b.storage) ||
    String(a.label).localeCompare(String(b.label), 'ja', { numeric: true })
  );
}

function deviceSubfamilyRank(p) {
  const n = String(p.name ?? '').normalize('NFKC');
  switch (p.category) {
    case 'iPhone':
      if (/\bSE\b/i.test(n)) return 1;
      if (/^iPhone\s*\d+e\b/i.test(n)) return 2;
      if (/\bmini\b/i.test(n)) return 3;
      if (/\bPlus\b/i.test(n)) return 5;
      if (/\bAir\b/i.test(n)) return 6;
      if (/\bPro\s+Max\b/i.test(n)) return 8;
      if (/\bPro\b/i.test(n)) return 7;
      if (/\b(Ultra|Duo)\b/i.test(n)) return 9;
      return 4; // 標準 (無印)
    case 'iPad':
      if (/\bmini\b/i.test(n)) return 2;
      if (/\bAir\b/i.test(n)) return 3;
      if (/\bPro\b/i.test(n)) return 4;
      return 1; // iPad (無印)
    case 'Apple Watch':
      if (/\bSE\b/i.test(n)) return 1;
      if (/\bUltra\b/i.test(n)) return 3;
      return 2; // Series
    case 'Mac':
      if (/^MacBook\s*(Neo|\(|$)/i.test(n)) return 1;
      if (/^MacBook\s*Air/i.test(n)) return 2;
      if (/^MacBook\s*Pro/i.test(n)) return 3;
      if (/^iMac\s*Pro/i.test(n)) return 5;
      if (/^iMac/i.test(n)) return 4;
      if (/^Mac\s*mini/i.test(n)) return 6;
      if (/^Mac\s*Studio/i.test(n)) return 7;
      if (/^Mac\s*Pro/i.test(n)) return 8;
      return 9;
    case 'AirPods':
      if (/\bMax\b/i.test(n)) return 4;
      if (/\bPro\b/i.test(n)) return 3;
      if (/Noise|Wireless/i.test(n)) return 2;
      return 1;
    default:
      return 5;
  }
}

function screenSizeRank(name = '') {
  const m = String(name).normalize('NFKC').match(/(\d+(?:\.\d+)?)\s*(?:インチ|-inch|mm)\b/i);
  return m ? parseFloat(m[1]) : 0;
}

function chipTierRank(name = '') {
  const n = String(name).normalize('NFKC');
  if (/\bM\d+\s+Ultra\b/i.test(n)) return 4;
  if (/\bM\d+\s+Max\b/i.test(n)) return 3;
  if (/\bM\d+\s+Pro\b/i.test(n)) return 2;
  if (/\bM\d+\b/i.test(n)) return 1;
  return 0;
}

function portVariantRank(name = '') {
  const n = String(name);
  if (/Two\s+(Ports|Thunderbolt)/i.test(n)) return 1;
  if (/Four\s+(Ports|Thunderbolt)/i.test(n)) return 2;
  if (/\bRack\b/i.test(n)) return 2;
  return 0;
}

function compareProducts(a, b) {
  return (
    catRank(a.category) - catRank(b.category) ||
    String(a.releaseDate ?? '').localeCompare(String(b.releaseDate ?? '')) ||
    deviceSubfamilyRank(a) - deviceSubfamilyRank(b) ||
    screenSizeRank(a.name) - screenSizeRank(b.name) ||
    chipTierRank(a.name) - chipTierRank(b.name) ||
    portVariantRank(a.name) - portVariantRank(b.name) ||
    String(a.name ?? '').localeCompare(String(b.name ?? ''), 'ja', { numeric: true })
  );
}

products.forEach((p) => {
  p.skus.sort(compareSkus);
});
products.sort(compareProducts);
mkdirSync('public', { recursive: true });
const out = { schemaVersion: 1, meta: { title: 'Apple Price Atlas 全製品データ', generatedAt: new Date().toISOString(), source: 'AppleDB (api.appledb.dev) + data/prices (価格リサーチ) + presets + data/detail', disclaimer: '価格履歴は報道・公式情報を元に収集(confidence が high 以外は概算)。プリセット由来の値とキャリア価格は推定値を含みます。公式情報で要確認。' }, products };
writeFileSync('public/products.json', JSON.stringify(out));

/* ---------- カバレッジレポート ---------- */
const fields = ['soc', 'display', 'ram', 'weight', 'ports', 'battery'];
const cats = [...new Set(products.map((p) => p.category))];
console.log(report.join('\n'));
console.log(`\n価格リサーチ: ${priceStats.families}機種 / ${priceStats.skus} SKU / ${priceStats.points}価格点${priceStats.unmatched.length ? ` / 未対応キー: ${priceStats.unmatched.join(', ')}` : ''}`);
console.log(`総製品数: ${products.length} / 詳細あり: ${products.filter((p) => p.detail).length} / 価格履歴リサーチ済: ${products.filter((p) => p.priceResearched).length} / JPY価格あり: ${products.filter((p) => p.skus.some((s) => s.priceHistory.length)).length}`);
for (const c of cats) {
  const ps = products.filter((p) => p.category === c);
  console.log(`${c.padEnd(12)} ${String(ps.length).padStart(3)}機種 | ` + fields.map((f) => `${f}:${ps.filter((p) => p.specs[f]).length}`).join(' ') + ` | JPY価格:${ps.filter((p) => p.skus.some((s) => s.priceHistory.length)).length} 改定履歴:${ps.filter((p) => p.skus.some((s) => s.priceHistory.length > 1)).length}`);
}
