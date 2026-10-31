// 生成スクリプト: node data/iphone-13-series.mjs > data/iphone-13-series.json
const L = '発売時', HIKE = '円安に伴う価格改定（値上げ）';
const N1 = 'iPhone 14発表に伴う価格改定（値下げ）', N2 = 'iPhone 15発表に伴う価格改定（値下げ）', DISC = '販売終了';
const FX = { l: 110.5, h: 136.0, a: 143.5, b: 147.5, c: 142.5 };
const D = { l: '2021-09-24', h: '2022-07-01', a: '2022-09-08', b: '2023-09-13', c: '2024-09-10' };
const prof = {
  docomo: { m: 1.01, ret: 23 / 36, prog: 'いつでもカエドキプログラム', mo: 23, mnp: 22000 },
  au: { m: 1.01, ret: 0.5, prog: 'スマホトクするプログラム', mo: 25, mnp: 22000 },
  softbank: { m: 1.0, ret: 0.5, prog: '新トクするサポート', mo: 25, mnp: 21600 },
  rakuten: { m: 1.0, ret: 0.5, prog: 'iPhoneアップグレードプログラム', mo: 24, mnp: 20000 },
};
const r10 = (n) => Math.round(n / 10) * 10;
const pt = (d, event, j, u, f, extra = {}) => ({ date: d, event, appleStorePrice: j, usdPrice: u, exchangeRate: f, ...extra });

function sku(storage, h) {
  const first = h[0].appleStorePrice, last = h[h.length - 1].appleStorePrice;
  const carriers = { apple: { launchPrice: first, currentPrice: last, mnpPrice: null, returnProgram: null } };
  for (const [k, p] of Object.entries(prof)) {
    const cur = r10(last * p.m), pay = r10(cur * (1 - p.ret));
    carriers[k] = {
      launchPrice: r10(first * p.m), currentPrice: cur, mnpPrice: cur - p.mnp,
      returnProgram: { name: p.prog, months: p.mo, effectiveCost: pay, residualValue: cur - pay },
      note: 'キャリア価格は推定値(Apple価格×係数−割引額)。実額は当時の公式発表で要確認',
    };
  }
  return { id: storage, label: storage, storage, connectivity: '-', priceHistory: h, carriers };
}
const AP = { approx: true, note: '概算値・要確認' };
const common = {
  connectivity: ['5G (Sub-6 / mmWave)', 'Wi-Fi 6', 'Bluetooth 5.0', 'nano-SIM + eSIM'],
  bands: '5G: n1/n2/n3/n5/n7/n8/n12/n20/n25/n28/n30/n38/n40/n41/n66/n77/n78/n79, mmWave n257/n258/n260/n261 (日本モデル)',
  ports: 'Lightning', os: 'iOS 15 〜',
};
const P = (id, name, specs, skus) => ({ id, category: 'iPhone', name, generation: '第14世代 (2021)', releaseDate: D.l, specs: { ...common, ...specs }, skus });

// [容量, 発売時JPY, 発売時USD, 値上げ後JPY, 2022-09 JPY, 2022-09 USD, 2023-09 JPY, 2023-09 USD]
const mini = [['128GB', 86800, 699, 99800, 92800, 599], ['256GB', 98800, 799, 114800, 107800, 699], ['512GB', 122800, 999, 144800, 136800, 899]]
  .map(([s, j, u, hj, aj, au]) => sku(s, [
    pt(D.l, L, j, u, FX.l), pt(D.h, HIKE, hj, u, FX.h),
    pt(D.a, N1, aj, au, FX.a, AP),
    pt(D.b, DISC, aj, au, FX.b, { note: 'iPhone 15発表に伴い販売終了(価格は終了時点)' }),
  ]));
