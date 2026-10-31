import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ComposedChart, Bar,
} from 'recharts';
import {
  Smartphone, Tablet, Watch, Laptop, Sun, Moon, TrendingUp, TrendingDown, Minus, Copy, Download, Upload,
  Trash2, RotateCcw, Check, Scale, LineChart as LineIcon, Database, Coins, Plus, X, Link2, AlertTriangle,
  Info, Trophy, Apple, Headphones, Search,
} from 'lucide-react';

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
 *      正確な運用には「データ管理」タブから実データ JSON を読み込んでください。
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

// AppleDB 連携用の機種ID (specs.identifier)。AppleDB 適用時にスペック・販売終了日が補強される
const APPLEDB_IDS: Record<string, string> = {
  'iphone-13': 'iPhone14,5', 'iphone-14': 'iPhone14,7', 'iphone-15': 'iPhone15,4', 'iphone-16': 'iPhone17,3',
  'ipad-10': 'iPad13,18', 'watch-s10': 'Watch7,8',
};
SAMPLE_PRODUCTS.forEach((p) => { if (APPLEDB_IDS[p.id]) p.specs.identifier = APPLEDB_IDS[p.id]; });

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
const lastOf = <T,>(a: T[]) => a[a.length - 1];
const impliedRate = (p: PricePoint) => (p.usdPrice ? p.appleStorePrice / (1 + (p.taxRate ?? 0.1)) / p.usdPrice : undefined);
/** 価格データを持つSKU / 製品か */
const skuPriced = (s: Sku) => s.priceHistory.length > 0;
const pricedSkus = (p: Product) => p.skus.filter(skuPriced);
const hasPrice = (p: Product) => p.skus.some(skuPriced);
/** 詳細価格データ(複数回の改定 or キャリア価格)があるか */
const hasDetail = (p: Product) => p.detail ?? p.skus.some((s) => new Set(s.priceHistory.map((h) => h.appleStorePrice)).size > 1 || Object.keys(s.carriers).some((k) => k !== 'apple'));

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
      skus.push({ id: String(s.id), label: s.label ?? s.storage ?? String(s.id), storage: s.storage ?? '', connectivity: s.connectivity ?? '-', priceHistory, carriers });
    });
    if (!skus.length) return;
    products.push({
      id: String(p.id), category: p.category, name: p.name, generation: p.generation ?? '', releaseDate: p.releaseDate ?? skus[0].priceHistory[0]?.date ?? '',
      specs: p.specs ?? {}, skus, ...(typeof p.detail === 'boolean' ? { detail: p.detail } : {}), ...(p.priceResearched ? { priceResearched: true } : {}),
    });
  });
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
        if (!last || last.event === '販売終了' || jp <= last.date || jp > today) return k;
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
  return { products: out, report };
}
const specText = (v: string | string[] | undefined) => (Array.isArray(v) ? v.join(' / ') : v || '—');

/** 比較表 (コピー用) のデータ行を組み立てる */
function buildCompareTable(products: Product[], sel: Sel[], mode: Mode, mnp: boolean): string[][] {
  const cols = sel.map((s) => {
    const p = products.find((x) => x.id === s.pid)!; return { p, sku: p.skus.find((k) => k.id === s.sid) ?? p.skus[0] };
  });
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
function downloadFile(name: string, text: string, mime = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url);
}

/* =====================================================================================
 * 4. 共通 UI パーツ
 * ===================================================================================== */

const card = 'rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900';
const selectCls = 'rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-sm text-zinc-900 outline-none focus:ring-2 focus:ring-sky-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100';
const btnCls = 'inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700';

function CarrierBadge({ id, small }: { id: CarrierId; small?: boolean }) {
  const dark = useDark();
  const c = carrierColor(id, dark);
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border font-semibold ${small ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs'}`}
      style={{ color: c, borderColor: c + '66', backgroundColor: c + '1a' }}>
      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: c }} />
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
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold tabular-nums ${cls}`}>
      <Icon className="h-3.5 w-3.5" />{signedYen(diff)} ({signedPct(pct)})
    </span>
  );
}

function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <div className="inline-flex rounded-xl bg-zinc-200/70 p-1 dark:bg-zinc-800">
      {options.map((o) => (
        <button key={o.value} onClick={() => onChange(o.value)}
          className={`rounded-lg px-3.5 py-1.5 text-sm font-semibold transition ${value === o.value ? 'bg-white text-zinc-900 shadow dark:bg-zinc-600 dark:text-white' : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white'}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function SectionTitle({ icon, title, desc }: { icon: React.ReactNode; title: string; desc?: string }) {
  return (
    <div className="mb-4 flex items-start gap-3">
      <div className="rounded-xl bg-zinc-900 p-2 text-white dark:bg-zinc-100 dark:text-zinc-900">{icon}</div>
      <div><h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-50">{title}</h2>{desc && <p className="text-sm text-zinc-500 dark:text-zinc-400">{desc}</p>}</div>
    </div>
  );
}

