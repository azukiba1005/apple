// AppleDB の全商用モデル → public/products.json を生成するビルドスクリプト
//   curl -sSL -o data/appledb-main.json https://api.appledb.dev/device/main.json
//   node data/build-products.mjs
// 処理: ① AppleDB から対象カテゴリの全モデルを製品ファミリー単位に集約 (internal 除外/未発売除外)
//       ② presets.mjs で基本スペック・発売時価格を補完  ③ data/detail/*.json の詳細データで上書き統合
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { IPHONE, IPAD, WATCH, AIRPODS, MAC } from './presets.mjs';

const db = JSON.parse(readFileSync('data/appledb-main.json', 'utf8'));
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
  return { id: slug(g.family), category: g.cat, name: g.family, generation: `${year}年発売${g.macType ? ` (${g.macType})` : ''}`, releaseDate: rel, specs, skus, detail: false };
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
      products[idx] = { ...g, ...d, id: d.id, specs: { ...g.specs, ...d.specs }, skus: d.skus, detail: true };
      report.push(`✓ 詳細統合 ${f}: ${d.name} ← ${g.name}`);
    } else {
      products.push({ ...d, detail: true });
      report.push(`＋ 詳細追加 ${f}: ${d.name} (AppleDB に対応なし)`);
    }
  }
}

products.sort((a, b) => a.category.localeCompare(b.category) || a.releaseDate.localeCompare(b.releaseDate) || a.name.localeCompare(b.name));
mkdirSync('public', { recursive: true });
const out = { schemaVersion: 1, meta: { title: 'Apple Price Atlas 全製品データ', generatedAt: new Date().toISOString(), source: 'AppleDB (api.appledb.dev) + presets + data/detail', disclaimer: 'スペック・発売時価格のうちプリセット由来は概算(approx)です。キャリア価格は detail データのみで推定値を含みます。公式情報で要確認。' }, products };
writeFileSync('public/products.json', JSON.stringify(out));

/* ---------- カバレッジレポート ---------- */
const fields = ['soc', 'display', 'ram', 'weight', 'ports', 'battery'];
const cats = [...new Set(products.map((p) => p.category))];
console.log(report.join('\n'));
console.log(`\n総製品数: ${products.length} / 詳細あり: ${products.filter((p) => p.detail).length} / 発売時JPY価格あり: ${products.filter((p) => p.skus.some((s) => s.priceHistory.length)).length}`);
for (const c of cats) {
  const ps = products.filter((p) => p.category === c);
  console.log(`${c.padEnd(12)} ${String(ps.length).padStart(3)}機種 | ` + fields.map((f) => `${f}:${ps.filter((p) => p.specs[f]).length}`).join(' ') + ` | JPY価格:${ps.filter((p) => p.skus.some((s) => s.priceHistory.length)).length}`);
}