const std = [['128GB', 98800, 799, 117800, 107800, 699, 99800, 599], ['256GB', 110800, 899, 132800, 122800, 799, 114800, 699], ['512GB', 134800, 1099, 162800, 152800, 999, 144800, 899]]
  .map(([s, j, u, hj, aj, au, bj, bu]) => sku(s, [
    pt(D.l, L, j, u, FX.l), pt(D.h, HIKE, hj, u, FX.h),
    pt(D.a, N1, aj, au, FX.a, AP), pt(D.b, N2, bj, bu, FX.b, AP),
    pt(D.c, DISC, bj, bu, FX.c, { note: 'iPhone 16発表に伴い販売終了(価格は終了時点)' }),
  ]));
const pro = (rows) => rows.map(([s, j, u, hj]) => sku(s, [
  pt(D.l, L, j, u, FX.l), pt(D.h, HIKE, hj, u, FX.h),
  pt(D.a, DISC, hj, u, FX.a, { note: 'iPhone 14 Pro発表に伴い販売終了(価格は終了時点)' }),
]));

const products = [
  P('iphone-13-mini', 'iPhone 13 mini', { soc: 'A15 Bionic (6コアCPU / 4コアGPU)', ram: '4GB', display: '5.4インチ Super Retina XDR OLED 2340×1080 (476ppi / 60Hz)', battery: '2,406mAh (ビデオ再生 最大17時間)', weight: '141g', camera: '12MP デュアル (広角+超広角)' }, mini),
  P('iphone-13', 'iPhone 13', { soc: 'A15 Bionic (6コアCPU / 4コアGPU)', ram: '4GB', display: '6.1インチ Super Retina XDR OLED 2532×1170 (460ppi / 60Hz)', battery: '3,227mAh (ビデオ再生 最大19時間)', weight: '174g', camera: '12MP デュアル (広角+超広角)' }, std),
  P('iphone-13-pro', 'iPhone 13 Pro', { soc: 'A15 Bionic (6コアCPU / 5コアGPU)', ram: '6GB', display: '6.1インチ Super Retina XDR OLED ProMotion 2532×1170 (460ppi / 10-120Hz)', battery: '3,095mAh (ビデオ再生 最大22時間)', weight: '204g', camera: '12MP トリプル (望遠+広角+超広角) + LiDAR' },
    pro([['128GB', 122800, 999, 144800], ['256GB', 134800, 1099, 159800], ['512GB', 158800, 1299, 189800], ['1TB', 182800, 1499, 219800]])),
  P('iphone-13-pro-max', 'iPhone 13 Pro Max', { soc: 'A15 Bionic (6コアCPU / 5コアGPU)', ram: '6GB', display: '6.7インチ Super Retina XDR OLED ProMotion 2778×1284 (458ppi / 10-120Hz)', battery: '4,352mAh (ビデオ再生 最大28時間)', weight: '240g', camera: '12MP トリプル (望遠+広角+超広角) + LiDAR' },
    pro([['128GB', 134800, 1099, 159800], ['256GB', 146800, 1199, 174800], ['512GB', 170800, 1399, 204800], ['1TB', 194800, 1599, 234800]])),
];
const ser=(v,ind)=>{const s=JSON.stringify(v);if(s.length<420||typeof v!=="object")return s;const pad="  ".repeat(ind+1);if(Array.isArray(v))return "[\n"+v.map(x=>pad+ser(x,ind+1)).join(",\n")+"\n"+"  ".repeat(ind)+"]";return "{\n"+Object.entries(v).map(([k,x])=>pad+JSON.stringify(k)+": "+ser(x,ind+1)).join(",\n")+"\n"+"  ".repeat(ind)+"}";};
console.log(ser({ schemaVersion: 1, meta: { title: 'iPhone 13 シリーズ ヒストリカルデータ', generatedAt: '2026-10-31', disclaimer: '2021-09発売時・2022-07-01値上げ価格は公開情報ベース。2022-09/2023-09の値下げ価格(approx=true)とキャリア価格(推定値)は要検証。' }, products },0));