function ProductSkuPicker({ products, sel, onChange }: { products: Product[]; sel: Sel; onChange: (s: Sel) => void }) {
  const p = products.find((x) => x.id === sel.pid) ?? products[0];
  const cats = Array.from(new Set(products.map((x) => x.category)));
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select className={selectCls} value={p.id} onChange={(e) => { const np = products.find((x) => x.id === e.target.value)!; onChange({ pid: np.id, sid: (pricedSkus(np)[0] ?? np.skus[0]).id }); }}>
        {cats.map((c) => (<optgroup key={c} label={c}>{products.filter((x) => x.category === c).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</optgroup>))}
      </select>
      <select className={selectCls} value={sel.sid} onChange={(e) => onChange({ pid: p.id, sid: e.target.value })}>
        {(pricedSkus(p).length ? pricedSkus(p) : p.skus).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
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
  const available = products.filter((p) => !sels.some((s) => s.pid === p.id));
  const allCats = Array.from(new Set(products.map((x) => x.category)));
  const matched = available.filter((p) => (!catF || p.category === catF) && (!q.trim() || p.name.toLowerCase().includes(q.trim().toLowerCase()) || String(p.specs.identifier ?? '').toLowerCase().includes(q.trim().toLowerCase())));

  const doCopy = async (kind: 'md' | 'csv') => {
    if (!sels.length) return;
    const rows = buildCompareTable(all, sels, mode, mnp);
    const ok = await copyText(kind === 'md' ? toMarkdown(rows) : toCSV(rows));
    toast(ok ? `${kind === 'md' ? 'Markdown' : 'CSV'} をコピーしました` : 'コピーに失敗しました');
  };

  const cheapest = (c: (typeof cols)[number]) => {
    const vals = CARRIER_ORDER.map((id) => ({ id, v: carrierValue(c.sku.carriers[id], mode, mnp) })).filter((x): x is { id: CarrierId; v: number } => x.v != null);
    if (!vals.length) return { min: null as number | null, ids: [] as CarrierId[] };
    const min = Math.min(...vals.map((x) => x.v));
    return { min, ids: vals.filter((x) => x.v === min).map((x) => x.id) };
  };

  return (
    <div className="space-y-5">
      <div className={`${card} p-5`}>
        <SectionTitle icon={<Scale className="h-5 w-5" />} title="スペック＆キャリア価格 比較" desc="機種を追加し、容量・通信方式を選んで横並び比較。最安キャリアを自動ハイライトします。" />
        <div className="flex flex-wrap items-center gap-3">
          <Segmented<Mode> value={mode} onChange={setMode} options={[{ value: 'bulk', label: '一括価格モード' }, { value: 'return', label: '2年返却（実質負担額）モード' }]} />
          <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
            <input type="checkbox" checked={mnp} onChange={(e) => setMnp(e.target.checked)} className="h-4 w-4 accent-sky-500" />MNP/新規割引を適用
          </label>
          <div className="ml-auto flex gap-2">
            <button className={btnCls} onClick={() => doCopy('md')}><Copy className="h-4 w-4" />Markdown</button>
            <button className={btnCls} onClick={() => doCopy('csv')}><Copy className="h-4 w-4" />CSV</button>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {cols.map((c) => (
            <span key={c.sel.pid} className="inline-flex items-center gap-1.5 rounded-full bg-zinc-100 py-1 pl-3 pr-1.5 text-sm font-medium text-zinc-800 dark:bg-zinc-800 dark:text-zinc-100">
              <CatIcon cat={c.p.category} className="h-3.5 w-3.5" />{c.p.name}
              <button aria-label="削除" onClick={() => setSels(sels.filter((s) => s.pid !== c.sel.pid))} className="rounded-full p-0.5 hover:bg-zinc-300 dark:hover:bg-zinc-600"><X className="h-3.5 w-3.5" /></button>
            </span>
          ))}
          {available.length > 0 && (
            <span className="inline-flex flex-wrap items-center gap-1.5">
              <select className={selectCls} value={catF} onChange={(e) => setCatF(e.target.value)} aria-label="カテゴリ絞り込み">
                <option value="">全カテゴリ</option>{allCats.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <span className="relative"><Search className="pointer-events-none absolute left-2 top-2 h-4 w-4 text-zinc-400" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="機種名・識別子で検索" className={`${selectCls} w-44 pl-7`} /></span>
              <select className={`${selectCls} max-w-[16rem]`} value={adding} onChange={(e) => { const p = all.find((x) => x.id === e.target.value); if (p) setSels([...sels, { pid: p.id, sid: p.skus[0].id }]); setAdding(''); }}>
                <option value="">＋ 機種を追加… ({matched.length}件)</option>
                {Array.from(new Set(matched.map((x) => x.category))).map((cat) => (
                  <optgroup key={cat} label={cat}>{matched.filter((x) => x.category === cat).slice(0, 300).map((x) => <option key={x.id} value={x.id}>{x.name} ({x.releaseDate.slice(0, 4)}){hasDetail(x) ? ' ★' : ''}</option>)}</optgroup>
                ))}
              </select>
            </span>
          )}
        </div>
      </div>

      {!cols.length ? (
        <div className={`${card} p-10 text-center text-zinc-500`}>比較する機種を追加してください。</div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {cols.map((c) => {
              const ch = cheapest(c);
              const apple = carrierValue(c.sku.carriers.apple, mode, mnp);
              return (
                <div key={c.sel.pid} className={`${card} p-4`}>
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-500 dark:text-zinc-400"><Trophy className="h-3.5 w-3.5 text-amber-500" />最安: {c.p.name} / {c.sku.label}</div>
                  {ch.min == null ? <div className="mt-2 text-sm text-zinc-500">このモードで購入可能な窓口がありません</div> : (
                    <>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">{ch.ids.map((id) => <CarrierBadge key={id} id={id} />)}</div>
                      <div className="mt-1 text-2xl font-extrabold tabular-nums text-zinc-900 dark:text-zinc-50">{yen(ch.min)}</div>
                      {apple != null && !ch.ids.includes('apple') && <div className="text-xs text-emerald-600 dark:text-emerald-400">Apple Store比 {signedYen(ch.min - apple)}</div>}
                    </>
                  )}
                </div>
              );
            })}
          </div>

          <div className={`${card} overflow-x-auto`}>
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-800">
                  <th className="sticky left-0 z-10 w-36 bg-white p-3 text-left text-xs font-semibold text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">項目</th>
                  {cols.map((c) => (
                    <th key={c.sel.pid} className="min-w-[220px] p-3 text-left align-top">
                      <div className="flex items-center gap-1.5 text-base font-bold text-zinc-900 dark:text-zinc-50"><CatIcon cat={c.p.category} className="h-4 w-4" />{c.p.name}</div>
                      <div className="mb-2 text-xs font-normal text-zinc-500 dark:text-zinc-400">{c.p.generation} ・ {c.p.releaseDate} 発売</div>
                      <select className={`${selectCls} w-full`} value={c.sku.id} onChange={(e) => setSels(sels.map((s) => (s.pid === c.sel.pid ? { ...s, sid: e.target.value } : s)))}>
                        {c.p.skus.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
                      </select>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr className="bg-zinc-50 dark:bg-zinc-800/50"><td colSpan={cols.length + 1} className="px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-zinc-500">価格 — {mode === 'bulk' ? '一括' : '2年返却 実質負担額'}{mnp ? ' (MNP/新規割引後)' : ''}</td></tr>
                {CARRIER_ORDER.map((id) => (
                  <tr key={id} className="border-b border-zinc-100 dark:border-zinc-800">
                    <td className="sticky left-0 z-10 bg-white p-3 dark:bg-zinc-900"><CarrierBadge id={id} /></td>
                    {cols.map((c) => {
                      const cp = c.sku.carriers[id];
                      const v = carrierValue(cp, mode, mnp);
                      const ch = cheapest(c);
                      const isMin = v != null && ch.ids.includes(id);
                      const col = carrierColor(id, dark);
                      return (
                        <td key={c.sel.pid} className="p-2 align-top">
                          {v == null ? (
                            <div className="rounded-xl p-2.5 text-zinc-400">{cp ? (mode === 'return' ? '返却プログラム対象外' : '—') : '取扱なし'}</div>
                          ) : (
                            <div className="rounded-xl p-2.5 transition" style={isMin ? { backgroundColor: '#10b9811f', boxShadow: 'inset 0 0 0 2px #10b981' } : { boxShadow: `inset 3px 0 0 ${col}` }}>
                              <div className="flex items-center gap-2">
                                <span className="text-lg font-extrabold tabular-nums text-zinc-900 dark:text-zinc-50">{yen(v)}</span>
                                {isMin && <span className="rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-bold text-white">最安</span>}
                              </div>
                              {!isMin && ch.min != null && <div className="text-xs text-zinc-500 dark:text-zinc-400">最安比 {signedYen(v - ch.min)}</div>}
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
                <tr className="bg-zinc-50 dark:bg-zinc-800/50"><td colSpan={cols.length + 1} className="px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-zinc-500">スペック</td></tr>
                <tr className="border-b border-zinc-100 dark:border-zinc-800"><td className="sticky left-0 bg-white p-3 text-xs font-semibold text-zinc-500 dark:bg-zinc-900">通信方式</td>{cols.map((c) => <td key={c.sel.pid} className="p-3 text-zinc-800 dark:text-zinc-200">{c.sku.connectivity === '-' ? '共通 (本体仕様参照)' : c.sku.connectivity}</td>)}</tr>
                {SPEC_ROWS.map((r) => (
                  <tr key={r.key} className="border-b border-zinc-100 dark:border-zinc-800">
                    <td className="sticky left-0 bg-white p-3 text-xs font-semibold text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">{r.label}</td>
                    {cols.map((c) => <td key={c.sel.pid} className="p-3 align-top text-zinc-800 dark:text-zinc-200">{specText(c.p.specs[r.key])}</td>)}
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

function TimelineView({ products }: { products: Product[] }) {
  const priced = products.filter(hasPrice);
  return priced.length ? <TimelineInner products={priced} /> : <EmptyNote text="価格データのある機種がありません (表示範囲を「歴代すべて」にするか、JSONを読み込んでください)" />;
}

function TimelineInner({ products }: { products: Product[] }) {
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
  const chartData = [...h.map((x) => ({ t: ts(x.date), price: x.appleStorePrice, event: x.event })), { t: Math.max(Date.now(), ts(lastOf(h).date)), price: lastOf(h).appleStorePrice, event: '現在' }];

  // 一斉改定日
  const dateCounts = new Map<string, number>();
  products.forEach((pr) => { const s = pricedSkus(pr)[0]; s.priceHistory.forEach((x, i) => { if (i && x.appleStorePrice !== s.priceHistory[i - 1].appleStorePrice) dateCounts.set(x.date, (dateCounts.get(x.date) ?? 0) + 1); }); });
  const dates = Array.from(dateCounts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([d]) => d);
  const [day, setDay] = useState(dates.includes('2022-07-01') ? '2022-07-01' : dates[0] ?? '');
  const dayRows = products.map((pr) => {
    const s = pricedSkus(pr)[0]; const i = s.priceHistory.findIndex((x) => x.date === day);
    return i > 0 ? { pr, s, diff: s.priceHistory[i].appleStorePrice - s.priceHistory[i - 1].appleStorePrice, base: s.priceHistory[i - 1].appleStorePrice, ev: s.priceHistory[i].event } : null;
  }).filter(Boolean) as { pr: Product; s: Sku; diff: number; base: number; ev: string }[];

  return (
    <div className="space-y-5">
      <div className={`${card} p-5`}>
        <SectionTitle icon={<LineIcon className="h-5 w-5" />} title="価格改定タイムライン＆推移グラフ" desc="Apple Store 直販価格 (税込) の変動を、改定ごとの差額・変動率つきで可視化します。" />
        <ProductSkuPicker products={products} sel={{ pid: p.id, sid: sku.id }} onChange={setSel} />
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {[
            { label: '発売時 → 現在', node: <DeltaBadge diff={total} base={h[0].appleStorePrice} />, sub: `${yen(h[0].appleStorePrice)} → ${yen(lastOf(h).appleStorePrice)}` },
            { label: '最大の値上げ', node: maxHike ? <DeltaBadge diff={maxHike.diff} base={maxHike.prev} /> : <span className="text-sm text-zinc-400">値上げなし</span>, sub: maxHike ? maxHike.pt.date : '' },
            { label: '最大の値下げ', node: maxCut ? <DeltaBadge diff={maxCut.diff} base={maxCut.prev} /> : <span className="text-sm text-zinc-400">値下げなし</span>, sub: maxCut ? maxCut.pt.date : '' },
          ].map((x) => (
            <div key={x.label} className="rounded-xl bg-zinc-50 p-3 dark:bg-zinc-800/60">
              <div className="mb-1.5 text-xs font-semibold text-zinc-500 dark:text-zinc-400">{x.label}</div>{x.node}<div className="mt-1 text-xs tabular-nums text-zinc-500">{x.sub}</div>
            </div>
          ))}
        </div>
        <div className="mt-5 h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 10, right: 20, left: 10, bottom: 0 }}>
              <CartesianGrid stroke={c.grid} strokeDasharray="3 3" />
              <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={ym} stroke={c.axis} fontSize={12} />
              <YAxis stroke={c.axis} fontSize={12} domain={['auto', 'auto']} tickFormatter={(v) => `¥${(v / 1000).toFixed(0)}k`} width={56} />
              <Tooltip contentStyle={{ background: c.tipBg, border: `1px solid ${c.tipBorder}`, borderRadius: 12, color: c.text }}
                labelFormatter={(t: any) => new Date(t).toISOString().slice(0, 10)} formatter={(v: any, _n: any, item: any) => [yen(v), item?.payload?.event]} />
              <Line type="stepAfter" dataKey="price" name="Apple Store" stroke={carrierColor('apple', dark)} strokeWidth={3} dot={{ r: 5, fill: '#0ea5e9', stroke: c.tipBg, strokeWidth: 2 }} activeDot={{ r: 7 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className={`${card} p-5`}>
        <h3 className="mb-4 text-sm font-bold text-zinc-900 dark:text-zinc-50">改定タイムライン — {p.name} {sku.label}</h3>
        <ol className="relative ml-3 space-y-5 border-l-2 border-zinc-200 dark:border-zinc-700">
          {events.map(({ pt, diff, prev }, i) => (
            <li key={pt.date + i} className="ml-5">
              <span className={`absolute -left-[9px] mt-1 h-4 w-4 rounded-full border-2 border-white dark:border-zinc-900 ${i === 0 ? 'bg-sky-500' : diff > 0 ? 'bg-rose-500' : diff < 0 ? 'bg-emerald-500' : 'bg-zinc-400'}`} />
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-bold tabular-nums text-zinc-900 dark:text-zinc-50">{pt.date}</span>
                <span className="text-sm text-zinc-600 dark:text-zinc-300">{pt.event}</span>
                {pt.approx && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">{pt.confidence === 'low' ? '要検証' : '概算'}</span>}
                {pt.confidence === 'high' && <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300">出典確認済</span>}
                {pt.source && <SourceLink src={pt.source} />}
              </div>
              {pt.note && <div className="mt-0.5 text-xs text-zinc-500">{pt.note}</div>}
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <span className="text-xl font-extrabold tabular-nums text-zinc-900 dark:text-zinc-50">{yen(pt.appleStorePrice)}</span>
                {i > 0 && <DeltaBadge diff={diff} base={prev} />}
                {pt.usdPrice != null && <span className="text-xs text-zinc-500">US ${pt.usdPrice} @ ¥{pt.exchangeRate}</span>}
              </div>
            </li>
          ))}
        </ol>
      </div>

      <div className={`${card} p-5`}>
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-50">一斉改定ビュー: この日の各製品の価格差 (最小容量SKU)</h3>
          <select className={selectCls} value={day} onChange={(e) => setDay(e.target.value)}>{dates.map((d) => <option key={d} value={d}>{d} ({dateCounts.get(d)}製品)</option>)}</select>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {dayRows.map((r) => (
            <div key={r.pr.id} className="flex items-center justify-between gap-2 rounded-xl bg-zinc-50 p-3 dark:bg-zinc-800/60">
              <div><div className="flex items-center gap-1.5 text-sm font-semibold text-zinc-900 dark:text-zinc-50"><CatIcon cat={r.pr.category} className="h-3.5 w-3.5" />{r.pr.name}</div>
                <div className="text-xs tabular-nums text-zinc-500">{r.s.label}: {yen(r.base)} → {yen(r.base + r.diff)}</div></div>
              <DeltaBadge diff={r.diff} base={r.base} />
            </div>
          ))}
          {!dayRows.length && <div className="text-sm text-zinc-500">該当なし</div>}
        </div>
      </div>

      <AllEventsTable products={products} />
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
interface EvRow { date: string; product: Product; sku: Sku; event: string; kind: Exclude<EvKind, 'all'>; price: number; prev?: number; usd?: number; approx?: boolean; source?: string }

/** 全機種の価格イベント (発売・値上げ・値下げ・販売終了) を一覧化 */
function AllEventsTable({ products }: { products: Product[] }) {
  const [kind, setKind] = useState<EvKind>('all');
  const [cat, setCat] = useState('');
  const [allSkus, setAllSkus] = useState(false);
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(150);
  const [sortDesc, setSortDesc] = useState(true);
  const cats = Array.from(new Set(products.map((p) => p.category)));
  const rows = useMemo(() => {
    const out: EvRow[] = [];
    products.forEach((p) => {
      const skus = allSkus ? pricedSkus(p) : pricedSkus(p).slice(0, 1);
      skus.forEach((s) => s.priceHistory.forEach((h, i) => {
        const prev = i ? s.priceHistory[i - 1].appleStorePrice : undefined;
        const k: EvRow['kind'] = i === 0 ? 'launch' : /販売終了/.test(h.event) ? 'end' : prev != null && h.appleStorePrice > prev ? 'up' : prev != null && h.appleStorePrice < prev ? 'down' : 'end';
        out.push({ date: h.date, product: p, sku: s, event: h.event, kind: k, price: h.appleStorePrice, prev, usd: h.usdPrice, approx: h.approx, source: h.source });
      }));
    });
    return out;
  }, [products, allSkus]);
  const ql = q.trim().toLowerCase();
  const filtered = rows
    .filter((r) => (kind === 'all' || r.kind === kind) && (!cat || r.product.category === cat) && (!ql || `${r.product.name} ${r.event}`.toLowerCase().includes(ql)))
    .sort((a, b) => (sortDesc ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date)) || a.product.name.localeCompare(b.product.name));
  const counts = { up: rows.filter((r) => r.kind === 'up').length, down: rows.filter((r) => r.kind === 'down').length, launch: rows.filter((r) => r.kind === 'launch').length, end: rows.filter((r) => r.kind === 'end').length };
  const kindBadge: Record<EvRow['kind'], string> = {
    launch: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300', up: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
    down: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300', end: 'bg-zinc-200 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300',
  };
  const kindLabel: Record<EvRow['kind'], string> = { launch: '発売', up: '値上げ', down: '値下げ', end: '販売終了/変更なし' };
  const exportCsv = () => {
    const head = ['日付', 'カテゴリ', '製品', 'SKU', '種別', 'イベント', '改定前(円)', '改定後(円)', '差額(円)', '変動率(%)', 'USD', '概算', '出典'];
    const lines = filtered.map((r) => [r.date, r.product.category, r.product.name, r.sku.label, kindLabel[r.kind], r.event, r.prev ?? '', r.price, r.prev != null ? r.price - r.prev : '', r.prev ? ((r.price / r.prev - 1) * 100).toFixed(1) : '', r.usd ?? '', r.approx ? '概算' : '', r.source ?? '']);
    downloadFile('apple-price-events.csv', '\uFEFF' + toCSV([head, ...lines.map((l) => l.map(String))]), 'text/csv');
  };
  return (
    <div className={`${card} p-5`}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h3 className="mr-2 text-sm font-bold text-zinc-900 dark:text-zinc-50">全機種 価格イベント一覧 ({filtered.length}件)</h3>
        <Segmented<EvKind> value={kind} onChange={(v) => { setKind(v); setLimit(150); }} options={[
          { value: 'all', label: 'すべて' }, { value: 'launch', label: `発売 ${counts.launch}` }, { value: 'up', label: `値上げ ${counts.up}` },
          { value: 'down', label: `値下げ ${counts.down}` }, { value: 'end', label: `終了 ${counts.end}` },
        ]} />
        <select className={selectCls} value={cat} onChange={(e) => { setCat(e.target.value); setLimit(150); }}><option value="">全カテゴリ</option>{cats.map((c) => <option key={c} value={c}>{c}</option>)}</select>
        <input value={q} onChange={(e) => { setQ(e.target.value); setLimit(150); }} placeholder="製品名・イベントで検索" className={`${selectCls} w-48`} />
        <label className="inline-flex cursor-pointer items-center gap-1.5 text-sm text-zinc-700 dark:text-zinc-300"><input type="checkbox" checked={allSkus} onChange={(e) => setAllSkus(e.target.checked)} className="h-4 w-4 accent-sky-500" />全容量SKU</label>
        <button className={btnCls} onClick={() => setSortDesc(!sortDesc)}>{sortDesc ? '新しい順' : '古い順'}</button>
        <button className={`${btnCls} ml-auto`} onClick={exportCsv}><Download className="h-4 w-4" />CSV</button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] text-sm">
          <thead><tr className="border-b border-zinc-200 text-left text-xs text-zinc-500 dark:border-zinc-800">{['日付', '製品 / SKU', '種別', 'イベント', '価格 (税込)', '差額', '出典'].map((x) => <th key={x} className="p-2 font-semibold">{x}</th>)}</tr></thead>
          <tbody>
            {filtered.slice(0, limit).map((r, i) => (
              <tr key={`${r.product.id}-${r.sku.id}-${r.date}-${i}`} className="border-b border-zinc-100 align-top text-zinc-800 dark:border-zinc-800 dark:text-zinc-200">
                <td className="whitespace-nowrap p-2 tabular-nums">{r.date}</td>
                <td className="p-2"><div className="flex items-center gap-1.5 font-semibold"><CatIcon cat={r.product.category} className="h-3.5 w-3.5 shrink-0" />{r.product.name}</div><div className="text-xs text-zinc-500">{r.sku.label}</div></td>
                <td className="p-2"><span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-bold ${kindBadge[r.kind]}`}>{kindLabel[r.kind]}</span></td>
                <td className="p-2 text-xs">{r.event}{r.approx && <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] font-bold text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">概算</span>}</td>
                <td className="whitespace-nowrap p-2 tabular-nums">{r.prev != null && r.prev !== r.price && <span className="text-xs text-zinc-400">{yen(r.prev)} → </span>}<span className="font-bold">{yen(r.price)}</span>{r.usd != null && <div className="text-[11px] text-zinc-500">US ${r.usd}</div>}</td>
                <td className="p-2">{r.prev != null && r.prev !== r.price ? <DeltaBadge diff={r.price - r.prev} base={r.prev} /> : <span className="text-xs text-zinc-400">—</span>}</td>
                <td className="p-2">{r.source ? <SourceLink src={r.source} /> : <span className="text-xs text-zinc-400">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {filtered.length > limit && <button className={`${btnCls} mt-3`} onClick={() => setLimit(limit + 300)}>さらに表示 ({limit}/{filtered.length})</button>}
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

function FxView({ products }: { products: Product[] }) {
  const priced = products.filter((p) => pricedSkus(p).some((s) => s.priceHistory.some((h) => h.usdPrice)));
  return priced.length ? <FxInner products={priced} /> : <EmptyNote text="USD価格つきの機種がありません (表示範囲を「歴代すべて」にしてください)" />;
}

function FxInner({ products }: { products: Product[] }) {
  const c = useChartColors();
  const dark = useDark();
  const cats = Array.from(new Set(products.map((x) => x.category)));
  const [catSel, setCat] = useState<string>(cats[0]);
  const cat = cats.includes(catSel) ? catSel : cats[0];
  const [sel, setSel] = useState<Sel>({ pid: products[0].id, sid: pricedSkus(products[0])[0].id });

  const launchRows = products.filter((x) => x.category === cat).sort((a, b) => a.releaseDate.localeCompare(b.releaseDate)).map((pr) => {
    const ps = pricedSkus(pr)[0]; const pt = ps.priceHistory[0]; const ar = impliedRate(pt);
    return { name: pr.name, sku: ps.label, date: pt.date, jpy: pt.appleStorePrice, usd: pt.usdPrice, fx: pt.exchangeRate, apple: ar, premium: ar && pt.exchangeRate ? (ar / pt.exchangeRate - 1) * 100 : undefined };
  });

  const p = products.find((x) => x.id === sel.pid) ?? products[0];
  const sku = pricedSkus(p).find((s) => s.id === sel.sid) ?? pricedSkus(p)[0];
  const h = sku.priceHistory;
  const b = h[0]; const bAr = impliedRate(b);
  const idx = h.map((x) => ({
    t: ts(x.date), JPY: (x.appleStorePrice / b.appleStorePrice) * 100,
    USD: x.usdPrice && b.usdPrice ? (x.usdPrice / b.usdPrice) * 100 : null,
    市場為替: x.exchangeRate && b.exchangeRate ? (x.exchangeRate / b.exchangeRate) * 100 : null,
    Appleレート: bAr && impliedRate(x) ? (impliedRate(x)! / bAr) * 100 : null,
  }));
  const tip = { background: c.tipBg, border: `1px solid ${c.tipBorder}`, borderRadius: 12, color: c.text };

  return (
    <div className="space-y-5">
      <div className={`${card} p-5`}>
        <SectionTitle icon={<Coins className="h-5 w-5" />} title="歴代モデル 発売時価格 vs 為替レート" desc={`Appleレート = 円価格 ÷ ${TAX}(当時の消費税率) ÷ USD価格。市場為替より高ければ「円建てに上乗せ」されています。`} />
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-sm text-zinc-500">カテゴリ</span>
          <Segmented value={cat} onChange={setCat} options={cats.map((x) => ({ value: x, label: x }))} />
        </div>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={launchRows} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={c.grid} strokeDasharray="3 3" />
              <XAxis dataKey="name" stroke={c.axis} fontSize={11} />
              <YAxis yAxisId="l" stroke={c.axis} fontSize={12} tickFormatter={(v) => `¥${(v / 1000).toFixed(0)}k`} width={56} />
              <YAxis yAxisId="r" orientation="right" stroke={c.axis} fontSize={12} domain={['auto', 'auto']} tickFormatter={(v) => `${v}`} width={40} />
              <Tooltip contentStyle={tip} formatter={(v: any, n: any) => (n === '発売時価格(JPY)' ? yen(v) : typeof v === 'number' ? v.toFixed(1) : v)} />
              <Legend />
              <Bar yAxisId="l" dataKey="jpy" name="発売時価格(JPY)" fill={carrierColor('apple', dark)} fillOpacity={0.25} radius={[6, 6, 0, 0]} />
              <Line yAxisId="r" type="monotone" dataKey="fx" name="市場為替 (円/$)" stroke={carrierColor('softbank', dark)} strokeWidth={2.5} dot />
              <Line yAxisId="r" type="monotone" dataKey="apple" name="実質Appleレート (円/$)" stroke={carrierColor('docomo', dark)} strokeWidth={2.5} dot />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead><tr className="border-b border-zinc-200 text-left text-xs text-zinc-500 dark:border-zinc-800">{['モデル', '発売日', '日本価格', 'USD価格', '市場為替', 'Appleレート', '為替比プレミアム'].map((x) => <th key={x} className="p-2 font-semibold">{x}</th>)}</tr></thead>
            <tbody>
              {launchRows.map((r) => (
                <tr key={r.name} className="border-b border-zinc-100 tabular-nums text-zinc-800 dark:border-zinc-800 dark:text-zinc-200">
                  <td className="p-2 font-semibold">{r.name} <span className="text-xs font-normal text-zinc-500">{r.sku}</span></td><td className="p-2">{r.date}</td><td className="p-2">{yen(r.jpy)}</td>
                  <td className="p-2">{r.usd != null ? `$${r.usd}` : '—'}</td><td className="p-2">{r.fx != null ? `¥${r.fx.toFixed(1)}` : '—'}</td>
                  <td className="p-2">{r.apple != null ? `¥${r.apple.toFixed(1)}` : '—'}</td>
                  <td className="p-2">{r.premium != null ? <span className={r.premium > 0 ? 'font-bold text-rose-500' : 'font-bold text-emerald-500'}>{signedPct(r.premium)}</span> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className={`${card} p-5`}>
        <h3 className="mb-3 text-sm font-bold text-zinc-900 dark:text-zinc-50">価格改定の内訳: ドル建て据え置き？ それともドル自体が値上がり？</h3>
        <ProductSkuPicker products={products} sel={{ pid: p.id, sid: sku.id }} onChange={setSel} />
        <div className="mt-4 h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={idx} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={c.grid} strokeDasharray="3 3" />
              <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={ym} stroke={c.axis} fontSize={12} />
              <YAxis stroke={c.axis} fontSize={12} domain={['auto', 'auto']} tickFormatter={(v) => `${Math.round(v)}`} width={40} />
              <Tooltip contentStyle={tip} labelFormatter={(t: any) => new Date(t).toISOString().slice(0, 10)} formatter={(v: any) => (typeof v === 'number' ? v.toFixed(1) : v)} />
              <Legend />
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
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-bold tabular-nums text-zinc-900 dark:text-zinc-50">{pt.date}</span>
                  <DeltaBadge diff={pt.appleStorePrice - prev.appleStorePrice} base={prev.appleStorePrice} />
                  <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${v.tone === 'up' ? 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300' : v.tone === 'down' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300' : 'bg-zinc-200 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300'}`}>{v.text}</span>
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
 * 8. タブ4: データ管理 (JSON インポート / エクスポート)
 * ===================================================================================== */

const SCHEMA_EXAMPLE = `{
  "schemaVersion": 1,
  "products": [{
    "id": "iphone-17", "category": "iPhone", "name": "iPhone 17",
    "generation": "第18世代 (2025)", "releaseDate": "2025-09-19",
    "specs": { "soc": "A19", "ram": "8GB", "display": "...", "battery": "...", "weight": "...",
               "connectivity": ["5G", "Wi-Fi 7"], "bands": "..." },
    "skus": [{
      "id": "256", "label": "256GB", "storage": "256GB", "connectivity": "-",
      "priceHistory": [
        { "date": "2025-09-19", "event": "発売時", "appleStorePrice": 129800, "usdPrice": 799, "exchangeRate": 147.5 }
      ],
      "carriers": {
        "docomo": { "launchPrice": 150000, "currentPrice": 150000, "mnpPrice": 128000,
          "returnProgram": { "name": "いつでもカエドキプログラム", "months": 23, "effectiveCost": 85000 } }
      }
    }]
  }]
}`;

function DataView({ products, onReplace, onMerge, onReset, onRemove, onAppleDb, autoDb, setAutoDb, sels, mode, mnp, toast }: {
  products: Product[]; onReplace: (p: Product[]) => void; onMerge: (p: Product[]) => void; onReset: () => void; onRemove: (id: string) => void;
  onAppleDb: (raw: unknown) => string[]; autoDb: boolean; setAutoDb: (b: boolean) => void;
  sels: Sel[]; mode: Mode; mnp: boolean; toast: (m: string) => void;
}) {
  const [text, setText] = useState('');
  const [url, setUrl] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [dbReport, setDbReport] = useState<string[]>([]);
  const [listQ, setListQ] = useState('');
  const [listLimit, setListLimit] = useState(60);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const runAppleDb = (raw: unknown) => { const rep = onAppleDb(raw); setDbReport(rep); toast(rep[0] ?? 'AppleDB を適用しました'); };
  const fetchAppleDb = async () => {
    setBusy(true);
    try { const r = await fetch(APPLEDB_URL); if (!r.ok) throw new Error(`HTTP ${r.status}`); runAppleDb(await r.json()); }
    catch (e) { setDbReport([`✗ AppleDB の取得に失敗しました: ${(e as Error).message}`]); }
    setBusy(false);
  };

  const apply = (raw: string, how: 'merge' | 'replace') => {
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch (e) { setErrors([`JSON の構文エラー: ${(e as Error).message}`]); return; }
    // AppleDB 形式 (機種配列に identifier / info がある) は自動判別して補強用に適用
    if (Array.isArray(parsed) && parsed.some((d) => d && (d as AppleDbDevice).identifier && (d as AppleDbDevice).info)) { setErrors([]); runAppleDb(parsed); return; }
    const { products: ps, errors: errs } = normalizeDataset(parsed);
    setErrors(errs);
    if (!ps.length) return;
    (how === 'merge' ? onMerge : onReplace)(ps);
    toast(`${ps.length}製品を${how === 'merge' ? 'マージ' : '置換'}しました${errs.length ? `（${errs.length}件スキップ）` : ''}`);
  };
  const onFile = async (f?: File | null) => { if (!f) return; const t = await f.text(); setText(t); apply(t, 'merge'); if (fileRef.current) fileRef.current.value = ''; };
  const fetchUrl = async () => {
    setBusy(true);
    try { const r = await fetch(url); if (!r.ok) throw new Error(`HTTP ${r.status}`); const t = await r.text(); setText(t); apply(t, 'merge'); }
    catch (e) { setErrors([`取得に失敗しました: ${(e as Error).message} (CORS許可されたURLのみ読み込めます)`]); }
    setBusy(false);
  };
  const exportJson = () => { const ds: Dataset = { ...BUILTIN_DATASET, meta: { ...BUILTIN_DATASET.meta, generatedAt: new Date().toISOString().slice(0, 10) }, products }; downloadFile('apple-products.json', JSON.stringify(ds, null, 2)); };
  const copyTable = async (kind: 'md' | 'csv') => {
    if (!sels.length) return toast('比較タブで機種を選択してください');
    const rows = buildCompareTable(products, sels, mode, mnp);
    toast((await copyText(kind === 'md' ? toMarkdown(rows) : toCSV(rows))) ? `${kind === 'md' ? 'Markdown' : 'CSV'} をコピーしました` : 'コピーに失敗しました');
  };

  return (
    <div className="space-y-5">
      <div className={`${card} p-5`}>
        <SectionTitle icon={<Database className="h-5 w-5" />} title="データ管理" desc="外部JSON(オープンデータ・追加生成データ)を読み込むだけで全機能が新製品に対応します。" />
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
              <button className={btnCls} onClick={() => fileRef.current?.click()}><Upload className="h-4 w-4" />JSONファイルを読み込む (マージ)</button>
              <button className={btnCls} onClick={exportJson}><Download className="h-4 w-4" />JSONエクスポート</button>
              <button className={btnCls} onClick={() => { if (confirm('初期サンプルデータに戻します。よろしいですか？')) { onReset(); setErrors([]); toast('初期データに戻しました'); } }}><RotateCcw className="h-4 w-4" />初期化</button>
            </div>
            <div className="flex gap-2">
              <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/products.json" className={`${selectCls} flex-1`} />
              <button className={btnCls} disabled={!url || busy} onClick={fetchUrl}><Link2 className="h-4 w-4" />URL取得</button>
            </div>
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={9} placeholder="JSONをここに貼り付け…" className={`${selectCls} w-full font-mono text-xs`} />
            <div className="flex gap-2">
              <button className={`${btnCls} !bg-sky-600 !text-white !border-sky-600 hover:!bg-sky-500`} disabled={!text.trim()} onClick={() => apply(text, 'merge')}><Plus className="h-4 w-4" />マージ (同一IDは上書き)</button>
              <button className={btnCls} disabled={!text.trim()} onClick={() => apply(text, 'replace')}>全置換</button>
            </div>
            {errors.length > 0 && (
              <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
                <div className="mb-1 flex items-center gap-1 font-bold"><AlertTriangle className="h-4 w-4" />検証メッセージ</div>
                <ul className="list-disc pl-5">{errors.slice(0, 8).map((e, i) => <li key={i}>{e}</li>)}</ul>
              </div>
            )}
          </div>
          <div>
            <div className="mb-1 text-xs font-bold text-zinc-500">スキーマ例 (carriers は省略可。Apple Store は priceHistory から自動補完)</div>
            <pre className="max-h-80 overflow-auto rounded-xl bg-zinc-900 p-3 text-[11px] leading-relaxed text-zinc-100">{SCHEMA_EXAMPLE}</pre>
          </div>
        </div>
      </div>

      <div className={`${card} p-5`}>
        <SectionTitle icon={<Database className="h-5 w-5" />} title="AppleDB 連携" desc="appledb.dev の機種データでスペック(SoC・RAM・バッテリー・型番等)と販売終了日を自動補強します。価格は変更しません。" />
        <div className="flex flex-wrap items-center gap-3">
          <button className={`${btnCls} !bg-sky-600 !text-white !border-sky-600 hover:!bg-sky-500`} disabled={busy} onClick={fetchAppleDb}><Download className="h-4 w-4" />AppleDB から取得して適用</button>
          <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
            <input type="checkbox" checked={autoDb} onChange={(e) => setAutoDb(e.target.checked)} className="h-4 w-4 accent-sky-500" />起動時に自動で適用する
          </label>
          <span className="text-xs text-zinc-500">{APPLEDB_URL} ／ main.json をファイル読み込み・貼り付けしても自動判別されます</span>
        </div>
        {dbReport.length > 0 && <pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap rounded-xl bg-zinc-100 p-3 text-xs text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200">{dbReport.join('\n')}</pre>}
        <p className="mt-2 text-xs text-zinc-500">突き合わせは <code>specs.identifier</code>(例 iPhone14,5)または機種名の完全一致。AppleDB の日付は米国基準のため、販売終了日は +1日で日本時間に換算しています。</p>
      </div>

      <div className={`${card} p-5`}>
        <h3 className="mb-3 text-sm font-bold text-zinc-900 dark:text-zinc-50">現在の比較表をコピー</h3>
        <div className="flex gap-2"><button className={btnCls} onClick={() => copyTable('md')}><Copy className="h-4 w-4" />Markdown</button><button className={btnCls} onClick={() => copyTable('csv')}><Copy className="h-4 w-4" />CSV</button></div>
        <p className="mt-2 text-xs text-zinc-500">比較タブで選択中の機種・モード({mode === 'bulk' ? '一括' : '2年返却'}{mnp ? '・MNP割引' : ''})がそのまま出力されます。</p>
      </div>

      <div className={`${card} p-5`}>
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-50">読み込み済み製品 ({products.length} / 詳細あり {products.filter(hasDetail).length})</h3>
          <input value={listQ} onChange={(e) => { setListQ(e.target.value); setListLimit(60); }} placeholder="機種名・カテゴリで絞り込み" className={`${selectCls} w-56`} />
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {products.filter((p) => !listQ.trim() || `${p.name} ${p.category}`.toLowerCase().includes(listQ.trim().toLowerCase())).slice(0, listLimit).map((p) => (
            <div key={p.id} className="flex items-center justify-between rounded-xl bg-zinc-50 p-3 dark:bg-zinc-800/60">
              <div className="min-w-0"><div className="flex items-center gap-1.5 truncate text-sm font-semibold text-zinc-900 dark:text-zinc-50"><CatIcon cat={p.category} className="h-3.5 w-3.5" />{p.name}</div>
                <div className="text-xs text-zinc-500">{p.releaseDate} ・ {p.category} ・ {p.skus.length} SKU{hasDetail(p) ? ' ・ ★詳細' : hasPrice(p) ? ' ・ 基本価格' : ''}</div></div>
              <button aria-label="削除" disabled={products.length <= 1} onClick={() => onRemove(p.id)} className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-200 hover:text-rose-500 disabled:opacity-30 dark:hover:bg-zinc-700"><Trash2 className="h-4 w-4" /></button>
            </div>
          ))}
        </div>
        {products.length > listLimit && <button className={`${btnCls} mt-3`} onClick={() => setListLimit(listLimit + 100)}>さらに表示 ({listLimit}/{products.length})</button>}
      </div>
    </div>
  );
}

/* =====================================================================================
 * 9. App
 * ===================================================================================== */

const LS_DATA = 'apple-price-atlas:data:v1';
const LS_THEME = 'apple-price-atlas:theme';
const LS_EXT = 'apple-price-atlas:ext-version';
const LS_AUTODB = 'apple-price-atlas:appledb-auto';
const LS_SCOPE = 'apple-price-atlas:scope';
type Scope = 'all' | 'detail';
type Tab = 'compare' | 'timeline' | 'fx' | 'data';

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
  const [autoDb, setAutoDb] = useState<boolean>(() => { try { return localStorage.getItem(LS_AUTODB) !== 'off'; } catch { return true; } });
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

  const applyAppleDbNow = (raw: unknown) => {
    const res = applyAppleDb(productsRef.current, raw); setProducts(res.products); return res.report;
  };

  // 製品が変わったとき選択を整合させる
  useEffect(() => {
    setSels((cur) => {
      const valid = cur.filter((s) => products.some((p) => p.id === s.pid)).map((s) => { const p = products.find((x) => x.id === s.pid)!; return p.skus.some((k) => k.id === s.sid) ? s : { pid: p.id, sid: p.skus[0].id }; });
      if (valid.length) return valid.length === cur.length && valid.every((v, i) => v === cur[i]) ? cur : valid;
      return products.slice(-2).map((p) => ({ pid: p.id, sid: p.skus[0].id }));
    });
  }, [products]);

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'compare', label: 'スペック＆キャリア比較', icon: <Scale className="h-4 w-4" /> },
    { id: 'timeline', label: '価格改定タイムライン', icon: <LineIcon className="h-4 w-4" /> },
    { id: 'fx', label: '発売時価格 × 為替', icon: <Coins className="h-4 w-4" /> },
    { id: 'data', label: 'データ管理', icon: <Database className="h-4 w-4" /> },
  ];

  const body = useMemo(() => null, []); void body;

  return (
    <ThemeCtx.Provider value={dark}>
      <div className="min-h-screen text-zinc-900 dark:text-zinc-100">
        <header className="sticky top-0 z-30 border-b border-zinc-200 bg-white/80 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/80">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-3">
            <div className="flex items-center gap-2">
              <div className="rounded-xl bg-zinc-900 p-1.5 text-white dark:bg-white dark:text-zinc-900"><Apple className="h-5 w-5" /></div>
              <div><div className="text-base font-extrabold leading-tight">Apple Price Atlas</div><div className="text-[11px] text-zinc-500">スペック・キャリア価格・価格改定の完全比較</div></div>
            </div>
            <div className="ml-2 hidden items-center gap-1.5 md:flex">{CARRIER_ORDER.map((id) => <CarrierBadge key={id} id={id} small />)}</div>
            <button onClick={() => setDark(!dark)} aria-label="テーマ切替" className={`${btnCls} ml-auto`}>{dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}{dark ? 'ライト' : 'ダーク'}</button>
          </div>
          <nav className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-4">
            {tabs.map((t) => (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3.5 py-2.5 text-sm font-semibold transition ${tab === t.id ? 'border-sky-500 text-sky-600 dark:text-sky-400' : 'border-transparent text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100'}`}>
                {t.icon}{t.label}
              </button>
            ))}
          </nav>
        </header>

        <main className="mx-auto max-w-7xl px-4 py-6">
          {tab !== 'data' && (
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <span className="text-xs font-semibold text-zinc-500">表示範囲</span>
              <Segmented<Scope> value={scope} onChange={setScope} options={[
                { value: 'detail', label: `★ 詳細価格データあり (${nDetail})` },
                { value: 'all', label: `歴代すべて (${products.length})` },
              ]} />
              <span className="text-xs text-zinc-500">{scope === 'detail' ? 'キャリア価格・値上げ/値下げ履歴を持つ機種のみ' : 'AppleDB の全機種(スペック・発売時の基本価格を比較)。★は詳細価格データあり'}</span>
            </div>
          )}
          {tab === 'compare' && <CompareView products={visible} all={products} sels={sels} setSels={setSels} mode={mode} setMode={setMode} mnp={mnp} setMnp={setMnp} toast={toast} />}
          {tab === 'timeline' && <TimelineView products={visible} />}
          {tab === 'fx' && <FxView products={visible} />}
          {tab === 'data' && (
            <DataView products={products} sels={sels} mode={mode} mnp={mnp} toast={toast}
              onAppleDb={applyAppleDbNow} autoDb={autoDb} setAutoDb={(b) => { setAutoDb(b); try { localStorage.setItem(LS_AUTODB, b ? 'on' : 'off'); } catch { /* noop */ } }}
              onReplace={(ps) => setProducts(ps)} onMerge={(ps) => setProducts((cur) => mergeProducts(cur, ps))}
              onReset={() => setProducts(normalizeDataset(BUILTIN_DATASET).products)}
              onRemove={(id) => setProducts((cur) => cur.filter((p) => p.id !== id))} />
          )}
        </main>

        <footer className="mx-auto max-w-7xl px-4 pb-10 text-xs text-zinc-500">
          ※ 価格は日本国内の税込表示。為替・USD価格・キャリア価格には概算/モデル値を含みます。購入前に各公式サイトで最新情報をご確認ください。
        </footer>

        {toastMsg && (
          <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white shadow-lg dark:bg-white dark:text-zinc-900">
            <span className="inline-flex items-center gap-1.5"><Check className="h-4 w-4 text-emerald-400" />{toastMsg}</span>
          </div>
        )}
      </div>
    </ThemeCtx.Provider>
  );
}

function mergeProducts(cur: Product[], incoming: Product[]): Product[] {
  const map = new Map(cur.map((p) => [p.id, p]));
  incoming.forEach((p) => map.set(p.id, p));
  return Array.from(map.values());
}


export const SAMPLE_DATASET = BUILTIN_DATASET;
export { applyAppleDb, normalizeDataset };
