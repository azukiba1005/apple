import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ComposedChart, Bar,
} from 'recharts';
import {
  Smartphone, Tablet, Watch, Laptop, Sun, Moon, TrendingUp, TrendingDown, Minus, Copy, Download,
  Check, Scale, LineChart as LineIcon, Coins, X, Link2, FileSpreadsheet,
  Info, Trophy, Apple, Headphones, Search, ShoppingBag, ExternalLink, Sparkles,
} from 'lucide-react';
import {
  estimateUsedMarketData,
  fetchUsedMarketPrice,
  type UsedMarketData,
  type UsedPricing,
} from './usedPrice';

/* =====================================================================================
 * 1. データスキーマ (TypeScript インターフェース)
 *    外部 JSON は `Dataset` もしくは `Product[]` の形式で読み込めます。
 * ===================================================================================== */

export type CarrierId = 'apple' | 'docomo' | 'au' | 'softbank' | 'rakuten';
export type Category = 'iPhone' | 'iPad' | 'Apple Watch' | 'Mac' | (string & {});
export type ConnectivityType = 'Wi-Fi' | 'Wi-Fi + Cellular' | 'GPS' | 'GPS + Cellular' | 'Cellular' | '-';

/** 価格改定履歴の1点 (Apple Store 直販価格 / 税込円) */
export interface PricePoint {
  date: string;            // YYYY-MM-DD
  event: string;           // 例: "発売時" / "円安に伴う価格改定（値上げ）"
  appleStorePrice: number; // 日本 Apple Store 税込価格 (JPY)
  usdPrice?: number;       // 米国 Apple Store 税抜価格 (USD)
  exchangeRate?: number;   // その日付近の市場為替 (JPY/USD)
  taxRate?: number;        // 当時の消費税率 (省略時 0.10)
  approx?: boolean;        // 概算値フラグ (要検証)
  confidence?: 'high' | 'medium' | 'low';
  source?: string;         // 出典 URL
  note?: string;
}

/** 返却プログラム (2年返却) の条件 */
export interface ReturnProgram {
  name: string;          // 例: "いつでもカエドキプログラム"
  months: number;        // 利用期間 (月)
  effectiveCost: number; // 返却した場合の実質負担額 (円)
  residualValue?: number;// 免除される残価 (円)
}

/** キャリア別の価格 (1 SKU × 1 キャリア) */
export interface CarrierPrice {
  launchPrice: number;            // 発売時の一括価格
  currentPrice: number;           // 現在の一括価格
  mnpPrice?: number | null;       // MNP/新規割引適用後の一括価格
  returnProgram?: ReturnProgram | null; // 2年返却プログラム適用時
  note?: string;
}

/** 容量・通信方式ごとの SKU */
export interface Sku {
  id: string;
  label: string;                  // 例: "128GB" / "256GB Wi-Fi + Cellular"
  storage: string;
  connectivity: ConnectivityType;
  priceHistory: PricePoint[];
  carriers: Partial<Record<CarrierId, CarrierPrice>>;
  usedPricing?: UsedPricing;      // 楽天市場・Yahoo!ショッピング横断中古最安値データ
}

export interface Specs {
  soc?: string; ram?: string; display?: string; battery?: string; weight?: string;
  connectivity?: string[]; bands?: string; camera?: string; ports?: string; os?: string;
  [extra: string]: string | string[] | undefined;
}

export interface Product {
  id: string;
  category: Category;
  name: string;
  generation: string;
  releaseDate: string;
  specs: Specs;
  skus: Sku[];
  detail?: boolean;       // 詳細価格データ(改定履歴/キャリア価格)あり。省略時は自動判定
  priceResearched?: boolean; // 価格履歴リサーチ済み
}

export interface Dataset {
  schemaVersion: 1;
  meta?: { title?: string; generatedAt?: string; disclaimer?: string; [k: string]: unknown };
  products: Product[];
}

/* =====================================================================================
 * 2. 初期搭載サンプルデータ
 *    ※ Apple Store 価格は公開情報ベースですが、一部は概算(approx)です。キャリア価格は
 *      キャリアごとの係数・割引額から作ったモデル値(目安)で、実際の価格とは異なります。
 * ===================================================================================== */

type H = [date: string, event: string, jpy: number, usd: number, fx: number, approx?: boolean];
const hist = (rows: H[]): PricePoint[] =>
  rows.map(([date, event, appleStorePrice, usdPrice, exchangeRate, approx]) => ({
    date, event, appleStorePrice, usdPrice, exchangeRate, ...(approx ? { approx: true } : {}),
  }));

type CarrierKey = Exclude<CarrierId, 'apple'>;
interface Profile { mult: number; mnp: number; residual: number; program: string; months: number }
const PROFILES: Record<'phone' | 'tablet' | 'watch', Record<CarrierKey, Profile>> = {
  phone: {
    docomo: { mult: 1.19, mnp: 22000, residual: 0.42, program: 'いつでもカエドキプログラム', months: 23 },
    au: { mult: 1.17, mnp: 22000, residual: 0.5, program: 'スマホトクするプログラム', months: 24 },
    softbank: { mult: 1.18, mnp: 21600, residual: 0.5, program: '新トクするサポート', months: 24 },
    rakuten: { mult: 1.02, mnp: 20000, residual: 0.5, program: 'iPhoneアップグレードプログラム', months: 24 },
  },
  tablet: {
    docomo: { mult: 1.12, mnp: 11000, residual: 0.42, program: 'いつでもカエドキプログラム', months: 23 },
    au: { mult: 1.1, mnp: 11000, residual: 0.5, program: 'スマホトクするプログラム', months: 24 },
    softbank: { mult: 1.1, mnp: 11000, residual: 0.5, program: '新トクするサポート', months: 24 },
    rakuten: { mult: 1.0, mnp: 10000, residual: 0.5, program: 'アップグレードプログラム', months: 24 },
  },
  watch: {
    docomo: { mult: 1.1, mnp: 5500, residual: 0, program: '', months: 0 },
    au: { mult: 1.08, mnp: 5500, residual: 0, program: '', months: 0 },
    softbank: { mult: 1.08, mnp: 5500, residual: 0, program: '', months: 0 },
    rakuten: { mult: 1.0, mnp: 5000, residual: 0, program: '', months: 0 },
  },
};
const r5 = (n: number) => Math.round(n / 5) * 5;

function mkCarriers(h: PricePoint[], kind: 'phone' | 'tablet' | 'watch'): Sku['carriers'] {
  const first = h[0].appleStorePrice, last = h[h.length - 1].appleStorePrice;
  const out: Sku['carriers'] = {};
  (Object.keys(PROFILES[kind]) as CarrierKey[]).forEach((c) => {
    const p = PROFILES[kind][c];
    const current = r5(last * p.mult);
    out[c] = {
      launchPrice: r5(first * p.mult),
      currentPrice: current,
      mnpPrice: Math.max(current - p.mnp, 0),
      returnProgram: p.residual > 0
        ? { name: p.program, months: p.months, effectiveCost: r5(current * (1 - p.residual)), residualValue: r5(current * p.residual) }
        : null,
    };
  });
  return out;
}

const mkSku = (id: string, label: string, storage: string, connectivity: ConnectivityType, rows: H[],
  carrierKind: 'phone' | 'tablet' | 'watch' | null): Sku => {
  const priceHistory = hist(rows);
  return { id, label, storage, connectivity, priceHistory, carriers: carrierKind ? mkCarriers(priceHistory, carrierKind) : {} };
};

const L = '発売時';
const HIKE = '円安に伴う価格改定（値上げ）';
const NEXTGEN = '次世代発表に伴う価格改定（値下げ）';

const SAMPLE_PRODUCTS: Product[] = [
  {
    id: 'iphone-13', category: 'iPhone', name: 'iPhone 13', generation: '第14世代 (2021)', releaseDate: '2021-09-24',
    specs: {
      soc: 'A15 Bionic (6コアCPU / 4コアGPU)', ram: '4GB', display: '6.1インチ Super Retina XDR OLED 2532×1170 (460ppi / 60Hz)',
      battery: '3,227mAh (ビデオ再生 最大19時間)', weight: '174g',
      connectivity: ['5G (Sub-6 / mmWave)', 'Wi-Fi 6', 'Bluetooth 5.0', 'nano-SIM + eSIM'],
      bands: '5G: n1/n3/n5/n28/n41/n77/n78/n79 ほか, mmWave n257/n258/n260/n261', camera: '12MP デュアル (広角+超広角)', ports: 'Lightning', os: 'iOS 15 〜',
    },
    skus: [
      mkSku('128', '128GB', '128GB', '-', [
        ['2021-09-24', L, 98800, 799, 110.5], ['2022-07-01', HIKE, 117800, 799, 136.0],
        ['2022-09-08', NEXTGEN, 107800, 699, 143.5],
      ], 'phone'),
      mkSku('256', '256GB', '256GB', '-', [
        ['2021-09-24', L, 110800, 899, 110.5], ['2022-07-01', HIKE, 129800, 899, 136.0],
        ['2022-09-08', NEXTGEN, 119800, 799, 143.5, true],
      ], 'phone'),
      mkSku('512', '512GB', '512GB', '-', [
        ['2021-09-24', L, 134800, 1099, 110.5], ['2022-07-01', HIKE, 153800, 1099, 136.0],
        ['2022-09-08', NEXTGEN, 143800, 999, 143.5, true],
      ], 'phone'),
    ],
  },
  {
    id: 'iphone-14', category: 'iPhone', name: 'iPhone 14', generation: '第15世代 (2022)', releaseDate: '2022-09-16',
    specs: {
      soc: 'A15 Bionic (6コアCPU / 5コアGPU)', ram: '6GB', display: '6.1インチ Super Retina XDR OLED 2532×1170 (460ppi / 60Hz)',
      battery: '3,279mAh (ビデオ再生 最大20時間)', weight: '172g',
      connectivity: ['5G (Sub-6 / mmWave)', 'Wi-Fi 6', 'Bluetooth 5.3', 'nano-SIM + eSIM', '衝突事故検出 / 衛星SOS'],
      bands: '5G: n1/n3/n5/n28/n41/n77/n78/n79 ほか, mmWave n257/n258/n260/n261', camera: '12MP デュアル (f/1.5 広角+超広角)', ports: 'Lightning', os: 'iOS 16 〜',
    },
    skus: [
      mkSku('128', '128GB', '128GB', '-', [
        ['2022-09-16', L, 119800, 799, 143.5], ['2023-09-13', NEXTGEN, 112800, 699, 147.5, true],
      ], 'phone'),
      mkSku('256', '256GB', '256GB', '-', [
        ['2022-09-16', L, 134800, 899, 143.5], ['2023-09-13', NEXTGEN, 127800, 799, 147.5, true],
      ], 'phone'),
      mkSku('512', '512GB', '512GB', '-', [
        ['2022-09-16', L, 164800, 1099, 143.5], ['2023-09-13', NEXTGEN, 157800, 999, 147.5, true],
      ], 'phone'),
    ],
  },
  {
    id: 'iphone-15', category: 'iPhone', name: 'iPhone 15', generation: '第16世代 (2023)', releaseDate: '2023-09-22',
    specs: {
      soc: 'A16 Bionic (6コアCPU / 5コアGPU)', ram: '6GB', display: '6.1インチ Super Retina XDR OLED 2556×1179 (460ppi / 60Hz) Dynamic Island',
      battery: '3,349mAh (ビデオ再生 最大20時間)', weight: '171g',
      connectivity: ['5G (Sub-6 / mmWave)', 'Wi-Fi 6', 'Bluetooth 5.3', 'UWB 第2世代', 'nano-SIM + eSIM'],
      bands: '5G: n1/n3/n5/n28/n41/n77/n78/n79 ほか, mmWave n257/n258/n260/n261', camera: '48MP メイン + 12MP 超広角', ports: 'USB-C (USB 2)', os: 'iOS 17 〜',
    },
    skus: [
      mkSku('128', '128GB', '128GB', '-', [
        ['2023-09-22', L, 124800, 799, 148.5], ['2024-09-10', NEXTGEN, 112800, 699, 142.5, true],
      ], 'phone'),
      mkSku('256', '256GB', '256GB', '-', [
        ['2023-09-22', L, 139800, 899, 148.5], ['2024-09-10', NEXTGEN, 127800, 799, 142.5, true],
      ], 'phone'),
      mkSku('512', '512GB', '512GB', '-', [
        ['2023-09-22', L, 169800, 1099, 148.5], ['2024-09-10', NEXTGEN, 157800, 999, 142.5, true],
      ], 'phone'),
    ],
  },
  {
    id: 'iphone-16', category: 'iPhone', name: 'iPhone 16', generation: '第17世代 (2024)', releaseDate: '2024-09-20',
    specs: {
      soc: 'A18 (6コアCPU / 5コアGPU)', ram: '8GB', display: '6.1インチ Super Retina XDR OLED 2556×1179 (460ppi / 60Hz)',
      battery: '3,561mAh (ビデオ再生 最大22時間)', weight: '170g',
      connectivity: ['5G (Sub-6 / mmWave)', 'Wi-Fi 7', 'Bluetooth 5.3', 'UWB 第2世代', 'nano-SIM + eSIM', 'Apple Intelligence'],
      bands: '5G: n1/n3/n5/n28/n41/n77/n78/n79 ほか, mmWave n257/n258/n260/n261', camera: '48MP Fusion + 12MP 超広角', ports: 'USB-C (USB 2)', os: 'iOS 18 〜',
    },
    skus: [
      mkSku('128', '128GB', '128GB', '-', [['2024-09-20', L, 124800, 799, 143.0]], 'phone'),
      mkSku('256', '256GB', '256GB', '-', [['2024-09-20', L, 139800, 899, 143.0]], 'phone'),
      mkSku('512', '512GB', '512GB', '-', [['2024-09-20', L, 169800, 1099, 143.0]], 'phone'),
    ],
  },
  {
    id: 'ipad-10', category: 'iPad', name: 'iPad (第10世代)', generation: '第10世代 (2022)', releaseDate: '2022-10-26',
    specs: {
      soc: 'A14 Bionic', ram: '4GB', display: '10.9インチ Liquid Retina 2360×1640 (264ppi)', battery: '28.6Wh (Wi-Fiで最大10時間)', weight: '477g (Wi-Fi) / 481g (Cellular)',
      connectivity: ['Wi-Fi 6', 'Bluetooth 5.2', '5G Sub-6 (Cellularモデル)', 'eSIM'], bands: '5G: n1/n2/n3/n5/n7/n8/n12/n20/n25/n28/n30/n38/n40/n41/n66/n77/n78/n79 (Cellular)',
      camera: '12MP 広角 / 12MP 横向き前面', ports: 'USB-C', os: 'iPadOS 16 〜',
    },
    skus: [
      mkSku('64-wifi', '64GB Wi-Fi', '64GB', 'Wi-Fi', [
        ['2022-10-26', L, 68800, 449, 148.0], ['2024-05-15', '新型iPad発表に伴う価格改定（値下げ）', 58800, 349, 156.0, true],
      ], null),
      mkSku('64-cell', '64GB Wi-Fi + Cellular', '64GB', 'Wi-Fi + Cellular', [
        ['2022-10-26', L, 92800, 599, 148.0], ['2024-05-15', '新型iPad発表に伴う価格改定（値下げ）', 82800, 499, 156.0, true],
      ], 'tablet'),
      mkSku('256-wifi', '256GB Wi-Fi', '256GB', 'Wi-Fi', [
        ['2022-10-26', L, 84800, 599, 148.0], ['2024-05-15', '新型iPad発表に伴う価格改定（値下げ）', 74800, 499, 156.0, true],
      ], null),
    ],
  },
  {
    id: 'ipad-air-11-m2', category: 'iPad', name: 'iPad Air 11インチ (M2)', generation: 'M2 (2024)', releaseDate: '2024-05-15',
    specs: {
      soc: 'Apple M2 (8コアCPU / 10コアGPU)', ram: '8GB', display: '11インチ Liquid Retina 2360×1640 (264ppi / P3)', battery: '28.93Wh (Wi-Fiで最大10時間)', weight: '462g (Wi-Fi) / 462g (Cellular)',
      connectivity: ['Wi-Fi 6E', 'Bluetooth 5.3', '5G Sub-6 (Cellularモデル)', 'eSIM'], bands: '5G: n1/n2/n3/n5/n7/n8/n12/n20/n25/n28/n30/n38/n40/n41/n66/n77/n78/n79 (Cellular)',
      camera: '12MP 広角 / 12MP 横向き前面', ports: 'USB-C (USB 3 / 10Gb/s)', os: 'iPadOS 17 〜',
    },
    skus: [
      mkSku('128-wifi', '128GB Wi-Fi', '128GB', 'Wi-Fi', [['2024-05-15', L, 98800, 599, 156.0]], null),
      mkSku('128-cell', '128GB Wi-Fi + Cellular', '128GB', 'Wi-Fi + Cellular', [['2024-05-15', L, 128800, 749, 156.0, true]], 'tablet'),
      mkSku('256-wifi', '256GB Wi-Fi', '256GB', 'Wi-Fi', [['2024-05-15', L, 118800, 699, 156.0]], null),
    ],
  },
  {
    id: 'watch-s10', category: 'Apple Watch', name: 'Apple Watch Series 10', generation: 'Series 10 (2024)', releaseDate: '2024-09-20',
    specs: {
      soc: 'S10 SiP (64bit デュアルコア)', ram: '非公開', display: '42mm: 374×446 / 46mm: 416×496 常時表示広視野角 LTPO3 OLED', battery: '通常使用 最大18時間 (急速充電 30分で約80%)', weight: '30g (42mm アルミ GPS)',
      connectivity: ['GPS (L1 + L5)', '4G LTE (Cellularモデル)', 'Wi-Fi 4', 'Bluetooth 5.3', 'UWB', 'eSIM'], bands: 'LTE: B1/B3/B5/B8/B18/B19/B26/B28 ほか',
      camera: '—', ports: '磁気急速充電', os: 'watchOS 11 〜',
    },
    skus: [
      mkSku('42-gps', '42mm GPS', '64GB', 'GPS', [['2024-09-20', L, 59800, 399, 143.0]], null),
      mkSku('42-cell', '42mm GPS + Cellular', '64GB', 'GPS + Cellular', [['2024-09-20', L, 74800, 499, 143.0]], 'watch'),
    ],
  },
  {
    id: 'mba-13-m2', category: 'Mac', name: 'MacBook Air 13インチ (M2)', generation: 'M2 (2022)', releaseDate: '2022-07-15',
    specs: {
      soc: 'Apple M2 (8コアCPU / 8コアGPU)', ram: '8GB', display: '13.6インチ Liquid Retina 2560×1664 (224ppi)', battery: '52.6Wh (ビデオ再生 最大18時間)', weight: '1.24kg',
      connectivity: ['Wi-Fi 6', 'Bluetooth 5.0'], bands: '—', camera: '1080p FaceTime HD', ports: 'MagSafe 3 / Thunderbolt 3 (USB 4) ×2 / 3.5mmジャック', os: 'macOS Monterey 〜',
    },
    skus: [
      mkSku('8-256', '8GB / 256GB SSD', '256GB', '-', [
        ['2022-07-15', L, 164800, 1199, 138.0], ['2024-03-08', 'M3搭載モデル発表に伴う価格改定（値下げ）', 148800, 999, 149.0],
      ], null),
      mkSku('8-512', '8GB / 512GB SSD', '512GB', '-', [
        ['2022-07-15', L, 198800, 1499, 138.0, true], ['2024-03-08', 'M3搭載モデル発表に伴う価格改定（値下げ）', 178800, 1199, 149.0, true],
      ], null),
    ],
  },
];

