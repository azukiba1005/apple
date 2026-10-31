// AppleDB (https://api.appledb.dev/device/main.json) でスペック/販売終了日を補強・検証する
// 使い方:
//   curl -sSL -o data/appledb-main.json https://api.appledb.dev/device/main.json
//   node data/enrich-with-appledb.mjs data/detail/iphone-13-series.json data/iphone-13-series.enriched.json
import { readFileSync, writeFileSync } from 'node:fs';

const [, , inFile = 'data/detail/iphone-13-series.json', outFile = 'data/iphone-13-series.enriched.json'] = process.argv;
const db = JSON.parse(readFileSync('data/appledb-main.json', 'utf8'));
const ds = JSON.parse(readFileSync(inFile, 'utf8'));

// 製品ID → AppleDB identifier (AppleDB は iPhone 13 mini = iPhone14,4 のように機種IDで引く)
const IDENT = {
  'iphone-13-mini': 'iPhone14,4', 'iphone-13': 'iPhone14,5', 'iphone-13-pro': 'iPhone14,2', 'iphone-13-pro-max': 'iPhone14,3',
  'iphone-14': 'iPhone14,7', 'iphone-15': 'iPhone15,4', 'iphone-16': 'iPhone17,3',
};
const info = (x, t) => x.info?.find((i) => i.type === t) ?? {};
const addDay = (d, n) => new Date(Date.parse(d) + n * 864e5).toISOString().slice(0, 10);
const report = [];

for (const p of ds.products) {
  const idf = IDENT[p.id];
  if (!idf) continue;
  const x = db.find((e) => e.type === 'iPhone' && e.identifier?.includes(idf));
  if (!x) { report.push(`✗ ${p.name}: AppleDB に ${idf} が見つかりません`); continue; }

  const cores = info(x, 'Cores'), mem = info(x, 'Memory'), pow = info(x, 'Power'), con = info(x, 'Connectivity'), soc = info(x, 'SoC'), dsp = info(x, 'Display');
  const s = p.specs;
  s.soc = `${x.soc === 'A15' ? 'A15 Bionic' : x.soc} (${cores.CPU_Core_Count}コアCPU / ${cores.GPU_Core_Count}コアGPU / Neural Engine ${cores.Neural_Engine_Core_Count}コア, ${soc.Manufacturing_Process ?? '?'})`;
  s.ram = String(mem.RAM ?? s.ram).split(' ')[0];
  s.battery = `${pow.Battery_Capacity} (ビデオ再生 最大${parseInt(pow.Battery_Life)}時間)`;
  s.ports = String(con.Ports ?? s.ports).replace(/^1x /, '');
  s.connectivity = [...(con.Cellular ?? []).slice(0, 1), con['Wi-Fi'], con.Bluetooth ? `Bluetooth ${con.Bluetooth}` : null, con['Ultra-wideband'] ? 'UWB' : null, 'nano-SIM + eSIM'].filter(Boolean);
  s.modelNumbers = (x.model ?? []).join(', ');
  s.identifier = idf;
  s.appledb = `https://appledb.dev/device-selection/${encodeURIComponent(x.name)}`;

  // 検証: 画面サイズ/リフレッシュレート (AppleDB の解像度・ppi は mini 等で不正確なため採用しない)
  if (!String(s.display).includes(String(dsp.Screen_Size).replace(/"/g, ''))) report.push(`! ${p.name}: 画面サイズ不一致 ${dsp.Screen_Size} vs ${s.display}`);
  // 検証: 容量ラインナップ
  const skuStorages = p.skus.map((k) => k.storage).sort().join(',');
  const dbStorages = (mem.Storage ?? []).slice().sort().join(',');
  if (skuStorages !== dbStorages) report.push(`! ${p.name}: 容量不一致 JSON=${skuStorages} AppleDB=${dbStorages}`);
  // 検証: 販売終了日 (AppleDB は米国日付。日本時間は +1日)
  const last = p.skus[0].priceHistory.at(-1);
  if (x.discontinued) {
    const jp = addDay(x.discontinued, 1);
    const ok = last.event === '販売終了' && last.date === jp;
    report.push(`${ok ? '✓' : '!'} ${p.name}: 販売終了 AppleDB=${x.discontinued} (JST ${jp}) / JSON=${last.event === '販売終了' ? last.date : '記載なし'}`);
  } else report.push(`- ${p.name}: AppleDB に販売終了日なし (現行/未記録)`);
}
writeFileSync(outFile, JSON.stringify(ds, null, 2));
console.log(report.join('\n'));
console.log(`→ ${outFile}`);