// AppleDB 連携用の機種ID (specs.identifier) と販売終了日の初期値
const APPLEDB_IDS: Record<string, string> = {
  'iphone-13': 'iPhone14,5', 'iphone-14': 'iPhone14,7', 'iphone-15': 'iPhone15,4', 'iphone-16': 'iPhone17,3',
  'ipad-10': 'iPad13,18', 'watch-s10': 'Watch7,8',
};
const SAMPLE_DISCONTINUED: Record<string, string> = {
  'iphone-13': '2024-09-10', 'iphone-14': '2025-09-10', 'iphone-15': '2026-09-10',
  'ipad-10': '2025-03-05', 'ipad-air-11-m2': '2025-03-05', 'watch-s10': '2025-09-10', 'mba-13-m2': '2025-03-06',
};
SAMPLE_PRODUCTS.forEach((p) => {
  if (APPLEDB_IDS[p.id]) p.specs.identifier = APPLEDB_IDS[p.id];
  if (SAMPLE_DISCONTINUED[p.id]) p.specs.discontinued = SAMPLE_DISCONTINUED[p.id];
});

const BUILTIN_DATASET: Dataset = {
  schemaVersion: 1,
  meta: {
    title: 'Apple Price Atlas サンプルデータ',
    generatedAt: '2026-10-31',
    disclaimer: 'Apple Store価格は公開情報ベース(概算はapprox=true)。キャリア価格はモデル算出の目安値です。必ず公式サイトで確認してください。',
  },
  products: SAMPLE_PRODUCTS,
};

/* =====================================================================================
 * 3. ユーティリティ
 * ===================================================================================== */

const TAX = 1.1;
const CARRIER_ORDER: CarrierId[] = ['apple', 'docomo', 'au', 'softbank', 'rakuten'];
const CARRIER_META: Record<CarrierId, { label: string; light: string; dark: string }> = {
  apple: { label: 'Apple Store', light: '#1d1d1f', dark: '#f5f5f7' },
  docomo: { label: 'docomo', light: '#cc0033', dark: '#ff3b5c' },
  au: { label: 'au', light: '#eb5505', dark: '#ff7a2f' },
  softbank: { label: 'SoftBank', light: '#5b7a99', dark: '#9fb4c9' },
  rakuten: { label: '楽天モバイル', light: '#bf0078', dark: '#ff4db8' },
};

const ThemeCtx = createContext(false);
const useDark = () => useContext(ThemeCtx);
const carrierColor = (id: CarrierId, dark: boolean) => (dark ? CARRIER_META[id].dark : CARRIER_META[id].light);

const yen = (n: number | null | undefined) => (n == null ? '—' : `¥${Math.round(n).toLocaleString('ja-JP')}`);
const signedYen = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : '±'}¥${Math.abs(Math.round(n)).toLocaleString('ja-JP')}`;
const signedPct = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${Math.abs(n).toFixed(1)}%`;
const ts = (d: string) => Date.parse(d + 'T00:00:00Z');
const ym = (t: number) => { const d = new Date(t); return `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`; };
const ymJp = (t: number) => { const d = new Date(t); return `${d.getUTCFullYear()}年${d.getUTCMonth() + 1}月`; };
const lastOf = <T,>(a: T[]) => a[a.length - 1];
const impliedRate = (p: PricePoint) => (p.usdPrice ? p.appleStorePrice / (1 + (p.taxRate ?? 0.1)) / p.usdPrice : undefined);

/** グラフ縦軸用の日本円フォーマット (例: 12万円 / 12.5万円 / 8,000円) */
function yenAxis(v: number): string {
  if (v === 0) return '0円';
  if (Math.abs(v) >= 10000) {
    const man = v / 10000;
    const s = Number.isInteger(man) ? String(man) : man.toFixed(man * 10 % 1 === 0 ? 1 : 2).replace(/\.?0+$/, '');
    return `${s}万円`;
  }
  return `${Math.round(v).toLocaleString('ja-JP')}円`;
}

/** 日本円の価格配列から、日本人に読みやすい「万円 / 0.5万円」刻みの縦軸 domain と ticks を算出する */
function buildYenAxis(values: number[]): { domain: [number, number]; ticks: number[] } {
  const valid = values.filter((v) => Number.isFinite(v) && v >= 0);
  if (!valid.length) return { domain: [0, 100000], ticks: [0, 50000, 100000] };
  const min = Math.min(...valid);
  const max = Math.max(...valid);
  if (min === max) {
    const step = min >= 80000 ? 10000 : min >= 20000 ? 5000 : 2000;
    const center = Math.round(min / step) * step;
    const low = Math.max(0, center - step * 2);
    const high = low + step * 4;
    const ticks: number[] = [];
    for (let v = low; v <= high; v += step) ticks.push(v);
    return { domain: [low, high], ticks };
  }
  const span = max - min;
  const pad = Math.max(span * 0.15, 2000);
  const steps = max >= 40000 ? [5000, 10000, 20000, 25000, 50000, 100000, 200000, 500000] : [2000, 5000, 10000, 20000, 50000];
  let chosen = steps[steps.length - 1];
  for (const s of steps) {
    const low = Math.max(0, Math.floor((min - pad) / s) * s);
    const high = Math.ceil((max + pad) / s) * s;
    const count = Math.round((high - low) / s);
    if (count <= 6) { chosen = s; break; }
  }
  let low = Math.max(0, Math.floor((min - pad) / chosen) * chosen);
  let high = Math.ceil((max + pad) / chosen) * chosen;
  while (Math.round((high - low) / chosen) < 3) {
    if (low >= chosen) low -= chosen;
    high += chosen;
  }
  const ticks: number[] = [];
  for (let v = low; v <= high; v += chosen) ticks.push(v);
  return { domain: [low, high], ticks };
}

interface DeviceTimelinePoint {
  t: number;
  date: string;
  price: number;
  event: string;
  diff: number;
  isStart?: boolean;
  isEnd?: boolean;
  isOngoing?: boolean;
  pt: PricePoint;
}

/**
 * 各デバイス・SKUの価格履歴から、左端=発売時、右端=販売終了日(現行機は現在)となるグラフ用データと横軸目盛りを生成する
 */
function buildDeviceTimeline(p: Product, sku: Sku) {
  const h = sku.priceHistory;
  const last = lastOf(h);
  const isEndEv = (ev: string, note?: string, idx?: number) =>
    /販売終了|終売/.test(ev) || ((idx ?? 0) > 0 && ev === '容量ラインナップ変更' && /終了|廃止|移行/.test(note ?? ''));
  const lastIsEnd = isEndEv(last.event, last.note, h.length - 1);
  const specDisc = typeof p.specs.discontinued === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.specs.discontinued) ? p.specs.discontinued : undefined;
  const siblingDisc = p.skus.flatMap((k) => k.priceHistory).find((x) => /販売終了|終売/.test(x.event))?.date;
  const endDate = lastIsEnd ? last.date : (specDisc && specDisc >= last.date ? specDisc : siblingDisc && siblingDisc >= last.date ? siblingDisc : undefined);
  const isDiscontinued = !!endDate;

  const points: DeviceTimelinePoint[] = h.map((x, idx) => ({
    t: ts(x.date),
    date: x.date,
    price: x.appleStorePrice,
    event: x.event,
    diff: idx > 0 ? x.appleStorePrice - h[idx - 1].appleStorePrice : 0,
    isStart: idx === 0,
    isEnd: idx === h.length - 1 && isDiscontinued && endDate === x.date,
    pt: x,
  }));

  if (isDiscontinued && endDate && endDate > last.date) {
    const endPt: PricePoint = { ...last, date: endDate, event: 'Apple Store販売終了' };
    points.push({
      t: ts(endDate),
      date: endDate,
      price: last.appleStorePrice,
      event: 'Apple Store販売終了',
      diff: 0,
      isEnd: true,
      pt: endPt,
    });
  } else if (!isDiscontinued) {
    const endT = Math.max(Date.now(), ts(last.date));
    const endD = new Date(endT).toISOString().slice(0, 10);
    if (endD > last.date || points.length === 1) {
      const nowPt: PricePoint = { ...last, date: endD, event: '現在 (販売中)' };
      points.push({
        t: endT,
        date: endD,
        price: last.appleStorePrice,
        event: '現在 (販売中)',
        diff: 0,
        isOngoing: true,
        pt: nowPt,
      });
    } else {
      points[points.length - 1].isOngoing = true;
    }
  }

  const minT = points[0].t;
  const maxT = points[points.length - 1].t;
  const spanDays = (maxT - minT) / 864e5;
  const stepCount = spanDays <= 90 ? 1 : spanDays <= 240 ? 2 : spanDays <= 600 ? 3 : 4;
  const xTicks: number[] = [];
  if (maxT <= minT) {
    xTicks.push(minT);
  } else {
    for (let i = 0; i <= stepCount; i++) {
      xTicks.push(Math.round(minT + ((maxT - minT) * i) / stepCount));
    }
  }

  const formatXTick = (t: number) => {
    if (maxT > minT && Math.abs(t - maxT) < 1000) {
      return isDiscontinued ? `${ym(t)} (販売終了)` : `${ym(t)} (現在)`;
    }
    if (Math.abs(t - minT) < 1000) {
      return `${ym(t)} (発売)`;
    }
    return ym(t);
  };

  return {
    points,
    minT,
    maxT,
    xTicks,
    formatXTick,
    isDiscontinued,
    startDate: points[0].date,
    endDate: points[points.length - 1].date,
  };
}
/** 価格データを持つSKU / 製品か */
const skuPriced = (s: Sku) => s.priceHistory.length > 0;
const pricedSkus = (p: Product) => p.skus.filter(skuPriced);
const hasPrice = (p: Product) => p.skus.some(skuPriced);
/** 詳細価格データ(複数回の改定 or キャリア価格)があるか */
const hasDetail = (p: Product) => hasPrice(p) && (!!p.detail || !!p.priceResearched) || p.skus.some((s) => new Set(s.priceHistory.map((h) => h.appleStorePrice)).size > 1 || Object.keys(s.carriers).some((k) => k !== 'apple'));

const CATEGORY_ORDER = ['iPhone', 'iPad', 'Apple Watch', 'Mac', 'AirPods'] as const;
const catRank = (c: string): number => {
  const idx = (CATEGORY_ORDER as readonly string[]).indexOf(c);
  return idx >= 0 ? idx : CATEGORY_ORDER.length;
};
const sortCategories = (cats: string[]): string[] =>
  [...cats].sort((a, b) => catRank(a) - catRank(b) || a.localeCompare(b, 'ja'));

function skuConnRank(conn = ''): number {
  const c = String(conn).toUpperCase();
  if (!c || c === '-') return 0;
  if (c === 'WI-FI' || c === 'GPS') return 1;
  if (c.includes('CELLULAR')) return 2;
  return 3;
}

function skuRamRank(label = '', storage = ''): number {
  const m = `${label} ${storage}`.match(/(\d+)\s*GB\s*[/／]/i);
  return m ? parseInt(m[1], 10) : 0;
}

function skuStorRank(label = '', storage = ''): number {
  const s = `${storage} ${label}`;
  const matches = [...s.matchAll(/([\d.]+)\s*(TB|GB|MB)/gi)];
  if (!matches.length) return 0;
  const last = matches[matches.length - 1];
  const mult: Record<string, number> = { TB: 1e6, GB: 1e3, MB: 1 };
  return parseFloat(last[1]) * (mult[last[2].toUpperCase()] ?? 1);
}

function skuMmRank(label = ''): number {
  const m = String(label).match(/(\d+)\s*mm/i);
  return m ? parseInt(m[1], 10) : 0;
}

function compareSkus(a: Sku, b: Sku): number {
  return (
    skuMmRank(a.label) - skuMmRank(b.label) ||
    skuConnRank(a.connectivity) - skuConnRank(b.connectivity) ||
    skuRamRank(a.label, a.storage) - skuRamRank(b.label, b.storage) ||
    skuStorRank(a.label, a.storage) - skuStorRank(b.label, b.storage) ||
    String(a.label).localeCompare(String(b.label), 'ja', { numeric: true })
  );
}

function deviceSubfamilyRank(p: Product): number {
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
      return 4;
    case 'iPad':
      if (/\bmini\b/i.test(n)) return 2;
      if (/\bAir\b/i.test(n)) return 3;
      if (/\bPro\b/i.test(n)) return 4;
      return 1;
    case 'Apple Watch':
      if (/\bSE\b/i.test(n)) return 1;
      if (/\bUltra\b/i.test(n)) return 3;
      return 2;
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

function screenSizeRank(name = ''): number {
  const m = String(name).normalize('NFKC').match(/(\d+(?:\.\d+)?)\s*(?:インチ|-inch|mm)\b/i);
  return m ? parseFloat(m[1]) : 0;
}

function chipTierRank(name = ''): number {
  const n = String(name).normalize('NFKC');
  if (/\bM\d+\s+Ultra\b/i.test(n)) return 4;
  if (/\bM\d+\s+Max\b/i.test(n)) return 3;
  if (/\bM\d+\s+Pro\b/i.test(n)) return 2;
  if (/\bM\d+\b/i.test(n)) return 1;
  return 0;
}

function portVariantRank(name = ''): number {
  const n = String(name);
  if (/Two\s+(Ports|Thunderbolt)/i.test(n)) return 1;
  if (/Four\s+(Ports|Thunderbolt)/i.test(n)) return 2;
  if (/\bRack\b/i.test(n)) return 2;
  return 0;
}

function compareProducts(a: Product, b: Product): number {
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

const CATEGORY_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  iPhone: Smartphone, iPad: Tablet, 'Apple Watch': Watch, Mac: Laptop, AirPods: Headphones,
};
const CatIcon = ({ cat, className }: { cat: string; className?: string }) => {
  const I = CATEGORY_ICON[cat] ?? Apple;
  return <I className={className} />;
};

/** 読み込み時の検証・正規化。Apple Store の carriers.apple は priceHistory から自動補完する */
function normalizeDataset(raw: unknown): { products: Product[]; errors: string[] } {
  const errors: string[] = [];
  const arr: unknown[] = Array.isArray(raw) ? raw : Array.isArray((raw as Dataset)?.products) ? (raw as Dataset).products : [];
  if (!arr.length) errors.push('products 配列が見つかりません (Product[] または { products: Product[] })');
  const products: Product[] = [];
  arr.forEach((p0, i) => {
    const p = p0 as Partial<Product>;
    const tag = `products[${i}]${p?.name ? ` (${p.name})` : ''}`;
    if (!p || typeof p !== 'object') return errors.push(`${tag}: オブジェクトではありません`);
    if (!p.id || !p.name || !p.category) return errors.push(`${tag}: id / name / category は必須です`);
    if (!Array.isArray(p.skus) || !p.skus.length) return errors.push(`${tag}: skus が空です`);
    const skus: Sku[] = [];
    p.skus.forEach((s0, j) => {
      const s = s0 as Partial<Sku>;
      if (!s?.id || !Array.isArray(s.priceHistory)) return errors.push(`${tag}.skus[${j}]: id と priceHistory(空配列可) が必要です`);
      const bad = s.priceHistory.find((h) => !h || typeof h.appleStorePrice !== 'number' || !/^\d{4}-\d{2}-\d{2}$/.test(h.date));
      if (bad) return errors.push(`${tag}.skus[${j}]: priceHistory の date(YYYY-MM-DD) / appleStorePrice(number) が不正です`);
      const priceHistory = [...s.priceHistory].sort((a, b) => a.date.localeCompare(b.date));
      const carriers: Sku['carriers'] = { ...(s.carriers ?? {}) };
      if (priceHistory.length) carriers.apple = { launchPrice: priceHistory[0].appleStorePrice, currentPrice: lastOf(priceHistory).appleStorePrice, mnpPrice: null, returnProgram: null, ...(carriers.apple ?? {}) };
      skus.push({
        id: String(s.id),
        label: s.label ?? s.storage ?? String(s.id),
        storage: s.storage ?? '',
        connectivity: s.connectivity ?? '-',
        priceHistory,
        carriers,
        ...(s.usedPricing ? { usedPricing: s.usedPricing } : {}),
      });
    });
    if (!skus.length) return;
    skus.sort(compareSkus);
    products.push({
      id: String(p.id), category: p.category, name: p.name, generation: p.generation ?? '', releaseDate: p.releaseDate ?? skus[0].priceHistory[0]?.date ?? '',
      specs: p.specs ?? {}, skus, ...(typeof p.detail === 'boolean' ? { detail: p.detail } : {}), ...(p.priceResearched ? { priceResearched: true } : {}),
    });
  });
  products.sort(compareProducts);
  return { products, errors };
}

type Mode = 'bulk' | 'return';
function carrierValue(cp: CarrierPrice | undefined, mode: Mode, mnp: boolean): number | null {
  if (!cp) return null;
  const disc = mnp && cp.mnpPrice != null ? cp.currentPrice - cp.mnpPrice : 0;
  if (mode === 'bulk') return Math.max(cp.currentPrice - disc, 0);
  return cp.returnProgram ? Math.max(cp.returnProgram.effectiveCost - disc, 0) : null;
}

interface Sel { pid: string; sid: string }

const SPEC_ROWS: { key: string; label: string }[] = [
  { key: 'soc', label: 'SoC' }, { key: 'ram', label: 'RAM' }, { key: 'display', label: 'ディスプレイ' }, { key: 'battery', label: 'バッテリー' },
  { key: 'weight', label: '重量' }, { key: 'connectivity', label: '通信規格' }, { key: 'bands', label: '対応バンド' },
  { key: 'camera', label: 'カメラ' }, { key: 'ports', label: '端子' }, { key: 'os', label: 'OS' },
  { key: 'colors', label: 'カラー' }, { key: 'launchPriceJpy', label: '発売時価格 (日本)' }, { key: 'launchPriceUsd', label: '発売時価格 (米国)' },
  { key: 'modelNumbers', label: '型番 (AppleDB)' }, { key: 'discontinued', label: '販売終了日 (日本時間)' },
];

/* ---------- AppleDB (https://api.appledb.dev/device/main.json) 連携 ---------- */
const APPLEDB_URL = 'https://api.appledb.dev/device/main.json';
interface AppleDbDevice { name: string; type?: string; identifier?: string[]; soc?: string; model?: string[]; discontinued?: string | string[]; info?: Record<string, any>[] }
const addDays = (d: string, n: number) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);

/**
 * AppleDB の機種データで Product.specs を補強し、販売終了日を価格履歴に反映する (冪等)。
 * 突き合わせ: specs.identifier (例 "iPhone14,5") → なければ name 完全一致。
 * 価格は AppleDB に無いため一切変更しない。解像度/ppi は AppleDB が不正確な機種があるため採用しない。
 */
function applyAppleDb(products: Product[], raw: unknown): { products: Product[]; report: string[] } {
  const devices = (Array.isArray(raw) ? (raw as AppleDbDevice[]) : []).filter((d) => d && d.identifier?.length);
  if (!devices.length) return { products, report: ['AppleDB 形式のデータ (identifier / info) が見つかりません'] };
  const today = new Date().toISOString().slice(0, 10);
  const report: string[] = [];
  const unmatched: string[] = [];
  const updatedLines: string[] = [];
  let same = 0;
  const out = products.map((p) => {
    const ids = String(p.specs.identifier ?? '').split(';').map((s) => s.trim()).filter(Boolean);
    const dev = devices.find((d) => ids.some((i) => d.identifier!.includes(i))) ?? devices.find((d) => d.name === p.name);
    if (!dev) { unmatched.push(p.name); return p; }
    const g = (t: string): Record<string, any> => (dev.info ?? []).find((i) => i.type === t) ?? {};
    const cores = g('Cores'), mem = g('Memory'), pow = g('Power'), con = g('Connectivity'), soc = g('SoC');
    const s: Specs = { ...p.specs };
    const changed: string[] = [];
    const set = (k: string, v: string | string[] | undefined) => { if (v && JSON.stringify(s[k]) !== JSON.stringify(v)) { s[k] = v; changed.push(k); } };

    const socBase = typeof s.soc === 'string' && dev.soc && s.soc.includes(dev.soc) ? s.soc.split(' (')[0] : dev.soc;
    if (socBase && cores.CPU_Core_Count) set('soc', `${socBase} (${cores.CPU_Core_Count}コアCPU${cores.GPU_Core_Count ? ` / ${cores.GPU_Core_Count}コアGPU` : ''}${cores.Neural_Engine_Core_Count ? ` / Neural Engine ${cores.Neural_Engine_Core_Count}コア` : ''}${soc.Manufacturing_Process ? `, ${soc.Manufacturing_Process}` : ''})`);
    if (mem.RAM) set('ram', String(mem.RAM).split(' ')[0]);
    if (pow.Battery_Capacity) set('battery', `${pow.Battery_Capacity}${pow.Battery_Life ? ` (${dev.type === 'iPhone' ? 'ビデオ再生 ' : ''}最大${parseInt(pow.Battery_Life)}時間)` : ''}`);
    if (con.Ports) set('ports', String(con.Ports).replace(/^1x /, ''));
    if (dev.type === 'iPhone') {
      set('connectivity', [...(con.Cellular ?? []).slice(0, 1), con['Wi-Fi'], con.Bluetooth ? `Bluetooth ${con.Bluetooth}` : null, con['Ultra-wideband'] ? 'UWB' : null, 'nano-SIM + eSIM'].filter(Boolean) as string[]);
    }
    set('modelNumbers', (dev.model ?? []).join(', '));
    if (!s.identifier) set('identifier', dev.identifier!.join(';'));
    set('appledb', `https://appledb.dev/device-selection/${encodeURIComponent(dev.name)}`);

    let skus = p.skus;
    const discDate = ([] as string[]).concat(dev.discontinued ?? []).filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x)).sort().pop();
    if (discDate) {
      const jp = addDays(discDate, 1); // AppleDB は米国日付 → 日本時間は +1日
      set('discontinued', jp);
      let added = 0;
      skus = p.skus.map((k) => {
        const last = lastOf(k.priceHistory);
        if (!last || /販売終了|終売/.test(last.event) || jp <= last.date || jp > today) return k;
        added++;
        return { ...k, priceHistory: [...k.priceHistory, { ...last, date: jp, event: '販売終了', approx: true, note: 'AppleDB の販売終了日 (米国日付+1日で日本時間に換算)。価格は終了時点' }] };
      });
      if (added) changed.push(`販売終了イベント×${added}`);
    }
    if (changed.length) updatedLines.push(`✓ ${p.name} ← ${dev.name}: ${changed.join(', ')}`); else same++;
    return { ...p, specs: s, skus };
  });
  report.unshift(`✓ ${out.length - unmatched.length}製品を突き合わせ (更新 ${updatedLines.length} / 変更なし ${same}) ／ 該当なし ${unmatched.length}${unmatched.length ? ` (例: ${unmatched.slice(0, 5).join(', ')})` : ''}`);
  report.push(...updatedLines.slice(0, 40));
  if (updatedLines.length > 40) report.push(`… ほか ${updatedLines.length - 40} 製品を更新`);
  out.sort(compareProducts);
  return { products: out, report };
}
const specText = (v: string | string[] | undefined) => (Array.isArray(v) ? v.join(' / ') : v || '—');

/** 比較表 (コピー用) のデータ行を組み立てる */
function buildCompareTable(
  products: Product[],
  sel: Sel[],
  mode: Mode,
  mnp: boolean,
  usedMap?: Record<string, UsedMarketData>,
): string[][] {
  const cols = sel.map((s) => {
    const p = products.find((x) => x.id === s.pid)!; return { p, sku: p.skus.find((k) => k.id === s.sid) ?? p.skus[0] };
  });
  const getUsed = (p: Product, sku: Sku) => usedMap?.[`${p.id}__${sku.id}`] ?? estimateUsedMarketData(p, sku);
  const rows: string[][] = [['項目', ...cols.map((c) => `${c.p.name} ${c.sku.label}`)]];
  rows.push(['発売日', ...cols.map((c) => c.p.releaseDate)]);
  rows.push(['通信方式', ...cols.map((c) => c.sku.connectivity)]);
  SPEC_ROWS.forEach((r) => rows.push([r.label, ...cols.map((c) => specText(c.p.specs[r.key]))]));
  const modeLabel = mode === 'bulk' ? `一括${mnp ? '(MNP/新規割引後)' : ''}` : `2年返却 実質${mnp ? '(MNP/新規割引後)' : ''}`;
  CARRIER_ORDER.forEach((id) => rows.push([`${CARRIER_META[id].label} ${modeLabel}`, ...cols.map((c) => { const v = carrierValue(c.sku.carriers[id], mode, mnp); return v == null ? '—' : yen(v); })]));
  rows.push(['最安キャリア', ...cols.map((c) => {
    const vals = CARRIER_ORDER.map((id) => ({ id, v: carrierValue(c.sku.carriers[id], mode, mnp) })).filter((x): x is { id: CarrierId; v: number } => x.v != null);
    if (!vals.length) return '—';
    const min = Math.min(...vals.map((x) => x.v));
    return vals.filter((x) => x.v === min).map((x) => CARRIER_META[x.id].label).join(' / ');
  })]);
  rows.push(['現在の中古最安値 (横断)', ...cols.map((c) => {
    const up = getUsed(c.p, c.sku).usedPricing;
    const plat = up.lowestPlatform === 'yahoo' ? 'Yahoo!ショッピング' : '楽天市場';
    const best = up.lowestPlatform === 'yahoo' ? up.yahoo : up.rakuten;
    return `${yen(up.lowestPrice)} [${plat}: ${best?.shopName ?? ''}]`;
  })]);
  rows.push(['楽天市場 中古最安値', ...cols.map((c) => { const r = getUsed(c.p, c.sku).usedPricing.rakuten; return r ? `${yen(r.price)} (${r.shopName})` : '—'; })]);
  rows.push(['Yahoo!ショッピング 中古最安値', ...cols.map((c) => { const y = getUsed(c.p, c.sku).usedPricing.yahoo; return y ? `${yen(y.price)} (${y.shopName})` : '—'; })]);
  rows.push(['未使用品最安値', ...cols.map((c) => { const u = getUsed(c.p, c.sku).unused; return u ? `${yen(u.price)} (${u.shopName})` : '—'; })]);
  rows.push(['リセールバリュー (残価率)', ...cols.map((c) => { const r = getUsed(c.p, c.sku).usedPricing.resaleValuePercent; return r != null ? `リセール率 ${r}%` : '—'; })]);
  return rows;
}
const toMarkdown = (rows: string[][]) => {
  const esc = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
  return [`| ${rows[0].map(esc).join(' | ')} |`, `| ${rows[0].map(() => '---').join(' | ')} |`, ...rows.slice(1).map((r) => `| ${r.map(esc).join(' | ')} |`)].join('\n');
};
const toCSV = (rows: string[][]) => rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n');
async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); return true; } catch {
    const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
    const ok = document.execCommand('copy'); document.body.removeChild(ta); return ok;
  }
}
function downloadBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function downloadFile(name: string, text: string, mime = 'application/json') {
  downloadBlob(name, new Blob([text], { type: mime }));
}

/* ---------- Excel (.xlsx / OpenXML SpreadsheetML) 生成ユーティリティ ---------- */
type XlsCellKind = 'header' | 'text' | 'yen' | 'yenBest' | 'int' | 'dec' | 'pct' | 'section' | 'yenDiff';
type XlsCell = string | number | null | undefined | { v: string | number | null | undefined; k?: XlsCellKind };
interface XlsSheet { name: string; rows: XlsCell[][]; freezeRows?: number; freezeCols?: number }

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function zipStore(files: { path: string; data: Uint8Array }[]): Uint8Array<ArrayBuffer> {
  const enc = new TextEncoder();
  const now = new Date();
  const dosTime = ((now.getHours() & 31) << 11) | ((now.getMinutes() & 63) << 5) | ((now.getSeconds() >> 1) & 31);
  const yr = Math.max(1980, now.getFullYear()) - 1980;
  const dosDate = ((yr & 127) << 9) | (((now.getMonth() + 1) & 15) << 5) | (now.getDate() & 31);

  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const f of files) {
    const name = enc.encode(f.path);
    const crc = crc32(f.data);
    const size = f.data.length;

    const lh = new Uint8Array(30 + name.length);
    const lv = new DataView(lh.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(10, dosTime, true);
    lv.setUint16(12, dosDate, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true);
    lv.setUint32(22, size, true);
    lv.setUint16(26, name.length, true);
    lh.set(name, 30);
    locals.push(lh, f.data);

    const ch = new Uint8Array(46 + name.length);
    const cv = new DataView(ch.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(12, dosTime, true);
    cv.setUint16(14, dosDate, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    ch.set(name, 46);
    centrals.push(ch);

    offset += lh.length + size;
  }

  const cdSize = centrals.reduce((a, b) => a + b.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);

  const out = new Uint8Array(offset + cdSize + 22);
  let pos = 0;
  for (const b of locals) { out.set(b, pos); pos += b.length; }
  for (const b of centrals) { out.set(b, pos); pos += b.length; }
  out.set(eocd, pos);
  return out;
}

const xmlEsc = (s: string) =>
  s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function xlsCol(c: number): string {
  let s = '', n = c + 1;
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

const XLS_STYLE: Record<XlsCellKind, number> = { header: 1, text: 2, yen: 3, yenBest: 4, int: 5, dec: 6, pct: 7, section: 8, yenDiff: 9 };

export function buildXlsx(inputSheets: XlsSheet[]): Uint8Array<ArrayBuffer> {
  const sheets = inputSheets.length ? inputSheets : [{ name: 'Sheet1', rows: [['']] }];
  const enc = new TextEncoder();
  const strings: string[] = [];
  const strMap = new Map<string, number>();
  let strCount = 0;
  const intern = (raw: string) => {
    const clean = raw.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
    strCount++;
    const hit = strMap.get(clean);
    if (hit !== undefined) return hit;
    const idx = strings.length;
    strings.push(clean);
    strMap.set(clean, idx);
    return idx;
  };

  const usedNames = new Set<string>();
  const safeName = (raw: string, idx: number) => {
    let base = raw.replace(/[:\\/?*[\]]/g, ' ').replace(/^'+|'+$/g, '').trim() || `Sheet${idx + 1}`;
    if (base.length > 31) base = base.slice(0, 31);
    let candidate = base, n = 2;
    while (usedNames.has(candidate.toLowerCase())) {
      const suffix = ` (${n++})`;
      candidate = base.slice(0, 31 - suffix.length) + suffix;
    }
    usedNames.add(candidate.toLowerCase());
    return candidate;
  };

  const dispWidth = (s: string) => {
    let max = 0;
    for (const line of s.split('\n')) {
      let w = 0;
      for (const ch of line) w += ch.charCodeAt(0) > 0x7f ? 2 : 1;
      if (w > max) max = w;
    }
    return max;
  };

  const sheetFiles: { path: string; data: Uint8Array }[] = [];
  const sheetNames: string[] = [];

  sheets.forEach((sh, si) => {
    sheetNames.push(safeName(sh.name, si));
    const colWidths: number[] = [];
    const rowsXml = sh.rows.map((row, ri) => {
      const cellsXml = row.map((cell, ci) => {
        const ref = `${xlsCol(ci)}${ri + 1}`;
        const isObj = cell !== null && typeof cell === 'object';
        const val = isObj ? cell.v : cell;
        const kind: XlsCellKind = isObj && cell.k ? cell.k : ri === 0 ? 'header' : 'text';
        const sIdx = XLS_STYLE[kind] ?? 2;

        if (typeof val === 'number' && Number.isFinite(val)) {
          const w = kind === 'yen' || kind === 'yenBest' || kind === 'yenDiff' ? 14 : 11;
          colWidths[ci] = Math.max(colWidths[ci] ?? 10, w);
          return `<c r="${ref}" s="${sIdx}"><v>${val}</v></c>`;
        }
        const text = val == null ? '' : String(val);
        colWidths[ci] = Math.max(colWidths[ci] ?? 10, dispWidth(text));
        return `<c r="${ref}" s="${sIdx}" t="s"><v>${intern(text)}</v></c>`;
      }).join('');
      return `<row r="${ri + 1}">${cellsXml}</row>`;
    }).join('');

    const fr = sh.rows.length > 1 ? (sh.freezeRows ?? 1) : 0;
    const fc = (sh.rows[0]?.length ?? 0) > 1 ? (sh.freezeCols ?? 0) : 0;
    let viewsXml = '';
    if (fr > 0 || fc > 0) {
      const topLeft = `${xlsCol(fc)}${fr + 1}`;
      const pane = fr > 0 && fc > 0 ? 'bottomRight' : fr > 0 ? 'bottomLeft' : 'topRight';
      const splits = `${fc > 0 ? ` xSplit="${fc}"` : ''}${fr > 0 ? ` ySplit="${fr}"` : ''}`;
      viewsXml = `<sheetViews><sheetView workbookViewId="0"><pane${splits} topLeftCell="${topLeft}" activePane="${pane}" state="frozen"/><selection pane="${pane}" activeCell="${topLeft}" sqref="${topLeft}"/></sheetView></sheetViews>`;
    }

    const colsXml = colWidths.length
      ? `<cols>${colWidths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${Math.min(48, Math.max(10, w + 3))}" customWidth="1"/>`).join('')}</cols>`
      : '';

    const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${viewsXml}${colsXml}<sheetData>${rowsXml}</sheetData></worksheet>`;
    sheetFiles.push({ path: `xl/worksheets/sheet${si + 1}.xml`, data: enc.encode(xml) });
  });

  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<numFmts count="4">` +
      `<numFmt numFmtId="164" formatCode="&quot;¥&quot;#,##0;-&quot;¥&quot;#,##0;&quot;¥&quot;0"/>` +
      `<numFmt numFmtId="165" formatCode="0.0"/>` +
      `<numFmt numFmtId="166" formatCode="+0.0%;-0.0%;0.0%"/>` +
      `<numFmt numFmtId="167" formatCode="+&quot;¥&quot;#,##0;-&quot;¥&quot;#,##0;&quot;±¥&quot;0"/>` +
    `</numFmts>` +
    `<fonts count="2"><font><sz val="11"/><name val="Yu Gothic"/></font><font><b/><sz val="11"/><name val="Yu Gothic"/></font></fonts>` +
    `<fills count="4">` +
      `<fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>` +
      `<fill><patternFill patternType="solid"><fgColor rgb="FFF4F4F5"/><bgColor indexed="64"/></patternFill></fill>` +
      `<fill><patternFill patternType="solid"><fgColor rgb="FFECFDF5"/><bgColor indexed="64"/></patternFill></fill>` +
    `</fills>` +
    `<borders count="2">` +
      `<border><left/><right/><top/><bottom/><diagonal/></border>` +
      `<border><left style="thin"><color rgb="FFD4D4D8"/></left><right style="thin"><color rgb="FFD4D4D8"/></right><top style="thin"><color rgb="FFD4D4D8"/></top><bottom style="thin"><color rgb="FFD4D4D8"/></bottom><diagonal/></border>` +
    `</borders>` +
    `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
    `<cellXfs count="10">` +
      `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
      `<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>` +
      `<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>` +
      `<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="top"/></xf>` +
      `<xf numFmtId="164" fontId="1" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="top"/></xf>` +
      `<xf numFmtId="3" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="top"/></xf>` +
      `<xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="top"/></xf>` +
      `<xf numFmtId="166" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="top"/></xf>` +
      `<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>` +
      `<xf numFmtId="167" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="top"/></xf>` +
    `</cellXfs>` +
    `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
    `</styleSheet>`;

  const sstXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strCount}" uniqueCount="${strings.length}">` +
    strings.map((s) => `<si><t xml:space="preserve">${xmlEsc(s)}</t></si>`).join('') +
    `</sst>`;

  const wbXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheets>${sheetNames.map((n, i) => `<sheet name="${xmlEsc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>` +
    `</workbook>`;

  const n = sheetFiles.length;
  const wbRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    sheetFiles.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
    `<Relationship Id="rId${n + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    `<Relationship Id="rId${n + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>` +
    `</Relationships>`;

  const rootRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
    `</Relationships>`;

  const ctXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
    `<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>` +
    sheetFiles.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
    `</Types>`;

  return zipStore([
    { path: '[Content_Types].xml', data: enc.encode(ctXml) },
    { path: '_rels/.rels', data: enc.encode(rootRelsXml) },
    { path: 'xl/workbook.xml', data: enc.encode(wbXml) },
    { path: 'xl/_rels/workbook.xml.rels', data: enc.encode(wbRelsXml) },
    { path: 'xl/styles.xml', data: enc.encode(stylesXml) },
    { path: 'xl/sharedStrings.xml', data: enc.encode(sstXml) },
    ...sheetFiles,
  ]);
}

function downloadXlsx(name: string, sheets: XlsSheet[]) {
  const bytes = buildXlsx(sheets);
  downloadBlob(
    name.endsWith('.xlsx') ? name : `${name}.xlsx`,
    new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
  );
}

/** 選択機種の比較データから Excel ワークブック (比較表 / キャリア価格詳細 / 価格改定履歴) を組み立てる */
function buildCompareExcelSheets(products: Product[], sel: Sel[], mode: Mode, mnp: boolean): XlsSheet[] {
  const cols = sel
    .filter((s) => products.some((x) => x.id === s.pid))
    .map((s) => {
      const p = products.find((x) => x.id === s.pid)!;
      return { p, sku: p.skus.find((k) => k.id === s.sid) ?? p.skus[0] };
    });

  const cheapestFor = (sku: Sku) => {
    const vals = CARRIER_ORDER.map((id) => ({ id, v: carrierValue(sku.carriers[id], mode, mnp) }))
      .filter((x): x is { id: CarrierId; v: number } => x.v != null);
    if (!vals.length) return { min: null as number | null, ids: [] as CarrierId[] };
    const min = Math.min(...vals.map((x) => x.v));
    return { min, ids: vals.filter((x) => x.v === min).map((x) => x.id) };
  };

  const modeLabel = `${mode === 'bulk' ? '一括価格' : '2年返却 実質負担額'}${mnp ? ' (MNP/新規割引後)' : ''}`;
  const secRow = (title: string): XlsCell[] => [{ v: title, k: 'section' }, ...cols.map((): XlsCell => ({ v: '', k: 'section' }))];

  const compareRows: XlsCell[][] = [
    ['項目', ...cols.map((c) => `${c.p.name} (${c.sku.label})`)],
    ['カテゴリ', ...cols.map((c) => c.p.category)],
    ['世代', ...cols.map((c) => c.p.generation || '—')],
    ['発売日', ...cols.map((c) => c.p.releaseDate || '—')],
    ['容量', ...cols.map((c) => c.sku.storage || '—')],
    ['通信方式', ...cols.map((c) => (c.sku.connectivity === '-' ? '共通 (本体仕様参照)' : c.sku.connectivity))],
    secRow(`価格 — ${modeLabel}`),
  ];

  CARRIER_ORDER.forEach((id) => {
    compareRows.push([
      CARRIER_META[id].label,
      ...cols.map((c): XlsCell => {
        const cp = c.sku.carriers[id];
        const v = carrierValue(cp, mode, mnp);
        if (v == null) return cp && mode === 'return' ? '返却プログラム対象外' : '—';
        const ch = cheapestFor(c.sku);
        return { v, k: ch.ids.includes(id) ? 'yenBest' : 'yen' };
      }),
    ]);
  });

  compareRows.push(['最安キャリア', ...cols.map((c) => {
    const ch = cheapestFor(c.sku);
    return ch.ids.length ? ch.ids.map((id) => CARRIER_META[id].label).join(' / ') : '—';
  })]);
  compareRows.push(['最安価格', ...cols.map((c): XlsCell => {
    const ch = cheapestFor(c.sku);
    return ch.min != null ? { v: ch.min, k: 'yenBest' } : '—';
  })]);

  const usedForCols = cols.map((c) => estimateUsedMarketData(c.p, c.sku));
  compareRows.push(secRow('中古相場・資産価値 (楽天市場 ＆ Yahoo!ショッピング 横断比較)'));
  compareRows.push(['現在の中古最安値 (横断)', ...usedForCols.map((u): XlsCell => ({ v: u.usedPricing.lowestPrice, k: 'yenBest' }))]);
  compareRows.push(['最安プラットフォーム', ...usedForCols.map((u): XlsCell => (u.usedPricing.lowestPlatform === 'yahoo' ? 'Yahoo!ショッピング' : '楽天市場'))]);
  compareRows.push(['リセールバリュー (残価率)', ...usedForCols.map((u): XlsCell => (u.usedPricing.resaleValuePercent != null ? `リセール率 ${u.usedPricing.resaleValuePercent}%` : '—'))]);
  compareRows.push(['楽天市場 中古最安値', ...usedForCols.map((u): XlsCell => (u.usedPricing.rakuten ? { v: u.usedPricing.rakuten.price, k: 'yen' } : '—'))]);
  compareRows.push(['楽天市場 ショップ名', ...usedForCols.map((u): XlsCell => u.usedPricing.rakuten?.shopName ?? '—')]);
  compareRows.push(['Yahoo!ショッピング 中古最安値', ...usedForCols.map((u): XlsCell => (u.usedPricing.yahoo ? { v: u.usedPricing.yahoo.price, k: 'yen' } : '—'))]);
  compareRows.push(['Yahoo!ショッピング ショップ名', ...usedForCols.map((u): XlsCell => u.usedPricing.yahoo?.shopName ?? '—')]);
  compareRows.push(['未使用品最安値', ...usedForCols.map((u): XlsCell => (u.unused ? { v: u.unused.price, k: 'yen' } : '—'))]);

  compareRows.push(secRow('スペック'));
  SPEC_ROWS.forEach((r) => {
    compareRows.push([r.label, ...cols.map((c) => specText(c.p.specs[r.key]))]);
  });

  const carrierRows: XlsCell[][] = [[
    '機種', 'カテゴリ', 'SKU', 'キャリア', '発売時一括(円)', '現在一括(円)', 'MNP/新規割引後(円)',
    '返却プログラム', '利用期間(月)', '2年返却実質(円)', 'MNP併用実質(円)', '免除残価(円)',
  ]];
  cols.forEach((c) => {
    CARRIER_ORDER.forEach((id) => {
      const cp = c.sku.carriers[id];
      if (!cp) return;
      const retMnp = carrierValue(cp, 'return', true);
      carrierRows.push([
        c.p.name,
        c.p.category,
        c.sku.label,
        CARRIER_META[id].label,
        { v: cp.launchPrice, k: 'yen' },
        { v: cp.currentPrice, k: 'yen' },
        cp.mnpPrice != null ? { v: cp.mnpPrice, k: 'yen' } : '—',
        cp.returnProgram?.name ?? '—',
        cp.returnProgram ? { v: cp.returnProgram.months, k: 'int' } : '—',
        cp.returnProgram ? { v: cp.returnProgram.effectiveCost, k: 'yen' } : '—',
        retMnp != null && cp.mnpPrice != null ? { v: retMnp, k: 'yen' } : '—',
        cp.returnProgram?.residualValue != null ? { v: cp.returnProgram.residualValue, k: 'yen' } : '—',
      ]);
    });
  });

  const historyRows: XlsCell[][] = [[
    '機種', 'カテゴリ', 'SKU', '日付', 'イベント', '日本価格(税込)', '前回比差額(円)', '変動率',
    '米国価格(USD)', '市場為替(円/$)', '実質Appleレート(円/$)', '精度', '出典', '備考',
  ]];
  cols.forEach((c) => {
    c.sku.priceHistory.forEach((pt, i) => {
      const prev = i > 0 ? c.sku.priceHistory[i - 1].appleStorePrice : null;
      const diff = prev != null ? pt.appleStorePrice - prev : null;
      const ar = impliedRate(pt);
      historyRows.push([
        c.p.name,
        c.p.category,
        c.sku.label,
        pt.date,
        pt.event,
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
  });

  return [
    { name: 'スペック・価格比較', rows: compareRows, freezeRows: 1, freezeCols: 1 },
    { name: 'キャリア価格詳細', rows: carrierRows, freezeRows: 1 },
    { name: '価格改定履歴', rows: historyRows, freezeRows: 1 },
  ];
}

/* =====================================================================================
 * 4. 共通 UI パーツ
 * ===================================================================================== */

const card = 'rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900';
const selectCls = 'rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-base sm:text-sm text-zinc-900 outline-none focus:ring-2 focus:ring-sky-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100';
const btnCls = 'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs sm:text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700';
const excelBtnCls = 'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-emerald-600 bg-emerald-600 px-3 py-1.5 text-xs sm:text-sm font-medium text-white transition hover:bg-emerald-500 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40 dark:border-emerald-500 dark:bg-emerald-600 dark:hover:bg-emerald-500';

function CarrierBadge({ id, small }: { id: CarrierId; small?: boolean }) {
  const dark = useDark();
  const c = carrierColor(id, dark);
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border font-semibold ${small ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs'}`}
      style={{ color: c, borderColor: c + '66', backgroundColor: c + '1a' }}>
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: c }} />
      {CARRIER_META[id].label}
    </span>
  );
}

function DeltaBadge({ diff, base }: { diff: number; base: number }) {
  const pct = base ? (diff / base) * 100 : 0;
  const up = diff > 0, down = diff < 0;
  const cls = up ? 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300' : down ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300' : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400';
  const Icon = up ? TrendingUp : down ? TrendingDown : Minus;
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 sm:px-2.5 py-0.5 sm:py-1 text-[11px] sm:text-xs font-bold tabular-nums ${cls}`}>
      <Icon className="h-3.5 w-3.5 shrink-0" />{signedYen(diff)} ({signedPct(pct)})
    </span>
  );
}

/** リセールバリュー（残価率）バッジ: （現在の中古最安値 ÷ 発売時Apple直販価格）× 100 */
function ResaleBadge({ rate, launchPrice }: { rate: number | null; launchPrice?: number | null }) {
  if (rate == null || !Number.isFinite(rate)) {
    return (
      <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-semibold text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
        リセール率 —
      </span>
    );
  }
  const tone =
    rate >= 65
      ? 'border-emerald-500/40 bg-emerald-50 text-emerald-700 dark:border-emerald-400/40 dark:bg-emerald-500/15 dark:text-emerald-300'
      : rate >= 45
        ? 'border-sky-500/40 bg-sky-50 text-sky-700 dark:border-sky-400/40 dark:bg-sky-500/15 dark:text-sky-300'
        : 'border-amber-500/40 bg-amber-50 text-amber-700 dark:border-amber-400/40 dark:bg-amber-500/15 dark:text-amber-300';
  return (
    <span
      title={launchPrice ? `（現在の中古最安値 ÷ 発売時Apple直販価格 ${yen(launchPrice)}）× 100` : '（現在の中古最安値 ÷ 発売時Apple直販価格）× 100'}
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px] sm:text-xs font-extrabold tabular-nums ${tone}`}
    >
      <Sparkles className="h-3 w-3 shrink-0" />
      リセール率 {rate}%
    </span>
  );
}

/** 大手中古ショップ認定バッジ（イオシス・じゃんぱら・ゲオ・ソフマップ等） */
function TrustedShopBadge({ isTrusted, compact }: { isTrusted?: boolean; compact?: boolean }) {
  if (isTrusted !== false) {
    return (
      <span
        title="✅ 大手ショップ認定（イオシス・じゃんぱら・ゲオ・ソフマップ・にこスマ等）"
        className="inline-flex items-center gap-0.5 whitespace-nowrap rounded-full border border-emerald-500/40 bg-emerald-50 px-1.5 py-0.2 text-[10px] font-bold text-emerald-700 dark:border-emerald-400/40 dark:bg-emerald-500/15 dark:text-emerald-300"
      >
        {compact ? '✅ 大手認定' : '✅ 大手ショップ認定'}
      </span>
    );
  }
  return (
    <span
      title="大手ショップ在庫0件のため、タイトル検証を通過した一般ショップの最安値を表示しています"
      className="inline-flex items-center whitespace-nowrap rounded-full bg-amber-100/80 px-1.5 py-0.2 text-[10px] font-semibold text-amber-800 dark:bg-amber-500/20 dark:text-amber-300"
    >
      ※一般ショップ参考価格
    </span>
  );
}

function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <div className="no-scrollbar inline-flex max-w-full overflow-x-auto rounded-xl bg-zinc-200/70 p-1 dark:bg-zinc-800">
      {options.map((o) => (
        <button key={o.value} onClick={() => onChange(o.value)}
          className={`flex-1 sm:flex-initial whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs sm:px-3.5 sm:text-sm font-semibold transition ${value === o.value ? 'bg-white text-zinc-900 shadow dark:bg-zinc-600 dark:text-white' : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white'}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function SectionTitle({ icon, title, desc }: { icon: React.ReactNode; title: string; desc?: string }) {
  return (
    <div className="mb-3 sm:mb-4 flex items-start gap-2.5 sm:gap-3">
      <div className="shrink-0 rounded-xl bg-zinc-900 p-2 text-white dark:bg-zinc-100 dark:text-zinc-900">{icon}</div>
      <div className="min-w-0"><h2 className="text-base sm:text-lg font-bold leading-snug text-zinc-900 dark:text-zinc-50">{title}</h2>{desc && <p className="mt-0.5 text-xs sm:text-sm text-zinc-500 dark:text-zinc-400">{desc}</p>}</div>
    </div>
  );
}

function ProductSkuPicker({ products, sel, onChange }: { products: Product[]; sel: Sel; onChange: (s: Sel) => void }) {
  const sortedProducts = useMemo(() => [...products].sort(compareProducts), [products]);
  const p = sortedProducts.find((x) => x.id === sel.pid) ?? sortedProducts[0];
  const cats = useMemo(() => sortCategories(Array.from(new Set(sortedProducts.map((x) => x.category)))), [sortedProducts]);
  const skus = useMemo(() => [...(pricedSkus(p).length ? pricedSkus(p) : p.skus)].sort(compareSkus), [p]);
  return (
    <div className="flex w-full sm:w-auto flex-wrap items-center gap-2">
      <select className={`${selectCls} min-w-0 flex-1 sm:flex-initial max-w-full`} value={p.id} onChange={(e) => { const np = sortedProducts.find((x) => x.id === e.target.value)!; const nextSkus = [...(pricedSkus(np).length ? pricedSkus(np) : np.skus)].sort(compareSkus); onChange({ pid: np.id, sid: nextSkus[0].id }); }}>
        {cats.map((c) => (<optgroup key={c} label={c}>{sortedProducts.filter((x) => x.category === c).map((x) => <option key={x.id} value={x.id}>{x.name}{x.releaseDate ? ` (${x.releaseDate.slice(0, 4)})` : ''}{hasDetail(x) ? ' ★' : ''}</option>)}</optgroup>))}
      </select>
      <select className={selectCls} value={sel.sid} onChange={(e) => onChange({ pid: p.id, sid: e.target.value })}>
        {skus.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
      </select>
    </div>
  );
}

const EmptyNote = ({ text }: { text: string }) => <div className={`${card} p-10 text-center text-sm text-zinc-500`}>{text}</div>;

const useChartColors = () => { const d = useDark(); return { axis: d ? '#a1a1aa' : '#52525b', grid: d ? '#3f3f46' : '#e4e4e7', tipBg: d ? '#18181b' : '#ffffff', tipBorder: d ? '#3f3f46' : '#e4e4e7', text: d ? '#f4f4f5' : '#18181b' }; };

/* =====================================================================================
 * 5. タブ1: スペック＆キャリア価格 横並び比較
 * ===================================================================================== */

function CompareView({ products, all, sels, setSels, mode, setMode, mnp, setMnp, toast }: {
  products: Product[]; all: Product[]; sels: Sel[]; setSels: (s: Sel[]) => void; mode: Mode; setMode: (m: Mode) => void; mnp: boolean; setMnp: (b: boolean) => void; toast: (m: string) => void;
}) {
  const dark = useDark();
  const cols = sels.filter((s) => all.some((x) => x.id === s.pid)).map((s) => { const p = all.find((x) => x.id === s.pid)!; return { sel: s, p, sku: p.skus.find((k) => k.id === s.sid) ?? p.skus[0] }; });
  const [adding, setAdding] = useState('');
  const [q, setQ] = useState('');
  const [catF, setCatF] = useState('');
  const [mobileView, setMobileView] = useState<'stack' | 'table'>('stack');
  const [usedMap, setUsedMap] = useState<Record<string, UsedMarketData>>({});
  const available = useMemo(
    () => products.filter((p) => !sels.some((s) => s.pid === p.id)).sort(compareProducts),
    [products, sels],
  );
  const allCats = useMemo(() => sortCategories(Array.from(new Set(products.map((x) => x.category)))), [products]);
  const matched = useMemo(
    () =>
      available
        .filter(
          (p) =>
            (!catF || p.category === catF) &&
            (!q.trim() ||
              p.name.toLowerCase().includes(q.trim().toLowerCase()) ||
              String(p.specs.identifier ?? '')
                .toLowerCase()
                .includes(q.trim().toLowerCase())),
        )
        .sort(compareProducts),
    [available, catF, q],
  );

  // 選択中の各機種・容量に対して楽天市場API（未設定時は推定フォールバック）から中古・未使用品最安値を取得
  const colsKey = cols.map((c) => `${c.p.id}__${c.sku.id}`).join('|');
  useEffect(() => {
    let cancelled = false;
    cols.forEach((c) => {
      const k = `${c.p.id}__${c.sku.id}`;
      fetchUsedMarketPrice(c.p, c.sku).then((data) => {
        if (!cancelled) {
          setUsedMap((prev) => (prev[k] === data ? prev : { ...prev, [k]: data }));
        }
      });
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colsKey]);

  const getUsedData = (c: (typeof cols)[number]): UsedMarketData =>
    usedMap[`${c.p.id}__${c.sku.id}`] ?? estimateUsedMarketData(c.p, c.sku);

  const doCopy = async (kind: 'md' | 'csv') => {
    if (!cols.length) return;
    const rows = buildCompareTable(all, cols.map((c) => c.sel), mode, mnp, usedMap);
    const ok = await copyText(kind === 'md' ? toMarkdown(rows) : toCSV(rows));
    toast(ok ? `${kind === 'md' ? 'Markdown' : 'CSV'} をコピーしました` : 'コピーに失敗しました');
  };

  const doExportExcel = () => {
    if (!cols.length) return;
    const today = new Date().toISOString().slice(0, 10);
    downloadXlsx(`apple-compare-${today}.xlsx`, buildCompareExcelSheets(all, cols.map((c) => c.sel), mode, mnp));
    toast(`選択中の${cols.length}機種をExcelでダウンロードしました`);
  };

  const cheapest = (c: (typeof cols)[number]) => {
    const vals = CARRIER_ORDER.map((id) => ({ id, v: carrierValue(c.sku.carriers[id], mode, mnp) })).filter((x): x is { id: CarrierId; v: number } => x.v != null);
    if (!vals.length) return { min: null as number | null, ids: [] as CarrierId[] };
    const min = Math.min(...vals.map((x) => x.v));
    return { min, ids: vals.filter((x) => x.v === min).map((x) => x.id) };
  };

  return (
    <div className="space-y-4 sm:space-y-5">
      <div className={`${card} p-3.5 sm:p-5`}>
        <SectionTitle icon={<Scale className="h-5 w-5" />} title="スペック＆キャリア価格 比較" desc="機種を追加し、容量・通信方式を選んで横並び比較。最安キャリアを自動ハイライトします。" />
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          <Segmented<Mode> value={mode} onChange={setMode} options={[{ value: 'bulk', label: '一括価格モード' }, { value: 'return', label: '2年返却（実質）モード' }]} />
          <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
            <input type="checkbox" checked={mnp} onChange={(e) => setMnp(e.target.checked)} className="h-4 w-4 accent-sky-500" />MNP/新規割引を適用
          </label>
          <div className="grid grid-cols-3 gap-1.5 sm:ml-auto sm:flex sm:flex-wrap sm:gap-2">
            <button className={excelBtnCls} disabled={!cols.length} onClick={doExportExcel}><FileSpreadsheet className="h-4 w-4 shrink-0" />Excel</button>
            <button className={btnCls} disabled={!cols.length} onClick={() => doCopy('md')}><Copy className="h-4 w-4 shrink-0" />Markdown</button>
            <button className={btnCls} disabled={!cols.length} onClick={() => doCopy('csv')}><Copy className="h-4 w-4 shrink-0" />CSV</button>
          </div>
        </div>
        <div className="mt-3.5 sm:mt-4 flex flex-wrap items-center gap-2">
          {cols.map((c) => (
            <span key={c.sel.pid} className="inline-flex items-center gap-1.5 rounded-full bg-zinc-100 py-1 pl-3 pr-1.5 text-xs sm:text-sm font-medium text-zinc-800 dark:bg-zinc-800 dark:text-zinc-100">
              <CatIcon cat={c.p.category} className="h-3.5 w-3.5 shrink-0" />{c.p.name}
              <button aria-label="削除" onClick={() => setSels(sels.filter((s) => s.pid !== c.sel.pid))} className="rounded-full p-1 hover:bg-zinc-300 dark:hover:bg-zinc-600"><X className="h-3.5 w-3.5" /></button>
            </span>
          ))}
          {available.length > 0 && (
            <div className="grid w-full grid-cols-2 gap-2 sm:w-auto sm:inline-flex sm:flex-wrap sm:items-center sm:gap-1.5">
              <select className={`${selectCls} w-full sm:w-auto`} value={catF} onChange={(e) => setCatF(e.target.value)} aria-label="カテゴリ絞り込み">
                <option value="">全カテゴリ</option>{allCats.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <span className="relative w-full sm:w-auto"><Search className="pointer-events-none absolute left-2.5 top-2.5 sm:top-2 h-4 w-4 text-zinc-400" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="機種名・識別子で検索" className={`${selectCls} w-full sm:w-44 pl-8`} /></span>
              <select className={`${selectCls} col-span-2 w-full sm:col-span-1 sm:w-auto sm:max-w-[16rem]`} value={adding} onChange={(e) => { const p = all.find((x) => x.id === e.target.value); if (p) { const nextSkus = [...(pricedSkus(p).length ? pricedSkus(p) : p.skus)].sort(compareSkus); setSels([...sels, { pid: p.id, sid: nextSkus[0].id }]); } setAdding(''); }}>
                <option value="">＋ 機種を追加… ({matched.length}件)</option>
                {sortCategories(Array.from(new Set(matched.map((x) => x.category)))).map((cat) => (
                  <optgroup key={cat} label={cat}>{matched.filter((x) => x.category === cat).sort(compareProducts).map((x) => <option key={x.id} value={x.id}>{x.name} ({x.releaseDate.slice(0, 4)}){hasDetail(x) ? ' ★' : ''}</option>)}</optgroup>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>

      {!cols.length ? (
        <div className={`${card} p-8 sm:p-10 text-center text-sm text-zinc-500`}>比較する機種を追加してください。</div>
      ) : (
        <>
          <div className="grid gap-2.5 sm:gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {cols.map((c) => {
              const ch = cheapest(c);
              const apple = carrierValue(c.sku.carriers.apple, mode, mnp);
              const usedInfo = getUsedData(c);
              return (
                <div key={c.sel.pid} className={`${card} flex flex-col justify-between p-3.5 sm:p-4`}>
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-1.5 text-xs font-semibold text-zinc-500 dark:text-zinc-400"><Trophy className="h-3.5 w-3.5 shrink-0 text-amber-500" /><span className="truncate">最安: {c.p.name}</span></div>
                      <select className={`${selectCls} !py-1 !px-2 !text-xs`} value={c.sku.id} aria-label={`${c.p.name} の容量・通信方式`} onChange={(e) => setSels(sels.map((s) => (s.pid === c.sel.pid ? { ...s, sid: e.target.value } : s)))}>
                        {[...c.p.skus].sort(compareSkus).map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
                      </select>
                    </div>
                    {ch.min == null ? <div className="mt-2 text-xs sm:text-sm text-zinc-500">このモードで購入可能な窓口がありません</div> : (
                      <div className="mt-2 flex flex-wrap items-baseline justify-between gap-2">
                        <div>
                          <div className="text-xl sm:text-2xl font-extrabold tabular-nums text-zinc-900 dark:text-zinc-50">{yen(ch.min)}</div>
                          {apple != null && !ch.ids.includes('apple') && <div className="text-xs text-emerald-600 dark:text-emerald-400">Apple Store比 {signedYen(ch.min - apple)}</div>}
                        </div>
                        <div className="flex flex-wrap items-center gap-1">{ch.ids.map((id) => <CarrierBadge key={id} id={id} small />)}</div>
                      </div>
                    )}
                  </div>

                  {/* 現在の中古相場（楽天・Yahoo!横断最安値・未使用品最安値）・リセールバリュー・ショップリンク枠 */}
                  {(() => {
                    const up = usedInfo.usedPricing;
                    const isYahooLowest = up.lowestPlatform === 'yahoo';
                    const bestOffer = isYahooLowest ? up.yahoo ?? up.rakuten : up.rakuten ?? up.yahoo;
                    return (
                      <div className="mt-3 rounded-xl border border-zinc-200/80 bg-zinc-50/80 p-2.5 dark:border-zinc-800 dark:bg-zinc-800/50">
                        <div className="flex flex-wrap items-center justify-between gap-1.5">
                          <span className="inline-flex flex-wrap items-center gap-1 text-[11px] font-bold text-zinc-600 dark:text-zinc-300">
                            <ShoppingBag className="h-3.5 w-3.5 shrink-0 text-rose-500" />
                            現在の中古最安値
                            <span
                              className={`rounded-full px-1.5 py-0.2 text-[10px] font-extrabold text-white ${
                                isYahooLowest ? 'bg-amber-500' : 'bg-rose-600'
                              }`}
                            >
                              {isYahooLowest ? 'Yahoo!最安' : '楽天最安'}
                            </span>
                            <TrustedShopBadge isTrusted={bestOffer?.isTrustedShop} compact />
                            {usedInfo.source === 'mock' && (
                              <span className="rounded bg-zinc-200/80 px-1 py-0.2 text-[10px] font-normal text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300">推定</span>
                            )}
                          </span>
                          <ResaleBadge rate={up.resaleValuePercent} launchPrice={usedInfo.launchPrice} />
                        </div>
                        <div className="mt-1.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                          <div className="flex items-baseline gap-2">
                            <span className="text-base sm:text-lg font-extrabold tabular-nums text-rose-600 dark:text-rose-400">
                              {yen(up.lowestPrice)}
                            </span>
                            {usedInfo.unused && (
                              <span className="text-[11px] tabular-nums text-zinc-500 dark:text-zinc-400">
                                未使用: <strong className="font-bold text-zinc-700 dark:text-zinc-200">{yen(usedInfo.unused.price)}</strong>
                              </span>
                            )}
                          </div>
                          {usedInfo.launchPrice && (
                            <span className="text-[10px] tabular-nums text-zinc-400 dark:text-zinc-500">
                              発売時直販 {yen(usedInfo.launchPrice)}
                            </span>
                          )}
                        </div>
                        <div className="mt-2 space-y-1 border-t border-zinc-200/60 pt-1.5 text-[11px] dark:border-zinc-700/60">
                          {up.rakuten && (
                            <div className="flex items-center justify-between gap-1.5">
                              <span className="inline-flex min-w-0 items-center gap-1 truncate">
                                <span className="shrink-0 rounded bg-rose-100 px-1 py-0.2 text-[10px] font-bold text-rose-700 dark:bg-rose-500/20 dark:text-rose-300">楽天</span>
                                <span className={`font-bold tabular-nums ${!isYahooLowest ? 'text-rose-600 dark:text-rose-400' : 'text-zinc-700 dark:text-zinc-300'}`}>
                                  {yen(up.rakuten.price)}
                                </span>
                                <span className="truncate text-zinc-500 dark:text-zinc-400" title={up.rakuten.shopName}>
                                  {up.rakuten.isTrustedShop !== false ? '✅' : '※'}{up.rakuten.shopName}
                                </span>
                              </span>
                              <a
                                href={up.rakuten.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex shrink-0 items-center gap-0.5 font-semibold text-sky-600 hover:underline dark:text-sky-400"
                              >
                                商品 <ExternalLink className="h-3 w-3" />
                              </a>
                            </div>
                          )}
                          {up.yahoo && (
                            <div className="flex items-center justify-between gap-1.5">
                              <span className="inline-flex min-w-0 items-center gap-1 truncate">
                                <span className="shrink-0 rounded bg-amber-100 px-1 py-0.2 text-[10px] font-bold text-amber-800 dark:bg-amber-500/20 dark:text-amber-300">Yahoo!</span>
                                <span className={`font-bold tabular-nums ${isYahooLowest ? 'text-rose-600 dark:text-rose-400' : 'text-zinc-700 dark:text-zinc-300'}`}>
                                  {yen(up.yahoo.price)}
                                </span>
                                <span className="truncate text-zinc-500 dark:text-zinc-400" title={up.yahoo.shopName}>
                                  {up.yahoo.isTrustedShop !== false ? '✅' : '※'}{up.yahoo.shopName}
                                </span>
                              </span>
                              <a
                                href={up.yahoo.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex shrink-0 items-center gap-0.5 font-semibold text-sky-600 hover:underline dark:text-sky-400"
                              >
                                商品 <ExternalLink className="h-3 w-3" />
                              </a>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-between gap-2 sm:hidden">
            <span className="text-xs font-semibold text-zinc-500">スマホ表示モード</span>
            <Segmented<'stack' | 'table'> value={mobileView} onChange={setMobileView} options={[
              { value: 'stack', label: '縦並びカード' },
              { value: 'table', label: '横並び表' },
            ]} />
          </div>

          {mobileView === 'stack' && (
            <div className="space-y-4 sm:hidden">
              <div className={`${card} divide-y divide-zinc-100 overflow-hidden dark:divide-zinc-800`}>
                <div className="bg-zinc-50 px-3.5 py-2 text-xs font-bold uppercase tracking-wider text-zinc-500 dark:bg-zinc-800/50">
                  キャリア別価格 — {mode === 'bulk' ? '一括' : '2年返却 実質負担額'}{mnp ? ' (MNP/新規割引後)' : ''}
                </div>
                {CARRIER_ORDER.map((id) => (
                  <div key={id} className="p-3.5">
                    <div className="mb-2.5"><CarrierBadge id={id} /></div>
                    <div className="space-y-2">
                      {cols.map((c) => {
                        const cp = c.sku.carriers[id];
                        const v = carrierValue(cp, mode, mnp);
                        const ch = cheapest(c);
                        const isMin = v != null && ch.ids.includes(id);
                        const col = carrierColor(id, dark);
                        return (
                          <div key={c.sel.pid} className="rounded-xl p-2.5 text-xs" style={v == null ? { backgroundColor: dark ? '#27272a66' : '#f4f4f5' } : isMin ? { backgroundColor: '#10b9811f', boxShadow: 'inset 0 0 0 1.5px #10b981' } : { backgroundColor: dark ? '#27272a66' : '#fafafa', boxShadow: `inset 3px 0 0 ${col}` }}>
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-bold text-zinc-900 dark:text-zinc-100">{c.p.name} <span className="font-normal text-zinc-500">({c.sku.label})</span></span>
                              {v == null ? (
                                <span className="text-zinc-400">{cp ? (mode === 'return' ? '返却対象外' : '—') : id === 'apple' ? '価格なし' : '取扱なし'}</span>
                              ) : (
                                <span className="inline-flex items-center gap-1.5">
                                  {isMin && <span className="rounded-full bg-emerald-500 px-1.5 py-0.5 text-[10px] font-bold text-white">最安</span>}
                                  <span className="text-base font-extrabold tabular-nums text-zinc-900 dark:text-zinc-50">{yen(v)}</span>
                                </span>
                              )}
                            </div>
                            {v != null && cp && (
                              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                                <span>発売時 {yen(cp.launchPrice)} → 現在 {yen(cp.currentPrice)}</span>
                                {cp.mnpPrice != null && <span>MNP: {yen(cp.mnpPrice)}</span>}
                                {cp.returnProgram && <span>{cp.returnProgram.name} ({cp.returnProgram.months}ヶ月): {yen(cp.returnProgram.effectiveCost)}</span>}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>

              {/* スマホ縦並び: 中古相場・リセールバリュー (楽天・Yahoo!横断比較) */}
              <div className={`${card} divide-y divide-zinc-100 overflow-hidden dark:divide-zinc-800`}>
                <div className="bg-zinc-50 px-3.5 py-2 text-xs font-bold uppercase tracking-wider text-zinc-500 dark:bg-zinc-800/50">
                  現在の中古相場（最安値）・リセールバリュー (楽天市場 ＆ Yahoo!ショッピング)
                </div>
                <div className="space-y-2.5 p-3.5">
                  {cols.map((c) => {
                    const u = getUsedData(c);
                    const up = u.usedPricing;
                    const isYahooLowest = up.lowestPlatform === 'yahoo';
                    return (
                      <div key={c.sel.pid} className="rounded-xl border border-zinc-200/80 bg-zinc-50/70 p-2.5 text-xs dark:border-zinc-800 dark:bg-zinc-800/50">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-bold text-zinc-900 dark:text-zinc-100">
                            {c.p.name} <span className="font-normal text-zinc-500">({c.sku.label})</span>
                          </span>
                          <ResaleBadge rate={up.resaleValuePercent} launchPrice={u.launchPrice} />
                        </div>
                        <div className="mt-1.5 flex flex-wrap items-baseline justify-between gap-2">
                          <div className="flex flex-wrap items-baseline gap-1.5">
                            <span className="text-[11px] text-zinc-500">横断最安:</span>
                            <span className="text-base font-extrabold tabular-nums text-rose-600 dark:text-rose-400">{yen(up.lowestPrice)}</span>
                            <span className={`rounded-full px-1.5 py-0.2 text-[10px] font-bold text-white ${isYahooLowest ? 'bg-amber-500' : 'bg-rose-600'}`}>
                              {isYahooLowest ? 'Yahoo!最安' : '楽天最安'}
                            </span>
                            {u.unused && (
                              <span className="text-[11px] tabular-nums text-zinc-500">
                                / 未使用: <strong className="font-bold text-zinc-800 dark:text-zinc-200">{yen(u.unused.price)}</strong>
                              </span>
                            )}
                          </div>
                          {u.launchPrice && (
                            <span className="text-[10px] tabular-nums text-zinc-400">発売時直販 {yen(u.launchPrice)}</span>
                          )}
                        </div>
                        <div className="mt-2 space-y-1 border-t border-zinc-200/60 pt-1.5 text-[11px] dark:border-zinc-700/60">
                          {up.rakuten && (
                            <div className="flex items-center justify-between gap-2">
                              <span className="truncate text-zinc-600 dark:text-zinc-300">
                                <strong className="text-rose-600 dark:text-rose-400">[楽天]</strong> {yen(up.rakuten.price)} — {up.rakuten.shopName}
                              </span>
                              <a href={up.rakuten.url} target="_blank" rel="noopener noreferrer" className="inline-flex shrink-0 items-center gap-1 font-semibold text-sky-600 hover:underline dark:text-sky-400">
                                リンク <ExternalLink className="h-3 w-3" />
                              </a>
                            </div>
                          )}
                          {up.yahoo && (
                            <div className="flex items-center justify-between gap-2">
                              <span className="truncate text-zinc-600 dark:text-zinc-300">
                                <strong className="text-amber-600 dark:text-amber-400">[Yahoo!]</strong> {yen(up.yahoo.price)} — {up.yahoo.shopName}
                              </span>
                              <a href={up.yahoo.url} target="_blank" rel="noopener noreferrer" className="inline-flex shrink-0 items-center gap-1 font-semibold text-sky-600 hover:underline dark:text-sky-400">
                                リンク <ExternalLink className="h-3 w-3" />
                              </a>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className={`${card} divide-y divide-zinc-100 overflow-hidden dark:divide-zinc-800`}>
                <div className="bg-zinc-50 px-3.5 py-2 text-xs font-bold uppercase tracking-wider text-zinc-500 dark:bg-zinc-800/50">スペック比較</div>
                {[{ key: '__conn', label: '通信方式' }, ...SPEC_ROWS].map((r) => (
                  <div key={r.key} className="p-3.5">
                    <div className="mb-1.5 text-xs font-bold text-zinc-500 dark:text-zinc-400">{r.label}</div>
                    <div className="space-y-1.5 text-xs">
                      {cols.map((c) => (
                        <div key={c.sel.pid} className="flex items-baseline justify-between gap-3 rounded-lg bg-zinc-50 px-2.5 py-1.5 dark:bg-zinc-800/60">
                          <span className="shrink-0 font-semibold text-zinc-700 dark:text-zinc-300">{c.p.name}</span>
                          <span className="text-right text-zinc-900 dark:text-zinc-100">
                            {r.key === '__conn' ? (c.sku.connectivity === '-' ? '共通 (本体仕様参照)' : c.sku.connectivity) : specText(c.p.specs[r.key])}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className={`${card} overflow-x-auto ${mobileView === 'stack' ? 'hidden sm:block' : 'block'}`}>
            <table className="w-full min-w-[440px] sm:min-w-[720px] border-collapse text-xs sm:text-sm">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-800">
                  <th className="sticky left-0 z-10 w-24 sm:w-36 bg-white p-2 sm:p-3 text-left text-[11px] sm:text-xs font-semibold text-zinc-500 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.06)] dark:bg-zinc-900 dark:text-zinc-400">項目</th>
                  {cols.map((c) => (
                    <th key={c.sel.pid} className="min-w-[160px] sm:min-w-[220px] p-2 sm:p-3 text-left align-top">
                      <div className="flex items-center gap-1.5 text-sm sm:text-base font-bold text-zinc-900 dark:text-zinc-50"><CatIcon cat={c.p.category} className="h-4 w-4 shrink-0" />{c.p.name}</div>
                      <div className="mb-2 text-[11px] sm:text-xs font-normal text-zinc-500 dark:text-zinc-400">{c.p.generation} ・ {c.p.releaseDate} 発売</div>
                      <select className={`${selectCls} w-full`} value={c.sku.id} onChange={(e) => setSels(sels.map((s) => (s.pid === c.sel.pid ? { ...s, sid: e.target.value } : s)))}>
                        {c.p.skus.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
                      </select>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr className="bg-zinc-50 dark:bg-zinc-800/50"><td colSpan={cols.length + 1} className="px-2.5 sm:px-3 py-1.5 text-[11px] sm:text-xs font-bold uppercase tracking-wider text-zinc-500">価格 — {mode === 'bulk' ? '一括' : '2年返却 実質負担額'}{mnp ? ' (MNP/新規割引後)' : ''}</td></tr>
                {CARRIER_ORDER.map((id) => (
                  <tr key={id} className="border-b border-zinc-100 dark:border-zinc-800">
                    <td className="sticky left-0 z-10 bg-white p-2 sm:p-3 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.06)] dark:bg-zinc-900"><CarrierBadge id={id} small /></td>
                    {cols.map((c) => {
                      const cp = c.sku.carriers[id];
                      const v = carrierValue(cp, mode, mnp);
                      const ch = cheapest(c);
                      const isMin = v != null && ch.ids.includes(id);
                      const col = carrierColor(id, dark);
                      return (
                        <td key={c.sel.pid} className="p-1.5 sm:p-2 align-top">
                          {v == null ? (
                            <div className="rounded-xl p-2 sm:p-2.5 text-zinc-400">{cp ? (mode === 'return' ? '返却プログラム対象外' : '—') : id === 'apple' ? <>日本 Apple Store 価格なし{c.p.specs.launchPriceUsd ? <span className="block text-[11px]">米国発売時 {String(c.p.specs.launchPriceUsd)}</span> : null}</> : '取扱なし'}</div>
                          ) : (
                            <div className="rounded-xl p-2 sm:p-2.5 transition" style={isMin ? { backgroundColor: '#10b9811f', boxShadow: 'inset 0 0 0 2px #10b981' } : { boxShadow: `inset 3px 0 0 ${col}` }}>
                              <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                                <span className="text-base sm:text-lg font-extrabold tabular-nums text-zinc-900 dark:text-zinc-50">{yen(v)}</span>
                                {isMin && <span className="rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-bold text-white">最安</span>}
                              </div>
                              {!isMin && ch.min != null && <div className="text-[11px] sm:text-xs text-zinc-500 dark:text-zinc-400">最安比 {signedYen(v - ch.min)}</div>}
                              {cp && (
                                <div className="mt-1 space-y-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                                  <div>発売時 {yen(cp.launchPrice)} → 現在 {yen(cp.currentPrice)}</div>
                                  {cp.mnpPrice != null && <div>MNP/新規: {yen(cp.mnpPrice)}</div>}
                                  {cp.returnProgram && <div>{cp.returnProgram.name} ({cp.returnProgram.months}ヶ月): {yen(cp.returnProgram.effectiveCost)}</div>}
                                </div>
                              )}
                            </div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                <tr className="bg-zinc-50 dark:bg-zinc-800/50">
                  <td colSpan={cols.length + 1} className="px-2.5 sm:px-3 py-1.5 text-[11px] sm:text-xs font-bold uppercase tracking-wider text-zinc-500">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span>中古相場・資産価値 — 楽天市場 ＆ Yahoo!ショッピング 横断比較</span>
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold normal-case text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                        ✅ 大手ショップ認定（イオシス・じゃんぱら・ゲオ等）優先 ／ 他社端末・別モデル・ジャンク完全除外
                      </span>
                    </div>
                  </td>
                </tr>
                <tr className="border-b border-zinc-100 dark:border-zinc-800">
                  <td className="sticky left-0 z-10 bg-white p-2 sm:p-3 align-top shadow-[2px_0_5px_-2px_rgba(0,0,0,0.06)] dark:bg-zinc-900">
                    <div className="inline-flex items-center gap-1.5 text-xs font-bold text-rose-600 dark:text-rose-400">
                      <ShoppingBag className="h-3.5 w-3.5 shrink-0" />
                      現在の中古相場
                    </div>
                    <div className="mt-0.5 text-[10px] text-zinc-400">楽天・Yahoo!横断最安</div>
                    <div className="mt-1"><TrustedShopBadge isTrusted={true} compact /></div>
                  </td>
                  {cols.map((c) => {
                    const u = getUsedData(c);
                    const up = u.usedPricing;
                    const isYahooLowest = up.lowestPlatform === 'yahoo';
                    const bestOffer = isYahooLowest ? up.yahoo ?? up.rakuten : up.rakuten ?? up.yahoo;
                    return (
                      <td key={c.sel.pid} className="p-1.5 sm:p-2 align-top">
                        <div className="rounded-xl border border-zinc-200/80 bg-zinc-50/70 p-2 sm:p-2.5 dark:border-zinc-800 dark:bg-zinc-800/40">
                          <div className="flex flex-wrap items-center justify-between gap-1.5">
                            <div>
                              <div className="flex flex-wrap items-center gap-1 text-[10px] font-semibold text-zinc-500 dark:text-zinc-400">
                                <span>横断最安値</span>
                                <span
                                  className={`rounded-full px-1.5 py-0.2 text-[9px] font-bold text-white ${
                                    isYahooLowest ? 'bg-amber-500' : 'bg-rose-600'
                                  }`}
                                >
                                  {isYahooLowest ? 'Yahoo!最安' : '楽天最安'}
                                </span>
                                <TrustedShopBadge isTrusted={bestOffer?.isTrustedShop} compact />
                                {u.source === 'mock' && <span className="rounded bg-zinc-200/80 px-1 text-[9px] font-normal dark:bg-zinc-700">推定</span>}
                              </div>
                              <div className="text-base sm:text-lg font-extrabold tabular-nums text-rose-600 dark:text-rose-400">
                                {yen(up.lowestPrice)}
                              </div>
                            </div>
                            <ResaleBadge rate={up.resaleValuePercent} launchPrice={u.launchPrice} />
                          </div>
                          {u.unused && (
                            <div className="mt-1 flex items-center justify-between text-[11px] tabular-nums text-zinc-600 dark:text-zinc-300">
                              <span className="text-zinc-500">未使用品最安値:</span>
                              <a
                                href={u.unused.itemUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-bold hover:text-sky-600 hover:underline dark:hover:text-sky-400"
                                title={`${u.unused.shopName}: ${u.unused.itemName}`}
                              >
                                {yen(u.unused.price)}
                              </a>
                            </div>
                          )}
                          {u.launchPrice && (
                            <div className="mt-0.5 text-[11px] tabular-nums text-zinc-500 dark:text-zinc-400">
                              発売時Apple直販: {yen(u.launchPrice)} (下限除外 {yen(u.minPrice)})
                            </div>
                          )}

                          {/* 楽天市場 vs Yahoo!ショッピング 横断比較リスト */}
                          <div className="mt-2 space-y-1.5 border-t border-zinc-200/70 pt-1.5 text-[11px] dark:border-zinc-700/70">
                            {up.rakuten && (
                              <div
                                className={`rounded-lg px-2 py-1 ${
                                  !isYahooLowest
                                    ? 'bg-emerald-500/10 ring-1 ring-emerald-500/40'
                                    : 'bg-white/60 dark:bg-zinc-900/40'
                                }`}
                              >
                                <div className="flex items-center justify-between gap-1">
                                  <span className="inline-flex items-center gap-1 font-bold text-rose-600 dark:text-rose-400">
                                    楽天市場
                                    {!isYahooLowest && (
                                      <span className="rounded bg-emerald-500 px-1 py-0.2 text-[9px] font-bold text-white">最安</span>
                                    )}
                                  </span>
                                  <span className="font-extrabold tabular-nums text-zinc-900 dark:text-zinc-50">
                                    {yen(up.rakuten.price)}
                                  </span>
                                </div>
                                <div className="mt-0.5 flex items-center justify-between gap-1 text-[10px]">
                                  <span className="truncate text-zinc-500 dark:text-zinc-400" title={up.rakuten.shopName}>
                                    {up.rakuten.isTrustedShop !== false ? '✅ ' : '※一般: '}
                                    {up.rakuten.shopName}
                                  </span>
                                  <a
                                    href={up.rakuten.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex shrink-0 items-center gap-0.5 font-semibold text-sky-600 hover:underline dark:text-sky-400"
                                  >
                                    商品リンク <ExternalLink className="h-2.5 w-2.5" />
                                  </a>
                                </div>
                              </div>
                            )}
                            {up.yahoo && (
                              <div
                                className={`rounded-lg px-2 py-1 ${
                                  isYahooLowest
                                    ? 'bg-emerald-500/10 ring-1 ring-emerald-500/40'
                                    : 'bg-white/60 dark:bg-zinc-900/40'
                                }`}
                              >
                                <div className="flex items-center justify-between gap-1">
                                  <span className="inline-flex items-center gap-1 font-bold text-amber-600 dark:text-amber-400">
                                    Yahoo!ショッピング
                                    {isYahooLowest && (
                                      <span className="rounded bg-emerald-500 px-1 py-0.2 text-[9px] font-bold text-white">最安</span>
                                    )}
                                  </span>
                                  <span className="font-extrabold tabular-nums text-zinc-900 dark:text-zinc-50">
                                    {yen(up.yahoo.price)}
                                  </span>
                                </div>
                                <div className="mt-0.5 flex items-center justify-between gap-1 text-[10px]">
                                  <span className="truncate text-zinc-500 dark:text-zinc-400" title={up.yahoo.shopName}>
                                    {up.yahoo.isTrustedShop !== false ? '✅ ' : '※一般: '}
                                    {up.yahoo.shopName}
                                  </span>
                                  <a
                                    href={up.yahoo.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex shrink-0 items-center gap-0.5 font-semibold text-sky-600 hover:underline dark:text-sky-400"
                                  >
                                    商品リンク <ExternalLink className="h-2.5 w-2.5" />
                                  </a>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                    );
                  })}
                </tr>
                <tr className="bg-zinc-50 dark:bg-zinc-800/50"><td colSpan={cols.length + 1} className="px-2.5 sm:px-3 py-1.5 text-[11px] sm:text-xs font-bold uppercase tracking-wider text-zinc-500">スペック</td></tr>
                <tr className="border-b border-zinc-100 dark:border-zinc-800"><td className="sticky left-0 bg-white p-2 sm:p-3 text-[11px] sm:text-xs font-semibold text-zinc-500 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.06)] dark:bg-zinc-900">通信方式</td>{cols.map((c) => <td key={c.sel.pid} className="p-2 sm:p-3 text-zinc-800 dark:text-zinc-200">{c.sku.connectivity === '-' ? '共通 (本体仕様参照)' : c.sku.connectivity}</td>)}</tr>
                {SPEC_ROWS.map((r) => (
                  <tr key={r.key} className="border-b border-zinc-100 dark:border-zinc-800">
                    <td className="sticky left-0 bg-white p-2 sm:p-3 text-[11px] sm:text-xs font-semibold text-zinc-500 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.06)] dark:bg-zinc-900 dark:text-zinc-400">{r.label}</td>
                    {cols.map((c) => <td key={c.sel.pid} className="p-2 sm:p-3 align-top text-zinc-800 dark:text-zinc-200">{specText(c.p.specs[r.key])}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="flex items-start gap-1.5 text-xs text-zinc-500"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />キャリア価格・返却時の実質負担額は目安のモデル値です。プログラム条件(回数・手数料・端末状態)により実際の金額は異なります。</p>
        </>
      )}
    </div>
  );
}

/* =====================================================================================
 * 6. タブ2: 価格改定タイムライン＆推移グラフ
 * ===================================================================================== */

function TimelineView({ products, toast }: { products: Product[]; toast: (m: string) => void }) {
  const priced = products.filter(hasPrice);
  return priced.length ? <TimelineInner products={priced} toast={toast} /> : <EmptyNote text="価格データのある機種がありません (表示範囲を「歴代すべて」にしてください)" />;
}

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
    <div className="space-y-4 sm:space-y-5">
      <div className={`${card} p-3.5 sm:p-5`}>
        <SectionTitle icon={<LineIcon className="h-5 w-5" />} title="価格改定タイムライン＆推移グラフ" desc="Apple Store 直販価格 (税込) の変動を、改定ごとの差額・変動率つきで可視化します。" />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <ProductSkuPicker products={products} sel={{ pid: p.id, sid: sku.id }} onChange={setSel} />
          <button className={`${excelBtnCls} w-full sm:w-auto`} onClick={exportModelTimeline}><FileSpreadsheet className="h-4 w-4" />Excel (.xlsx)</button>
        </div>
        <div className="mt-3.5 sm:mt-4 grid gap-2.5 sm:gap-3 sm:grid-cols-3">
          {[
            { label: tl.isDiscontinued ? '発売時 → 販売終了時' : '発売時 → 現在', node: <DeltaBadge diff={total} base={h[0].appleStorePrice} />, sub: `${yen(h[0].appleStorePrice)} → ${yen(lastOf(h).appleStorePrice)}` },
            { label: '最大の値上げ', node: maxHike ? <DeltaBadge diff={maxHike.diff} base={maxHike.prev} /> : <span className="text-sm text-zinc-400">値上げなし</span>, sub: maxHike ? maxHike.pt.date : '' },
            { label: '最大の値下げ', node: maxCut ? <DeltaBadge diff={maxCut.diff} base={maxCut.prev} /> : <span className="text-sm text-zinc-400">値下げなし</span>, sub: maxCut ? maxCut.pt.date : '' },
          ].map((x) => (
            <div key={x.label} className="rounded-xl bg-zinc-50 p-3 dark:bg-zinc-800/60">
              <div className="mb-1.5 text-xs font-semibold text-zinc-500 dark:text-zinc-400">{x.label}</div>{x.node}<div className="mt-1 text-xs tabular-nums text-zinc-500">{x.sub}</div>
            </div>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-zinc-50 px-3 py-2 text-xs text-zinc-600 dark:bg-zinc-800/50 dark:text-zinc-300">
          <div className="flex flex-wrap items-center gap-1.5 tabular-nums">
            <span className="font-semibold text-zinc-500 dark:text-zinc-400">表示期間:</span>
            <span className="font-bold text-sky-600 dark:text-sky-400">{tl.startDate} (発売)</span>
            <span>〜</span>
            <span className={`font-bold ${tl.isDiscontinued ? 'text-zinc-700 dark:text-zinc-200' : 'text-emerald-600 dark:text-emerald-400'}`}>
              {tl.endDate} ({tl.isDiscontinued ? '販売終了' : '現在販売中'})
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-[11px] text-zinc-500">
            <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-sky-500" />発売</span>
            <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-rose-500" />値上げ</span>
            <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />値下げ</span>
            <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-zinc-500" />{tl.isDiscontinued ? '販売終了' : '現在'}</span>
          </div>
        </div>
        <div className="mt-3 sm:mt-4 h-60 sm:h-72">
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
                fontSize={11}
              />
              <YAxis
                stroke={c.axis}
                fontSize={11}
                domain={yAxis.domain}
                ticks={yAxis.ticks}
                tickFormatter={yenAxis}
                width={56}
              />
              <Tooltip
                contentStyle={{ background: c.tipBg, border: `1px solid ${c.tipBorder}`, borderRadius: 12, color: c.text }}
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
                    ? '#0ea5e9'
                    : payload?.diff > 0
                      ? '#f43f5e'
                      : payload?.diff < 0
                        ? '#10b981'
                        : '#71717a';
                  return <circle key={index} cx={cx} cy={cy} r={payload?.isEnd ? 5 : 4.5} fill={fill} stroke={c.tipBg} strokeWidth={2} />;
                }}
                activeDot={{ r: 6.5 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className={`${card} p-3.5 sm:p-5`}>
        <h3 className="mb-3.5 sm:mb-4 text-sm font-bold text-zinc-900 dark:text-zinc-50">改定タイムライン — {p.name} {sku.label}</h3>
        <ol className="relative ml-2.5 sm:ml-3 space-y-4 sm:space-y-5 border-l-2 border-zinc-200 dark:border-zinc-700">
          {timelineEvents.map(({ pt, diff, prev, isEnd }, i) => (
            <li key={pt.date + i} className="ml-4 sm:ml-5">
              <span className={`absolute -left-[9px] mt-1 h-4 w-4 rounded-full border-2 border-white dark:border-zinc-900 ${i === 0 ? 'bg-sky-500' : diff > 0 ? 'bg-rose-500' : diff < 0 ? 'bg-emerald-500' : isEnd ? 'bg-zinc-500' : 'bg-zinc-400'}`} />
              <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                <span className="text-xs sm:text-sm font-bold tabular-nums text-zinc-900 dark:text-zinc-50">{pt.date}</span>
                <span className="text-xs sm:text-sm text-zinc-600 dark:text-zinc-300">{pt.event}</span>
                {pt.approx && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">{pt.confidence === 'low' ? '要検証' : '概算'}</span>}
                {pt.confidence === 'high' && <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300">出典確認済</span>}
                {pt.source && <SourceLink src={pt.source} />}
              </div>
              {pt.note && <div className="mt-0.5 text-xs text-zinc-500">{pt.note}</div>}
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <span className="text-lg sm:text-xl font-extrabold tabular-nums text-zinc-900 dark:text-zinc-50">{yen(pt.appleStorePrice)}</span>
                {i > 0 && diff !== 0 && <DeltaBadge diff={diff} base={prev} />}
                {pt.usdPrice != null && <span className="text-xs text-zinc-500">US ${pt.usdPrice} @ ¥{pt.exchangeRate}</span>}
              </div>
            </li>
          ))}
        </ol>
      </div>

      <div className={`${card} p-3.5 sm:p-5`}>
        <div className="mb-3 flex flex-wrap items-center gap-2 sm:gap-3">
          <h3 className="w-full sm:w-auto text-sm font-bold text-zinc-900 dark:text-zinc-50">一斉改定ビュー: この日の各製品の価格差 (最小容量SKU)</h3>
          <select className={`${selectCls} min-w-0 flex-1 sm:flex-initial`} value={day} onChange={(e) => setDay(e.target.value)}>{dates.map((d) => <option key={d} value={d}>{d} ({dateCounts.get(d)}製品)</option>)}</select>
          <button className={`${excelBtnCls} sm:ml-auto`} disabled={!dayRows.length} onClick={exportDayRevision}><FileSpreadsheet className="h-4 w-4" />Excel (.xlsx)</button>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {dayRows.map((r) => (
            <div key={r.pr.id} className="flex items-center justify-between gap-2 rounded-xl bg-zinc-50 p-3 dark:bg-zinc-800/60">
              <div className="min-w-0"><div className="flex items-center gap-1.5 truncate text-xs sm:text-sm font-semibold text-zinc-900 dark:text-zinc-50"><CatIcon cat={r.pr.category} className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{r.pr.name}</span></div>
                <div className="text-xs tabular-nums text-zinc-500">{r.s.label}: {yen(r.base)} → {yen(r.base + r.diff)}</div></div>
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
    ? <a href={src} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-[11px] text-sky-600 hover:underline dark:text-sky-400"><Link2 className="h-3 w-3" />{host}</a>
    : <span className="text-[11px] text-zinc-500">出典: {src}</span>;
}

type EvKind = 'all' | 'launch' | 'up' | 'down' | 'end';
interface EvRow { key: string; date: string; product: Product; sku: Sku; event: string; kind: Exclude<EvKind, 'all'>; price: number; prev?: number; usd?: number; approx?: boolean; source?: string }

/** 全機種の価格イベント (発売・値上げ・値下げ・販売終了) を一覧化 */
function AllEventsTable({ products, toast }: { products: Product[]; toast: (m: string) => void }) {
  const [kind, setKind] = useState<EvKind>('all');
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
        out.push({ key: `${p.id}|${s.id}|${h.date}|${i}`, date: h.date, product: p, sku: s, event: h.event, kind: k, price: h.appleStorePrice, prev, usd: h.usdPrice, approx: h.approx, source: h.source });
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

  const toggleOne = (key: string) => setSelected((cur) => {
    const next = new Set(cur);
    if (next.has(key)) next.delete(key); else next.add(key);
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
    launch: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300', up: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
    down: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300', end: 'bg-zinc-200 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300',
  };
  const kindLabel: Record<EvRow['kind'], string> = { launch: '発売', up: '値上げ', down: '値下げ', end: '販売終了/変更なし' };

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
    <div className={`${card} p-3.5 sm:p-5`}>
      <div className="mb-3 flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:items-center sm:gap-2">
        <h3 className="mr-2 text-sm font-bold text-zinc-900 dark:text-zinc-50">全機種 価格イベント一覧 ({filtered.length}件)</h3>
        <Segmented<EvKind> value={kind} onChange={(v) => { setKind(v); setLimit(150); }} options={[
          { value: 'all', label: 'すべて' }, { value: 'launch', label: `発売 ${counts.launch}` }, { value: 'up', label: `値上げ ${counts.up}` },
          { value: 'down', label: `値下げ ${counts.down}` }, { value: 'end', label: `終了 ${counts.end}` },
        ]} />
        <div className="grid grid-cols-2 gap-2 sm:contents">
          <select className={`${selectCls} w-full sm:w-auto`} value={cat} onChange={(e) => { setCat(e.target.value); setLimit(150); }}><option value="">全カテゴリ</option>{cats.map((c) => <option key={c} value={c}>{c}</option>)}</select>
          <input value={q} onChange={(e) => { setQ(e.target.value); setLimit(150); }} placeholder="製品名・イベントで検索" className={`${selectCls} w-full sm:w-48`} />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 sm:contents">
          <div className="flex items-center gap-3">
            <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs sm:text-sm text-zinc-700 dark:text-zinc-300"><input type="checkbox" checked={allSkus} onChange={(e) => setAllSkus(e.target.checked)} className="h-4 w-4 accent-sky-500" />全容量SKU</label>
            <button className={btnCls} onClick={() => setSortDesc(!sortDesc)}>{sortDesc ? '新しい順' : '古い順'}</button>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 sm:ml-auto sm:gap-2">
            {picked.length > 0 && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-100 px-2.5 py-1 text-xs font-semibold text-sky-700 dark:bg-sky-500/20 dark:text-sky-300">
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
      </div>

      {/* スマホ向けカードリスト (md未満) */}
      <div className="space-y-2 md:hidden">
        {filtered.length > 0 && (
          <label className="flex cursor-pointer items-center gap-2 rounded-xl bg-zinc-50 px-3 py-2 text-xs font-semibold text-zinc-600 dark:bg-zinc-800/60 dark:text-zinc-300">
            <input type="checkbox" checked={allFilteredSelected} onChange={toggleFiltered} className="h-4 w-4 accent-sky-500" />
            表示中のすべてを選択 ({filtered.length}件)
          </label>
        )}
        {filtered.slice(0, limit).map((r) => {
          const isSel = selected.has(r.key);
          return (
            <div key={r.key} onClick={() => toggleOne(r.key)}
              className={`cursor-pointer rounded-xl border p-3 text-xs transition ${isSel ? 'border-sky-400 bg-sky-50/70 dark:border-sky-500/60 dark:bg-sky-500/10' : 'border-zinc-200 bg-zinc-50/50 dark:border-zinc-800 dark:bg-zinc-800/40'}`}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <input type="checkbox" checked={isSel} onChange={() => {}} onClick={(e) => e.stopPropagation()} className="h-4 w-4 accent-sky-500" />
                  <span className="font-bold tabular-nums text-zinc-700 dark:text-zinc-300">{r.date}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${kindBadge[r.kind]}`}>{kindLabel[r.kind]}</span>
                  {r.approx && <span className="rounded bg-amber-100 px-1 text-[10px] font-bold text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">概算</span>}
                </div>
                {r.source && <span onClick={(e) => e.stopPropagation()}><SourceLink src={r.source} /></span>}
              </div>
              <div className="mt-1.5 flex items-baseline justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-1 font-bold text-sm text-zinc-900 dark:text-zinc-50">
                    <CatIcon cat={r.product.category} className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{r.product.name}</span>
                    <span className="shrink-0 text-xs font-normal text-zinc-500">({r.sku.label})</span>
                  </div>
                  <div className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">{r.event}</div>
                </div>
                <div className="shrink-0 text-right tabular-nums">
                  <div>
                    {r.prev != null && r.prev !== r.price && <span className="text-[11px] text-zinc-400">{yen(r.prev)} → </span>}
                    <span className="text-sm font-extrabold text-zinc-900 dark:text-zinc-50">{yen(r.price)}</span>
                  </div>
                  {r.usd != null && <div className="text-[10px] text-zinc-500">US ${r.usd}</div>}
                </div>
              </div>
              {r.prev != null && r.prev !== r.price && (
                <div className="mt-1.5 flex justify-end"><DeltaBadge diff={r.price - r.prev} base={r.prev} /></div>
              )}
            </div>
          );
        })}
      </div>

      {/* PC/タブレット向けテーブル (md以上) */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[850px] text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500 dark:border-zinc-800">
              <th className="w-9 p-2">
                <input type="checkbox" aria-label="表示中のすべてを選択" checked={allFilteredSelected} onChange={toggleFiltered} className="h-4 w-4 accent-sky-500" />
              </th>
              {['日付', '製品 / SKU', '種別', 'イベント', '価格 (税込)', '差額', '出典'].map((x) => <th key={x} className="p-2 font-semibold">{x}</th>)}
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, limit).map((r) => {
              const isSel = selected.has(r.key);
              return (
                <tr key={r.key} className={`border-b border-zinc-100 align-top text-zinc-800 dark:border-zinc-800 dark:text-zinc-200 ${isSel ? 'bg-sky-50/70 dark:bg-sky-500/10' : ''}`}>
                  <td className="p-2">
                    <input type="checkbox" aria-label={`${r.product.name} ${r.date} を選択`} checked={isSel} onChange={() => toggleOne(r.key)} className="mt-0.5 h-4 w-4 accent-sky-500" />
                  </td>
                  <td className="whitespace-nowrap p-2 tabular-nums">{r.date}</td>
                  <td className="p-2"><div className="flex items-center gap-1.5 font-semibold"><CatIcon cat={r.product.category} className="h-3.5 w-3.5 shrink-0" />{r.product.name}</div><div className="text-xs text-zinc-500">{r.sku.label}</div></td>
                  <td className="p-2"><span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-bold ${kindBadge[r.kind]}`}>{kindLabel[r.kind]}</span></td>
                  <td className="p-2 text-xs">{r.event}{r.approx && <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] font-bold text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">概算</span>}</td>
                  <td className="whitespace-nowrap p-2 tabular-nums">{r.prev != null && r.prev !== r.price && <span className="text-xs text-zinc-400">{yen(r.prev)} → </span>}<span className="font-bold">{yen(r.price)}</span>{r.usd != null && <div className="text-[11px] text-zinc-500">US ${r.usd}</div>}</td>
                  <td className="p-2">{r.prev != null && r.prev !== r.price ? <DeltaBadge diff={r.price - r.prev} base={r.prev} /> : <span className="text-xs text-zinc-400">—</span>}</td>
                  <td className="p-2">{r.source ? <SourceLink src={r.source} /> : <span className="text-xs text-zinc-400">—</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {filtered.length > limit && <button className={`${btnCls} mt-3 w-full sm:w-auto`} onClick={() => setLimit(limit + 300)}>さらに表示 ({limit}/{filtered.length})</button>}
    </div>
  );
}

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

function FxView({ products, toast }: { products: Product[]; toast: (m: string) => void }) {
  const priced = products.filter((p) => pricedSkus(p).some((s) => s.priceHistory.some((h) => h.usdPrice)));
  return priced.length ? <FxInner products={priced} toast={toast} /> : <EmptyNote text="USD価格つきの機種がありません (表示範囲を「歴代すべて」にしてください)" />;
}

function FxInner({ products, toast }: { products: Product[]; toast: (m: string) => void }) {
  const c = useChartColors();
  const dark = useDark();
  const cats = useMemo(() => sortCategories(Array.from(new Set(products.map((x) => x.category)))), [products]);
  const [catSel, setCat] = useState<string>(cats[0]);
  const cat = cats.includes(catSel) ? catSel : cats[0];
  const [sel, setSel] = useState<Sel>({ pid: products[0].id, sid: pricedSkus(products[0])[0].id });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());

  const toLaunchRow = (pr: Product) => {
    const ps = pricedSkus(pr)[0]; const pt = ps.priceHistory[0]; const ar = impliedRate(pt);
    return {
      id: pr.id, category: pr.category, name: pr.name, sku: ps.label, date: pt.date,
      jpy: pt.appleStorePrice, usd: pt.usdPrice, fx: pt.exchangeRate, apple: ar,
      premium: ar && pt.exchangeRate ? (ar / pt.exchangeRate - 1) * 100 : undefined,
      premiumRatio: ar && pt.exchangeRate ? ar / pt.exchangeRate - 1 : undefined,
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
  const tip = { background: c.tipBg, border: `1px solid ${c.tipBorder}`, borderRadius: 12, color: c.text };

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
    <div className="space-y-4 sm:space-y-5">
      <div className={`${card} p-3.5 sm:p-5`}>
        <SectionTitle icon={<Coins className="h-5 w-5" />} title="歴代モデル 発売時価格 vs 為替レート" desc={`Appleレート = 円価格 ÷ ${TAX}(当時の消費税率) ÷ USD価格。市場為替より高ければ「円建てに上乗せ」されています。`} />
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="hidden sm:inline text-sm text-zinc-500">カテゴリ</span>
          <Segmented value={cat} onChange={setCat} options={cats.map((x) => ({ value: x, label: x }))} />
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {pickedLaunch.length > 0 && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-100 px-2.5 py-1 text-xs font-semibold text-sky-700 dark:bg-sky-500/20 dark:text-sky-300">
                {pickedLaunch.length}機種選択中
                <button onClick={() => setSelectedIds(new Set())} className="underline hover:no-underline">解除</button>
              </span>
            )}
            <button className={excelBtnCls} disabled={!targetLaunch.length} onClick={exportLaunchExcel}>
              <FileSpreadsheet className="h-4 w-4" />Excel{pickedLaunch.length > 0 ? ` (${pickedLaunch.length}件)` : ' (.xlsx)'}
            </button>
          </div>
        </div>
        <div className="h-60 sm:h-72">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={launchRows} margin={{ top: 10, right: 6, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={c.grid} strokeDasharray="3 3" />
              <XAxis dataKey="name" stroke={c.axis} fontSize={10} interval="preserveStartEnd" />
              <YAxis yAxisId="l" stroke={c.axis} fontSize={11} tickFormatter={yenAxis} width={56} />
              <YAxis yAxisId="r" orientation="right" stroke={c.axis} fontSize={11} domain={['auto', 'auto']} tickFormatter={(v) => `${v}円`} width={44} />
              <Tooltip contentStyle={tip} formatter={(v: any, n: any) => (n === '発売時価格(JPY)' ? yen(v) : typeof v === 'number' ? v.toFixed(1) : v)} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar yAxisId="l" dataKey="jpy" name="発売時価格(JPY)" fill={carrierColor('apple', dark)} fillOpacity={0.25} radius={[6, 6, 0, 0]} />
              <Line yAxisId="r" type="monotone" dataKey="fx" name="市場為替 (円/$)" stroke={carrierColor('softbank', dark)} strokeWidth={2.5} dot />
              <Line yAxisId="r" type="monotone" dataKey="apple" name="実質Appleレート (円/$)" stroke={carrierColor('docomo', dark)} strokeWidth={2.5} dot />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* スマホ向けカードリスト (md未満) */}
        <div className="mt-4 space-y-2 md:hidden">
          {launchRows.length > 0 && (
            <label className="flex cursor-pointer items-center gap-2 rounded-xl bg-zinc-50 px-3 py-2 text-xs font-semibold text-zinc-600 dark:bg-zinc-800/60 dark:text-zinc-300">
              <input type="checkbox" checked={allCatSelected} onChange={toggleLaunchCat} className="h-4 w-4 accent-sky-500" />
              表示カテゴリの全モデルを選択 ({launchRows.length}機種)
            </label>
          )}
          {launchRows.map((r) => {
            const isSel = selectedIds.has(r.id);
            return (
              <div key={r.id} onClick={() => toggleLaunchOne(r.id)}
                className={`cursor-pointer rounded-xl border p-3 text-xs tabular-nums transition ${isSel ? 'border-sky-400 bg-sky-50/70 dark:border-sky-500/60 dark:bg-sky-500/10' : 'border-zinc-200 bg-zinc-50/50 dark:border-zinc-800 dark:bg-zinc-800/40'}`}>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <input type="checkbox" checked={isSel} onChange={() => {}} onClick={(e) => e.stopPropagation()} className="h-4 w-4 shrink-0 accent-sky-500" />
                    <span className="truncate text-sm font-bold text-zinc-900 dark:text-zinc-50">{r.name}</span>
                    <span className="shrink-0 text-xs text-zinc-500">({r.sku})</span>
                  </div>
                  <span className="shrink-0 text-zinc-500">{r.date}</span>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2 rounded-lg bg-white/80 p-2 dark:bg-zinc-900/60">
                  <div>
                    <div className="text-[10px] text-zinc-500">発売時価格</div>
                    <div className="font-bold text-zinc-900 dark:text-zinc-100">{yen(r.jpy)}</div>
                    <div className="text-[10px] text-zinc-500">{r.usd != null ? `US $${r.usd}` : '—'}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-zinc-500">市場 / Appleレート</div>
                    <div className="font-semibold text-zinc-800 dark:text-zinc-200">{r.fx != null ? `¥${r.fx.toFixed(1)}` : '—'} → {r.apple != null ? `¥${r.apple.toFixed(1)}` : '—'}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] text-zinc-500">為替比プレミアム</div>
                    <div className="text-sm font-bold">{r.premium != null ? <span className={r.premium > 0 ? 'text-rose-500' : 'text-emerald-500'}>{signedPct(r.premium)}</span> : '—'}</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* PC/タブレット向けテーブル (md以上) */}
        <div className="mt-4 hidden overflow-x-auto md:block">
          <table className="w-full min-w-[680px] text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500 dark:border-zinc-800">
                <th className="w-9 p-2">
                  <input type="checkbox" aria-label="表示カテゴリの全モデルを選択" checked={allCatSelected} onChange={toggleLaunchCat} className="h-4 w-4 accent-sky-500" />
                </th>
                {['モデル', '発売日', '日本価格', 'USD価格', '市場為替', 'Appleレート', '為替比プレミアム'].map((x) => <th key={x} className="p-2 font-semibold">{x}</th>)}
              </tr>
            </thead>
            <tbody>
              {launchRows.map((r) => {
                const isSel = selectedIds.has(r.id);
                return (
                  <tr key={r.id} className={`border-b border-zinc-100 tabular-nums text-zinc-800 dark:border-zinc-800 dark:text-zinc-200 ${isSel ? 'bg-sky-50/70 dark:bg-sky-500/10' : ''}`}>
                    <td className="p-2">
                      <input type="checkbox" aria-label={`${r.name} を選択`} checked={isSel} onChange={() => toggleLaunchOne(r.id)} className="h-4 w-4 accent-sky-500" />
                    </td>
                    <td className="p-2 font-semibold">{r.name} <span className="text-xs font-normal text-zinc-500">{r.sku}</span></td><td className="p-2">{r.date}</td><td className="p-2">{yen(r.jpy)}</td>
                    <td className="p-2">{r.usd != null ? `$${r.usd}` : '—'}</td><td className="p-2">{r.fx != null ? `¥${r.fx.toFixed(1)}` : '—'}</td>
                    <td className="p-2">{r.apple != null ? `¥${r.apple.toFixed(1)}` : '—'}</td>
                    <td className="p-2">{r.premium != null ? <span className={r.premium > 0 ? 'font-bold text-rose-500' : 'font-bold text-emerald-500'}>{signedPct(r.premium)}</span> : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className={`${card} p-3.5 sm:p-5`}>
        <h3 className="mb-3 text-sm font-bold text-zinc-900 dark:text-zinc-50">価格改定の内訳: ドル建て据え置き？ それともドル自体が値上がり？</h3>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <ProductSkuPicker products={products} sel={{ pid: p.id, sid: sku.id }} onChange={setSel} />
          <button className={`${excelBtnCls} w-full sm:w-auto`} onClick={exportBreakdownExcel}><FileSpreadsheet className="h-4 w-4" />Excel (.xlsx)</button>
        </div>
        <div className="mt-4 h-56 sm:h-64">
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
                fontSize={11}
              />
              <YAxis stroke={c.axis} fontSize={11} domain={['auto', 'auto']} tickFormatter={(v) => `${Math.round(v)}`} width={36} />
              <Tooltip contentStyle={tip} labelFormatter={(t: any) => `${new Date(t).toISOString().slice(0, 10)} (${ymJp(Number(t))})`} formatter={(v: any) => (typeof v === 'number' ? v.toFixed(1) : v)} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line type="stepAfter" dataKey="JPY" name="円価格 (発売時=100)" stroke={carrierColor('apple', dark)} strokeWidth={3} dot />
              <Line type="stepAfter" dataKey="USD" name="USD価格" stroke={carrierColor('au', dark)} strokeWidth={2} dot connectNulls />
              <Line type="monotone" dataKey="市場為替" name="市場為替" stroke={carrierColor('softbank', dark)} strokeWidth={2} strokeDasharray="5 4" dot connectNulls />
              <Line type="monotone" dataKey="Appleレート" name="実質Appleレート" stroke={carrierColor('rakuten', dark)} strokeWidth={2} dot connectNulls />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-4 space-y-2">
          {h.map((pt, i) => {
            if (!i) return null;
            const prev = h[i - 1]; const v = verdict(prev, pt);
            const ar = impliedRate(pt); const pr = impliedRate(prev);
            return (
              <div key={pt.date} className="rounded-xl bg-zinc-50 p-3 dark:bg-zinc-800/60">
                <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                  <span className="text-xs sm:text-sm font-bold tabular-nums text-zinc-900 dark:text-zinc-50">{pt.date}</span>
                  <DeltaBadge diff={pt.appleStorePrice - prev.appleStorePrice} base={prev.appleStorePrice} />
                  <span className={`rounded-full px-2 sm:px-2.5 py-0.5 sm:py-1 text-[11px] sm:text-xs font-bold ${v.tone === 'up' ? 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300' : v.tone === 'down' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300' : 'bg-zinc-200 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300'}`}>{v.text}</span>
                </div>
                <div className="mt-1.5 grid gap-x-6 gap-y-0.5 text-xs tabular-nums text-zinc-600 dark:text-zinc-400 sm:grid-cols-3">
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

/* =====================================================================================
 * 8. App
 * ===================================================================================== */

const LS_DATA = 'apple-price-atlas:data:v1';
const LS_THEME = 'apple-price-atlas:theme';
const LS_EXT = 'apple-price-atlas:ext-version';
const LS_AUTODB = 'apple-price-atlas:appledb-auto';
const LS_SCOPE = 'apple-price-atlas:scope';
type Scope = 'all' | 'detail';
type Tab = 'compare' | 'timeline' | 'fx';

export default function App() {
  const [dark, setDark] = useState<boolean>(() => {
    try { const t = localStorage.getItem(LS_THEME); if (t) return t === 'dark'; } catch { /* noop */ }
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
  });
  const [products, setProducts] = useState<Product[]>(() => {
    try { const raw = localStorage.getItem(LS_DATA); if (raw) { const r = normalizeDataset(JSON.parse(raw)); if (r.products.length) return r.products; } } catch { /* noop */ }
    return normalizeDataset(BUILTIN_DATASET).products;
  });
  const [scope, setScopeState] = useState<Scope>(() => { try { return localStorage.getItem(LS_SCOPE) === 'detail' ? 'detail' : 'all'; } catch { return 'all'; } });
  const setScope = (v: Scope) => { setScopeState(v); try { localStorage.setItem(LS_SCOPE, v); } catch { /* noop */ } };
  const nDetail = useMemo(() => products.filter(hasDetail).length, [products]);
  const visible = useMemo(() => (scope === 'all' ? products : products.filter(hasDetail)), [products, scope]);
  const productsRef = useRef(products);
  productsRef.current = products;
  const [tab, setTab] = useState<Tab>('compare');
  const [mode, setMode] = useState<Mode>('bulk');
  const [mnp, setMnp] = useState(false);
  const [sels, setSels] = useState<Sel[]>(() => ['iphone-14', 'iphone-15', 'iphone-16'].map((id) => ({ pid: id, sid: '128' })));
  const [toastMsg, setToastMsg] = useState('');
  const toastTimer = useRef<number>();

  const toast = (m: string) => { setToastMsg(m); window.clearTimeout(toastTimer.current); toastTimer.current = window.setTimeout(() => setToastMsg(''), 2200); };

  useEffect(() => { document.documentElement.classList.toggle('dark', dark); try { localStorage.setItem(LS_THEME, dark ? 'dark' : 'light'); } catch { /* noop */ } }, [dark]);
  useEffect(() => { try { localStorage.setItem(LS_DATA, JSON.stringify({ schemaVersion: 1, products })); } catch { /* noop */ } }, [products]);

  // 起動時の自動読み込み:
  //  1) ./products.json (同梱の実データ) を generatedAt が変わったときだけ id 単位でマージ
  //  2) AppleDB が有効なら api.appledb.dev から取得してスペック/販売終了日を補強
  //  いずれも失敗時は静かに無視 (オフライン・未配置でも動作)
  useEffect(() => {
    const autoDb = (() => { try { return localStorage.getItem(LS_AUTODB) !== 'off'; } catch { return true; } })();
    (async () => {
      let cur = productsRef.current; let dirty = false; const notes: string[] = [];
      try {
        const r = await fetch('./products.json');
        if (r.ok) {
          const j = await r.json(); const ver = String(j?.meta?.generatedAt ?? '');
          if (ver && localStorage.getItem(LS_EXT) !== ver) {
            const { products: ps } = normalizeDataset(j);
            if (ps.length) { cur = mergeProducts(cur, ps); dirty = true; localStorage.setItem(LS_EXT, ver); notes.push(`products.json ${ps.length}製品`); }
          }
        }
      } catch { /* noop */ }
      if (autoDb) {
        try {
          const r = await fetch(APPLEDB_URL);
          if (r.ok) { const res = applyAppleDb(cur, await r.json()); if (JSON.stringify(res.products) !== JSON.stringify(cur)) { cur = res.products; dirty = true; notes.push('AppleDB'); } }
        } catch { /* noop */ }
      }
      if (dirty) { setProducts(cur); toast(`自動適用: ${notes.join(' + ')}`); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 製品が変わったとき選択を整合させる
  useEffect(() => {
    setSels((cur) => {
      const valid = cur.filter((s) => products.some((p) => p.id === s.pid)).map((s) => { const p = products.find((x) => x.id === s.pid)!; return p.skus.some((k) => k.id === s.sid) ? s : { pid: p.id, sid: p.skus[0].id }; });
      if (valid.length) return valid.length === cur.length && valid.every((v, i) => v === cur[i]) ? cur : valid;
      return products.slice(-2).map((p) => ({ pid: p.id, sid: p.skus[0].id }));
    });
  }, [products]);

  const tabs: { id: Tab; label: string; shortLabel: string; icon: React.ReactNode }[] = [
    { id: 'compare', label: 'スペック＆キャリア比較', shortLabel: '価格・スペック比較', icon: <Scale className="h-4 w-4 shrink-0" /> },
    { id: 'timeline', label: '価格改定タイムライン', shortLabel: '価格改定履歴', icon: <LineIcon className="h-4 w-4 shrink-0" /> },
    { id: 'fx', label: '発売時価格 × 為替', shortLabel: '発売価格×為替', icon: <Coins className="h-4 w-4 shrink-0" /> },
  ];

  return (
    <ThemeCtx.Provider value={dark}>
      <div className="min-h-screen text-zinc-900 dark:text-zinc-100">
        <header className="sticky top-0 z-30 border-b border-zinc-200 bg-white/85 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/85">
          <div className="mx-auto flex max-w-7xl items-center gap-2 sm:gap-3 px-3 py-2.5 sm:px-4 sm:py-3">
            <div className="flex min-w-0 items-center gap-2">
              <div className="shrink-0 rounded-xl bg-zinc-900 p-1.5 text-white dark:bg-white dark:text-zinc-900"><Apple className="h-5 w-5" /></div>
              <div className="min-w-0">
                <div className="truncate text-sm sm:text-base font-extrabold leading-tight">Apple Price Atlas</div>
                <div className="truncate text-[10px] sm:text-[11px] text-zinc-500">スペック・キャリア価格・価格改定の完全比較</div>
              </div>
            </div>
            <div className="ml-2 hidden items-center gap-1.5 lg:flex">{CARRIER_ORDER.map((id) => <CarrierBadge key={id} id={id} small />)}</div>
            <button onClick={() => setDark(!dark)} aria-label="テーマ切替" className={`${btnCls} ml-auto shrink-0 !px-2.5 !py-1.5`}>
              {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              <span className="hidden xs:inline sm:inline">{dark ? 'ライト' : 'ダーク'}</span>
            </button>
          </div>
          <nav className="mx-auto grid max-w-7xl grid-cols-3 sm:flex sm:gap-1 px-2 sm:px-4">
            {tabs.map((t) => (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`inline-flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-1.5 whitespace-nowrap border-b-2 px-1 sm:px-3.5 py-2 sm:py-2.5 text-[11px] sm:text-sm font-semibold transition ${tab === t.id ? 'border-sky-500 text-sky-600 dark:text-sky-400' : 'border-transparent text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100'}`}>
                {t.icon}
                <span className="sm:hidden">{t.shortLabel}</span>
                <span className="hidden sm:inline">{t.label}</span>
              </button>
            ))}
          </nav>
        </header>

        <main className="mx-auto max-w-7xl px-3 py-4 sm:px-4 sm:py-6">
          <div className="mb-3.5 sm:mb-4 flex flex-col gap-1.5 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
            <div className="flex items-center gap-2">
              <span className="shrink-0 text-xs font-semibold text-zinc-500">表示範囲</span>
              <Segmented<Scope> value={scope} onChange={setScope} options={[
                { value: 'detail', label: `★ 価格履歴あり (${nDetail})` },
                { value: 'all', label: `歴代すべて (${products.length})` },
              ]} />
            </div>
            <span className="text-[11px] sm:text-xs text-zinc-500">{scope === 'detail' ? '発売時・値上げ/値下げ履歴（またはキャリア価格）を持つ機種のみ' : 'AppleDB の全機種(スペック中心・価格のない機種も含む)。★は価格履歴あり'}</span>
          </div>
          {tab === 'compare' && <CompareView products={visible} all={products} sels={sels} setSels={setSels} mode={mode} setMode={setMode} mnp={mnp} setMnp={setMnp} toast={toast} />}
          {tab === 'timeline' && <TimelineView products={visible} toast={toast} />}
          {tab === 'fx' && <FxView products={visible} toast={toast} />}
        </main>

        <footer className="mx-auto max-w-7xl px-3 sm:px-4 pb-10 text-[11px] sm:text-xs text-zinc-500">
          <div className="flex flex-col gap-2 border-t border-zinc-200 pt-4 sm:flex-row sm:items-center sm:justify-between dark:border-zinc-800">
            <div className="space-y-0.5">
              <div>※ 価格は日本国内の税込表示。為替・USD価格・キャリア価格・中古相場には概算/モデル値を含みます。購入前に各公式サイト・販売店で最新情報をご確認ください。</div>
              <div>※ 当サイトは楽天アフィリエイト等のアフィリエイトプログラムに参加しており、一部ショップリンクに広告（PR）を含みます。</div>
            </div>
            <div className="flex shrink-0 items-center gap-4 font-medium">
              <a href="./privacy/" className="hover:text-zinc-900 hover:underline dark:hover:text-zinc-200">プライバシーポリシー</a>
              <a href="./terms/" className="hover:text-zinc-900 hover:underline dark:hover:text-zinc-200">利用規約</a>
            </div>
          </div>
        </footer>

        {toastMsg && (
          <div className="fixed bottom-4 left-1/2 z-50 w-max max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-full bg-zinc-900 px-4 py-2 text-center text-xs sm:text-sm font-medium text-white shadow-lg dark:bg-white dark:text-zinc-900">
            <span className="inline-flex items-center gap-1.5"><Check className="h-4 w-4 shrink-0 text-emerald-400" /><span>{toastMsg}</span></span>
          </div>
        )}
      </div>
    </ThemeCtx.Provider>
  );
}

function mergeProducts(cur: Product[], incoming: Product[]): Product[] {
  const map = new Map(cur.map((p) => [p.id, p]));
  incoming.forEach((p) => map.set(p.id, p));
  return Array.from(map.values()).sort(compareProducts);
}


export const SAMPLE_DATASET = BUILTIN_DATASET;
export { applyAppleDb, normalizeDataset };

export { hasDetail, hasPrice };
