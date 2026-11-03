import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ComposedChart, Bar,
} from 'recharts';
import {
  Smartphone, Tablet, Watch, Laptop, Sun, Moon, TrendingUp, TrendingDown, Minus, Copy, Download,
  Check, Scale, LineChart as LineIcon, Coins, X, Link2, FileSpreadsheet,
  Info, Trophy, Apple, Headphones, Search, ShoppingBag, ExternalLink, Sparkles, ChevronDown, ChevronUp,
} from 'lucide-react';
import { toBlob, toPng } from 'html-to-image';
import {
  estimateUsedMarketData,
  fetchUsedMarketPrice,
  type UsedConditionRank,
  type UsedMarketData,
  type UsedPlatformId,
  type UsedPricing,
  type UsedShopOffer,
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
  date: string;              // YYYY-MM-DD
  event: string;             // 例: "発売時" / "円安に伴う価格改定（値上げ）"
  appleStorePrice: number;   // 日本 Apple Store 税込価格 (JPY)
  usdPrice?: number;         // 米国 Apple Store 税抜価格 (USD)
  exchangeRate?: number;     // その日付近の市場為替 (JPY/USD)
  taxRate?: number;          // 当時の消費税率 (省略時 日付から自動判定: 5%/8%/10%)
  marketUsdJpy?: number;     // Frankfurter APIから取得したその日の実際のドル円レート（例：110.4 円）
  impliedAppleRate?: number; // 税抜日本円 ÷ USD価格（例：112.4 円）
  rateDiff?: number;         // impliedAppleRate - marketUsdJpy（実勢為替比 1ドルあたりの上乗せ/割引）
  currentFairJpy?: number;   // 現在の最新ドル円レート(latest)でUSD価格を日本円換算(＋消費税10%)した理論価格
  approx?: boolean;          // 概算値フラグ (要検証)
  confidence?: 'high' | 'medium' | 'low';
  source?: string;           // 出典 URL
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
  currentPrice: number;           // 現在の一括価格（終売時は終売時最終価格）
  mnpPrice?: number | null;       // MNP/新規割引適用後の一括価格
  returnProgram?: ReturnProgram | null; // 2年返却プログラム適用時
  isDiscontinued?: boolean;       // 新品販売終了フラグ
  discontinuedDate?: string;      // 販売終了日 (YYYY-MM-DD)
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
  isDiscontinued?: boolean;       // 新品販売終了フラグ
  discontinuedDate?: string;      // 販売終了日 (YYYY-MM-DD)
  marketUsdJpy?: number;
  impliedAppleRate?: number;
  rateDiff?: number;
  currentFairJpy?: number;
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
  isDiscontinued?: boolean;       // 新品販売終了フラグ
  discontinuedDate?: string;      // 販売終了日 (YYYY-MM-DD)
  marketUsdJpy?: number;
  impliedAppleRate?: number;
  rateDiff?: number;
  currentFairJpy?: number;
}

export interface Dataset {
  schemaVersion: 1;
  meta?: { title?: string; generatedAt?: string; latestUsdJpy?: number; latestFxDate?: string; disclaimer?: string; [k: string]: unknown };
  products: Product[];
}

export const DEFAULT_LATEST_USD_JPY = 152.8;
const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * 日付（YYYY-MM-DD）に応じて日本の消費税率を自動判定:
 * - 2019-10-01 以降：10% (jpy / 1.10)
 * - 2014-04-01 〜 2019-09-30：8% (jpy / 1.08)
 * - 1997-04-01 〜 2014-03-31：5% (jpy / 1.05)
 */
export function taxRateAt(date: string): number {
  if (date >= '2019-10-01') return 0.10;
  if (date >= '2014-04-01') return 0.08;
  if (date >= '1997-04-01') return 0.05;
  return 0.03;
}

export function enrichPricePointFx(pt: PricePoint, latestUsdJpy = DEFAULT_LATEST_USD_JPY): PricePoint {
  const taxRate = pt.taxRate ?? taxRateAt(pt.date);
  const marketUsdJpy = pt.marketUsdJpy ?? (pt.exchangeRate != null ? round1(pt.exchangeRate) : undefined);
  const usd = pt.usdPrice != null && pt.usdPrice > 0 ? pt.usdPrice : undefined;
  const impliedAppleRate =
    pt.impliedAppleRate ?? (usd != null ? round1(pt.appleStorePrice / (1 + taxRate) / usd) : undefined);
  const rateDiff =
    pt.rateDiff ?? (impliedAppleRate != null && marketUsdJpy != null ? round1(impliedAppleRate - marketUsdJpy) : undefined);
  const currentFairJpy =
    pt.currentFairJpy ?? (usd != null ? Math.round(usd * latestUsdJpy * 1.10) : undefined);
  return {
    ...pt,
    taxRate,
    ...(marketUsdJpy != null ? { exchangeRate: marketUsdJpy, marketUsdJpy } : {}),
    ...(impliedAppleRate != null ? { impliedAppleRate } : {}),
    ...(rateDiff != null ? { rateDiff } : {}),
    ...(currentFairJpy != null ? { currentFairJpy } : {}),
  };
}

/* =====================================================================================
 * 2. 初期搭載サンプルデータ
 *    ※ Apple Store 価格は公開情報ベースですが、一部は概算(approx)です。キャリア価格は
 *      キャリアごとの係数・割引額から作ったモデル値(目安)で、実際の価格とは異なります。
 * ===================================================================================== */

type H = [date: string, event: string, jpy: number, usd: number, fx: number, approx?: boolean];
const hist = (rows: H[]): PricePoint[] =>
  rows.map(([date, event, appleStorePrice, usdPrice, exchangeRate, approx]) =>
    enrichPricePointFx({
      date, event, appleStorePrice, usdPrice, exchangeRate, marketUsdJpy: exchangeRate, ...(approx ? { approx: true } : {}),
    }),
  );

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
const impliedRate = (p: PricePoint) =>
  p.impliedAppleRate ?? (p.usdPrice ? round1(p.appleStorePrice / (1 + (p.taxRate ?? taxRateAt(p.date))) / p.usdPrice) : undefined);
const marketRate = (p: PricePoint) => p.marketUsdJpy ?? p.exchangeRate;
const rateDiffVal = (p: PricePoint) => {
  if (p.rateDiff != null) return p.rateDiff;
  const ar = impliedRate(p), mr = marketRate(p);
  return ar != null && mr != null ? round1(ar - mr) : undefined;
};
const fairJpyVal = (p: PricePoint, latestUsdJpy = DEFAULT_LATEST_USD_JPY) =>
  p.currentFairJpy ?? (p.usdPrice ? Math.round(p.usdPrice * latestUsdJpy * 1.10) : undefined);
const signedRate = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${Math.abs(n).toFixed(1)}円`;

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

/**
 * 製品・SKUが現在新品販売終了（終売）しているかを自動＆明示判定する
 * 1) priceHistory の最終イベントに「販売終了」「終売」が含まれる、または discontinued が設定されている場合
 * 2) Appleのラインナップ法則（Pro/Pro Maxは次世代発売＝約1年後で終売、無印/Plus/mini/iPad/Mac/Watchは旧世代終売）
 */
export function getSkuDiscontinuedInfo(
  p: Pick<Product, 'category' | 'name' | 'releaseDate' | 'specs' | 'isDiscontinued' | 'discontinuedDate'>,
  s?: Pick<Sku, 'priceHistory' | 'isDiscontinued' | 'discontinuedDate'>,
): { isDiscontinued: boolean; discontinuedDate?: string } {
  const ph = s?.priceHistory ?? [];
  const lastPt = ph.length ? lastOf(ph) : undefined;
  if (lastPt && /販売終了|終売/.test(String(lastPt.event ?? ''))) {
    return { isDiscontinued: true, discontinuedDate: lastPt.date };
  }
  if (s?.isDiscontinued === true) {
    return { isDiscontinued: true, discontinuedDate: s.discontinuedDate ?? p.discontinuedDate };
  }
  const specDisc =
    typeof p.specs?.discontinued === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.specs.discontinued)
      ? p.specs.discontinued
      : undefined;
  if (specDisc || p.isDiscontinued === true) {
    return { isDiscontinued: true, discontinuedDate: specDisc ?? p.discontinuedDate ?? lastPt?.date };
  }

  const rel = String(p.releaseDate ?? '');
  const relYear = parseInt(rel.slice(0, 4), 10) || 2020;
  const name = String(p.name ?? '');

  // Pro / Pro Max シリーズ (iPhone): 次世代モデル発売時点(約1年後)でApple Store直販は販売終了
  if (p.category === 'iPhone' && (/\bPro(\s+Max)?\b/i.test(name) || /^iPhone\s+(X|XS|XS Max)$/i.test(name))) {
    if (rel < '2026-01-01') {
      return { isDiscontinued: true, discontinuedDate: `${relYear + 1}-09-10` };
    }
  }

  // 無印 / Plus / mini / SE / e (iPhone): iPhone 15以前、mini / SE / 16 Plus / 16e 等は終売
  if (p.category === 'iPhone') {
    if (
      rel < '2024-09-01' ||
      /\b(mini|SE)\b/i.test(name) ||
      /^iPhone 16 (Plus|Pro|Pro Max)$/i.test(name) ||
      /^iPhone 16e$/i.test(name)
    ) {
      return { isDiscontinued: true, discontinuedDate: `${Math.min(2026, relYear + 2)}-09-10` };
    }
  }

  // iPad / Mac / Apple Watch / AirPods: 後継世代が出た旧世代 (2024年以前のモデル) は終売
  if (p.category !== 'iPhone' && rel < '2025-01-01') {
    return { isDiscontinued: true, discontinuedDate: `${Math.min(2026, relYear + 2)}-09-01` };
  }

  return { isDiscontinued: false };
}

/** 読み込み時の検証・正規化。Apple Store の carriers.apple は priceHistory から自動補完する */
function normalizeDataset(raw: unknown): { products: Product[]; errors: string[]; latestUsdJpy: number } {
  const errors: string[] = [];
  const rawMeta = (raw as Dataset)?.meta;
  const latestUsdJpy =
    typeof rawMeta?.latestUsdJpy === 'number' && rawMeta.latestUsdJpy > 0
      ? rawMeta.latestUsdJpy
      : DEFAULT_LATEST_USD_JPY;
  const arr: unknown[] = Array.isArray(raw) ? raw : Array.isArray((raw as Dataset)?.products) ? (raw as Dataset).products : [];
  if (!arr.length) errors.push('products 配列が見つかりません (Product[] または { products: Product[] })');
  const products: Product[] = [];
  arr.forEach((p0, i) => {
    const p = p0 as Partial<Product>;
    const tag = `products[${i}]${p?.name ? ` (${p.name})` : ''}`;
    if (!p || typeof p !== 'object') return errors.push(`${tag}: オブジェクトではありません`);
    if (!p.id || !p.name || !p.category) return errors.push(`${tag}: id / name / category は必須です`);
    if (!Array.isArray(p.skus) || !p.skus.length) return errors.push(`${tag}: skus が空です`);
    const relDate = p.releaseDate ?? p.skus[0]?.priceHistory?.[0]?.date ?? '';
    const baseProdInfo = {
      category: p.category,
      name: p.name,
      releaseDate: relDate,
      specs: p.specs ?? {},
      isDiscontinued: p.isDiscontinued,
      discontinuedDate: p.discontinuedDate,
    };
    const skus: Sku[] = [];
    p.skus.forEach((s0, j) => {
      const s = s0 as Partial<Sku>;
      if (!s?.id || !Array.isArray(s.priceHistory)) return errors.push(`${tag}.skus[${j}]: id と priceHistory(空配列可) が必要です`);
      const bad = s.priceHistory.find((h) => !h || typeof h.appleStorePrice !== 'number' || !/^\d{4}-\d{2}-\d{2}$/.test(h.date));
      if (bad) return errors.push(`${tag}.skus[${j}]: priceHistory の date(YYYY-MM-DD) / appleStorePrice(number) が不正です`);
      const priceHistory = [...s.priceHistory]
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((pt) => enrichPricePointFx(pt, latestUsdJpy));
      const discInfo = getSkuDiscontinuedInfo(baseProdInfo, {
        priceHistory,
        isDiscontinued: s.isDiscontinued,
        discontinuedDate: s.discontinuedDate,
      });
      const carriers: Sku['carriers'] = { ...(s.carriers ?? {}) };
      if (priceHistory.length) {
        carriers.apple = {
          launchPrice: priceHistory[0].appleStorePrice,
          currentPrice: lastOf(priceHistory).appleStorePrice,
          mnpPrice: null,
          returnProgram: null,
          ...(carriers.apple ?? {}),
        };
      }
      (Object.keys(carriers) as CarrierId[]).forEach((cid) => {
        const cp = carriers[cid];
        if (cp) {
          carriers[cid] = {
            ...cp,
            isDiscontinued: cp.isDiscontinued ?? discInfo.isDiscontinued,
            ...(discInfo.discontinuedDate ? { discontinuedDate: cp.discontinuedDate ?? discInfo.discontinuedDate } : {}),
          };
        }
      });
      const launchPt = priceHistory[0];
      const latestPt = priceHistory.length ? lastOf(priceHistory) : undefined;
      let cleanUsedPricing = s.usedPricing;
      if (cleanUsedPricing) {
        const rApi = cleanUsedPricing.rakuten?.source === 'api' || (cleanUsedPricing.rakuten as any)?.source === 'live';
        const yApi = cleanUsedPricing.yahoo?.source === 'api' || (cleanUsedPricing.yahoo as any)?.source === 'live';
        const anyReal = !cleanUsedPricing.isEstimated && (rApi || yApi);
        cleanUsedPricing = {
          ...cleanUsedPricing,
          isEstimated: !anyReal,
          rakuten: cleanUsedPricing.rakuten
            ? {
                ...cleanUsedPricing.rakuten,
                shopName: rApi ? cleanUsedPricing.rakuten.shopName : '',
                isTrustedShop: rApi ? Boolean(cleanUsedPricing.rakuten.isTrustedShop) : false,
                source: rApi ? 'api' : 'mock',
              }
            : null,
          yahoo: cleanUsedPricing.yahoo
            ? {
                ...cleanUsedPricing.yahoo,
                shopName: yApi ? cleanUsedPricing.yahoo.shopName : '',
                isTrustedShop: yApi ? Boolean(cleanUsedPricing.yahoo.isTrustedShop) : false,
                source: yApi ? 'api' : 'mock',
              }
            : null,
          offers: anyReal ? (cleanUsedPricing.offers ?? []) : [],
        };
      }
      skus.push({
        id: String(s.id),
        label: s.label ?? s.storage ?? String(s.id),
        storage: s.storage ?? '',
        connectivity: s.connectivity ?? '-',
        priceHistory,
        carriers,
        isDiscontinued: discInfo.isDiscontinued,
        ...(discInfo.discontinuedDate ? { discontinuedDate: discInfo.discontinuedDate } : {}),
        ...(cleanUsedPricing ? { usedPricing: cleanUsedPricing } : {}),
        ...(launchPt?.marketUsdJpy != null ? { marketUsdJpy: launchPt.marketUsdJpy } : {}),
        ...(launchPt?.impliedAppleRate != null ? { impliedAppleRate: launchPt.impliedAppleRate } : {}),
        ...(launchPt?.rateDiff != null ? { rateDiff: launchPt.rateDiff } : {}),
        ...(latestPt?.currentFairJpy != null ? { currentFairJpy: latestPt.currentFairJpy } : {}),
      });
    });
    if (!skus.length) return;
    skus.sort(compareSkus);
    const primarySku = skus.find((k) => k.priceHistory.length > 0) ?? skus[0];
    const priced = skus.filter((k) => k.priceHistory.length > 0);
    const targetSkus = priced.length > 0 ? priced : skus;
    const prodIsDisc = targetSkus.every((k) => Boolean(k.isDiscontinued));
    const skuDiscDates = targetSkus.map((k) => k.discontinuedDate).filter((d): d is string => Boolean(d)).sort();
    const prodDiscDate =
      p.discontinuedDate ??
      (typeof p.specs?.discontinued === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.specs.discontinued) ? p.specs.discontinued : undefined) ??
      (prodIsDisc && skuDiscDates.length ? lastOf(skuDiscDates) : undefined);
    products.push({
      id: String(p.id), category: p.category, name: p.name, generation: p.generation ?? '', releaseDate: relDate,
      specs: { ...(p.specs ?? {}), ...(prodDiscDate && !p.specs?.discontinued ? { discontinued: prodDiscDate } : {}) },
      skus,
      isDiscontinued: prodIsDisc,
      ...(prodDiscDate ? { discontinuedDate: prodDiscDate } : {}),
      ...(typeof p.detail === 'boolean' ? { detail: p.detail } : {}), ...(p.priceResearched ? { priceResearched: true } : {}),
      ...(primarySku.marketUsdJpy != null ? { marketUsdJpy: primarySku.marketUsdJpy } : {}),
      ...(primarySku.impliedAppleRate != null ? { impliedAppleRate: primarySku.impliedAppleRate } : {}),
      ...(primarySku.rateDiff != null ? { rateDiff: primarySku.rateDiff } : {}),
      ...(primarySku.currentFairJpy != null ? { currentFairJpy: primarySku.currentFairJpy } : {}),
    });
  });
  products.sort(compareProducts);
  return { products, errors, latestUsdJpy };
}

type Mode = 'bulk' | 'return';
function carrierValue(cp: CarrierPrice | undefined, mode: Mode, mnp: boolean): number | null {
  if (!cp) return null;
  const disc = mnp && cp.mnpPrice != null ? cp.currentPrice - cp.mnpPrice : 0;
  if (mode === 'bulk') return Math.max(cp.currentPrice - disc, 0);
  return cp.returnProgram ? Math.max(cp.returnProgram.effectiveCost - disc, 0) : null;
}

interface Sel { pid: string; sid: string }

export interface SpecRowDef {
  key: string;
  label: string;
  primary?: boolean;
}

/** 初期表示（主要項目のみ）の対象となる主要6スペック */
const PRIMARY_SPEC_ROWS: SpecRowDef[] = [
  { key: 'soc', label: 'SoC（チップ）', primary: true },
  { key: 'ram', label: 'メモリ（RAM）', primary: true },
  { key: 'display', label: 'ディスプレイ（サイズ・Hz）', primary: true },
  { key: 'battery', label: 'バッテリー', primary: true },
  { key: 'weight', label: '重量', primary: true },
  { key: 'ports', label: 'ポート / 端子', primary: true },
];

/** 折りたたみ時に隠れる詳細スペック項目 */
const DETAIL_SPEC_ROWS: SpecRowDef[] = [
  { key: 'camera', label: 'カメラ' },
  { key: '__conn', label: '通信方式（SKU）' },
  { key: 'connectivity', label: '通信規格' },
  { key: 'bands', label: '対応バンド' },
  { key: 'os', label: '対応OS' },
  { key: 'colors', label: 'カラー' },
  { key: 'launchPriceJpy', label: '発売時価格 (日本)' },
  { key: 'launchPriceUsd', label: '発売時価格 (米国)' },
  { key: 'identifier', label: '機種識別子 (Identifier)' },
  { key: 'modelNumbers', label: 'モデル番号 (型番)' },
  { key: 'discontinued', label: '販売終了日 (日本時間)' },
];

const SPEC_ROWS: SpecRowDef[] = [
  ...PRIMARY_SPEC_ROWS,
  ...DETAIL_SPEC_ROWS.filter((r) => r.key !== '__conn'),
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

/**
 * スペック値の差分判定用正規化:
 * - 全角/半角 (NFKC)、大文字/小文字、空白・改行、波ダッシュ・ハイフン表記ゆれを吸収
 * - null / undefined / "-" / "—" / "不明" / "非公開" / "データなし" 等はすべて空文字 "" に正規化
 */
export function normalizeSpecForCompare(raw: unknown): string {
  if (raw == null) return '';
  const text = (Array.isArray(raw) ? raw.join('/') : String(raw))
    .normalize('NFKC')
    .trim()
    .toLowerCase();
  if (!text) return '';
  const compact = text
    .replace(/[\s\u3000]+/g, '')
    .replace(/[〜～~]/g, '~')
    .replace(/[－−–—―ｰ]/g, '-');
  if (
    !compact ||
    compact === '-' ||
    compact === '--' ||
    compact === '不明' ||
    compact === '非公開' ||
    compact === 'データなし' ||
    compact === 'なし' ||
    compact === 'n/a' ||
    compact === 'none' ||
    compact === 'null' ||
    compact === 'undefined'
  ) {
    return '';
  }
  return compact;
}

function getColSpecDisplayValue(
  c: { p: Product; sku: Sku },
  key: string,
): string {
  if (key === '__conn') {
    return c.sku.connectivity === '-' ? '共通 (本体仕様参照)' : c.sku.connectivity;
  }
  return specText(c.p.specs[key]);
}

export interface EvaluatedSpecRow {
  row: SpecRowDef;
  values: string[];
  normValues: string[];
  allEmpty: boolean;
  hasDiff: boolean;
}

function evaluateSpecRows(
  cols: { p: Product; sku: Sku }[],
  rows: SpecRowDef[],
): EvaluatedSpecRow[] {
  return rows.map((row) => {
    const values = cols.map((c) => getColSpecDisplayValue(c, row.key));
    const normValues = cols.map((c) => {
      if (row.key === '__conn') {
        return c.sku.connectivity === '-' ? '' : normalizeSpecForCompare(c.sku.connectivity);
      }
      return normalizeSpecForCompare(c.p.specs[row.key]);
    });
    const allEmpty = normValues.every((v) => v === '');
    const uniqueCount = new Set(normValues).size;
    const hasDiff = cols.length >= 2 && !allEmpty && uniqueCount > 1;
    return {
      row,
      values,
      normValues,
      allEmpty,
      hasDiff,
    };
  });
}

function formatFxComparisonText(pt?: PricePoint): string {
  if (!pt) return '—';
  const mkt = marketRate(pt);
  const apl = impliedRate(pt);
  const diff = rateDiffVal(pt);
  if (mkt == null && apl == null) return '—';
  const mktStr = mkt != null ? `当時の市場レート 1ドル ${mkt.toFixed(1)}円` : '市場レート —';
  const aplStr = apl != null ? `Apple適用レート 1ドル ${apl.toFixed(1)}円` : 'Apple適用レート —';
  const diffStr = diff != null ? ` (${signedRate(diff)}/ドル)` : '';
  return `${mktStr} vs ${aplStr}${diffStr}`;
}

function evaluateCurrentFxFairness(pt?: PricePoint, latestUsdJpy = DEFAULT_LATEST_USD_JPY): {
  status: 'bargain' | 'expensive' | 'fair' | 'none';
  label: string;
  shortLabel: string;
  fairJpy?: number;
  jpyDiff?: number;
  pctDiff?: number;
  appleRate?: number;
  latestUsdJpy: number;
  summaryText: string;
} {
  if (!pt) {
    return { status: 'none', label: '判定データなし', shortLabel: '—', latestUsdJpy, summaryText: '—' };
  }
  const fairJpy = fairJpyVal(pt, latestUsdJpy);
  const appleRate = impliedRate(pt);
  if (fairJpy == null || fairJpy <= 0) {
    return { status: 'none', label: 'USD価格なし', shortLabel: '—', latestUsdJpy, summaryText: '—' };
  }
  const jpyDiff = pt.appleStorePrice - fairJpy;
  const pctDiff = ((pt.appleStorePrice - fairJpy) / fairJpy) * 100;
  if (pctDiff <= -1.0) {
    return {
      status: 'bargain',
      label: `今の為替から見て割安 (${signedYen(jpyDiff)} / ${signedPct(pctDiff)})`,
      shortLabel: `今の為替比: 割安 (${signedPct(pctDiff)})`,
      fairJpy,
      jpyDiff,
      pctDiff,
      appleRate,
      latestUsdJpy,
      summaryText: `割安 (${signedYen(jpyDiff)} / 理論価格 ${yen(fairJpy)})`,
    };
  }
  if (pctDiff >= 1.0) {
    return {
      status: 'expensive',
      label: `今の為替から見て割高 (${signedYen(jpyDiff)} / ${signedPct(pctDiff)})`,
      shortLabel: `今の為替比: 割高 (${signedPct(pctDiff)})`,
      fairJpy,
      jpyDiff,
      pctDiff,
      appleRate,
      latestUsdJpy,
      summaryText: `割高 (${signedYen(jpyDiff)} / 理論価格 ${yen(fairJpy)})`,
    };
  }
  return {
    status: 'fair',
    label: `今の為替から見て適正水準 (${signedYen(jpyDiff)} / ${signedPct(pctDiff)})`,
    shortLabel: `今の為替比: 適正 (${signedPct(pctDiff)})`,
    fairJpy,
    jpyDiff,
    pctDiff,
    appleRate,
    latestUsdJpy,
    summaryText: `適正水準 (${signedYen(jpyDiff)} / 理論価格 ${yen(fairJpy)})`,
  };
}

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
  rows.push(['発売時: 当時の市場レート vs Apple適用レート', ...cols.map((c) => formatFxComparisonText(c.sku.priceHistory[0]))]);
  rows.push(['現在/最終: 当時の市場レート vs Apple適用レート', ...cols.map((c) => formatFxComparisonText(c.sku.priceHistory.length ? lastOf(c.sku.priceHistory) : undefined))]);
  rows.push(['現在為替レートでの理論価格 (税込10%)', ...cols.map((c) => {
    const curPt = c.sku.priceHistory.length ? lastOf(c.sku.priceHistory) : undefined;
    const fair = curPt ? fairJpyVal(curPt) : undefined;
    return fair != null ? yen(fair) : '—';
  })]);
  rows.push(['今の為替レートから見た割安・割高判定', ...cols.map((c) => {
    const curPt = c.sku.priceHistory.length ? lastOf(c.sku.priceHistory) : undefined;
    return evaluateCurrentFxFairness(curPt).summaryText;
  })]);
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
    const u = getUsed(c.p, c.sku);
    const up = u.usedPricing;
    if (u.isEstimated || u.source === 'mock' || up.isEstimated) {
      return `参考推定相場: 約${yen(up.lowestPrice)}（実在庫データ未取得）`;
    }
    const plat = up.lowestPlatform === 'yahoo' ? 'Yahoo!ショッピング' : '楽天市場';
    const best = up.lowestPlatform === 'yahoo' ? up.yahoo : up.rakuten;
    return `${yen(up.lowestPrice)} [${plat}${best?.shopName ? `: ${best.shopName}` : ''}]`;
  })]);
  rows.push(['楽天市場 中古最安値', ...cols.map((c) => {
    const u = getUsed(c.p, c.sku);
    const r = u.usedPricing.rakuten;
    if (!r) return '—';
    if (u.isEstimated || u.source === 'mock' || u.usedPricing.isEstimated || !r.shopName) {
      return `約${yen(r.price)} (参考推定)`;
    }
    return `${yen(r.price)} (${r.shopName})`;
  })]);
  rows.push(['Yahoo!ショッピング 中古最安値', ...cols.map((c) => {
    const u = getUsed(c.p, c.sku);
    const y = u.usedPricing.yahoo;
    if (!y) return '—';
    if (u.isEstimated || u.source === 'mock' || u.usedPricing.isEstimated || !y.shopName) {
      return `約${yen(y.price)} (参考推定)`;
    }
    return `${yen(y.price)} (${y.shopName})`;
  })]);
  rows.push(['未使用品最安値', ...cols.map((c) => { const u = getUsed(c.p, c.sku).unused; return u ? `${yen(u.price)}${u.shopName ? ` (${u.shopName})` : ''}` : '—'; })]);
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
  compareRows.push(['データ種別 / 最安モール', ...usedForCols.map((u): XlsCell => (u.isEstimated || u.source === 'mock' || u.usedPricing.isEstimated ? '参考推定相場（実在庫データ未取得）' : u.usedPricing.lowestPlatform === 'yahoo' ? 'Yahoo!ショッピング' : '楽天市場'))]);
  compareRows.push(['リセールバリュー (残価率)', ...usedForCols.map((u): XlsCell => (u.usedPricing.resaleValuePercent != null ? `リセール率 ${u.usedPricing.resaleValuePercent}%` : '—'))]);
  compareRows.push(['楽天市場 中古最安値', ...usedForCols.map((u): XlsCell => (!u.isEstimated && u.usedPricing.rakuten ? { v: u.usedPricing.rakuten.price, k: 'yen' } : '—'))]);
  compareRows.push(['楽天市場 ショップ名', ...usedForCols.map((u): XlsCell => (!u.isEstimated && u.usedPricing.rakuten?.shopName ? u.usedPricing.rakuten.shopName : '—'))]);
  compareRows.push(['Yahoo!ショッピング 中古最安値', ...usedForCols.map((u): XlsCell => (!u.isEstimated && u.usedPricing.yahoo ? { v: u.usedPricing.yahoo.price, k: 'yen' } : '—'))]);
  compareRows.push(['Yahoo!ショッピング ショップ名', ...usedForCols.map((u): XlsCell => (!u.isEstimated && u.usedPricing.yahoo?.shopName ? u.usedPricing.yahoo.shopName : '—'))]);
  compareRows.push(['未使用品最安値', ...usedForCols.map((u): XlsCell => (u.unused ? { v: u.unused.price, k: 'yen' } : '—'))]);

  compareRows.push(secRow('為替レート比較（当時の市場レート vs Apple適用レート・現在レート理論価格）'));
  compareRows.push(['発売時: 市場レート vs Apple適用レート', ...cols.map((c): XlsCell => formatFxComparisonText(c.sku.priceHistory[0]))]);
  compareRows.push(['現在/最終: 市場レート vs Apple適用レート', ...cols.map((c): XlsCell => formatFxComparisonText(c.sku.priceHistory.length ? lastOf(c.sku.priceHistory) : undefined))]);
  compareRows.push(['現在レート理論価格 (税込10%)', ...cols.map((c): XlsCell => {
    const curPt = c.sku.priceHistory.length ? lastOf(c.sku.priceHistory) : undefined;
    const fair = curPt ? fairJpyVal(curPt) : undefined;
    return fair != null ? { v: fair, k: 'yen' } : '—';
  })]);
  compareRows.push(['今の為替から見た割安・割高判定', ...cols.map((c): XlsCell => {
    const curPt = c.sku.priceHistory.length ? lastOf(c.sku.priceHistory) : undefined;
    return evaluateCurrentFxFairness(curPt).summaryText;
  })]);

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

const card = 'rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800/80 dark:bg-zinc-900/50';
const selectCls = 'rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-base sm:text-sm text-zinc-900 outline-none focus:ring-2 focus:ring-zinc-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100';
const btnCls = 'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-zinc-200 bg-zinc-100 px-3 py-1.5 text-xs sm:text-sm font-medium text-zinc-700 transition hover:bg-zinc-200 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700';
const excelBtnCls = 'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-zinc-200 bg-zinc-100 px-3 py-1.5 text-xs sm:text-sm font-medium text-zinc-700 transition hover:bg-zinc-200 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700';
const secondaryActionBtnCls = 'inline-flex items-center justify-center gap-1 whitespace-nowrap rounded-lg border border-zinc-200 bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-700 transition hover:bg-zinc-200 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700';

function CarrierBadge({ id, small }: { id: CarrierId; small?: boolean }) {
  const dark = useDark();
  const c = carrierColor(id, dark);
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-zinc-200/80 bg-zinc-100/80 font-medium text-zinc-700 dark:border-zinc-700/80 dark:bg-zinc-800 dark:text-zinc-300 ${small ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs'}`}>
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: c }} />
      {CARRIER_META[id].label}
    </span>
  );
}

function DeltaBadge({ diff, base }: { diff: number; base: number }) {
  const pct = base ? (diff / base) * 100 : 0;
  const up = diff > 0, down = diff < 0;
  const dotCls = up ? 'bg-rose-500' : down ? 'bg-emerald-500' : 'bg-zinc-400';
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-zinc-200/80 bg-zinc-100/80 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-zinc-700 dark:border-zinc-700/80 dark:bg-zinc-800 dark:text-zinc-300">
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotCls}`} />
      {signedYen(diff)} ({signedPct(pct)})
    </span>
  );
}

/** リセールバリュー（残価率）バッジ: （現在の中古最安値 ÷ 発売時Apple直販価格）× 100 */
function ResaleBadge({ rate, launchPrice }: { rate: number | null; launchPrice?: number | null }) {
  if (rate == null || !Number.isFinite(rate)) {
    return (
      <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
        リセール率 —
      </span>
    );
  }
  const dotCls = rate >= 65 ? 'bg-emerald-500' : rate >= 45 ? 'bg-sky-500' : 'bg-amber-500';
  return (
    <span
      title={launchPrice ? `（現在の中古最安値 ÷ 発売時Apple直販価格 ${yen(launchPrice)}）× 100` : '（現在の中古最安値 ÷ 発売時Apple直販価格）× 100'}
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-zinc-200/80 bg-zinc-100/80 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-zinc-700 dark:border-zinc-700/80 dark:bg-zinc-800 dark:text-zinc-300"
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotCls}`} />
      リセール率 {rate}%
    </span>
  );
}

/** 大手中古ショップ認定バッジ（イオシス・じゃんぱら・ゲオ・ソフマップ等） */
function TrustedShopBadge({ isTrusted, compact }: { isTrusted?: boolean; compact?: boolean }) {
  if (isTrusted !== false) {
    return (
      <span
        title="大手ショップ認定（イオシス・じゃんぱら・ゲオ・ソフマップ・にこスマ等）"
        className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
      >
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
        {compact ? '大手認定' : '大手ショップ認定'}
      </span>
    );
  }
  return (
    <span
      title="大手ショップ在庫0件のため、タイトル検証を通過した一般ショップの最安値を表示しています"
      className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
      ※一般ショップ
    </span>
  );
}

/** カード内用の1行スリム為替表示: 為替評価: 割安 -4.8% （市場 ¥150.1 / Apple ¥145.4） */
function CompactCardFxLine({ pt, latestUsdJpy = DEFAULT_LATEST_USD_JPY }: { pt?: PricePoint; latestUsdJpy?: number }) {
  if (!pt) return null;
  const res = evaluateCurrentFxFairness(pt, latestUsdJpy);
  const mkt = marketRate(pt);
  const apl = impliedRate(pt);
  if (mkt == null && apl == null && res.status === 'none') return null;

  const verdictWord =
    res.status === 'bargain'
      ? '割安'
      : res.status === 'expensive'
        ? '割高'
        : res.status === 'fair'
          ? '適正'
          : null;
  const dotCls =
    res.status === 'bargain'
      ? 'bg-emerald-500'
      : res.status === 'expensive'
        ? 'bg-rose-500'
        : 'bg-zinc-400';

  return (
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
      <span className="inline-flex items-center gap-1.5">
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotCls}`} />
        <span>為替評価:</span>
        {verdictWord && res.pctDiff != null ? (
          <strong className="font-semibold text-zinc-700 dark:text-zinc-200">
            {verdictWord} {signedPct(res.pctDiff)}
          </strong>
        ) : (
          <strong className="font-semibold text-zinc-700 dark:text-zinc-200">—</strong>
        )}
      </span>
      {(mkt != null || apl != null) && (
        <span className="text-[11px] text-zinc-400 dark:text-zinc-500">
          （市場 {mkt != null ? `¥${mkt.toFixed(1)}` : '—'} / Apple {apl != null ? `¥${apl.toFixed(1)}` : '—'}）
        </span>
      )}
    </div>
  );
}

/** 当時の市場レート（例：1ドル 110.4円） vs Apple適用レート（例：1ドル 112.4円）を並べて表示するチップ */
function FxRatePairChip({ pt, compact }: { pt?: PricePoint; compact?: boolean }) {
  if (!pt) return <span className="text-xs text-zinc-400">—</span>;
  const mkt = marketRate(pt);
  const apl = impliedRate(pt);
  const diff = rateDiffVal(pt);
  const taxPct = Math.round((pt.taxRate ?? taxRateAt(pt.date)) * 100);
  if (mkt == null && apl == null) return <span className="text-xs text-zinc-400">為替データなし</span>;

  const dotCls =
    diff == null
      ? 'bg-zinc-400'
      : diff > 0.5
        ? 'bg-rose-500'
        : diff < -0.5
          ? 'bg-emerald-500'
          : 'bg-zinc-400';

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5 tabular-nums text-[11px] sm:text-xs">
      <span className="inline-flex flex-wrap items-center gap-1 rounded-lg border border-zinc-200/80 bg-zinc-50/80 px-2 py-0.5 font-medium text-zinc-700 dark:border-zinc-700/80 dark:bg-zinc-800/70 dark:text-zinc-300">
        <span className="text-zinc-500 dark:text-zinc-400">{compact ? '市場' : '当時の市場レート'}:</span>
        <strong className="font-semibold text-zinc-800 dark:text-zinc-100">
          {mkt != null ? `1ドル ${mkt.toFixed(1)}円` : '—'}
        </strong>
        <span className="mx-0.5 text-zinc-400">/</span>
        <span className="text-zinc-500 dark:text-zinc-400">{compact ? 'Apple' : 'Apple適用レート'}:</span>
        <strong className="font-semibold text-zinc-800 dark:text-zinc-100">
          {apl != null ? `1ドル ${apl.toFixed(1)}円` : '—'}
        </strong>
        {!compact && <span className="text-[10px] text-zinc-400">(税抜・税{taxPct}%)</span>}
      </span>
      {diff != null && (
        <span
          title={`当時の実勢為替 (${mkt?.toFixed(1)}円) と比べて1ドルあたり ${signedRate(diff)} (${diff > 0 ? '上乗せ' : diff < 0 ? '割引' : '同水準'})`}
          className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] sm:text-[11px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
        >
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotCls}`} />
          {signedRate(diff)}/ドル {diff > 0.5 ? '(上乗せ)' : diff < -0.5 ? '(割引)' : '(実勢並み)'}
        </span>
      )}
    </span>
  );
}

/** 現在のドル円レートと照らし合わせて「今の為替レートから見て、現在のApple Store価格は割安か割高か」を表示するバッジ */
function CurrentFxFairnessBadge({
  pt,
  latestUsdJpy = DEFAULT_LATEST_USD_JPY,
  compact,
  showFairPrice = true,
}: {
  pt?: PricePoint;
  latestUsdJpy?: number;
  compact?: boolean;
  showFairPrice?: boolean;
}) {
  const res = evaluateCurrentFxFairness(pt, latestUsdJpy);
  if (res.status === 'none' || !pt || res.fairJpy == null || res.jpyDiff == null || res.pctDiff == null) {
    return null;
  }
  const dotCls =
    res.status === 'bargain'
      ? 'bg-emerald-500'
      : res.status === 'expensive'
        ? 'bg-rose-500'
        : 'bg-zinc-400';
  const verdictWord = res.status === 'bargain' ? '割安' : res.status === 'expensive' ? '割高' : '適正水準';

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5 tabular-nums">
      <span
        title={`現在の為替レート (1ドル ${latestUsdJpy.toFixed(1)}円・税込10%) で US $${pt.usdPrice} を換算した理論価格 ${yen(res.fairJpy)} との比較`}
        className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-zinc-200/80 bg-zinc-100/80 px-2.5 py-0.5 text-[11px] sm:text-xs font-semibold text-zinc-700 dark:border-zinc-700/80 dark:bg-zinc-800 dark:text-zinc-300"
      >
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotCls}`} />
        {compact
          ? `為替評価: ${verdictWord} (${signedPct(res.pctDiff)})`
          : `今の為替比: ${verdictWord} (${signedYen(res.jpyDiff)} / ${signedPct(res.pctDiff)})`}
      </span>
      {showFairPrice && (
        <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
          理論価格: <strong className="font-semibold text-zinc-700 dark:text-zinc-300">{yen(res.fairJpy)}</strong>
        </span>
      )}
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

/* ---------- URLクエリパラメータの双方向同期ユーティリティ ---------- */
type Tab = 'compare' | 'budget' | 'timeline' | 'fx';

const DEFAULT_COMPARE_IDS = ['iphone-14', 'iphone-15', 'iphone-16'] as const;

const CARRIER_STORE_URLS: Record<CarrierId, string> = {
  apple: 'https://www.apple.com/jp/shop/goto/buy_iphone',
  docomo: 'https://onlineshop.smt.docomo.ne.jp/',
  au: 'https://www.au.com/online-shop/',
  softbank: 'https://www.softbank.jp/online-shop/',
  rakuten: 'https://network.mobile.rakuten.co.jp/product/iphone/',
};

function appleStoreUrlForCategory(cat: string): string {
  switch (cat) {
    case 'iPad':
      return 'https://www.apple.com/jp/shop/goto/buy_ipad';
    case 'Mac':
      return 'https://www.apple.com/jp/shop/goto/buy_mac';
    case 'Apple Watch':
      return 'https://www.apple.com/jp/shop/goto/buy_watch';
    case 'AirPods':
      return 'https://www.apple.com/jp/airpods/';
    default:
      return 'https://www.apple.com/jp/shop/goto/buy_iphone';
  }
}

/**
 * スペック性能スコア (performanceScore) 算出ロジック
 * 1. SoC（チップ）世代スコア（最重要）
 * 2. 発売年ボーナス ((releaseYear - 2015) * 2)
 * 3. RAM容量ボーナス (16GB以上: +15, 8GB: +10, 6GB: +6)
 * 4. Pro / Ultra / Max モデル補正 (+5)
 * 5. ストレージ容量ボーナス (同一予算内で大容量SKUを上位に)
 */
export interface PerformanceScoreBreakdown {
  total: number;
  socScore: number;
  yearBonus: number;
  ramBonus: number;
  proBonus: number;
  storageBonus: number;
  socLabel: string;
  ramGb: number;
  releaseYear: number;
  remainingSupportYears: number;
}

function computePerformanceScore(p: Product, sku: Sku): PerformanceScoreBreakdown {
  const socRaw = String(p.specs.soc ?? '').normalize('NFKC');
  const nameRaw = String(p.name ?? '').normalize('NFKC');
  const combined = `${socRaw} ${nameRaw}`;

  let socScore = 40;
  // Mシリーズ判定
  if (/\bM5\s*(Ultra|Max)\b/i.test(combined)) socScore = 104;
  else if (/\bM5\s*Pro\b/i.test(combined)) socScore = 99;
  else if (/\bM5\b/i.test(combined)) socScore = 94;
  else if (/\bM4\s*(Ultra|Max)\b/i.test(combined)) socScore = 100;
  else if (/\bM4\s*Pro\b/i.test(combined)) socScore = 95;
  else if (/\bM4\b/i.test(combined)) socScore = 90;
  else if (/\bM3\s*(Ultra|Max|Pro)\b/i.test(combined)) socScore = 88;
  else if (/\bM3\b/i.test(combined)) socScore = 82;
  else if (/\bM2\s*(Ultra|Max|Pro)\b/i.test(combined)) socScore = 79;
  else if (/\bM2\b/i.test(combined)) socScore = 75;
  else if (/\bM1\s*(Ultra|Max|Pro)\b/i.test(combined)) socScore = 72;
  else if (/\bM1\b/i.test(combined)) socScore = 68;
  // Aシリーズ判定
  else if (/\bA19\s*Pro\b/i.test(combined)) socScore = 94;
  else if (/\bA19\b/i.test(combined)) socScore = 89;
  else if (/\bA18\s*Pro\b/i.test(combined)) socScore = 90;
  else if (/\bA18\b/i.test(combined)) socScore = 85;
  else if (/\bA17\s*Pro\b/i.test(combined)) socScore = 82;
  else if (/\bA16\b/i.test(combined)) socScore = 76;
  else if (/\bA15\b/i.test(combined)) socScore = 70;
  else if (/\bA14\b/i.test(combined)) socScore = 62;
  else if (/\bA13\b/i.test(combined)) socScore = 55;
  else if (/\bA12[XZ]\b/i.test(combined)) socScore = 50;
  else if (/\bA12\b/i.test(combined)) socScore = 46;
  // Sシリーズ (Watch) / Hシリーズ (AirPods)
  else if (/\bS(11|10|9)\b/i.test(combined)) socScore = 80;
  else if (/\bS(8|7|6)\b/i.test(combined)) socScore = 65;
  else if (/\bS(5|4|3)\b/i.test(combined)) socScore = 48;
  else if (/\bH2\b/i.test(combined)) socScore = 78;
  else if (/\bH1\b/i.test(combined)) socScore = 62;

  const releaseYear = parseInt(String(p.releaseDate ?? '').slice(0, 4), 10) || 2020;
  const yearBonus = Math.max(0, (releaseYear - 2015) * 2);
  const remainingSupportYears = Math.max(1, releaseYear + 7 - 2026);

  // RAM容量の抽出 (SKUラベル "16GB/512GB" または specs.ram "8GB")
  const skuRam = skuRamRank(sku.label, sku.storage);
  const specRamMatch = String(p.specs.ram ?? '').match(/(\d+(?:\.\d+)?)\s*GB/i);
  const ramGb = skuRam > 0 ? skuRam : specRamMatch ? parseFloat(specRamMatch[1]) : 0;
  const ramBonus = ramGb >= 16 ? 15 : ramGb >= 12 ? 12 : ramGb >= 8 ? 10 : ramGb >= 6 ? 6 : ramGb >= 4 ? 3 : 0;

  // Pro / Ultra / Max モデル補正 (120Hz ProMotionや上位カメラ搭載)
  const isProTier =
    /\b(Pro|Ultra|Max|Studio)\b/i.test(nameRaw) ||
    /120Hz|ProMotion/i.test(String(p.specs.display ?? ''));
  const proBonus = isProTier ? 5 : 0;

  // ストレージ容量ボーナス
  const storRank = skuStorRank(sku.label, sku.storage);
  const storageBonus =
    storRank >= 2e6
      ? 6
      : storRank >= 1e6
        ? 5
        : storRank >= 512e3
          ? 4
          : storRank >= 256e3
            ? 2.5
            : storRank >= 128e3
              ? 1.5
              : storRank >= 64e3
                ? 0.5
                : 0;

  const total = round1(socScore + yearBonus + ramBonus + proBonus + storageBonus);
  const socLabel = socRaw ? socRaw.split(' (')[0] : 'Apple Silicon';

  return {
    total,
    socScore,
    yearBonus,
    ramBonus,
    proBonus,
    storageBonus,
    socLabel,
    ramGb,
    releaseYear,
    remainingSupportYears,
  };
}

function toSlug(s: string): string {
  return String(s ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function encodeSkuToken(p: Product, sku: Sku): string {
  const stor = (sku.storage || '').trim();
  if (stor && stor !== '-') {
    const sameStorCount = p.skus.filter(
      (k) => (k.storage || '').trim().toUpperCase() === stor.toUpperCase(),
    ).length;
    if (sameStorCount === 1) return stor.replace(/\s+/g, '');
  }
  const lbl = (sku.label || '').trim();
  if (lbl && !/\s/.test(lbl)) return lbl;
  return sku.id;
}

function findProductByQueryToken(products: Product[], rawPid: string): Product | undefined {
  const q = rawPid.trim().normalize('NFKC');
  if (!q) return undefined;
  const qLower = q.toLowerCase();
  const qSlug = toSlug(q);
  return (
    products.find((p) => p.id === q) ??
    products.find((p) => p.id.toLowerCase() === qLower) ??
    products.find((p) => p.name.normalize('NFKC').toLowerCase() === qLower) ??
    products.find((p) => toSlug(p.id) === qSlug || toSlug(p.name) === qSlug) ??
    products.find((p) =>
      String(p.specs.identifier ?? '')
        .toLowerCase()
        .split(';')
        .map((x) => x.trim())
        .includes(qLower),
    )
  );
}

function findSkuByQueryToken(p: Product, rawSku?: string): Sku {
  const defaultSkus = [...(pricedSkus(p).length ? pricedSkus(p) : p.skus)].sort(compareSkus);
  const fallback = defaultSkus[0] ?? p.skus[0];
  if (!rawSku || !rawSku.trim()) return fallback;
  const q = rawSku.trim().normalize('NFKC');
  const qLower = q.toLowerCase();
  const qCompact = qLower.replace(/\s+/g, '');
  const qSlug = toSlug(q);
  return (
    p.skus.find(
      (k) =>
        k.id.toLowerCase() === qLower ||
        k.storage.toLowerCase() === qLower ||
        k.label.toLowerCase() === qLower,
    ) ??
    p.skus.find(
      (k) =>
        k.id.toLowerCase().replace(/\s+/g, '') === qCompact ||
        k.storage.toLowerCase().replace(/\s+/g, '') === qCompact ||
        k.label.toLowerCase().replace(/\s+/g, '') === qCompact ||
        `${qCompact}gb` === k.storage.toLowerCase().replace(/\s+/g, '') ||
        `${qCompact}gb` === k.label.toLowerCase().replace(/\s+/g, ''),
    ) ??
    p.skus.find(
      (k) => toSlug(k.id) === qSlug || toSlug(k.label) === qSlug || toSlug(k.storage) === qSlug,
    ) ??
    p.skus.find(
      (k) =>
        k.label.toLowerCase().replace(/\s+/g, '').startsWith(qCompact) ||
        k.storage.toLowerCase().replace(/\s+/g, '').startsWith(qCompact),
    ) ??
    fallback
  );
}

function parseCompareQuery(
  compareParam: string | null,
  catalog: Product[],
): { sels: Sel[]; matchedAll: boolean } {
  if (!compareParam || !compareParam.trim()) return { sels: [], matchedAll: true };
  const items = compareParam
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!items.length) return { sels: [], matchedAll: true };

  const out: Sel[] = [];
  const seen = new Set<string>();
  let matchedCount = 0;

  for (const item of items) {
    const colonIdx = item.indexOf(':');
    const rawPid = colonIdx >= 0 ? item.slice(0, colonIdx) : item;
    const rawSku = colonIdx >= 0 ? item.slice(colonIdx + 1) : undefined;
    const p = findProductByQueryToken(catalog, rawPid);
    if (!p) continue;
    matchedCount++;
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    const sku = findSkuByQueryToken(p, rawSku);
    if (sku) out.push({ pid: p.id, sid: sku.id });
  }

  return { sels: out, matchedAll: matchedCount === items.length };
}

function buildDefaultSels(catalog: Product[]): Sel[] {
  const matched = DEFAULT_COMPARE_IDS.map((id) => {
    const p = findProductByQueryToken(catalog, id);
    if (!p) return null;
    const sku = findSkuByQueryToken(p, '128GB');
    return { pid: p.id, sid: sku.id };
  }).filter((x): x is Sel => Boolean(x));
  if (matched.length) return matched;
  return catalog.slice(-3).map((p) => ({ pid: p.id, sid: p.skus[0]?.id ?? '128' }));
}

export type BudgetCategoryFilter = 'all' | 'iPhone' | 'iPad' | 'Mac' | 'Apple Watch' | 'AirPods';

function parseBudgetCategoryParam(raw: string | null): BudgetCategoryFilter {
  const v = (raw ?? '').trim().toLowerCase();
  if (v === 'iphone') return 'iPhone';
  if (v === 'ipad') return 'iPad';
  if (v === 'mac') return 'Mac';
  if (v === 'watch' || v === 'apple watch' || v === 'apple-watch') return 'Apple Watch';
  if (v === 'airpods') return 'AirPods';
  return 'all';
}

function encodeBudgetCategoryParam(cat: BudgetCategoryFilter): string {
  switch (cat) {
    case 'iPhone':
      return 'iphone';
    case 'iPad':
      return 'ipad';
    case 'Mac':
      return 'mac';
    case 'Apple Watch':
      return 'watch';
    case 'AirPods':
      return 'airpods';
    default:
      return 'all';
  }
}

export type SellMode = 'flea' | 'shop' | 'tradein' | 'custom';

function parseSellModeParam(raw: string | null): SellMode {
  const v = (raw ?? '').trim().toLowerCase();
  if (v === 'shop') return 'shop';
  if (v === 'tradein' || v === 'apple') return 'tradein';
  if (v === 'custom') return 'custom';
  return 'flea';
}

function parseMyDeviceQuery(
  myParam: string | null,
  catalog: Product[],
): { sel: Sel | null; matched: boolean } {
  if (!myParam || !myParam.trim()) return { sel: null, matched: true };
  const item = myParam.trim();
  const colonIdx = item.indexOf(':');
  const rawPid = colonIdx >= 0 ? item.slice(0, colonIdx) : item;
  const rawSku = colonIdx >= 0 ? item.slice(colonIdx + 1) : undefined;
  const p = findProductByQueryToken(catalog, rawPid);
  if (!p) return { sel: null, matched: false };
  const sku = findSkuByQueryToken(p, rawSku);
  return { sel: { pid: p.id, sid: sku.id }, matched: true };
}

export type CompareShowKey = 'diag' | 'tradein' | 'fx' | 'shops';
export type CompareShowFlags = Record<CompareShowKey, boolean>;

const COMPARE_SHOW_KEYS: CompareShowKey[] = ['diag', 'tradein', 'fx', 'shops'];

const DEFAULT_SHOW_FLAGS: CompareShowFlags = {
  diag: false,
  tradein: false,
  fx: false,
  shops: false,
};

const LS_COMPARE_SHOW = 'apple-price-atlas:compare-show:v1';

function parseShowFlagsParam(raw: string | null): CompareShowFlags | null {
  if (raw === null) return null;
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed || trimmed === 'none' || trimmed === 'simple') {
    return { ...DEFAULT_SHOW_FLAGS };
  }
  if (trimmed === 'all' || trimmed === 'full') {
    return { diag: true, tradein: true, fx: true, shops: true };
  }
  const tokens = new Set(
    trimmed
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
  return {
    diag: tokens.has('diag'),
    tradein: tokens.has('tradein'),
    fx: tokens.has('fx'),
    shops: tokens.has('shops'),
  };
}

function encodeShowFlagsParam(flags: CompareShowFlags): string | null {
  const active = COMPARE_SHOW_KEYS.filter((k) => flags[k]);
  if (active.length === 0) return null;
  return active.join(',');
}

function loadInitialShowFlags(
  initShowFlags: CompareShowFlags | null,
  hasMyParam: boolean,
): CompareShowFlags {
  if (initShowFlags !== null) {
    return initShowFlags;
  }
  try {
    const raw = localStorage.getItem(LS_COMPARE_SHOW);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        return {
          diag: Boolean(parsed.diag),
          tradein: Boolean(parsed.tradein) || hasMyParam,
          fx: Boolean(parsed.fx),
          shops: Boolean(parsed.shops),
        };
      }
    }
  } catch {
    /* noop */
  }
  return {
    ...DEFAULT_SHOW_FLAGS,
    tradein: hasMyParam ? true : false,
  };
}

const LS_COMPARE_SPEC_PREFS = 'apple-price-atlas:compare-spec-prefs:v1';

function loadInitialSpecPrefs(
  initDiffOnly: boolean | null,
  initSpecExpanded: boolean | null,
): { diffOnly: boolean; specExpanded: boolean } {
  let savedDiffOnly = false;
  let savedSpecExpanded = false;
  try {
    const raw = localStorage.getItem(LS_COMPARE_SPEC_PREFS);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        savedDiffOnly = Boolean(parsed.diffOnly);
        savedSpecExpanded = Boolean(parsed.specExpanded);
      }
    }
  } catch {
    /* noop */
  }
  return {
    diffOnly: initDiffOnly !== null ? initDiffOnly : savedDiffOnly,
    specExpanded: initSpecExpanded !== null ? initSpecExpanded : savedSpecExpanded,
  };
}

function parseUrlSearchParams(search: string) {
  const params = new URLSearchParams(search);
  const compareRaw = params.get('compare');
  const modeRaw = (params.get('mode') ?? '').toLowerCase();
  const mode: Mode = modeRaw === 'program' || modeRaw === 'return' ? 'return' : 'bulk';
  const mnpRaw = (params.get('mnp') ?? '').toLowerCase();
  const mnp = mnpRaw === '1' || mnpRaw === 'true';
  const tabRaw = (params.get('tab') ?? '').toLowerCase();
  const tab: Tab =
    tabRaw === 'budget'
      ? 'budget'
      : tabRaw === 'timeline'
        ? 'timeline'
        : tabRaw === 'fx'
          ? 'fx'
          : 'compare';
  const maxPriceNum = parseInt(params.get('maxPrice') ?? '', 10);
  const maxPrice =
    Number.isFinite(maxPriceNum) && maxPriceNum >= 10000 && maxPriceNum <= 300000
      ? Math.round(maxPriceNum / 5000) * 5000
      : 80000;
  const budgetCat = parseBudgetCategoryParam(params.get('cat'));
  const myRaw = params.get('my');
  const sellMode = parseSellModeParam(params.get('sellMode'));
  const sellCustomNum = parseInt(params.get('sellCustom') ?? '', 10);
  const sellCustom =
    Number.isFinite(sellCustomNum) && sellCustomNum >= 0 && sellCustomNum <= 500000
      ? sellCustomNum
      : 42000;
  const showFlags = parseShowFlagsParam(params.get('show'));
  const rawDiffOnly = params.get('diffOnly');
  const diffOnly: boolean | null =
    rawDiffOnly === null
      ? null
      : rawDiffOnly === '1' || rawDiffOnly.toLowerCase() === 'true';
  const rawSpecs = params.get('specs');
  const specExpanded: boolean | null =
    rawSpecs === null
      ? null
      : rawSpecs.toLowerCase() === 'all' || rawSpecs.toLowerCase() === 'full' || rawSpecs === '1';
  return {
    compareRaw,
    mode,
    mnp,
    tab,
    maxPrice,
    budgetCat,
    myRaw,
    sellMode,
    sellCustom,
    showFlags,
    diffOnly,
    specExpanded,
  };
}

function buildShareSearchString(
  products: Product[],
  sels: Sel[],
  mode: Mode,
  mnp: boolean,
  tab: Tab,
  budgetMaxPrice = 80000,
  budgetCat: BudgetCategoryFilter = 'all',
  mySel: Sel | null = null,
  sellMode: SellMode = 'flea',
  sellCustom = 42000,
  showFlags: CompareShowFlags = DEFAULT_SHOW_FLAGS,
  diffOnly = false,
  specExpanded = false,
): string {
  const parts: string[] = [];
  const compareTokens = sels
    .map((s) => {
      const p = products.find((x) => x.id === s.pid);
      if (!p) return null;
      const sku = p.skus.find((k) => k.id === s.sid) ?? p.skus[0];
      if (!sku) return encodeURIComponent(p.id);
      const skuToken = encodeSkuToken(p, sku);
      return `${encodeURIComponent(p.id)}:${encodeURIComponent(skuToken)}`;
    })
    .filter((x): x is string => Boolean(x));

  if (compareTokens.length > 0) {
    parts.push(`compare=${compareTokens.join(',')}`);
  }
  if (mySel) {
    const mp = products.find((x) => x.id === mySel.pid);
    if (mp) {
      const msku = mp.skus.find((k) => k.id === mySel.sid) ?? mp.skus[0];
      const mToken = msku ? `${encodeURIComponent(mp.id)}:${encodeURIComponent(encodeSkuToken(mp, msku))}` : encodeURIComponent(mp.id);
      parts.push(`my=${mToken}`);
      parts.push(`sellMode=${encodeURIComponent(sellMode)}`);
      if (sellMode === 'custom') {
        parts.push(`sellCustom=${Math.max(0, Math.round(sellCustom))}`);
      }
    }
  }
  parts.push(`mode=${mode === 'return' ? 'program' : 'full'}`);
  if (mnp) {
    parts.push('mnp=1');
  }
  const showParam = encodeShowFlagsParam(showFlags);
  if (showParam) {
    parts.push(`show=${showParam}`);
  }
  if (diffOnly) {
    parts.push('diffOnly=1');
  }
  if (specExpanded) {
    parts.push('specs=all');
  }
  if (tab !== 'compare') {
    parts.push(`tab=${encodeURIComponent(tab)}`);
  }
  if (tab === 'budget') {
    parts.push(`maxPrice=${budgetMaxPrice}`);
    parts.push(`cat=${encodeBudgetCategoryParam(budgetCat)}`);
  }
  return parts.length ? `?${parts.join('&')}` : '';
}

/* ---------- 🔄 買い替え追い金（実質差額）＆スペック進化シミュレーター ---------- */
export interface TradeInEstimate {
  myProduct: Product;
  mySku: Sku;
  baseUsedPrice: number;
  isFallbackDepreciation: boolean;
  fleaYen: number;
  shopYen: number;
  tradeinYen: number;
  activeYen: number;
  sellMode: SellMode;
  sellModeLabel: string;
}

function computeTradeInEstimate(
  myProduct: Product,
  mySku: Sku,
  usedData: UsedMarketData | undefined,
  sellMode: SellMode,
  customYen: number,
): TradeInEstimate {
  const fromUsedData = usedData?.usedPricing?.lowestPrice;
  const fromSku = mySku.usedPricing?.lowestPrice;
  let baseUsedPrice = 0;
  let isFallbackDepreciation = false;

  if (typeof fromUsedData === 'number' && fromUsedData > 0) {
    baseUsedPrice = fromUsedData;
  } else if (typeof fromSku === 'number' && fromSku > 0) {
    baseUsedPrice = fromSku;
  } else {
    // フォールバック: 発売時価格と経過年数から減価償却計算（1年ごとに約18%減価）
    isFallbackDepreciation = true;
    const launchPrice =
      mySku.carriers.apple?.launchPrice ??
      (mySku.priceHistory.length ? mySku.priceHistory[0].appleStorePrice : 98800);
    const releaseYear = parseInt(String(myProduct.releaseDate ?? '').slice(0, 4), 10) || 2021;
    const elapsedYears = Math.max(1, 2026 - releaseYear);
    baseUsedPrice = Math.max(
      5000,
      Math.round((launchPrice * Math.pow(0.82, elapsedYears)) / 100) * 100,
    );
  }

  const fleaYen = Math.round((baseUsedPrice * 0.82) / 100) * 100;
  const shopYen = Math.round((baseUsedPrice * 0.68) / 100) * 100;
  const tradeinYen = Math.round((baseUsedPrice * 0.60) / 100) * 100;

  const activeYen =
    sellMode === 'flea'
      ? fleaYen
      : sellMode === 'shop'
        ? shopYen
        : sellMode === 'tradein'
          ? tradeinYen
          : Math.max(0, Math.round(customYen));

  const sellModeLabel =
    sellMode === 'flea'
      ? 'フリマ出品（×0.82 手取り目安）'
      : sellMode === 'shop'
        ? '中古ショップ買取（×0.68 目安）'
        : sellMode === 'tradein'
          ? 'Apple Trade In（×0.60 目安）'
          : '手入力査定額';

  return {
    myProduct,
    mySku,
    baseUsedPrice,
    isFallbackDepreciation,
    fleaYen,
    shopYen,
    tradeinYen,
    activeYen,
    sellMode,
    sellModeLabel,
  };
}

export interface UpgradeDiffBadgeItem {
  key: string;
  label: string;
  tone: 'emerald' | 'sky' | 'violet' | 'amber' | 'zinc';
}

/**
 * 「今の機種から何が進化する？」アップグレード差分ハイライト抽出
 */
function computeUpgradeDiffBadges(
  fromP: Product,
  fromSku: Sku,
  toP: Product,
  toSku: Sku,
): UpgradeDiffBadgeItem[] {
  if (fromP.id === toP.id && fromSku.id === toSku.id) {
    return [{ key: 'same', label: '現在お使いの機種・容量と同一です', tone: 'zinc' }];
  }

  const badges: UpgradeDiffBadgeItem[] = [];
  const fromSocRaw = String(fromP.specs.soc ?? '').normalize('NFKC');
  const toSocRaw = String(toP.specs.soc ?? '').normalize('NFKC');
  const fromSocShort = fromSocRaw.split(' (')[0].trim();
  const toSocShort = toSocRaw.split(' (')[0].trim();

  // 1. チップ世代の進化
  if (fromSocShort && toSocShort && fromSocShort !== toSocShort) {
    const aFrom = fromSocShort.match(/\bA(\d+)\b/i);
    const aTo = toSocShort.match(/\bA(\d+)\b/i);
    const mFrom = fromSocShort.match(/\bM(\d+)\b/i);
    const mTo = toSocShort.match(/\bM(\d+)\b/i);
    const sFrom = fromSocShort.match(/\bS(\d+)\b/i);
    const sTo = toSocShort.match(/\bS(\d+)\b/i);

    if (aFrom && aTo) {
      const diff = parseInt(aTo[1], 10) - parseInt(aFrom[1], 10);
      if (diff > 0) {
        badges.push({
          key: 'soc',
          label: `🚀 ${fromSocShort} → ${toSocShort}（${diff}世代進化！）`,
          tone: 'sky',
        });
      } else if (diff === 0 && /Pro/i.test(toSocShort) && !/Pro/i.test(fromSocShort)) {
        badges.push({
          key: 'soc',
          label: `🚀 ${fromSocShort} → ${toSocShort}（Proチップ化！）`,
          tone: 'sky',
        });
      }
    } else if (mFrom && mTo) {
      const diff = parseInt(mTo[1], 10) - parseInt(mFrom[1], 10);
      if (diff > 0) {
        badges.push({
          key: 'soc',
          label: `🚀 ${fromSocShort} → ${toSocShort}（${diff}世代進化！）`,
          tone: 'sky',
        });
      } else if (diff === 0) {
        badges.push({
          key: 'soc',
          label: `🚀 ${fromSocShort} → ${toSocShort}`,
          tone: 'sky',
        });
      }
    } else if (sFrom && sTo) {
      const diff = parseInt(sTo[1], 10) - parseInt(sFrom[1], 10);
      if (diff > 0) {
        badges.push({
          key: 'soc',
          label: `🚀 ${fromSocShort} → ${toSocShort}（${diff}世代進化！）`,
          tone: 'sky',
        });
      }
    } else if (/Intel|Core/i.test(fromSocShort) && /\bM\d/i.test(toSocShort)) {
      badges.push({
        key: 'soc',
        label: `🚀 Intel → ${toSocShort}（Apple Silicon化で劇的進化！）`,
        tone: 'sky',
      });
    } else {
      badges.push({
        key: 'soc',
        label: `🚀 チップ: ${fromSocShort} → ${toSocShort}`,
        tone: 'sky',
      });
    }
  }

  // 2. メモリ（RAM）増量
  const fromScore = computePerformanceScore(fromP, fromSku);
  const toScore = computePerformanceScore(toP, toSku);
  if (fromScore.ramGb > 0 && toScore.ramGb > fromScore.ramGb) {
    const diffRam = toScore.ramGb - fromScore.ramGb;
    const isDouble = toScore.ramGb >= fromScore.ramGb * 2;
    badges.push({
      key: 'ram',
      label: `🧠 RAM ${fromScore.ramGb}GB → ${toScore.ramGb}GB（+${diffRam}GB${isDouble ? '・倍増！' : '増量'}）`,
      tone: 'violet',
    });
  }

  // 3. 端子の変更 (Lightning → USB-C 等)
  const fromPorts = String(fromP.specs.ports ?? '').normalize('NFKC');
  const toPorts = String(toP.specs.ports ?? '').normalize('NFKC');
  if (/Lightning/i.test(fromPorts) && /USB-C|Type-C|Thunderbolt/i.test(toPorts)) {
    badges.push({
      key: 'ports',
      label: '🔌 Lightning → USB-C 対応！',
      tone: 'emerald',
    });
  } else if (/Thunderbolt\s*3/i.test(fromPorts) && /Thunderbolt\s*[45]/i.test(toPorts)) {
    badges.push({
      key: 'ports',
      label: `🔌 端子進化: ${toPorts}`,
      tone: 'emerald',
    });
  }

  // 4. 画面リフレッシュレート (60Hz → 120Hz ProMotion) / ディスプレイ進化
  const fromDisp = String(fromP.specs.display ?? '').normalize('NFKC');
  const toDisp = String(toP.specs.display ?? '').normalize('NFKC');
  const from120 = /120Hz|ProMotion/i.test(fromDisp);
  const to120 = /120Hz|ProMotion/i.test(toDisp);
  if (!from120 && to120) {
    badges.push({
      key: 'display',
      label: '✨ 60Hz → 120Hz ProMotion対応！',
      tone: 'amber',
    });
  } else if (/液晶|Liquid Retina HD/i.test(fromDisp) && /OLED|Super Retina XDR|タンデムOLED/i.test(toDisp)) {
    badges.push({
      key: 'display',
      label: '✨ 液晶 → 有機EL (XDR) ディスプレイ進化！',
      tone: 'amber',
    });
  }

  // 5. 重量の変化
  const parseGrams = (w: string | string[] | undefined): number | null => {
    const m = String(w ?? '').normalize('NFKC').match(/(\d+(?:\.\d+)?)\s*g\b/i);
    return m ? parseFloat(m[1]) : null;
  };
  const fromG = parseGrams(fromP.specs.weight);
  const toG = parseGrams(toP.specs.weight);
  if (fromG != null && toG != null) {
    const diffG = Math.round(toG - fromG);
    if (diffG < 0) {
      badges.push({
        key: 'weight',
        label: `⚖️ ${Math.round(fromG)}g → ${Math.round(toG)}g（${diffG}g 軽量化！）`,
        tone: 'emerald',
      });
    } else if (diffG > 0) {
      badges.push({
        key: 'weight',
        label: `⚖️ ${Math.round(fromG)}g → ${Math.round(toG)}g（+${diffG}g）`,
        tone: 'zinc',
      });
    }
  }

  // 6. カメラ / バッテリー / 容量の進化（バッジが3個以下の場合に補完）
  if (badges.length < 4) {
    const fromCam = String(fromP.specs.camera ?? '').normalize('NFKC');
    const toCam = String(toP.specs.camera ?? '').normalize('NFKC');
    if (!/48MP/i.test(fromCam) && /48MP/i.test(toCam)) {
      badges.push({
        key: 'camera',
        label: '📷 12MP → 48MP高解像度カメラ対応！',
        tone: 'violet',
      });
    }
  }
  if (badges.length < 4) {
    const parseHours = (b: string | string[] | undefined): number | null => {
      const m = String(b ?? '').normalize('NFKC').match(/最大\s*(\d+)\s*時間/);
      return m ? parseInt(m[1], 10) : null;
    };
    const fH = parseHours(fromP.specs.battery);
    const tH = parseHours(toP.specs.battery);
    if (fH != null && tH != null && tH > fH) {
      badges.push({
        key: 'battery',
        label: `🔋 駆動時間 最大${fH}h → 最大${tH}h（+${tH - fH}時間延長）`,
        tone: 'emerald',
      });
    }
  }
  if (badges.length < 4) {
    const fStor = skuStorRank(fromSku.label, fromSku.storage);
    const tStor = skuStorRank(toSku.label, toSku.storage);
    if (fStor > 0 && tStor > fStor) {
      badges.push({
        key: 'storage',
        label: `💾 容量アップ: ${fromSku.label} → ${toSku.label}`,
        tone: 'sky',
      });
    }
  }

  return badges.slice(0, 4);
}

const TRADEIN_PRESETS = [
  { id: 'iphone-13', skuHint: '128GB', label: 'iPhone 13 (128GB)' },
  { id: 'iphone-12', skuHint: '128GB', label: 'iPhone 12 (128GB)' },
  { id: 'iphone-14', skuHint: '128GB', label: 'iPhone 14 (128GB)' },
  { id: 'iphone-se-3rd-generation', skuHint: '128GB', label: 'iPhone SE 第3世代' },
  { id: 'iphone-15', skuHint: '128GB', label: 'iPhone 15 (128GB)' },
] as const;

function TradeInSimulatorBar({
  allProducts,
  mySel,
  setMySel,
  sellMode,
  setSellMode,
  sellCustom,
  setSellCustom,
  tradeInEst,
}: {
  allProducts: Product[];
  mySel: Sel | null;
  setMySel: (s: Sel | null) => void;
  sellMode: SellMode;
  setSellMode: (m: SellMode) => void;
  sellCustom: number;
  setSellCustom: (n: number) => void;
  tradeInEst: TradeInEstimate | null;
}) {
  const [expanded, setExpanded] = useState(true);
  const sortedAll = useMemo(() => [...allProducts].sort(compareProducts), [allProducts]);
  const cats = useMemo(
    () => sortCategories(Array.from(new Set(sortedAll.map((x) => x.category)))),
    [sortedAll],
  );
  const myProduct = mySel ? sortedAll.find((p) => p.id === mySel.pid) ?? null : null;
  const mySkus = useMemo(
    () => (myProduct ? [...(pricedSkus(myProduct).length ? pricedSkus(myProduct) : myProduct.skus)].sort(compareSkus) : []),
    [myProduct],
  );

  const applyPreset = (id: string, skuHint: string) => {
    const p = findProductByQueryToken(sortedAll, id);
    if (!p) return;
    const sku = findSkuByQueryToken(p, skuHint);
    setMySel({ pid: p.id, sid: sku.id });
  };

  return (
    <div className={`${card} px-3.5 py-2.5 sm:px-4 sm:py-3`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-zinc-100 text-xs dark:bg-zinc-800">
            🔄
          </span>
          <h3 className="text-xs sm:text-sm font-bold text-zinc-900 dark:text-zinc-100">
            下取り・買い替え追い金シミュレーター
          </h3>
          {tradeInEst ? (
            <span className="inline-flex items-center gap-1.5 rounded-md bg-zinc-100 px-2 py-0.5 text-xs font-semibold tabular-nums text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              {tradeInEst.myProduct.name} ({tradeInEst.mySku.label}) 売却推計:{' '}
              <strong className="font-bold text-zinc-900 dark:text-white">−{yen(tradeInEst.activeYen)}</strong>
            </span>
          ) : (
            <span className="hidden text-xs text-zinc-500 sm:inline dark:text-zinc-400">
              現在の機種を選ぶと実質追い金・進化点を算出
            </span>
          )}
          {!expanded && (
            <div className="hidden items-center gap-1 lg:inline-flex">
              {TRADEIN_PRESETS.slice(0, 4).map((pr) => {
                const matchedP = findProductByQueryToken(sortedAll, pr.id);
                if (!matchedP) return null;
                const isSelected = mySel?.pid === matchedP.id;
                return (
                  <button
                    key={pr.id}
                    type="button"
                    onClick={() => applyPreset(pr.id, pr.skuHint)}
                    className={`rounded-md border px-2 py-0.5 text-[11px] font-medium transition ${
                      isSelected
                        ? 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-200 dark:bg-zinc-100 dark:text-zinc-900'
                        : 'border-zinc-200 bg-zinc-50 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700/80 dark:bg-zinc-800/70 dark:text-zinc-300 dark:hover:bg-zinc-800'
                    }`}
                  >
                    {pr.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex items-center gap-1.5 ml-auto">
          {mySel && (
            <button
              type="button"
              onClick={() => setMySel(null)}
              className={secondaryActionBtnCls}
            >
              <X className="h-3 w-3" />
              <span>クリア</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className={secondaryActionBtnCls}
          >
            <span>{expanded ? '閉じる ▴' : mySel ? '条件を変更 ▾' : '機種・条件を選択 ▾'}</span>
          </button>
        </div>
      </div>

      {expanded && (
        <div className="mt-3 border-t border-zinc-200/80 pt-3 dark:border-zinc-800/70">
          {/* クイック選択プリセットボタン */}
          <div className="mb-2.5 flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-medium text-zinc-500">定番の乗り換え元:</span>
            {TRADEIN_PRESETS.map((pr) => {
              const matchedP = findProductByQueryToken(sortedAll, pr.id);
              if (!matchedP) return null;
              const isSelected = mySel?.pid === matchedP.id;
              return (
                <button
                  key={pr.id}
                  type="button"
                  onClick={() => applyPreset(pr.id, pr.skuHint)}
                  className={`rounded-md border px-2.5 py-0.5 text-xs font-medium transition ${
                    isSelected
                      ? 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-200 dark:bg-zinc-100 dark:text-zinc-900'
                      : 'border-zinc-200 bg-zinc-50 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700'
                  }`}
                >
                  {pr.label}
                </button>
              );
            })}
          </div>

          {/* 機種・容量・売却ルート選択コントロール */}
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-12 sm:items-center">
            <div className="sm:col-span-5">
              <label className="mb-1 block text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
                1. 現在使っている機種
              </label>
              <select
                className={`${selectCls} w-full`}
                value={mySel?.pid ?? ''}
                aria-label="現在使っている機種を選択"
                onChange={(e) => {
                  const pid = e.target.value;
                  if (!pid) {
                    setMySel(null);
                    return;
                  }
                  const np = sortedAll.find((x) => x.id === pid);
                  if (np) {
                    const nextSkus = [...(pricedSkus(np).length ? pricedSkus(np) : np.skus)].sort(compareSkus);
                    const defaultSku = findSkuByQueryToken(np, '128GB') ?? nextSkus[0];
                    setMySel({ pid: np.id, sid: defaultSku.id });
                  }
                }}
              >
                <option value="">― 機種を選択してください（未選択） ―</option>
                {cats.map((c) => (
                  <optgroup key={c} label={c}>
                    {sortedAll
                      .filter((x) => x.category === c)
                      .map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.name} ({x.releaseDate.slice(0, 4)})
                        </option>
                      ))}
                  </optgroup>
                ))}
              </select>
            </div>

            <div className="sm:col-span-2">
              <label className="mb-1 block text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
                2. 容量 (SKU)
              </label>
              <select
                className={`${selectCls} w-full`}
                disabled={!myProduct}
                value={mySel?.sid ?? ''}
                aria-label="現在使っている機種の容量を選択"
                onChange={(e) => {
                  if (myProduct) setMySel({ pid: myProduct.id, sid: e.target.value });
                }}
              >
                {!myProduct ? (
                  <option value="">―</option>
                ) : (
                  mySkus.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))
                )}
              </select>
            </div>

            <div className="sm:col-span-5">
              <label className="mb-1 block text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
                3. 売却ルート（状態・方法）
              </label>
              <div className="flex flex-wrap items-center gap-1.5">
                <select
                  className={`${selectCls} min-w-0 flex-1`}
                  disabled={!myProduct}
                  value={sellMode}
                  aria-label="売却ルートを選択"
                  onChange={(e) => setSellMode(e.target.value as SellMode)}
                >
                  <option value="flea">
                    フリマ出品（メルカリ等・手取り目安: 中古最安×0.82）
                  </option>
                  <option value="shop">
                    中古ショップ買取（イオシス・じゃんぱら等 A/Bランク: ×0.68）
                  </option>
                  <option value="tradein">
                    Apple Trade In（公式下取り目安: ×0.60）
                  </option>
                  <option value="custom">手入力で査定額を指定</option>
                </select>
                {sellMode === 'custom' && (
                  <div className="inline-flex items-center gap-1">
                    <span className="text-xs font-bold text-zinc-600 dark:text-zinc-300">¥</span>
                    <input
                      type="number"
                      min={0}
                      max={500000}
                      step={1000}
                      value={sellCustom}
                      onChange={(e) => setSellCustom(Math.max(0, Number(e.target.value) || 0))}
                      className={`${selectCls} w-28 tabular-nums`}
                      aria-label="手入力査定額"
                    />
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* 売却ルート別の推定金額サマリー */}
          {tradeInEst && (
            <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-zinc-200/70 pt-2.5 text-xs dark:border-zinc-800/70">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="text-zinc-600 dark:text-zinc-400">
                  {tradeInEst.myProduct.name} ({tradeInEst.mySku.label}) 中古販売相場:{' '}
                  <strong className="font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
                    {yen(tradeInEst.baseUsedPrice)}
                  </strong>
                  {tradeInEst.isFallbackDepreciation && (
                    <span className="ml-1 text-[10px] text-zinc-400">(年式推計)</span>
                  )}
                </span>
                <div className="flex flex-wrap items-center gap-1.5 text-[11px] tabular-nums">
                  <button
                    type="button"
                    onClick={() => setSellMode('flea')}
                    className={`rounded-md border px-2 py-0.5 font-medium transition ${
                      sellMode === 'flea'
                        ? 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-200 dark:bg-zinc-100 dark:text-zinc-900'
                        : 'border-zinc-200 bg-zinc-50 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300'
                    }`}
                  >
                    フリマ手取り: {yen(tradeInEst.fleaYen)}
                  </button>
                  <button
                    type="button"
                    onClick={() => setSellMode('shop')}
                    className={`rounded-md border px-2 py-0.5 font-medium transition ${
                      sellMode === 'shop'
                        ? 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-200 dark:bg-zinc-100 dark:text-zinc-900'
                        : 'border-zinc-200 bg-zinc-50 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300'
                    }`}
                  >
                    ショップ買取: {yen(tradeInEst.shopYen)}
                  </button>
                  <button
                    type="button"
                    onClick={() => setSellMode('tradein')}
                    className={`rounded-md border px-2 py-0.5 font-medium transition ${
                      sellMode === 'tradein'
                        ? 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-200 dark:bg-zinc-100 dark:text-zinc-900'
                        : 'border-zinc-200 bg-zinc-50 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300'
                    }`}
                  >
                    Apple下取り: {yen(tradeInEst.tradeinYen)}
                  </button>
                </div>
              </div>
              <div className="text-xs font-bold tabular-nums text-zinc-900 dark:text-zinc-100">
                適用中の下取り差引: −{yen(tradeInEst.activeYen)}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * 各機種の「買い替え実質追い金」＋「スペック進化ポイント」表示（フラット・モノトーン）
 */
function TradeInCardOverlay({
  tradeInEst,
  targetProduct,
  targetSku,
  appleNewPrice,
  lowestUsedPrice,
  bestReturnCost,
  compact,
  inTable,
}: {
  tradeInEst: TradeInEstimate;
  targetProduct: Product;
  targetSku: Sku;
  appleNewPrice: number | null;
  lowestUsedPrice: number;
  bestReturnCost?: number | null;
  compact?: boolean;
  inTable?: boolean;
}) {
  const sellYen = tradeInEst.activeYen;
  const netNew = appleNewPrice != null ? appleNewPrice - sellYen : null;
  const netUsed = lowestUsedPrice - sellYen;
  const netReturn = bestReturnCost != null ? bestReturnCost - sellYen : null;
  const diffBadges = useMemo(
    () =>
      computeUpgradeDiffBadges(
        tradeInEst.myProduct,
        tradeInEst.mySku,
        targetProduct,
        targetSku,
      ),
    [tradeInEst.myProduct, tradeInEst.mySku, targetProduct, targetSku],
  );

  return (
    <div
      className={
        inTable
          ? `rounded-lg bg-zinc-50/70 ${compact ? 'p-2' : 'p-2.5'} dark:bg-zinc-800/40`
          : 'border-t border-zinc-200/80 pt-2.5 dark:border-zinc-800/60'
      }
    >
      <div className="flex items-center justify-between gap-1.5 text-[11px] font-semibold text-zinc-500 dark:text-zinc-400">
        <span>
          🔄 {tradeInEst.myProduct.name} (−{yen(sellYen)}) 下取り時の実質追い金
        </span>
      </div>

      <div className="mt-1.5 space-y-1 text-xs tabular-nums">
        {netNew != null && appleNewPrice != null && (
          <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
            <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
              新品（{yen(appleNewPrice)}）へ:
            </span>
            {netNew <= 0 ? (
              <span className="font-bold text-emerald-600 dark:text-emerald-400">
                追い金 0円（+{yen(Math.abs(netNew))} プラス）
              </span>
            ) : (
              <span className="font-bold text-zinc-900 dark:text-zinc-100">
                実質追い金 {yen(netNew)}
              </span>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
          <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
            中古最安（{yen(lowestUsedPrice)}）へ:
          </span>
          {netUsed <= 0 ? (
            <span className="font-bold text-emerald-600 dark:text-emerald-400">
              追い金 0円（+{yen(Math.abs(netUsed))} プラス）
            </span>
          ) : (
            <span className="font-bold text-zinc-900 dark:text-zinc-100">
              実質追い金 {yen(netUsed)}
            </span>
          )}
        </div>

        {netReturn != null && bestReturnCost != null && (
          <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5 text-[11px]">
            <span className="text-zinc-500 dark:text-zinc-400">
              2年返却（実質{yen(bestReturnCost)}）:
            </span>
            {netReturn <= 0 ? (
              <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                追い金 0円（+{yen(Math.abs(netReturn))}）
              </span>
            ) : (
              <span className="font-semibold text-zinc-700 dark:text-zinc-300">
                実質追い金 {yen(netReturn)}
              </span>
            )}
          </div>
        )}
      </div>

      {diffBadges.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1 pt-1">
          {diffBadges.map((b) => (
            <span
              key={b.key}
              className="inline-flex items-center rounded border border-zinc-200/80 bg-zinc-100/80 px-1.5 py-0.5 text-[10px] font-medium text-zinc-700 dark:border-zinc-700/70 dark:bg-zinc-800/80 dark:text-zinc-300"
            >
              {b.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- 💡 この比較の結論・おすすめ購入ルート診断パネル（コンパクト4列サマリーバー） ---------- */
function CompareDiagnosticPanel({
  cols,
  mode,
  mnp,
  setMode,
  getUsedData,
  onOpenBudgetTab,
}: {
  cols: { sel: Sel; p: Product; sku: Sku }[];
  mode: Mode;
  mnp: boolean;
  setMode: (m: Mode) => void;
  getUsedData: (c: { sel: Sel; p: Product; sku: Sku }) => UsedMarketData;
  onOpenBudgetTab?: () => void;
}) {
  const [open, setOpen] = useState(true);

  const enriched = useMemo(() => {
    return cols.map((c) => {
      const usedInfo = getUsedData(c);
      const up = usedInfo.usedPricing;
      const lowestUsed = up.lowestPrice;
      const isYahooLowest = up.lowestPlatform === 'yahoo';
      const bestUsedOffer = isYahooLowest ? up.yahoo ?? up.rakuten : up.rakuten ?? up.yahoo;
      const unusedOffer = usedInfo.unused;
      const appleCur =
        c.sku.carriers.apple?.currentPrice ??
        (c.sku.priceHistory.length ? lastOf(c.sku.priceHistory).appleStorePrice : null);
      const appleLaunch =
        c.sku.carriers.apple?.launchPrice ??
        (c.sku.priceHistory.length ? c.sku.priceHistory[0].appleStorePrice : null);
      const score = computePerformanceScore(c.p, c.sku);
      const annualUsedCost = Math.round(lowestUsed / score.remainingSupportYears);
      const resalePct =
        up.resaleValuePercent ??
        (appleLaunch && appleLaunch > 0
          ? Math.round((lowestUsed / appleLaunch) * 100)
          : appleCur && appleCur > 0
            ? Math.round((lowestUsed / appleCur) * 100)
            : null);

      const carrierReturns = (['docomo', 'au', 'softbank', 'rakuten'] as CarrierId[])
        .map((cid) => {
          const cp = c.sku.carriers[cid];
          if (!cp?.returnProgram) return null;
          const eff = carrierValue(cp, 'return', mnp) ?? cp.returnProgram.effectiveCost;
          return { cid, effectiveCost: eff, programName: cp.returnProgram.name };
        })
        .filter((x): x is { cid: CarrierId; effectiveCost: number; programName: string } => x !== null)
        .sort((a, b) => a.effectiveCost - b.effectiveCost);

      const discInfo = getSkuDiscontinuedInfo(c.p, c.sku);
      const isDisc = discInfo.isDiscontinued;

      return {
        ...c,
        isDisc,
        discDate: discInfo.discontinuedDate,
        usedInfo,
        lowestUsed,
        isYahooLowest,
        bestUsedOffer,
        unusedOffer,
        appleCur,
        appleLaunch,
        score,
        annualUsedCost,
        resalePct,
        bestCarrierReturn: carrierReturns[0] ?? null,
        allCarrierReturns: carrierReturns,
      };
    });
  }, [cols, getUsedData, mnp]);

  if (!enriched.length) return null;

  // 1. 中古コスパ最適（初期費用×残り寿命バランス）
  const usedCandidates = enriched.filter((x) => x.score.remainingSupportYears >= 2);
  const bestUsedValue = [...(usedCandidates.length ? usedCandidates : enriched)].sort(
    (a, b) => a.annualUsedCost - b.annualUsedCost || b.score.total - a.score.total,
  )[0];

  // 2. キャリア2年返却（実質負担）最安ルート (現在新品販売中のモデルを優先)
  const returnCandidates = enriched
    .filter((x) => x.bestCarrierReturn != null)
    .sort(
      (a, b) =>
        Number(a.isDisc) - Number(b.isDisc) ||
        a.bestCarrierReturn!.effectiveCost - b.bestCarrierReturn!.effectiveCost ||
        b.score.total - a.score.total,
    );
  const bestReturnRoute = returnCandidates[0] ?? null;

  // 3. リセールバリュー（資産価値）No.1
  const resaleCandidates = enriched
    .filter((x) => x.resalePct != null)
    .sort((a, b) => (b.resalePct ?? 0) - (a.resalePct ?? 0) || b.score.total - a.score.total);
  const bestResaleModel = resaleCandidates[0] ?? enriched[0];

  // 4. 価格逆転・要注意アラート（短文サマリー）
  const alerts: {
    label: string;
    modelText: string;
    detailText: string;
    linkUrl?: string;
    isWarning?: boolean;
  }[] = [];

  for (let i = 0; i < enriched.length; i++) {
    for (let j = 0; j < enriched.length; j++) {
      if (i === j) continue;
      const older = enriched[i];
      const newer = enriched[j];
      const isNewerHigher =
        newer.score.total > older.score.total &&
        (newer.p.releaseDate >= older.p.releaseDate || newer.score.socScore > older.score.socScore);
      if (!isNewerHigher || older.appleCur == null) continue;
      const olderPriceKind = older.isDisc ? '終売定価' : '新品定価';
      const newerUnusedPrice = newer.unusedOffer?.price;
      const newerUsedPrice = newer.lowestUsed;
      if (newerUnusedPrice != null && newerUnusedPrice < older.appleCur) {
        alerts.push({
          label: '価格逆転注目',
          modelText: `${newer.p.name} (${newer.sku.label})`,
          detailText: `未使用 ${yen(newerUnusedPrice)}（${older.p.name}${olderPriceKind} ${yen(older.appleCur)}より安）`,
          linkUrl: newer.unusedOffer?.itemUrl ?? newer.bestUsedOffer?.url,
          isWarning: true,
        });
      } else if (newerUsedPrice < older.appleCur - 10000) {
        alerts.push({
          label: '価格逆転注目',
          modelText: `${newer.p.name} (${newer.sku.label})`,
          detailText: `中古 ${yen(newerUsedPrice)}（${older.p.name}${olderPriceKind}より${yen(older.appleCur - newerUsedPrice)}安）`,
          linkUrl: newer.bestUsedOffer?.url,
          isWarning: true,
        });
      }
    }
  }

  for (const item of enriched) {
    if (item.unusedOffer && item.unusedOffer.price <= item.lowestUsed) {
      alerts.push({
        label: '未使用逆転',
        modelText: `${item.p.name} (${item.sku.label})`,
        detailText: `未使用 ${yen(item.unusedOffer.price)} ≦ 中古 ${yen(item.lowestUsed)}（未使用品が得）`,
        linkUrl: item.unusedOffer.itemUrl,
        isWarning: true,
      });
    }
  }

  for (const item of enriched) {
    if (item.appleCur != null && !item.isDisc) {
      const gap = item.appleCur - item.lowestUsed;
      if (gap >= 0 && gap < 15000) {
        alerts.push({
          label: '新品推奨',
          modelText: `${item.p.name} (${item.sku.label})`,
          detailText: `新品と中古の差が ${yen(gap)} のためApple直販新品が有利`,
          linkUrl: appleStoreUrlForCategory(item.p.category),
          isWarning: false,
        });
      }
    }
  }

  const primaryAlert = alerts[0] ?? {
    label: enriched.length === 1 ? '単体購入診断' : '価格バランス',
    modelText: `${bestUsedValue.p.name} (${bestUsedValue.sku.label})`,
    detailText:
      enriched.length === 1
        ? `中古最安 ${yen(bestUsedValue.lowestUsed)}（年あたり ${yen(bestUsedValue.annualUsedCost)}）が好バランス`
        : `世代間の不自然な価格逆転なし（長期所有は${bestUsedValue.p.name}中古が最適）`,
    linkUrl: bestUsedValue.bestUsedOffer?.url,
    isWarning: false,
  };

  return (
    <div className={`${card} px-3.5 py-2.5 sm:px-4 sm:py-3`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-zinc-100 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
            💡
          </span>
          <h3 className="text-xs sm:text-sm font-bold text-zinc-900 dark:text-zinc-100">
            この比較の結論・おすすめ購入ルート診断
          </h3>
          <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
            {enriched.length}機種分析
          </span>
        </div>

        <div data-export-ignore="true" className="flex items-center gap-1.5 ml-auto">
          {onOpenBudgetTab && (
            <button
              type="button"
              onClick={onOpenBudgetTab}
              className={secondaryActionBtnCls}
            >
              <span>予算から最高スペックを探す ↗</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => setOpen(!open)}
            className={secondaryActionBtnCls}
          >
            <span>{open ? '折りたたむ ▴' : '展開 ▾'}</span>
          </button>
        </div>
      </div>

      {open && (
        <div className="mt-2.5 grid grid-cols-1 divide-y divide-zinc-200/80 border-t border-zinc-200/80 pt-2.5 text-xs sm:grid-cols-2 sm:divide-y-0 sm:gap-y-2.5 lg:grid-cols-4 lg:gap-y-0 lg:divide-x dark:divide-zinc-800/70 dark:border-zinc-800/70">
          {/* 1. 中古コスパ最適 */}
          <div className="py-1.5 sm:py-0 sm:pr-3">
            <div className="flex items-center justify-between gap-1.5">
              <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-zinc-500 dark:text-zinc-400">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                中古コスパ最適
              </span>
              {bestUsedValue.bestUsedOffer && (
                <a
                  data-export-ignore="true"
                  href={bestUsedValue.bestUsedOffer.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-0.5 text-[11px] font-medium text-zinc-500 hover:text-zinc-900 hover:underline dark:text-zinc-400 dark:hover:text-zinc-100"
                >
                  <span>{bestUsedValue.usedInfo.isEstimated ? '在庫検索' : 'ショップ'}</span>
                  <ExternalLink className="h-2.5 w-2.5" />
                </a>
              )}
            </div>
            <div className="mt-1 leading-snug text-zinc-700 dark:text-zinc-300">
              <strong className="font-bold text-zinc-900 dark:text-zinc-100">
                {bestUsedValue.p.name} ({bestUsedValue.sku.label})
              </strong>{' '}
              — {bestUsedValue.usedInfo.isEstimated ? '参考推定 約' : '最安 '}
              <strong className="font-bold tabular-nums text-zinc-900 dark:text-zinc-100">
                {yen(bestUsedValue.lowestUsed)}
              </strong>{' '}
              <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
                （年あたり {yen(bestUsedValue.annualUsedCost)} / 残{bestUsedValue.score.remainingSupportYears}年）
              </span>
            </div>
          </div>

          {/* 2. 2年返却最安 */}
          <div className="py-1.5 sm:py-0 sm:pl-3 lg:px-3">
            <div className="flex items-center justify-between gap-1.5">
              <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-zinc-500 dark:text-zinc-400">
                <span className="h-1.5 w-1.5 rounded-full bg-sky-500" />
                2年返却最安
              </span>
              {bestReturnRoute?.bestCarrierReturn && (
                <div data-export-ignore="true" className="flex items-center gap-2">
                  {mode !== 'return' && (
                    <button
                      type="button"
                      onClick={() => setMode('return')}
                      className="text-[10px] font-medium text-zinc-500 underline hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                    >
                      返却表示へ
                    </button>
                  )}
                  <a
                    href={CARRIER_STORE_URLS[bestReturnRoute.bestCarrierReturn.cid]}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-0.5 text-[11px] font-medium text-zinc-500 hover:text-zinc-900 hover:underline dark:text-zinc-400 dark:hover:text-zinc-100"
                  >
                    <span>詳細</span>
                    <ExternalLink className="h-2.5 w-2.5" />
                  </a>
                </div>
              )}
            </div>
            <div className="mt-1 leading-snug text-zinc-700 dark:text-zinc-300">
              {bestReturnRoute?.bestCarrierReturn ? (
                <>
                  <strong className="font-bold text-zinc-900 dark:text-zinc-100">
                    {bestReturnRoute.p.name} ({bestReturnRoute.sku.label})
                  </strong>{' '}
                  — {CARRIER_META[bestReturnRoute.bestCarrierReturn.cid].label} 実質{' '}
                  <strong className="font-bold tabular-nums text-zinc-900 dark:text-zinc-100">
                    {yen(bestReturnRoute.bestCarrierReturn.effectiveCost)}
                  </strong>{' '}
                  <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
                    （月約{yen(Math.round(bestReturnRoute.bestCarrierReturn.effectiveCost / 24))}）
                  </span>
                </>
              ) : (
                <span className="text-zinc-500">対象プログラムなし（直販・中古推奨）</span>
              )}
            </div>
          </div>

          {/* 3. リセールNo.1 */}
          <div className="py-1.5 sm:py-0 sm:pr-3 lg:px-3">
            <div className="flex items-center justify-between gap-1.5">
              <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-zinc-500 dark:text-zinc-400">
                <span className="h-1.5 w-1.5 rounded-full bg-violet-500" />
                リセールNo.1
              </span>
              <a
                data-export-ignore="true"
                href={appleStoreUrlForCategory(bestResaleModel.p.category)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-0.5 text-[11px] font-medium text-zinc-500 hover:text-zinc-900 hover:underline dark:text-zinc-400 dark:hover:text-zinc-100"
              >
                <span>公式</span>
                <ExternalLink className="h-2.5 w-2.5" />
              </a>
            </div>
            <div className="mt-1 leading-snug text-zinc-700 dark:text-zinc-300">
              <strong className="font-bold text-zinc-900 dark:text-zinc-100">
                {bestResaleModel.p.name} ({bestResaleModel.sku.label})
              </strong>{' '}
              — 残価率{' '}
              <strong className="font-bold tabular-nums text-zinc-900 dark:text-zinc-100">
                {bestResaleModel.resalePct ?? '—'}%
              </strong>{' '}
              <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
                （中古相場 {yen(bestResaleModel.lowestUsed)}）
              </span>
            </div>
          </div>

          {/* 4. 価格逆転注目 / 価格バランス */}
          <div className="py-1.5 sm:py-0 sm:pl-3">
            <div className="flex items-center justify-between gap-1.5">
              <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-zinc-500 dark:text-zinc-400">
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    primaryAlert.isWarning ? 'bg-amber-500' : 'bg-zinc-400'
                  }`}
                />
                {primaryAlert.label}
              </span>
              {primaryAlert.linkUrl && (
                <a
                  data-export-ignore="true"
                  href={primaryAlert.linkUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-0.5 text-[11px] font-medium text-zinc-500 hover:text-zinc-900 hover:underline dark:text-zinc-400 dark:hover:text-zinc-100"
                >
                  <span>詳細</span>
                  <ExternalLink className="h-2.5 w-2.5" />
                </a>
              )}
            </div>
            <div className="mt-1 leading-snug text-zinc-700 dark:text-zinc-300">
              <strong className="font-bold text-zinc-900 dark:text-zinc-100">
                {primaryAlert.modelText}
              </strong>{' '}
              — {primaryAlert.detailText}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* =====================================================================================
 * 5. タブ1: スペック＆キャリア価格 横並び比較
 * ===================================================================================== */

export type ImageExportScope = 'all' | 'cards' | 'table';

const IMAGE_EXPORT_SCOPE_LABELS: Record<ImageExportScope, string> = {
  all: 'カード＋テーブル全体',
  cards: 'サマリーカードのみ',
  table: '比較テーブルのみ',
};

/**
 * 比較中の機種名スラッグから分かりやすいPNG保存ファイル名を生成
 * 例: apple-compare-iphone-14-vs-15-vs-16.png
 */
function buildCompareImageFilename(
  cols: { p: Product; sku: Sku }[],
  scope: ImageExportScope,
): string {
  if (!cols.length) return 'apple-compare.png';
  const rawSlugs = cols.map((c) =>
    c.p.id
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, ''),
  );
  const commonPrefixes = ['iphone-', 'ipad-', 'macbook-', 'apple-watch-', 'mac-'];
  const matchedPrefix = commonPrefixes.find(
    (pref) => rawSlugs.length > 1 && rawSlugs.every((s) => s.startsWith(pref) && s.length > pref.length),
  );
  const compactSlugs = rawSlugs.map((s, idx) =>
    idx > 0 && matchedPrefix ? s.slice(matchedPrefix.length) : s,
  );
  const joined = compactSlugs.slice(0, 5).join('-vs-');
  const suffix = scope === 'cards' ? '-cards' : scope === 'table' ? '-table' : '';
  return `apple-compare-${joined}${suffix}.png`;
}

function formatCurrentYearMonthLabel(): string {
  const now = new Date();
  return `${now.getFullYear()}年${now.getMonth() + 1}月時点`;
}

type ShopModalConditionFilter = 'all' | 'unused' | 'rankA_plus' | 'trusted';
type ShopModalMallFilter = 'all' | 'rakuten' | 'yahoo';
type ShopModalSortOrder = 'price_asc' | 'condition_desc';

const CONDITION_RANK_META: Record<
  UsedConditionRank,
  { label: string; shortLabel: string; dotCls: string; qualityOrder: number }
> = {
  unused: { label: '✨ 未使用品', shortLabel: '未使用品', dotCls: 'bg-emerald-500', qualityOrder: 5 },
  rankA: { label: 'Aランク（美品）', shortLabel: 'Aランク', dotCls: 'bg-sky-500', qualityOrder: 4 },
  rankB: { label: 'Bランク（良品）', shortLabel: 'Bランク', dotCls: 'bg-zinc-400', qualityOrder: 3 },
  used: { label: '中古品', shortLabel: '中古', dotCls: 'bg-zinc-400', qualityOrder: 2 },
  rankC: { label: 'Cランク', shortLabel: 'Cランク', dotCls: 'bg-amber-500', qualityOrder: 1 },
};

/**
 * 🏪 中古ショップ価格比較モーダル（ポップアップ画面）
 * 選択した機種・容量の楽天市場＆Yahoo!ショッピングの中古・未使用品出品リスト（最大15件）を
 * 状態ランク・モール・価格順で一覧比較できるモノトーンUIモーダル
 */
function UsedShopOffersModal({
  product,
  sku,
  usedInfo,
  isLoadingLive,
  onRefreshLive,
  onClose,
}: {
  product: Product;
  sku: Sku;
  usedInfo: UsedMarketData;
  isLoadingLive: boolean;
  onRefreshLive: () => void;
  onClose: () => void;
}) {
  const [condFilter, setCondFilter] = useState<ShopModalConditionFilter>('all');
  const [mallFilter, setMallFilter] = useState<ShopModalMallFilter>('all');
  const [sortOrder, setSortOrder] = useState<ShopModalSortOrder>('price_asc');

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const allOffers: UsedShopOffer[] = useMemo(() => {
    const raw = usedInfo.usedPricing.offers ?? usedInfo.offers ?? [];
    return [...raw].sort((a, b) => a.price - b.price);
  }, [usedInfo]);

  const discInfo = useMemo(() => getSkuDiscontinuedInfo(product, sku), [product, sku]);
  const refApplePrice = useMemo(() => {
    return (
      sku.carriers.apple?.currentPrice ??
      (sku.priceHistory.length ? lastOf(sku.priceHistory).appleStorePrice : usedInfo.launchPrice)
    );
  }, [sku, usedInfo.launchPrice]);

  const overallLowestPrice = allOffers.length > 0 ? allOffers[0].price : usedInfo.usedPricing.lowestPrice;
  const maxSavingsVsNew =
    refApplePrice != null && overallLowestPrice > 0 ? refApplePrice - overallLowestPrice : null;

  const filteredOffers = useMemo(() => {
    const filtered = allOffers.filter((offer) => {
      if (mallFilter !== 'all' && offer.platform !== mallFilter) return false;
      if (condFilter === 'unused' && offer.conditionRank !== 'unused') return false;
      if (
        condFilter === 'rankA_plus' &&
        offer.conditionRank !== 'unused' &&
        offer.conditionRank !== 'rankA'
      ) {
        return false;
      }
      if (condFilter === 'trusted' && !offer.isTrusted) return false;
      return true;
    });

    if (sortOrder === 'condition_desc') {
      return [...filtered].sort((a, b) => {
        const qa = CONDITION_RANK_META[a.conditionRank]?.qualityOrder ?? 2;
        const qb = CONDITION_RANK_META[b.conditionRank]?.qualityOrder ?? 2;
        if (qb !== qa) return qb - qa;
        return a.price - b.price;
      });
    }
    return [...filtered].sort((a, b) => a.price - b.price);
  }, [allOffers, condFilter, mallFilter, sortOrder]);

  const topFilteredPrice = filteredOffers.length > 0 ? Math.min(...filteredOffers.map((o) => o.price)) : overallLowestPrice;

  const condFilterOptions: { value: ShopModalConditionFilter; label: string; count: number }[] = [
    { value: 'all', label: 'すべて', count: allOffers.length },
    {
      value: 'unused',
      label: '✨ 未使用品のみ',
      count: allOffers.filter((o) => o.conditionRank === 'unused').length,
    },
    {
      value: 'rankA_plus',
      label: '🅰️ 美品(Aランク)以上',
      count: allOffers.filter((o) => o.conditionRank === 'unused' || o.conditionRank === 'rankA').length,
    },
    {
      value: 'trusted',
      label: '✅ 大手ショップのみ',
      count: allOffers.filter((o) => o.isTrusted).length,
    },
  ];

  const mallFilterOptions: { value: ShopModalMallFilter; label: string; dotCls?: string }[] = [
    { value: 'all', label: 'すべて' },
    { value: 'rakuten', label: '楽天市場', dotCls: 'bg-rose-500' },
    { value: 'yahoo', label: 'Yahoo!ショッピング', dotCls: 'bg-amber-500' },
  ];

  return (
    <div
      data-export-ignore="true"
      role="dialog"
      aria-modal="true"
      aria-label={`${product.name} (${sku.label}) の中古・未使用品 ショップ比較`}
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-2.5 sm:p-4 backdrop-blur-xs"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white text-zinc-900 shadow-2xl dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
      >
        {/* 1. モーダルヘッダー */}
        <div className="flex items-start justify-between gap-3 border-b border-zinc-200 px-4 py-3.5 sm:px-5 sm:py-4 dark:border-zinc-800">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 text-base sm:text-lg font-extrabold tracking-tight text-zinc-900 dark:text-zinc-50">
                <span aria-hidden="true">🏪</span>
                <span>
                  {product.name} ({sku.label}) の中古・未使用品 ショップ比較
                </span>
              </span>
              {maxSavingsVsNew != null && maxSavingsVsNew > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-zinc-100 px-2.5 py-0.5 text-xs font-bold tabular-nums text-zinc-800 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  {discInfo.isDiscontinued ? '終売最終定価比' : '定価比'} 最大 −{yen(maxSavingsVsNew)} お得
                </span>
              )}
              {usedInfo.source === 'mock' && (
                <span className="rounded-md bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                  相場推定リスト
                </span>
              )}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400 tabular-nums">
              <span>
                横断最安: <strong className="font-bold text-zinc-900 dark:text-zinc-100">{yen(overallLowestPrice)}</strong>
              </span>
              {refApplePrice != null && (
                <span>
                  {discInfo.isDiscontinued ? '終売時Apple直販価格' : 'Apple Store新品定価'}:{' '}
                  <strong className="font-semibold text-zinc-700 dark:text-zinc-300">{yen(refApplePrice)}</strong>
                </span>
              )}
              {usedInfo.usedPricing.resaleValuePercent != null && (
                <span>
                  リセール残価率: <strong className="font-semibold text-zinc-700 dark:text-zinc-300">{usedInfo.usedPricing.resaleValuePercent}%</strong>
                </span>
              )}
              {isLoadingLive ? (
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-zinc-600 dark:text-zinc-300">
                  ⏳ 楽天・Yahoo!の最新出品リストを取得中...
                </span>
              ) : (
                <button
                  type="button"
                  onClick={onRefreshLive}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-zinc-500 underline underline-offset-2 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                >
                  🔄 最新在庫を再取得
                </button>
              )}
            </div>
          </div>
          <button
            type="button"
            aria-label="モーダルを閉じる"
            onClick={onClose}
            className="shrink-0 rounded-xl border border-zinc-200 p-1.5 text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 dark:border-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* 2. クイック絞り込み＆並び替えバー */}
        <div className="space-y-2 border-b border-zinc-200/80 bg-zinc-50/80 px-4 py-3 text-xs sm:px-5 dark:border-zinc-800 dark:bg-zinc-800/40">
          {/* 上段: 状態フィルタ */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-[11px] font-semibold text-zinc-500 dark:text-zinc-400">状態・店舗:</span>
            {condFilterOptions.map((opt) => {
              const active = condFilter === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setCondFilter(opt.value)}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition ${
                    active
                      ? 'border-zinc-900 bg-zinc-900 text-white shadow-xs dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900'
                      : 'border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300 hover:bg-zinc-100 hover:text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800'
                  }`}
                >
                  <span>{opt.label}</span>
                  <span
                    className={`rounded-full px-1.5 py-0.2 text-[10px] tabular-nums ${
                      active
                        ? 'bg-white/20 text-current dark:bg-zinc-900/20'
                        : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400'
                    }`}
                  >
                    {opt.count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* 下段: モールフィルタ ＋ 並び替え */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-[11px] font-semibold text-zinc-500 dark:text-zinc-400">モール:</span>
              {mallFilterOptions.map((opt) => {
                const active = mallFilter === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setMallFilter(opt.value)}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition ${
                      active
                        ? 'border-zinc-900 bg-zinc-900 text-white shadow-xs dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900'
                        : 'border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300 hover:bg-zinc-100 hover:text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800'
                    }`}
                  >
                    {opt.dotCls && <span className={`h-1.5 w-1.5 rounded-full ${opt.dotCls}`} />}
                    <span>{opt.label}</span>
                  </button>
                );
              })}
            </div>

            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400">並び替え:</span>
              <div
                role="group"
                aria-label="出品リストの並び替え"
                className="inline-flex rounded-lg bg-zinc-200/80 p-0.5 text-xs font-medium dark:bg-zinc-800"
              >
                <button
                  type="button"
                  onClick={() => setSortOrder('price_asc')}
                  className={`rounded-md px-2.5 py-1 transition ${
                    sortOrder === 'price_asc'
                      ? 'bg-white font-semibold text-zinc-900 shadow-xs dark:bg-zinc-700 dark:text-zinc-100'
                      : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200'
                  }`}
                >
                  価格が安い順
                </button>
                <button
                  type="button"
                  onClick={() => setSortOrder('condition_desc')}
                  className={`rounded-md px-2.5 py-1 transition ${
                    sortOrder === 'condition_desc'
                      ? 'bg-white font-semibold text-zinc-900 shadow-xs dark:bg-zinc-700 dark:text-zinc-100'
                      : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200'
                  }`}
                >
                  状態が良い順
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* 3. ショップ別ランキングリスト（1行1出品のすっきりしたリスト） */}
        <div className="flex-1 divide-y divide-zinc-100 overflow-y-auto px-4 py-2 sm:px-5 dark:divide-zinc-800/80">
          {allOffers.length === 0 ? (
            <div className="py-10 text-center text-xs sm:text-sm text-zinc-600 dark:text-zinc-300 space-y-3">
              <div className="font-bold text-zinc-900 dark:text-zinc-100">
                📊 参考推定相場: 約{yen(overallLowestPrice)}（実在庫データ未取得）
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                現在この機種のリアルタイム出品リストは未取得です。各モールの検索ページで実際の在庫・価格をご確認ください。
              </p>
              <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                <a
                  href={usedInfo.rakutenSearchUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs font-medium text-zinc-700 transition hover:bg-zinc-100 hover:text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
                >
                  <span>楽天市場で実際の在庫を検索</span>
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
                <a
                  href={usedInfo.yahooSearchUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs font-medium text-zinc-700 transition hover:bg-zinc-100 hover:text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
                >
                  <span>Yahoo!で実際の在庫を検索</span>
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>
            </div>
          ) : filteredOffers.length === 0 ? (
            <div className="py-12 text-center text-sm text-zinc-500 dark:text-zinc-400">
              <p>選択した絞り込み条件に一致する出品がありません。</p>
              <button
                type="button"
                onClick={() => {
                  setCondFilter('all');
                  setMallFilter('all');
                }}
                className="mt-2 font-semibold text-zinc-800 underline underline-offset-2 hover:text-zinc-950 dark:text-zinc-200 dark:hover:text-white"
              >
                フィルタをリセットして全{allOffers.length}件を表示
              </button>
            </div>
          ) : (
            filteredOffers.map((offer, idx) => {
              const rank = idx + 1;
              const isFirst = rank === 1 && sortOrder === 'price_asc';
              const condMeta = CONDITION_RANK_META[offer.conditionRank] ?? CONDITION_RANK_META.used;
              const diffFromTop = offer.price - topFilteredPrice;
              const diffFromApple = refApplePrice != null ? offer.price - refApplePrice : null;

              return (
                <div
                  key={`${offer.platform}-${offer.price}-${offer.shopName}-${idx}`}
                  className={`flex flex-col gap-2.5 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4 ${
                    isFirst ? 'bg-zinc-50/70 -mx-2 px-2 rounded-xl dark:bg-zinc-800/30' : ''
                  }`}
                >
                  {/* 左〜中央: 順位バッジ ＋ モール・ショップ名 ＋ 状態バッジ＆商品タイトル */}
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {/* 順位バッジ */}
                      <span
                        className={`inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-bold tabular-nums ${
                          rank === 1
                            ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                            : rank <= 3
                              ? 'bg-zinc-200/90 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200'
                              : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800/60 dark:text-zinc-400'
                        }`}
                      >
                        {rank === 1 && <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 dark:bg-emerald-500" />}
                        <span>{rank === 1 ? '1位 (最安)' : `${rank}位`}</span>
                      </span>

                      {/* モールバッジ ([楽天] or [Yahoo!]) */}
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-zinc-200/80 bg-zinc-100/80 px-1.5 py-0.5 text-[11px] font-semibold text-zinc-700 dark:border-zinc-700/80 dark:bg-zinc-800 dark:text-zinc-300">
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${
                            offer.platform === 'yahoo' ? 'bg-amber-500' : 'bg-rose-500'
                          }`}
                        />
                        <span>{offer.platform === 'yahoo' ? 'Yahoo!' : '楽天'}</span>
                      </span>

                      {/* ショップ名 */}
                      <span className="truncate text-xs sm:text-sm font-bold text-zinc-900 dark:text-zinc-100">
                        {offer.shopName}
                      </span>

                      {/* 大手認定バッジ */}
                      {offer.isTrusted && (
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                          <span>✓ 大手認定</span>
                        </span>
                      )}
                    </div>

                    {/* 状態・特徴バッジ ＋ 商品タイトル（1行省略＋ホバー全文） */}
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-zinc-200/80 bg-white px-2 py-0.5 text-[10px] font-semibold text-zinc-700 dark:border-zinc-700/80 dark:bg-zinc-800/90 dark:text-zinc-200">
                        <span className={`h-1.5 w-1.5 rounded-full ${condMeta.dotCls}`} />
                        <span>{condMeta.label}</span>
                      </span>
                      {offer.simFree && (
                        <span className="inline-flex shrink-0 items-center rounded-md bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                          SIMフリー
                        </span>
                      )}
                      <span
                        className="min-w-0 truncate text-xs text-zinc-500 dark:text-zinc-400"
                        title={offer.title}
                      >
                        {offer.title}
                      </span>
                    </div>
                  </div>

                  {/* 右側: 価格＆差額 ＋ 購入リンクボタン */}
                  <div className="flex items-center justify-between gap-3 sm:shrink-0 sm:justify-end">
                    <div className="text-left sm:text-right tabular-nums">
                      <div className="text-base sm:text-lg font-extrabold text-zinc-900 dark:text-zinc-50">
                        {yen(offer.price)}
                      </div>
                      <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                        {diffFromTop === 0 ? (
                          diffFromApple != null && diffFromApple < 0 ? (
                            <span>（最安 / 定価比 {signedYen(diffFromApple)}）</span>
                          ) : (
                            <span>（第1位・最安基準）</span>
                          )
                        ) : (
                          <span>（第1位との差 +{yen(diffFromTop)}）</span>
                        )}
                      </div>
                    </div>

                    <a
                      href={offer.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex shrink-0 items-center gap-1 rounded-xl border border-zinc-300 bg-zinc-900 px-3 py-2 text-xs font-semibold text-white transition hover:bg-zinc-700 dark:border-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                    >
                      <span>ショップで見る</span>
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* 4. モーダルフッター */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-200 bg-zinc-50/70 px-4 py-2.5 text-[11px] text-zinc-500 sm:px-5 dark:border-zinc-800 dark:bg-zinc-900/80 dark:text-zinc-400">
          <span>
            ※厳密タイトル検証によりケース・フィルム・ジャンク品・別容量・別モデル（Pro/Max/mini等）を自動除外しています。在庫・価格は各ショップページでご確認ください。
          </span>
          <span className="font-medium tabular-nums">
            表示中: {filteredOffers.length}件 / 全{allOffers.length}件
          </span>
        </div>
      </div>
    </div>
  );
}

function CompareView({
  products,
  all,
  sels,
  setSels,
  mode,
  setMode,
  mnp,
  setMnp,
  mySel,
  setMySel,
  sellMode,
  setSellMode,
  sellCustom,
  setSellCustom,
  showFlags,
  setShowFlags,
  diffOnly,
  setDiffOnly,
  specExpanded,
  setSpecExpanded,
  toast,
  onOpenBudgetTab,
}: {
  products: Product[];
  all: Product[];
  sels: Sel[];
  setSels: (s: Sel[]) => void;
  mode: Mode;
  setMode: (m: Mode) => void;
  mnp: boolean;
  setMnp: (b: boolean) => void;
  mySel: Sel | null;
  setMySel: (s: Sel | null) => void;
  sellMode: SellMode;
  setSellMode: (m: SellMode) => void;
  sellCustom: number;
  setSellCustom: (n: number) => void;
  showFlags: CompareShowFlags;
  setShowFlags: React.Dispatch<React.SetStateAction<CompareShowFlags>>;
  diffOnly: boolean;
  setDiffOnly: React.Dispatch<React.SetStateAction<boolean>>;
  specExpanded: boolean;
  setSpecExpanded: React.Dispatch<React.SetStateAction<boolean>>;
  toast: (m: string) => void;
  onOpenBudgetTab?: () => void;
}) {
  const dark = useDark();
  const cols = sels.filter((s) => all.some((x) => x.id === s.pid)).map((s) => { const p = all.find((x) => x.id === s.pid)!; return { sel: s, p, sku: p.skus.find((k) => k.id === s.sid) ?? p.skus[0] }; });
  const myProduct = useMemo(() => (mySel ? all.find((x) => x.id === mySel.pid) ?? null : null), [all, mySel]);
  const mySku = useMemo(
    () => (myProduct ? myProduct.skus.find((k) => k.id === mySel?.sid) ?? myProduct.skus[0] ?? null : null),
    [myProduct, mySel],
  );
  const [adding, setAdding] = useState('');
  const [q, setQ] = useState('');
  const [catF, setCatF] = useState('');
  const [mobileView, setMobileView] = useState<'stack' | 'table'>('stack');
  const [discontinuedHeroMode, setDiscontinuedHeroMode] = useState<'archive' | 'used'>('archive');
  const [openShopCards, setOpenShopCards] = useState<Record<string, boolean>>({});
  const [usedMap, setUsedMap] = useState<Record<string, UsedMarketData>>({});
  const [activeShopModal, setActiveShopModal] = useState<{ p: Product; sku: Sku } | null>(null);
  const [loadingModalKey, setLoadingModalKey] = useState<string | null>(null);
  const liveFetchedModalKeysRef = useRef<Set<string>>(new Set());
  const [urlCopied, setUrlCopied] = useState(false);
  const urlCopyTimer = useRef<number>();
  const [imageScope, setImageScope] = useState<ImageExportScope>('all');
  const [exportingKind, setExportingKind] = useState<'download' | 'copy' | null>(null);
  const [activeExportScope, setActiveExportScope] = useState<ImageExportScope | null>(null);
  const [imageCopied, setImageCopied] = useState(false);
  const imageCopyTimer = useRef<number>();
  const captureRootRef = useRef<HTMLDivElement>(null);
  const tableWrapRef = useRef<HTMLDivElement>(null);
  const tableElRef = useRef<HTMLTableElement>(null);
  const isExporting = activeExportScope !== null;

  const triggerLiveOffersFetch = (p: Product, sku: Sku, force = false) => {
    const key = `${p.id}__${sku.id}`;
    if (!force && liveFetchedModalKeysRef.current.has(key)) return;
    liveFetchedModalKeysRef.current.add(key);
    setLoadingModalKey(key);
    fetchUsedMarketPrice(p, sku, { forceRefresh: true })
      .then((data) => {
        setUsedMap((prev) => ({ ...prev, [key]: data }));
      })
      .finally(() => {
        setLoadingModalKey((prev) => (prev === key ? null : prev));
      });
  };

  const openShopComparisonModal = (p: Product, sku: Sku) => {
    setActiveShopModal({ p, sku });
    const hasPrepopulatedOffers = Array.isArray(sku.usedPricing?.offers) && sku.usedPricing.offers.length >= 3;
    if (!hasPrepopulatedOffers) {
      triggerLiveOffersFetch(p, sku, false);
    }
  };

  const primaryEvalRows = useMemo(() => evaluateSpecRows(cols, PRIMARY_SPEC_ROWS), [cols]);
  const detailEvalRows = useMemo(() => evaluateSpecRows(cols, DETAIL_SPEC_ROWS), [cols]);
  const visiblePrimaryRows = useMemo(
    () => (diffOnly ? primaryEvalRows.filter((r) => r.hasDiff) : primaryEvalRows),
    [primaryEvalRows, diffOnly],
  );
  const visibleDetailRows = useMemo(
    () => (diffOnly ? detailEvalRows.filter((r) => r.hasDiff) : detailEvalRows),
    [detailEvalRows, diffOnly],
  );
  const displayedSpecRows = useMemo(
    () => (specExpanded ? [...visiblePrimaryRows, ...visibleDetailRows] : visiblePrimaryRows),
    [specExpanded, visiblePrimaryRows, visibleDetailRows],
  );
  const totalDiffSpecCount = useMemo(
    () => primaryEvalRows.filter((r) => r.hasDiff).length + detailEvalRows.filter((r) => r.hasDiff).length,
    [primaryEvalRows, detailEvalRows],
  );

  const isSimpleView =
    !showFlags.diag && !showFlags.tradein && !showFlags.fx && !showFlags.shops && !diffOnly && !specExpanded;
  const isFullDetailView =
    showFlags.diag && showFlags.tradein && showFlags.fx && showFlags.shops && specExpanded;
  const toggleShowFlag = (key: CompareShowKey) => {
    if (key === 'shops') {
      setOpenShopCards({});
    }
    setShowFlags((prev) => ({ ...prev, [key]: !prev[key] }));
  };
  const applySimpleView = () => {
    setOpenShopCards({});
    setDiscontinuedHeroMode('archive');
    setDiffOnly(false);
    setSpecExpanded(false);
    setShowFlags({ ...DEFAULT_SHOW_FLAGS });
  };
  const applyFullDetailView = () => {
    setOpenShopCards({});
    setSpecExpanded(true);
    setShowFlags({ diag: true, tradein: true, fx: true, shops: true });
  };
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

  // 選択中の各機種・容量（＋下取り対象機種）に対して楽天市場API（未設定時は推定フォールバック）から中古・未使用品最安値を取得
  const myKey = myProduct && mySku ? `${myProduct.id}__${mySku.id}` : '';
  const colsKey = `${cols.map((c) => `${c.p.id}__${c.sku.id}`).join('|')}||${myKey}`;
  useEffect(() => {
    let cancelled = false;
    const targets: { p: Product; sku: Sku }[] = cols.map((c) => ({ p: c.p, sku: c.sku }));
    if (myProduct && mySku) {
      targets.push({ p: myProduct, sku: mySku });
    }
    targets.forEach((t) => {
      const k = `${t.p.id}__${t.sku.id}`;
      fetchUsedMarketPrice(t.p, t.sku).then((data) => {
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

  const tradeInEst = useMemo<TradeInEstimate | null>(() => {
    if (!myProduct || !mySku) return null;
    const k = `${myProduct.id}__${mySku.id}`;
    const uData = usedMap[k] ?? estimateUsedMarketData(myProduct, mySku);
    return computeTradeInEstimate(myProduct, mySku, uData, sellMode, sellCustom);
  }, [myProduct, mySku, usedMap, sellMode, sellCustom]);

  const getCardTradeInProps = (c: (typeof cols)[number]) => {
    const rawApplePrice =
      c.sku.carriers.apple?.currentPrice ??
      (c.sku.priceHistory.length ? lastOf(c.sku.priceHistory).appleStorePrice : null);
    const appleNewPrice = !isProductDiscontinued(c.p, c.sku) ? rawApplePrice : null;
    const bestReturnCost =
      (['docomo', 'au', 'softbank', 'rakuten'] as CarrierId[])
        .map((cid) => {
          const cp = c.sku.carriers[cid];
          if (!cp?.returnProgram) return null;
          return carrierValue(cp, 'return', mnp) ?? cp.returnProgram.effectiveCost;
        })
        .filter((v): v is number => v != null)
        .sort((a, b) => a - b)[0] ?? null;
    return { appleNewPrice, bestReturnCost };
  };

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

  const doCopyShareUrl = async () => {
    const shareUrl =
      typeof window !== 'undefined'
        ? window.location.href
        : '';
    const ok = await copyText(shareUrl);
    if (ok) {
      setUrlCopied(true);
      window.clearTimeout(urlCopyTimer.current);
      urlCopyTimer.current = window.setTimeout(() => setUrlCopied(false), 2000);
      toast('比較URLをクリップボードにコピーしました');
    } else {
      toast('URLのコピーに失敗しました');
    }
  };

  /**
   * 比較カード＆テーブルを高解像度PNG (pixelRatio: 2) でレンダリングする共通関数
   * - data-export-ignore="true" 要素の除外
   * - 横スクロール切れ防止のためテーブル全体幅に一時拡張
   * - ダーク時 #09090b / ライト時 #ffffff で背景塗りつぶし
   */
  const renderComparisonToImage = async (
    scope: ImageExportScope,
    outputType: 'png' | 'blob',
  ): Promise<{ dataUrl?: string; blob?: Blob }> => {
    setActiveExportScope(scope);
    // Reactの状態反映とDOMレイアウト確定を待つ
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    const rootEl = captureRootRef.current;
    if (!rootEl) {
      setActiveExportScope(null);
      throw new Error('キャプチャ対象要素が見つかりません');
    }
    const bgColor = dark ? '#09090b' : '#ffffff';
    const prevWidth = rootEl.style.width;
    const prevMaxWidth = rootEl.style.maxWidth;
    const prevOverflow = rootEl.style.overflow;
    const prevBg = rootEl.style.backgroundColor;

    try {
      if (tableWrapRef.current) {
        tableWrapRef.current.scrollLeft = 0;
      }
      const tableScrollW =
        scope !== 'cards' && tableElRef.current ? tableElRef.current.scrollWidth + 56 : 0;
      const minSlideW =
        scope === 'cards'
          ? Math.max(880, Math.min(1440, cols.length * 300 + 64))
          : Math.max(920, Math.min(1680, cols.length * 260 + 220));
      const targetWidth = Math.ceil(Math.max(rootEl.scrollWidth, tableScrollW, minSlideW));

      rootEl.style.width = `${targetWidth}px`;
      rootEl.style.maxWidth = 'none';
      rootEl.style.overflow = 'visible';
      rootEl.style.backgroundColor = bgColor;

      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

      const targetHeight = Math.ceil(
        Math.max(rootEl.getBoundingClientRect().height, rootEl.scrollHeight),
      );

      const exportOptions = {
        pixelRatio: 2,
        backgroundColor: bgColor,
        skipFonts: true,
        fontEmbedCSS: '',
        cacheBust: true,
        width: targetWidth,
        height: targetHeight,
        style: {
          width: `${targetWidth}px`,
          height: `${targetHeight}px`,
          maxWidth: 'none',
          overflow: 'visible',
          backgroundColor: bgColor,
        },
        filter: (domNode: HTMLElement) => {
          if (domNode instanceof HTMLElement && domNode.dataset?.exportIgnore === 'true') {
            return false;
          }
          return true;
        },
      };

      if (outputType === 'png') {
        const dataUrl = await toPng(rootEl, exportOptions);
        return { dataUrl };
      } else {
        const blob = await toBlob(rootEl, exportOptions);
        if (!blob) throw new Error('PNG Blob の生成に失敗しました');
        return { blob };
      }
    } finally {
      rootEl.style.width = prevWidth;
      rootEl.style.maxWidth = prevMaxWidth;
      rootEl.style.overflow = prevOverflow;
      rootEl.style.backgroundColor = prevBg;
      setActiveExportScope(null);
    }
  };

  const doDownloadImage = async (overrideScope?: ImageExportScope) => {
    if (!cols.length || exportingKind) return;
    const scope = overrideScope ?? imageScope;
    setExportingKind('download');
    try {
      const { dataUrl } = await renderComparisonToImage(scope, 'png');
      if (!dataUrl) throw new Error('画像データの生成に失敗しました');
      const filename = buildCompareImageFilename(cols, scope);
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      toast(`PNG画像を保存しました (${filename})`);
    } catch {
      toast('画像の保存に失敗しました');
    } finally {
      setExportingKind(null);
    }
  };

  const doCopyImage = async () => {
    if (!cols.length || exportingKind) return;
    if (
      typeof navigator === 'undefined' ||
      !navigator.clipboard?.write ||
      typeof ClipboardItem === 'undefined'
    ) {
      toast('お使いのブラウザは画像のクリップボードコピーに対応していません。「📷 画像として保存 (PNG)」をご利用ください');
      return;
    }
    setExportingKind('copy');
    try {
      const { blob } = await renderComparisonToImage(imageScope, 'blob');
      if (!blob) throw new Error('Blobの生成に失敗しました');
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      setImageCopied(true);
      window.clearTimeout(imageCopyTimer.current);
      imageCopyTimer.current = window.setTimeout(() => setImageCopied(false), 2000);
      toast('比較画像をクリップボードにコピーしました（Xやスライドへそのままペースト可能）');
    } catch {
      toast('画像のコピーに失敗しました。「📷 画像として保存 (PNG)」をお試しください');
    } finally {
      setExportingKind(null);
    }
  };

  const shareTweetText = useMemo(() => {
    const names = cols.length ? cols.map((c) => c.p.name).join(' / ') : 'Apple製品';
    if (showFlags.tradein && tradeInEst) {
      return `${tradeInEst.myProduct.name} (${tradeInEst.mySku.label}) から ${names} への買い替え追い金・スペック比較 | Apple Price Atlas`;
    }
    return `${names} の価格・スペック比較 | Apple Price Atlas`;
  }, [cols, showFlags.tradein, tradeInEst]);

  const xPostIntentUrl = useMemo(() => {
    const base =
      typeof window !== 'undefined'
        ? `${window.location.origin}${window.location.pathname}`
        : '';
    const search = buildShareSearchString(
      all,
      sels,
      mode,
      mnp,
      'compare',
      80000,
      'all',
      mySel,
      sellMode,
      sellCustom,
      showFlags,
      diffOnly,
      specExpanded,
    );
    const url = `${base}${search}`;
    return `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareTweetText)}&url=${encodeURIComponent(url)}`;
  }, [all, sels, mode, mnp, mySel, sellMode, sellCustom, showFlags, diffOnly, specExpanded, shareTweetText]);

  const cheapest = (c: (typeof cols)[number]) => {
    const vals = CARRIER_ORDER.map((id) => ({ id, v: carrierValue(c.sku.carriers[id], mode, mnp) })).filter((x): x is { id: CarrierId; v: number } => x.v != null);
    if (!vals.length) return { min: null as number | null, ids: [] as CarrierId[] };
    const min = Math.min(...vals.map((x) => x.v));
    return { min, ids: vals.filter((x) => x.v === min).map((x) => x.id) };
  };

  const SHOW_SWITCH_ITEMS: { key: CompareShowKey; icon: string; label: string }[] = [
    { key: 'diag', icon: '💡', label: '自動診断パネル' },
    { key: 'tradein', icon: '🔄', label: '下取り・追い金計算' },
    { key: 'fx', icon: '💱', label: '為替・Appleレート分析' },
    { key: 'shops', icon: '🏪', label: '中古ショップ個別リンク' },
  ];

  return (
    <div className="space-y-4 sm:space-y-5">
      <div className={`${card} p-3.5 sm:p-5`}>
        <SectionTitle icon={<Scale className="h-5 w-5" />} title="スペック＆キャリア価格 比較" desc="機種を追加し、容量・通信方式を選んで横並び比較。最安キャリアを自動ハイライトします。" />
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          <Segmented<Mode> value={mode} onChange={setMode} options={[{ value: 'bulk', label: '一括価格モード' }, { value: 'return', label: '2年返却（実質）モード' }]} />
          <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
            <input type="checkbox" checked={mnp} onChange={(e) => setMnp(e.target.checked)} className="h-4 w-4 accent-sky-500" />MNP/新規割引を適用
          </label>
          <div className="flex flex-wrap items-center gap-1.5 sm:ml-auto sm:gap-2">
            {/* 画像出力コントロール群（範囲選択 ＋ PNG保存 ＋ クリップボードコピー） */}
            <div className="inline-flex flex-wrap items-center gap-1 rounded-xl border border-zinc-200/90 bg-zinc-50/70 p-0.5 dark:border-zinc-800 dark:bg-zinc-900/60">
              <select
                value={imageScope}
                onChange={(e) => setImageScope(e.target.value as ImageExportScope)}
                aria-label="画像キャプチャ範囲を選択"
                className="rounded-lg border-0 bg-transparent py-1 pl-2 pr-1 text-[11px] font-medium text-zinc-600 focus:outline-none focus:ring-1 focus:ring-zinc-400 dark:text-zinc-300"
                title="画像出力する範囲を選択"
              >
                <option value="all">範囲: カード＋テーブル全体</option>
                <option value="cards">範囲: サマリーカードのみ</option>
                <option value="table">範囲: 比較テーブルのみ</option>
              </select>
              <button
                type="button"
                disabled={!cols.length || exportingKind !== null}
                onClick={() => doDownloadImage()}
                className={`${btnCls} !py-1 !px-2.5 !text-xs`}
                title={`選択範囲（${IMAGE_EXPORT_SCOPE_LABELS[imageScope]}）を高解像度PNG画像として保存`}
              >
                <span>{exportingKind === 'download' ? '⏳ 画像生成中...' : '📷 画像として保存 (PNG)'}</span>
              </button>
              <button
                type="button"
                disabled={!cols.length || exportingKind !== null}
                onClick={doCopyImage}
                className={`${btnCls} !py-1 !px-2.5 !text-xs ${
                  imageCopied
                    ? '!border-emerald-500/60 !bg-emerald-50/90 !text-emerald-700 dark:!border-emerald-500/50 dark:!bg-emerald-950/50 dark:!text-emerald-300'
                    : ''
                }`}
                title={`選択範囲（${IMAGE_EXPORT_SCOPE_LABELS[imageScope]}）のPNG画像をクリップボードへ直接コピー`}
              >
                <span>
                  {imageCopied
                    ? '✅ 画像をコピーしました！'
                    : exportingKind === 'copy'
                      ? '⏳ コピー中...'
                      : '📋 画像をコピー'}
                </span>
              </button>
            </div>
            <button
              type="button"
              onClick={doCopyShareUrl}
              disabled={!cols.length}
              className={`${btnCls} ${
                urlCopied
                  ? '!border-zinc-400 !bg-zinc-200/80 dark:!border-zinc-600 dark:!bg-zinc-700'
                  : ''
              }`}
            >
              {urlCopied ? (
                <>
                  <Check className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                  <span>コピー済</span>
                </>
              ) : (
                <>
                  <Link2 className="h-4 w-4 shrink-0" />
                  <span>比較URLをコピー</span>
                </>
              )}
            </button>
            <a
              href={xPostIntentUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={btnCls}
            >
              <span>𝕏 ポスト</span>
            </a>
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

        {/* 表示カスタマイズバー（4つの詳細トグルスイッチ ＋ 差分フィルタ ＋ シンプル/フル詳細一括切替） */}
        <div className="mt-3.5 flex flex-col gap-2 border-t border-zinc-200/70 pt-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between dark:border-zinc-800/70">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-[11px] font-semibold text-zinc-500 dark:text-zinc-400">
              表示カスタマイズ:
            </span>
            {SHOW_SWITCH_ITEMS.map((item) => {
              const active = showFlags[item.key];
              return (
                <button
                  key={item.key}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggleShowFlag(item.key)}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition ${
                    active
                      ? 'border-zinc-900 bg-zinc-900 text-white shadow-sm dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900'
                      : 'border-zinc-200/90 bg-white text-zinc-600 hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-900 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-400 dark:hover:border-zinc-700 dark:hover:bg-zinc-800/80 dark:hover:text-zinc-200'
                  }`}
                >
                  <span aria-hidden="true">{item.icon}</span>
                  <span>{item.label}</span>
                </button>
              );
            })}
            <button
              type="button"
              aria-pressed={diffOnly}
              onClick={() => setDiffOnly((prev) => !prev)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition ${
                diffOnly
                  ? 'border-zinc-900 bg-zinc-900 text-white shadow-sm dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900'
                  : 'border-zinc-200/90 bg-white text-zinc-600 hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-900 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-400 dark:hover:border-zinc-700 dark:hover:bg-zinc-800/80 dark:hover:text-zinc-200'
              }`}
            >
              <span aria-hidden="true">🔍</span>
              <span>差分のみ表示</span>
            </button>
          </div>
          <div className="flex items-center gap-1.5 self-end sm:self-auto">
            <button
              type="button"
              onClick={applySimpleView}
              disabled={isSimpleView}
              className={`rounded-lg px-2 py-1 text-[11px] font-medium transition ${
                isSimpleView
                  ? 'bg-zinc-100 text-zinc-400 cursor-default dark:bg-zinc-800/60 dark:text-zinc-500'
                  : 'border border-zinc-200/80 bg-white text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:border-zinc-700/80 dark:bg-zinc-800/70 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-100'
              }`}
            >
              シンプル表示（初期）
            </button>
            <button
              type="button"
              onClick={applyFullDetailView}
              disabled={isFullDetailView}
              className={`rounded-lg px-2 py-1 text-[11px] font-medium transition ${
                isFullDetailView
                  ? 'bg-zinc-100 text-zinc-400 cursor-default dark:bg-zinc-800/60 dark:text-zinc-500'
                  : 'border border-zinc-200/80 bg-white text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:border-zinc-700/80 dark:bg-zinc-800/70 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-100'
              }`}
            >
              フル詳細表示
            </button>
          </div>
        </div>
      </div>

      {showFlags.tradein && (
        <TradeInSimulatorBar
          allProducts={all}
          mySel={mySel}
          setMySel={setMySel}
          sellMode={sellMode}
          setSellMode={setSellMode}
          sellCustom={sellCustom}
          setSellCustom={setSellCustom}
          tradeInEst={tradeInEst}
        />
      )}

      {!cols.length ? (
        <div className={`${card} p-8 sm:p-10 text-center text-sm text-zinc-500`}>比較する機種を追加してください。</div>
      ) : (
        <div
          ref={captureRootRef}
          className={
            isExporting
              ? 'space-y-4 rounded-2xl bg-white p-6 text-zinc-900 dark:bg-[#09090b] dark:text-zinc-100'
              : 'space-y-4 sm:space-y-5'
          }
        >
          {/* 画像出力時のみ最上部に表示される図解スライド用タイトル＆条件ヘッダー */}
          {isExporting && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 pb-3.5 dark:border-zinc-800">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-base font-extrabold tracking-tight text-zinc-900 dark:text-zinc-50">
                  <span>📊 Apple製品 スペック＆価格比較（{formatCurrentYearMonthLabel()}）</span>
                </div>
                <div className="mt-1 text-xs font-medium text-zinc-500 dark:text-zinc-400">
                  {cols.map((c) => `${c.p.name} (${c.sku.label})`).join('  vs  ')}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-semibold">
                <span className="rounded-md border border-zinc-200 bg-zinc-100 px-2.5 py-1 text-zinc-800 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100">
                  {mode === 'bulk' ? '一括価格モード' : '2年返却（実質負担）モード'}
                </span>
                <span className="rounded-md border border-zinc-200 bg-zinc-100 px-2.5 py-1 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
                  {mnp ? 'MNP/新規割引 適用' : '割引なし（通常価格）'}
                </span>
                {diffOnly && activeExportScope !== 'cards' && (
                  <span className="rounded-md border border-zinc-200 bg-zinc-100 px-2.5 py-1 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
                    🔍 差分スペックのみ抜粋
                  </span>
                )}
              </div>
            </div>
          )}

          {/* サマリーカード＆自動診断セクション（「比較テーブルのみ」出力時は非表示） */}
          <div
            data-export-ignore={activeExportScope === 'table' ? 'true' : undefined}
            className={activeExportScope === 'table' ? 'hidden' : 'space-y-4'}
          >
            {showFlags.diag && (
              <CompareDiagnosticPanel
                cols={cols}
                mode={mode}
                mnp={mnp}
                setMode={setMode}
                getUsedData={getUsedData}
                onOpenBudgetTab={onOpenBudgetTab}
              />
            )}

            <div
              className={
                isExporting
                  ? `grid gap-3 ${
                      cols.length === 1
                        ? 'grid-cols-1'
                        : cols.length === 2
                          ? 'grid-cols-2'
                          : cols.length === 3
                            ? 'grid-cols-3'
                            : 'grid-cols-4'
                    }`
                  : 'grid gap-3 sm:grid-cols-2 lg:grid-cols-3'
              }
            >
              {cols.map((c) => {
                const ch = cheapest(c);
                const apple = carrierValue(c.sku.carriers.apple, mode, mnp);
                const usedInfo = getUsedData(c);
                const { appleNewPrice, bestReturnCost } = getCardTradeInProps(c);
                const discInfo = getSkuDiscontinuedInfo(c.p, c.sku);
                const isDisc = discInfo.isDiscontinued;
                const launchApplePrice =
                  c.sku.carriers.apple?.launchPrice ??
                  (c.sku.priceHistory.length ? c.sku.priceHistory[0].appleStorePrice : null);
                const finalApplePrice =
                  c.sku.carriers.apple?.currentPrice ??
                  (c.sku.priceHistory.length ? lastOf(c.sku.priceHistory).appleStorePrice : null);
                const isShopsOpen = openShopCards[c.sel.pid] ?? showFlags.shops;
                return (
                  <div
                    key={c.sel.pid}
                    className={`${card} flex flex-col justify-between p-4 ${
                      isDisc
                        ? 'border-dashed border-zinc-300 dark:border-zinc-700/80'
                        : ''
                    }`}
                  >
                    <div>
                      {/* 要素1: 機種名・容量セレクター（販売終了機種は機種名横に小さく控えめな販売終了バッジのみ） */}
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-1.5">
                          <CatIcon cat={c.p.category} className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
                          <span className="truncate text-sm sm:text-base font-bold text-zinc-900 dark:text-zinc-100">
                            {c.p.name}
                          </span>
                          {isDisc && (
                            <span
                              className="shrink-0 rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
                              title={discInfo.discontinuedDate ? `終売: ${discInfo.discontinuedDate}` : 'Apple Store / キャリア販売終了'}
                            >
                              販売終了
                            </span>
                          )}
                        </div>
                        {isExporting ? (
                          <span className="shrink-0 rounded-md border border-zinc-300 bg-zinc-100 px-2 py-0.5 text-xs font-semibold text-zinc-800 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100">
                            {c.sku.label}
                          </span>
                        ) : (
                          <select
                            data-export-ignore="true"
                            className={`${selectCls} shrink-0 !py-1 !px-2 !text-xs`}
                            value={c.sku.id}
                            aria-label={`${c.p.name} の容量・通信方式`}
                            onChange={(e) => setSels(sels.map((s) => (s.pid === c.sel.pid ? { ...s, sid: e.target.value } : s)))}
                          >
                            {[...c.p.skus].sort(compareSkus).map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
                          </select>
                        )}
                      </div>

                      {/* 販売終了モデルの主役価格切替はショップ詳細表示ON時のみ補助表示 */}
                      {isDisc && isShopsOpen && (
                        <div
                          data-export-ignore="true"
                          role="group"
                          aria-label="販売終了モデルの主役価格切り替え"
                          className="mt-2 grid grid-cols-2 gap-1 rounded-lg bg-zinc-100 p-0.5 text-[10px] font-medium dark:bg-zinc-800/90"
                        >
                          <button
                            type="button"
                            onClick={() => setDiscontinuedHeroMode('archive')}
                            className={`rounded-md px-2 py-0.5 transition ${
                              discontinuedHeroMode === 'archive'
                                ? 'bg-white font-semibold text-zinc-900 shadow-sm dark:bg-zinc-900 dark:text-zinc-100'
                                : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200'
                            }`}
                          >
                            最終定価で比較
                          </button>
                          <button
                            type="button"
                            onClick={() => setDiscontinuedHeroMode('used')}
                            className={`rounded-md px-2 py-0.5 transition ${
                              discontinuedHeroMode === 'used'
                                ? 'bg-white font-semibold text-zinc-900 shadow-sm dark:bg-zinc-900 dark:text-zinc-100'
                                : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200'
                            }`}
                          >
                            現在の中古・未使用で比較
                          </button>
                        </div>
                      )}

                      {/* 要素2: メイン価格 */}
                      {isDisc && isShopsOpen && discontinuedHeroMode === 'used' ? (
                        <div className="mt-2.5">
                          <div className="flex flex-wrap items-baseline justify-between gap-2">
                            <div className="flex flex-wrap items-baseline gap-1.5">
                              <span className="text-xl sm:text-2xl font-extrabold tabular-nums text-zinc-900 dark:text-zinc-50">
                                {yen(usedInfo.usedPricing.lowestPrice)}
                              </span>
                              <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                                （現在の中古最安）
                              </span>
                            </div>
                            {usedInfo.unused && (
                              <span className="rounded bg-zinc-100 px-2 py-0.5 text-[11px] font-medium tabular-nums text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                                未使用: {yen(usedInfo.unused.price)}
                              </span>
                            )}
                          </div>
                          <div className="mt-0.5 text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
                            発売時 {yen(launchApplePrice ?? ch.min)} → 終売時最終 {yen(finalApplePrice ?? ch.min)}
                            {finalApplePrice != null && (
                              <span className="ml-1.5 font-medium text-zinc-600 dark:text-zinc-300">
                                （最終定価比 {signedYen(usedInfo.usedPricing.lowestPrice - finalApplePrice)}）
                              </span>
                            )}
                          </div>
                        </div>
                      ) : ch.min == null ? (
                        <div className="mt-2.5 text-xs sm:text-sm text-zinc-500">このモードで購入可能な窓口がありません</div>
                      ) : isDisc ? (
                        <div className="mt-2.5 flex flex-wrap items-baseline justify-between gap-2">
                          <div>
                            <div className="text-xl sm:text-2xl font-extrabold tabular-nums text-zinc-700 dark:text-zinc-200">
                              {yen(ch.min)}
                            </div>
                            <div className="mt-0.5 text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
                              発売時 {yen(launchApplePrice ?? ch.min)} → 終売時最終 {yen(finalApplePrice ?? ch.min)}
                              {apple != null && !ch.ids.includes('apple') && (
                                <span className="ml-1.5 text-zinc-600 dark:text-zinc-300">
                                  (Apple終売比 {signedYen(ch.min - apple)})
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="flex flex-wrap items-center gap-1">{ch.ids.map((id) => <CarrierBadge key={id} id={id} small />)}</div>
                        </div>
                      ) : (
                        <div className="mt-2.5 flex flex-wrap items-baseline justify-between gap-2">
                          <div>
                            <div className="text-xl sm:text-2xl font-extrabold tabular-nums text-zinc-900 dark:text-zinc-50">{yen(ch.min)}</div>
                            {apple != null && !ch.ids.includes('apple') ? (
                              <div className="mt-0.5 text-xs text-emerald-600 dark:text-emerald-400">Apple Store比 {signedYen(ch.min - apple)}</div>
                            ) : launchApplePrice != null && finalApplePrice != null ? (
                              <div className="mt-0.5 text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
                                発売時 {yen(launchApplePrice)} → 現在 {yen(finalApplePrice)}
                              </div>
                            ) : null}
                          </div>
                          <div className="flex flex-wrap items-center gap-1">{ch.ids.map((id) => <CarrierBadge key={id} id={id} small />)}</div>
                        </div>
                      )}

                      {/* 💱 為替・Appleレート分析（ONの時のみ表示） */}
                      {showFlags.fx && c.sku.priceHistory.length > 0 && (
                        <div className="mt-2.5 border-t border-zinc-200/80 pt-2.5 dark:border-zinc-800/60">
                          <CompactCardFxLine pt={lastOf(c.sku.priceHistory)} />
                        </div>
                      )}

                      {/* 🔄 下取り・追い金計算（ONの時のみ表示） */}
                      {showFlags.tradein && tradeInEst && (
                        <div className="mt-2.5">
                          <TradeInCardOverlay
                            tradeInEst={tradeInEst}
                            targetProduct={c.p}
                            targetSku={c.sku}
                            appleNewPrice={appleNewPrice}
                            lowestUsedPrice={usedInfo.usedPricing.lowestPrice}
                            bestReturnCost={bestReturnCost}
                          />
                        </div>
                      )}
                    </div>

                    {/* 要素3: 中古最安値の1行サマリー（クリックまたは 🏪 中古ショップ個別リンクON で個別ショップ行を展開） */}
                    {(() => {
                      const up = usedInfo.usedPricing;
                      const isEstimated = Boolean(usedInfo.isEstimated || usedInfo.source === 'mock' || up.isEstimated);
                      const isYahooLowest = up.lowestPlatform === 'yahoo';
                      const bestOffer = isYahooLowest ? up.yahoo ?? up.rakuten : up.rakuten ?? up.yahoo;
                      const offerCount = (up.offers ?? usedInfo.offers ?? []).length;
                      const toggleCardShops = () =>
                        setOpenShopCards((prev) => ({
                          ...prev,
                          [c.sel.pid]: !(prev[c.sel.pid] ?? showFlags.shops),
                        }));
                      return (
                        <div className="mt-2.5 border-t border-zinc-200/80 pt-2.5 dark:border-zinc-800/60">
                          <div className="flex items-center justify-between gap-2">
                            <button
                              type="button"
                              onClick={() => (isEstimated ? toggleCardShops() : openShopComparisonModal(c.p, c.sku))}
                              className="min-w-0 flex-1 truncate rounded text-left text-xs text-zinc-600 transition hover:text-zinc-900 focus:outline-none focus-visible:ring-1 focus-visible:ring-zinc-600 dark:text-zinc-400 dark:hover:text-zinc-100 tabular-nums"
                              title={
                                isEstimated
                                  ? 'クリックして実在庫の検索リンクを表示'
                                  : 'クリックして中古・未使用品のショップ比較リスト（安い順）を表示'
                              }
                            >
                              {isEstimated ? (
                                <>
                                  📊 参考推定相場: <strong className="font-bold text-zinc-900 dark:text-zinc-100">約{yen(up.lowestPrice)}</strong>
                                  <span className="ml-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                                    （実在庫データ未取得）
                                  </span>
                                </>
                              ) : (
                                <>
                                  中古最安 <strong className="font-bold text-zinc-900 dark:text-zinc-100">{yen(up.lowestPrice)}</strong>
                                  {usedInfo.unused && (
                                    <>
                                      {' '}/ 未使用 <strong className="font-semibold text-zinc-800 dark:text-zinc-200">{yen(usedInfo.unused.price)}</strong>
                                    </>
                                  )}
                                  {up.resaleValuePercent != null && (
                                    <span className="ml-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                                      （リセール {up.resaleValuePercent}%）
                                    </span>
                                  )}
                                </>
                              )}
                            </button>
                            <button
                              data-export-ignore="true"
                              type="button"
                              onClick={toggleCardShops}
                              aria-expanded={isShopsOpen}
                              className="inline-flex shrink-0 items-center gap-0.5 rounded px-1 py-0.5 text-[11px] text-zinc-400 transition hover:text-zinc-700 focus:outline-none focus-visible:ring-1 focus-visible:ring-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300"
                            >
                              <span>{isShopsOpen ? '閉じる' : '内訳'}</span>
                              {isShopsOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                            </button>
                          </div>

                          {!isEstimated && offerCount > 0 && (
                            <div data-export-ignore="true" className="mt-2">
                              <button
                                type="button"
                                onClick={() => openShopComparisonModal(c.p, c.sku)}
                                className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-zinc-200/90 bg-zinc-50/90 px-3 py-1.5 text-xs font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-100 hover:text-zinc-900 focus:outline-none focus-visible:ring-1 focus-visible:ring-zinc-600 dark:border-zinc-800 dark:bg-zinc-800/60 dark:text-zinc-200 dark:hover:border-zinc-700 dark:hover:bg-zinc-800"
                              >
                                <span aria-hidden="true">🏪</span>
                                <span>中古ショップを安い順に見る ({offerCount}件)</span>
                              </button>
                            </div>
                          )}

                          {isShopsOpen && (
                            <div className="mt-2 space-y-1.5 border-t border-zinc-100 pt-2 text-[11px] dark:border-zinc-800/60">
                              {isEstimated ? (
                                <>
                                  <div className="flex flex-wrap items-center justify-between gap-1.5">
                                    <span className="text-[11px] font-medium text-zinc-600 dark:text-zinc-300 tabular-nums">
                                      📊 参考推定相場: 約{yen(up.lowestPrice)}（実在庫データ未取得）
                                    </span>
                                    <ResaleBadge rate={up.resaleValuePercent} launchPrice={usedInfo.launchPrice} />
                                  </div>
                                  <div data-export-ignore="true" className="flex flex-col gap-1 pt-0.5">
                                    <a
                                      href={usedInfo.rakutenSearchUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="inline-flex items-center justify-between rounded-lg border border-zinc-200/80 bg-zinc-50/80 px-2.5 py-1 text-[11px] font-medium text-zinc-600 transition hover:border-zinc-300 hover:bg-zinc-100 hover:text-zinc-900 focus:outline-none focus-visible:ring-1 focus-visible:ring-zinc-600 dark:border-zinc-800 dark:bg-zinc-800/50 dark:text-zinc-300 dark:hover:border-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                                    >
                                      <span>楽天市場で実際の在庫を検索</span>
                                      <ExternalLink className="h-3 w-3 shrink-0" />
                                    </a>
                                    <a
                                      href={usedInfo.yahooSearchUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="inline-flex items-center justify-between rounded-lg border border-zinc-200/80 bg-zinc-50/80 px-2.5 py-1 text-[11px] font-medium text-zinc-600 transition hover:border-zinc-300 hover:bg-zinc-100 hover:text-zinc-900 focus:outline-none focus-visible:ring-1 focus-visible:ring-zinc-600 dark:border-zinc-800 dark:bg-zinc-800/50 dark:text-zinc-300 dark:hover:border-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                                    >
                                      <span>Yahoo!で実際の在庫を検索</span>
                                      <ExternalLink className="h-3 w-3 shrink-0" />
                                    </a>
                                  </div>
                                </>
                              ) : (
                                <>
                                  <div className="flex flex-wrap items-center justify-between gap-1.5">
                                    <span className="inline-flex flex-wrap items-center gap-1.5 text-[10px] font-medium text-zinc-500 dark:text-zinc-400">
                                      <span className="inline-flex items-center gap-1 rounded-md bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                                        <span
                                          className={`h-1.5 w-1.5 rounded-full ${
                                            isYahooLowest ? 'bg-amber-500' : 'bg-rose-500'
                                          }`}
                                        />
                                        {isYahooLowest ? 'Yahoo!最安' : '楽天最安'}
                                      </span>
                                      <TrustedShopBadge isTrusted={bestOffer?.isTrustedShop} compact />
                                    </span>
                                    <ResaleBadge rate={up.resaleValuePercent} launchPrice={usedInfo.launchPrice} />
                                  </div>
                                  <div className="space-y-1">
                                    {up.rakuten && (
                                      <div className="flex items-center justify-between gap-1.5">
                                        <span className="inline-flex min-w-0 items-center gap-1.5 truncate">
                                          <span className="inline-flex shrink-0 items-center gap-1 rounded bg-zinc-100 px-1.5 py-0.2 text-[10px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                                            <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
                                            楽天
                                          </span>
                                          <span className={`tabular-nums ${!isYahooLowest ? 'font-bold text-zinc-900 dark:text-zinc-100' : 'font-medium text-zinc-600 dark:text-zinc-400'}`}>
                                            {yen(up.rakuten.price)}
                                          </span>
                                          <span className="truncate text-zinc-500 dark:text-zinc-400" title={up.rakuten.shopName}>
                                            {up.rakuten.shopName}
                                          </span>
                                        </span>
                                        <a
                                          data-export-ignore="true"
                                          href={up.rakuten.url}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="inline-flex shrink-0 items-center gap-0.5 font-medium text-zinc-500 hover:text-zinc-900 hover:underline dark:text-zinc-400 dark:hover:text-zinc-100"
                                        >
                                          商品 <ExternalLink className="h-3 w-3" />
                                        </a>
                                      </div>
                                    )}
                                    {up.yahoo && (
                                      <div className="flex items-center justify-between gap-1.5">
                                        <span className="inline-flex min-w-0 items-center gap-1.5 truncate">
                                          <span className="inline-flex shrink-0 items-center gap-1 rounded bg-zinc-100 px-1.5 py-0.2 text-[10px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                                            <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                                            Yahoo!
                                          </span>
                                          <span className={`tabular-nums ${isYahooLowest ? 'font-bold text-zinc-900 dark:text-zinc-100' : 'font-medium text-zinc-600 dark:text-zinc-400'}`}>
                                            {yen(up.yahoo.price)}
                                          </span>
                                          <span className="truncate text-zinc-500 dark:text-zinc-400" title={up.yahoo.shopName}>
                                            {up.yahoo.shopName}
                                          </span>
                                        </span>
                                        <a
                                          data-export-ignore="true"
                                          href={up.yahoo.url}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="inline-flex shrink-0 items-center gap-0.5 font-medium text-zinc-500 hover:text-zinc-900 hover:underline dark:text-zinc-400 dark:hover:text-zinc-100"
                                        >
                                          商品 <ExternalLink className="h-3 w-3" />
                                        </a>
                                      </div>
                                    )}
                                  </div>
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                );
              })}
            </div>
          </div>

          <div
            data-export-ignore="true"
            className={`flex items-center justify-between gap-2 sm:hidden ${isExporting ? 'hidden' : ''}`}
          >
            <span className="text-xs font-semibold text-zinc-500">スマホ表示モード</span>
            <Segmented<'stack' | 'table'> value={mobileView} onChange={setMobileView} options={[
              { value: 'stack', label: '縦並びカード' },
              { value: 'table', label: '横並び表' },
            ]} />
          </div>

          {mobileView === 'stack' && !isExporting && (
            <div data-export-ignore="true" className="space-y-4 sm:hidden">
              {showFlags.tradein && tradeInEst && (
                <div className={`${card} divide-y divide-zinc-100 overflow-hidden dark:divide-zinc-800`}>
                  <div className="bg-zinc-50 px-3.5 py-2 text-xs font-bold text-zinc-700 dark:bg-zinc-800/50 dark:text-zinc-200">
                    🔄 買い替え実質追い金 ＆ 進化点（{tradeInEst.myProduct.name} {tradeInEst.mySku.label} 下取り −{yen(tradeInEst.activeYen)}）
                  </div>
                  <div className="space-y-2.5 p-3.5">
                    {cols.map((c) => {
                      const u = getUsedData(c);
                      const { appleNewPrice, bestReturnCost } = getCardTradeInProps(c);
                      return (
                        <div key={c.sel.pid}>
                          <div className="mb-1 text-xs font-bold text-zinc-900 dark:text-zinc-100">
                            {c.p.name} <span className="font-normal text-zinc-500">({c.sku.label})</span>
                          </div>
                          <TradeInCardOverlay
                            tradeInEst={tradeInEst}
                            targetProduct={c.p}
                            targetSku={c.sku}
                            appleNewPrice={appleNewPrice}
                            lowestUsedPrice={u.usedPricing.lowestPrice}
                            bestReturnCost={bestReturnCost}
                            inTable
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
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
                        const discInfo = getSkuDiscontinuedInfo(c.p, c.sku);
                        const isDisc = Boolean(cp?.isDiscontinued ?? discInfo.isDiscontinued);
                        return (
                          <div
                            key={c.sel.pid}
                            className={`rounded-xl p-2.5 text-xs ${
                              v == null
                                ? 'bg-zinc-50 dark:bg-zinc-800/40'
                                : isDisc
                                  ? 'border border-dashed border-zinc-300/90 bg-zinc-50/70 dark:border-zinc-700 dark:bg-zinc-800/40'
                                  : isMin
                                    ? 'bg-zinc-100/90 ring-1 ring-zinc-300 dark:bg-zinc-800/70 dark:ring-zinc-700'
                                    : 'bg-zinc-50/80 dark:bg-zinc-800/40'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-bold text-zinc-900 dark:text-zinc-100">
                                {c.p.name} <span className="font-normal text-zinc-500">({c.sku.label})</span>
                              </span>
                              {v == null ? (
                                <span className="text-zinc-400">{cp ? (mode === 'return' ? '返却対象外' : '—') : id === 'apple' ? '価格なし' : '取扱なし'}</span>
                              ) : (
                                <span className="inline-flex flex-wrap items-center justify-end gap-1.5">
                                  {isDisc ? (
                                    <>
                                      {isMin && (
                                        <span className="inline-flex items-center gap-1 rounded-md bg-zinc-200/80 px-1.5 py-0.5 text-[10px] font-medium text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200">
                                          <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                                          終売最安
                                        </span>
                                      )}
                                      <span className="rounded-md bg-zinc-200/70 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300">
                                        最終価格
                                      </span>
                                    </>
                                  ) : (
                                    isMin && (
                                      <span className="inline-flex items-center gap-1 rounded-md bg-zinc-200/80 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-800 dark:bg-zinc-700 dark:text-zinc-100">
                                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                                        最安
                                      </span>
                                    )
                                  )}
                                  <span
                                    className={`text-base font-extrabold tabular-nums ${
                                      isDisc ? 'text-zinc-700 dark:text-zinc-200' : 'text-zinc-900 dark:text-zinc-50'
                                    }`}
                                  >
                                    {yen(v)}
                                  </span>
                                </span>
                              )}
                            </div>
                            {v != null && cp && (
                              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                                {isDisc ? (
                                  id === 'apple' ? (
                                    <span>発売時 {yen(cp.launchPrice)} → 終売時最終 {yen(cp.currentPrice)}</span>
                                  ) : cp.launchPrice !== cp.currentPrice ? (
                                    <span>発売時 {yen(cp.launchPrice)} → 終売時最終 {yen(cp.currentPrice)}（販売終了）</span>
                                  ) : (
                                    <span>発売時総額 {yen(cp.launchPrice)}（販売終了）</span>
                                  )
                                ) : (
                                  <span>発売時 {yen(cp.launchPrice)} → 現在 {yen(cp.currentPrice)}</span>
                                )}
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
                    const isEstimated = Boolean(u.isEstimated || u.source === 'mock' || up.isEstimated);
                    const isYahooLowest = up.lowestPlatform === 'yahoo';
                    const isShopsOpen = openShopCards[c.sel.pid] ?? showFlags.shops;
                    const offerCount = (up.offers ?? u.offers ?? []).length;
                    return (
                      <div key={c.sel.pid} className="rounded-xl border border-zinc-200/80 bg-zinc-50/70 p-2.5 text-xs dark:border-zinc-800 dark:bg-zinc-800/50">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-bold text-zinc-900 dark:text-zinc-100">
                            {c.p.name} <span className="font-normal text-zinc-500">({c.sku.label})</span>
                          </span>
                          <ResaleBadge rate={up.resaleValuePercent} launchPrice={u.launchPrice} />
                        </div>
                        {isEstimated ? (
                          <div className="mt-1.5 space-y-1.5">
                            <div className="text-xs font-semibold tabular-nums text-zinc-800 dark:text-zinc-200">
                              📊 参考推定相場: 約{yen(up.lowestPrice)}（実在庫データ未取得）
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              <a
                                href={u.rakutenSearchUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 bg-white px-2.5 py-1 text-[11px] font-medium text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
                              >
                                <span>楽天市場で実際の在庫を検索</span>
                                <ExternalLink className="h-3 w-3 shrink-0" />
                              </a>
                              <a
                                href={u.yahooSearchUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 bg-white px-2.5 py-1 text-[11px] font-medium text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
                              >
                                <span>Yahoo!で実際の在庫を検索</span>
                                <ExternalLink className="h-3 w-3 shrink-0" />
                              </a>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div className="mt-1.5 flex flex-wrap items-baseline justify-between gap-2">
                              <div className="flex flex-wrap items-baseline gap-1.5">
                                <span className="text-[11px] text-zinc-500">横断最安:</span>
                                <span className="text-base font-extrabold tabular-nums text-zinc-900 dark:text-zinc-100">{yen(up.lowestPrice)}</span>
                                <span className="inline-flex items-center gap-1 rounded-md bg-zinc-200/70 px-1.5 py-0.5 text-[10px] font-medium text-zinc-700 dark:bg-zinc-700 dark:text-zinc-300">
                                  <span className={`h-1.5 w-1.5 rounded-full ${isYahooLowest ? 'bg-amber-500' : 'bg-rose-500'}`} />
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
                            {offerCount > 0 && (
                              <div className="mt-2">
                                <button
                                  type="button"
                                  onClick={() => openShopComparisonModal(c.p, c.sku)}
                                  className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-zinc-700 transition hover:bg-zinc-100 hover:text-zinc-900 focus:outline-none focus-visible:ring-1 focus-visible:ring-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
                                >
                                  <span aria-hidden="true">🏪</span>
                                  <span>中古ショップを安い順に見る ({offerCount}件)</span>
                                </button>
                              </div>
                            )}
                            {isShopsOpen && (
                              <div className="mt-2 space-y-1 border-t border-zinc-200/60 pt-1.5 text-[11px] dark:border-zinc-700/60">
                                {up.rakuten && (
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="truncate text-zinc-600 dark:text-zinc-300">
                                      <strong className="text-zinc-800 dark:text-zinc-200">[楽天]</strong> {yen(up.rakuten.price)} — {up.rakuten.shopName}
                                    </span>
                                    <a href={up.rakuten.url} target="_blank" rel="noopener noreferrer" className="inline-flex shrink-0 items-center gap-1 font-medium text-zinc-500 hover:text-zinc-900 hover:underline dark:text-zinc-400 dark:hover:text-zinc-100">
                                      リンク <ExternalLink className="h-3 w-3" />
                                    </a>
                                  </div>
                                )}
                                {up.yahoo && (
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="truncate text-zinc-600 dark:text-zinc-300">
                                      <strong className="text-zinc-800 dark:text-zinc-200">[Yahoo!]</strong> {yen(up.yahoo.price)} — {up.yahoo.shopName}
                                    </span>
                                    <a href={up.yahoo.url} target="_blank" rel="noopener noreferrer" className="inline-flex shrink-0 items-center gap-1 font-medium text-zinc-500 hover:text-zinc-900 hover:underline dark:text-zinc-400 dark:hover:text-zinc-100">
                                      リンク <ExternalLink className="h-3 w-3" />
                                    </a>
                                  </div>
                                )}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {showFlags.fx && (
                <div className={`${card} divide-y divide-zinc-100 overflow-hidden dark:divide-zinc-800`}>
                  <div className="bg-zinc-50 px-3.5 py-2 text-xs font-bold uppercase tracking-wider text-zinc-500 dark:bg-zinc-800/50">
                    為替レート比較（当時の市場レート vs Apple適用レート・割安判定）
                  </div>
                  <div className="space-y-2.5 p-3.5">
                    {cols.map((c) => {
                      const launchPt = c.sku.priceHistory[0];
                      const curPt = c.sku.priceHistory.length ? lastOf(c.sku.priceHistory) : undefined;
                      return (
                        <div key={c.sel.pid} className="space-y-1.5 rounded-xl border border-zinc-200/80 bg-zinc-50/70 p-2.5 text-xs dark:border-zinc-800 dark:bg-zinc-800/50">
                          <div className="font-bold text-zinc-900 dark:text-zinc-100">
                            {c.p.name} <span className="font-normal text-zinc-500">({c.sku.label})</span>
                          </div>
                          {curPt && (
                            <div>
                              <CurrentFxFairnessBadge pt={curPt} compact showFairPrice={true} />
                            </div>
                          )}
                          {launchPt && (
                            <div className="space-y-1 pt-0.5">
                              <div className="text-[11px] font-semibold text-zinc-500">発売時 ({launchPt.date}):</div>
                              <FxRatePairChip pt={launchPt} compact />
                            </div>
                          )}
                          {curPt && curPt !== launchPt && (
                            <div className="space-y-1 pt-0.5">
                              <div className="text-[11px] font-semibold text-zinc-500">最新/終売時 ({curPt.date}):</div>
                              <FxRatePairChip pt={curPt} compact />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className={`${card} divide-y divide-zinc-100 overflow-hidden dark:divide-zinc-800`}>
                <div className="flex flex-wrap items-center justify-between gap-2 bg-zinc-50 px-3.5 py-2.5 dark:bg-zinc-800/50">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold uppercase tracking-wider text-zinc-600 dark:text-zinc-300">
                      スペック比較
                    </span>
                    <span className="inline-flex items-center gap-1 text-[10px] text-zinc-400">
                      <span className="h-1.5 w-1.5 rounded-full bg-sky-500 dark:bg-sky-400" />
                      違いあり ({totalDiffSpecCount})
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      aria-pressed={diffOnly}
                      onClick={() => setDiffOnly((prev) => !prev)}
                      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition ${
                        diffOnly
                          ? 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900'
                          : 'border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300'
                      }`}
                    >
                      <span aria-hidden="true">🔍</span>
                      <span>差分のみ表示</span>
                    </button>
                    <div
                      role="group"
                      aria-label="スペック表示範囲"
                      className="inline-flex rounded-lg bg-zinc-200/70 p-0.5 text-[10px] font-medium dark:bg-zinc-800"
                    >
                      <button
                        type="button"
                        onClick={() => setSpecExpanded(false)}
                        className={`rounded-md px-2 py-0.5 transition ${
                          !specExpanded
                            ? 'bg-white font-semibold text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-100'
                            : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400'
                        }`}
                      >
                        主要項目のみ
                      </button>
                      <button
                        type="button"
                        onClick={() => setSpecExpanded(true)}
                        className={`rounded-md px-2 py-0.5 transition ${
                          specExpanded
                            ? 'bg-white font-semibold text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-100'
                            : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400'
                        }`}
                      >
                        すべて展開
                      </button>
                    </div>
                  </div>
                </div>
                {displayedSpecRows.length === 0 ? (
                  <div className="p-5 text-center text-xs text-zinc-500 dark:text-zinc-400">
                    <span>
                      {cols.length < 2
                        ? '1機種のみ選択中のため、選択中のモデル間で異なるスペック項目はありません'
                        : '選択中のモデル間で異なるスペック項目はありません'}
                    </span>{' '}
                    <button
                      type="button"
                      onClick={() => setDiffOnly(false)}
                      className="font-semibold text-zinc-800 underline underline-offset-2 hover:text-zinc-950 dark:text-zinc-200 dark:hover:text-white"
                    >
                      （すべて表示に戻す）
                    </button>
                  </div>
                ) : (
                  displayedSpecRows.map((er) => (
                    <div key={er.row.key} className="p-3.5">
                      <div className="mb-1.5 flex items-center gap-1.5 text-xs">
                        {er.hasDiff ? (
                          <>
                            <span
                              className="h-1.5 w-1.5 shrink-0 rounded-full bg-sky-500 dark:bg-sky-400"
                              title="比較モデル間で違いがある項目"
                            />
                            <span className="font-bold text-zinc-800 dark:text-zinc-200">{er.row.label}</span>
                          </>
                        ) : (
                          <span className="font-medium text-zinc-400 dark:text-zinc-500">{er.row.label}</span>
                        )}
                      </div>
                      <div className="space-y-1.5 text-xs">
                        {cols.map((c, idx) => (
                          <div
                            key={c.sel.pid}
                            className="flex items-baseline justify-between gap-3 rounded-lg bg-zinc-50 px-2.5 py-1.5 dark:bg-zinc-800/60"
                          >
                            <span className="shrink-0 font-semibold text-zinc-600 dark:text-zinc-400">{c.p.name}</span>
                            <span
                              className={`text-right ${
                                er.hasDiff
                                  ? 'font-medium text-zinc-900 dark:text-zinc-100'
                                  : 'text-zinc-500 dark:text-zinc-500'
                              }`}
                            >
                              {er.values[idx]}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))
                )}
                <button
                  type="button"
                  onClick={() => setSpecExpanded((prev) => !prev)}
                  className="flex w-full items-center justify-center gap-1.5 bg-zinc-50/90 px-3.5 py-2.5 text-xs font-semibold text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-900 dark:bg-zinc-800/50 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                >
                  {specExpanded ? (
                    <span>▲ 詳細スペックを折りたたむ（主要{PRIMARY_SPEC_ROWS.length}項目のみ表示に戻す）</span>
                  ) : (
                    <span>
                      ▼ 詳細スペック（アーキテクチャ・ボードID・モデル番号・対応バンド等 残り{detailEvalRows.length}項目）をすべて表示
                    </span>
                  )}
                </button>
              </div>
            </div>
          )}

          <div
            ref={tableWrapRef}
            data-export-ignore={activeExportScope === 'cards' ? 'true' : undefined}
            className={
              activeExportScope === 'cards'
                ? 'hidden'
                : isExporting
                  ? `${card} block overflow-visible`
                  : `${card} overflow-x-auto ${mobileView === 'stack' ? 'hidden sm:block' : 'block'}`
            }
          >
            <table
              ref={tableElRef}
              className="w-full min-w-[440px] sm:min-w-[720px] border-collapse text-xs sm:text-sm"
            >
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-800">
                  <th
                    className={`${
                      isExporting ? '' : 'sticky left-0 z-10'
                    } w-24 sm:w-36 bg-white p-2 sm:p-3 text-left text-[11px] sm:text-xs font-semibold text-zinc-500 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.06)] dark:bg-zinc-900 dark:text-zinc-400`}
                  >
                    項目
                  </th>
                  {cols.map((c) => {
                    const discInfo = getSkuDiscontinuedInfo(c.p, c.sku);
                    return (
                      <th key={c.sel.pid} className="min-w-[160px] sm:min-w-[220px] p-2 sm:p-3 text-left align-top">
                        <div className="flex flex-wrap items-center gap-1.5 text-sm sm:text-base font-bold text-zinc-900 dark:text-zinc-50">
                          <CatIcon cat={c.p.category} className="h-4 w-4 shrink-0" />
                          <span>{c.p.name}</span>
                        </div>
                        <div className="mt-0.5 mb-1.5 flex flex-wrap items-center gap-1.5 text-[11px] sm:text-xs font-normal text-zinc-500 dark:text-zinc-400">
                          <span>{c.p.generation} ・ {c.p.releaseDate} 発売</span>
                          {discInfo.isDiscontinued ? (
                            <span className="inline-flex items-center gap-1 rounded-md bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                              終売・最終価格{discInfo.discontinuedDate ? ` (${discInfo.discontinuedDate})` : ''}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-md bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                              現行販売中
                            </span>
                          )}
                        </div>
                        {isExporting ? (
                          <div className="inline-flex items-center rounded-md border border-zinc-300 bg-zinc-100 px-2.5 py-1 text-xs font-semibold text-zinc-800 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100">
                            容量・仕様: {c.sku.label}
                          </div>
                        ) : (
                          <select
                            data-export-ignore="true"
                            className={`${selectCls} w-full`}
                            value={c.sku.id}
                            onChange={(e) => setSels(sels.map((s) => (s.pid === c.sel.pid ? { ...s, sid: e.target.value } : s)))}
                          >
                            {c.p.skus.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
                          </select>
                        )}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {showFlags.tradein && tradeInEst && (
                  <>
                    <tr className="bg-zinc-50 dark:bg-zinc-800/50">
                      <td colSpan={cols.length + 1} className="px-2.5 sm:px-3 py-1.5 text-[11px] sm:text-xs font-bold text-zinc-600 dark:text-zinc-300">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span>
                            🔄 買い替え追い金（実質差額）＆スペック進化 — {tradeInEst.myProduct.name} ({tradeInEst.mySku.label}) 下取り差引: −{yen(tradeInEst.activeYen)}
                          </span>
                          <span className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400">
                            {tradeInEst.sellModeLabel}
                          </span>
                        </div>
                      </td>
                    </tr>
                    <tr className="border-b border-zinc-100 dark:border-zinc-800">
                      <td
                        className={`${
                          isExporting ? '' : 'sticky left-0 z-10'
                        } bg-white p-2 sm:p-3 align-top shadow-[2px_0_5px_-2px_rgba(0,0,0,0.06)] dark:bg-zinc-900`}
                      >
                        <div className="inline-flex items-center gap-1.5 text-xs font-bold text-zinc-700 dark:text-zinc-300">
                          <span aria-hidden="true">🔄</span>
                          実質追い金・進化点
                        </div>
                        <div className="mt-0.5 text-[10px] text-zinc-400">
                          {tradeInEst.myProduct.name} から乗換
                        </div>
                      </td>
                      {cols.map((c) => {
                        const u = getUsedData(c);
                        const { appleNewPrice, bestReturnCost } = getCardTradeInProps(c);
                        return (
                          <td key={c.sel.pid} className="p-1.5 sm:p-2 align-top">
                            <TradeInCardOverlay
                              tradeInEst={tradeInEst}
                              targetProduct={c.p}
                              targetSku={c.sku}
                              appleNewPrice={appleNewPrice}
                              lowestUsedPrice={u.usedPricing.lowestPrice}
                              bestReturnCost={bestReturnCost}
                              compact
                              inTable
                            />
                          </td>
                        );
                      })}
                    </tr>
                  </>
                )}
                <tr className="bg-zinc-50 dark:bg-zinc-800/50"><td colSpan={cols.length + 1} className="px-2.5 sm:px-3 py-1.5 text-[11px] sm:text-xs font-bold uppercase tracking-wider text-zinc-500">価格 — {mode === 'bulk' ? '一括' : '2年返却 実質負担額'}{mnp ? ' (MNP/新規割引後)' : ''}</td></tr>
                {CARRIER_ORDER.map((id) => (
                  <tr key={id} className="border-b border-zinc-100 dark:border-zinc-800">
                    <td
                      className={`${
                        isExporting ? '' : 'sticky left-0 z-10'
                      } bg-white p-2 sm:p-3 align-middle shadow-[2px_0_5px_-2px_rgba(0,0,0,0.06)] dark:bg-zinc-900`}
                    >
                      <CarrierBadge id={id} small />
                    </td>
                    {cols.map((c) => {
                      const cp = c.sku.carriers[id];
                      const v = carrierValue(cp, mode, mnp);
                      const ch = cheapest(c);
                      const isMin = v != null && ch.ids.includes(id);
                      const discInfo = getSkuDiscontinuedInfo(c.p, c.sku);
                      const isDisc = Boolean(cp?.isDiscontinued ?? discInfo.isDiscontinued);

                      const subParts: string[] = [];
                      if (cp && v != null) {
                        if (mode === 'bulk') {
                          if (!mnp && cp.mnpPrice != null) {
                            subParts.push(`MNP ${yen(cp.mnpPrice)}`);
                          } else if (mnp && cp.mnpPrice != null && cp.currentPrice !== cp.mnpPrice) {
                            subParts.push(`通常一括 ${yen(cp.currentPrice)}`);
                          }
                          if (cp.returnProgram) {
                            subParts.push(`2年返却 ${yen(cp.returnProgram.effectiveCost)}`);
                          }
                        } else {
                          subParts.push(`通常一括 ${yen(cp.currentPrice)}`);
                          if (cp.mnpPrice != null) {
                            subParts.push(`MNP一括 ${yen(cp.mnpPrice)}`);
                          }
                        }
                      }
                      const hasLaunchDiff = Boolean(cp && cp.launchPrice !== cp.currentPrice);
                      if (hasLaunchDiff && cp && subParts.length === 0) {
                        subParts.push(`発売時 ${yen(cp.launchPrice)}`);
                      }

                      const latestPt =
                        id === 'apple' && c.sku.priceHistory.length > 0
                          ? lastOf(c.sku.priceHistory)
                          : undefined;
                      const fxEval =
                        showFlags.fx && latestPt ? evaluateCurrentFxFairness(latestPt) : null;

                      return (
                        <td
                          key={c.sel.pid}
                          className={`px-2.5 py-2 sm:px-3 sm:py-2.5 align-top transition-colors ${
                            isMin ? 'bg-emerald-50/50 dark:bg-emerald-950/20' : ''
                          }`}
                        >
                          {v == null ? (
                            <div className="text-xs text-zinc-400 dark:text-zinc-500">
                              {cp
                                ? mode === 'return'
                                  ? '返却プログラム対象外'
                                  : '—'
                                : id === 'apple'
                                  ? c.p.specs.launchPriceUsd
                                    ? `日本未発売 (米国 ${String(c.p.specs.launchPriceUsd)})`
                                    : '価格データなし'
                                  : '取扱なし'}
                            </div>
                          ) : (
                            <div className="space-y-0.5">
                              {/* 1行目: メイン価格 ＋ 月々目安(返却モード時) ＋ 最安ピル or 最安との差額 */}
                              <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 whitespace-nowrap">
                                <span
                                  className={`text-sm sm:text-base font-extrabold tabular-nums ${
                                    isDisc
                                      ? 'text-zinc-700 dark:text-zinc-200'
                                      : 'text-zinc-900 dark:text-zinc-50'
                                  }`}
                                >
                                  {yen(v)}
                                </span>
                                {mode === 'return' && cp?.returnProgram && (
                                  <span className="text-[11px] font-normal tabular-nums text-zinc-500 dark:text-zinc-400">
                                    （月々約{yen(Math.round(v / (cp.returnProgram.months || 24)))}）
                                  </span>
                                )}
                                {isMin ? (
                                  <span className="inline-flex items-center gap-1 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300">
                                    <span
                                      className={`h-1.5 w-1.5 rounded-full ${
                                        isDisc ? 'bg-amber-500' : 'bg-emerald-500'
                                      }`}
                                    />
                                    {isDisc ? '終売最安' : '最安'}
                                  </span>
                                ) : ch.min != null ? (
                                  <span className="text-[11px] font-medium tabular-nums text-zinc-400 dark:text-zinc-500">
                                    ({signedYen(v - ch.min)})
                                  </span>
                                ) : null}
                              </div>

                              {/* 2行目: 補足データ（MNP / 2年返却 / 通常一括 等を1行で凝縮） */}
                              {subParts.length > 0 && (
                                <div className="truncate text-[11px] tabular-nums text-zinc-500 dark:text-zinc-400">
                                  {subParts.join(' ｜ ')}
                                </div>
                              )}

                              {/* 3行目: 発売時と現在価格が異なる場合のみ小さく表示 */}
                              {hasLaunchDiff && cp && subParts[0] !== `発売時 ${yen(cp.launchPrice)}` && (
                                <div className="text-[10px] tabular-nums text-zinc-400 dark:text-zinc-500">
                                  発売時 {yen(cp.launchPrice)}
                                </div>
                              )}

                              {/* Apple Store行の為替1行コンパクト表示（為替トグルON時のみ） */}
                              {fxEval && fxEval.status !== 'none' && fxEval.pctDiff != null && (
                                <div className="truncate whitespace-nowrap text-[10px] tabular-nums text-zinc-500 dark:text-zinc-400">
                                  為替:{' '}
                                  <span
                                    className={
                                      fxEval.status === 'bargain'
                                        ? 'font-semibold text-emerald-600 dark:text-emerald-400'
                                        : fxEval.status === 'expensive'
                                          ? 'font-semibold text-rose-600 dark:text-rose-400'
                                          : 'font-medium text-zinc-600 dark:text-zinc-300'
                                    }
                                  >
                                    {fxEval.status === 'bargain'
                                      ? '割安'
                                      : fxEval.status === 'expensive'
                                        ? '割高'
                                        : '適正'}{' '}
                                    {signedPct(fxEval.pctDiff)}
                                  </span>
                                  {fxEval.appleRate != null && (
                                    <span className="text-zinc-400 dark:text-zinc-500">
                                      {' '}
                                      (Apple ¥{fxEval.appleRate.toFixed(1)}/$)
                                    </span>
                                  )}
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
                    中古相場・資産価値 — 楽天市場 ＆ Yahoo!ショッピング 横断比較
                  </td>
                </tr>
                <tr className="border-b border-zinc-100 dark:border-zinc-800">
                  <td
                    className={`${
                      isExporting ? '' : 'sticky left-0 z-10'
                    } bg-white p-2 sm:p-3 align-top shadow-[2px_0_5px_-2px_rgba(0,0,0,0.06)] dark:bg-zinc-900`}
                  >
                    <div className="inline-flex items-center gap-1.5 text-xs font-bold text-zinc-700 dark:text-zinc-200">
                      <ShoppingBag className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
                      現在の中古相場
                    </div>
                    <div className="mt-0.5 text-[10px] text-zinc-400">楽天・Yahoo!横断比較</div>
                  </td>
                  {cols.map((c) => {
                    const u = getUsedData(c);
                    const up = u.usedPricing;
                    const isEstimated = Boolean(u.isEstimated || u.source === 'mock' || up.isEstimated);
                    const isYahooLowest = up.lowestPlatform === 'yahoo';
                    const bestOffer = isYahooLowest ? up.yahoo ?? up.rakuten : up.rakuten ?? up.yahoo;
                    const isShopsOpen = openShopCards[c.sel.pid] ?? showFlags.shops;
                    const offerCount = (up.offers ?? u.offers ?? []).length;
                    const metaLineParts = [
                      u.unused ? `未使用品目安: ${yen(u.unused.price)}` : null,
                      u.launchPrice ? `発売時定価: ${yen(u.launchPrice)}` : null,
                    ].filter(Boolean);

                    return (
                      <td key={c.sel.pid} className="px-2.5 py-2 sm:px-3 sm:py-2.5 align-top">
                        <div className="space-y-1">
                          {/* 1行目: ステータスバッジ + メイン価格 + リセール率バッジを横1行で揃え段落ちを防止 */}
                          <div className="flex items-baseline gap-2 whitespace-nowrap">
                            <span className="text-sm sm:text-base font-extrabold tabular-nums text-zinc-900 dark:text-zinc-50">
                              {isEstimated ? `約${yen(up.lowestPrice)}` : yen(up.lowestPrice)}
                            </span>
                            {up.resaleValuePercent != null && (
                              <span
                                className="inline-flex items-center gap-1 rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                                title={
                                  u.launchPrice
                                    ? `発売時定価 ${yen(u.launchPrice)} に対する残価率`
                                    : undefined
                                }
                              >
                                <span
                                  className={`h-1.5 w-1.5 rounded-full ${
                                    up.resaleValuePercent >= 70
                                      ? 'bg-emerald-500'
                                      : up.resaleValuePercent >= 50
                                        ? 'bg-sky-500'
                                        : up.resaleValuePercent >= 35
                                          ? 'bg-amber-500'
                                          : 'bg-zinc-400'
                                  }`}
                                />
                                リセール {up.resaleValuePercent}%
                              </span>
                            )}
                            {isEstimated ? (
                              <span className="inline-flex items-center rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                                参考推定相場
                              </span>
                            ) : (
                              <>
                                <span className="inline-flex items-center gap-1 rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                                  <span
                                    className={`h-1.5 w-1.5 rounded-full ${
                                      isYahooLowest ? 'bg-amber-500' : 'bg-rose-500'
                                    }`}
                                  />
                                  {isYahooLowest ? 'Yahoo!最安' : '楽天最安'}
                                </span>
                                <TrustedShopBadge isTrusted={bestOffer?.isTrustedShop} compact />
                              </>
                            )}
                          </div>

                          {/* 2行目: 未使用品目安 ｜ 発売時定価（不要な内部計算式表記は削除） */}
                          {metaLineParts.length > 0 && (
                            <div className="truncate text-[11px] tabular-nums text-zinc-500 dark:text-zinc-400">
                              {metaLineParts.join(' ｜ ')}
                            </div>
                          )}

                          {/* 3行目: アクションリンク / ボタン */}
                          {isEstimated ? (
                            <div data-export-ignore="true" className="flex flex-wrap items-center gap-1.5 pt-0.5">
                              <a
                                href={u.rakutenSearchUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 rounded-md border border-zinc-200/80 bg-zinc-50/80 px-2 py-0.5 text-[11px] font-medium text-zinc-600 transition hover:border-zinc-300 hover:bg-zinc-100 hover:text-zinc-900 focus:outline-none focus-visible:ring-1 focus-visible:ring-zinc-600 dark:border-zinc-800 dark:bg-zinc-800/50 dark:text-zinc-300 dark:hover:border-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                              >
                                <span>楽天市場で実際の在庫を検索</span>
                                <ExternalLink className="h-2.5 w-2.5 shrink-0" />
                              </a>
                              <a
                                href={u.yahooSearchUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 rounded-md border border-zinc-200/80 bg-zinc-50/80 px-2 py-0.5 text-[11px] font-medium text-zinc-600 transition hover:border-zinc-300 hover:bg-zinc-100 hover:text-zinc-900 focus:outline-none focus-visible:ring-1 focus-visible:ring-zinc-600 dark:border-zinc-800 dark:bg-zinc-800/50 dark:text-zinc-300 dark:hover:border-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                              >
                                <span>Yahoo!で実際の在庫を検索</span>
                                <ExternalLink className="h-2.5 w-2.5 shrink-0" />
                              </a>
                            </div>
                          ) : (
                            <>
                              <div data-export-ignore="true" className="flex flex-wrap items-center gap-1.5 pt-0.5">
                                {offerCount > 0 && (
                                  <button
                                    type="button"
                                    onClick={() => openShopComparisonModal(c.p, c.sku)}
                                    className="inline-flex items-center gap-1 rounded-md border border-zinc-200/90 bg-zinc-50/90 px-2 py-0.5 text-[11px] font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-100 hover:text-zinc-900 focus:outline-none focus-visible:ring-1 focus-visible:ring-zinc-600 dark:border-zinc-800 dark:bg-zinc-800/60 dark:text-zinc-200 dark:hover:border-zinc-700 dark:hover:bg-zinc-800"
                                  >
                                    <span aria-hidden="true">🏪</span>
                                    <span>ショップ比較 ({offerCount}件)</span>
                                  </button>
                                )}
                                {!isShopsOpen && (
                                  <button
                                    type="button"
                                    onClick={() => setOpenShopCards((prev) => ({ ...prev, [c.sel.pid]: true }))}
                                    className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[11px] font-medium text-zinc-500 hover:text-zinc-900 focus:outline-none focus-visible:ring-1 focus-visible:ring-zinc-600 dark:text-zinc-400 dark:hover:text-zinc-100"
                                  >
                                    <span>内訳</span>
                                    <ChevronDown className="h-3 w-3" />
                                  </button>
                                )}
                              </div>

                              {isShopsOpen && (
                                <div className="space-y-0.5 pt-1 text-[11px]">
                                  {up.rakuten && (
                                    <div className="flex items-center justify-between gap-1.5">
                                      <span className="truncate text-zinc-600 dark:text-zinc-300">
                                        <span className="font-medium text-zinc-500">楽天:</span>{' '}
                                        <strong className="font-bold tabular-nums text-zinc-900 dark:text-zinc-100">
                                          {yen(up.rakuten.price)}
                                        </strong>{' '}
                                        <span className="text-zinc-500 dark:text-zinc-400">
                                          ({up.rakuten.shopName})
                                        </span>
                                      </span>
                                      <a
                                        data-export-ignore="true"
                                        href={up.rakuten.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex shrink-0 items-center gap-0.5 font-medium text-zinc-500 hover:text-zinc-900 hover:underline dark:text-zinc-400 dark:hover:text-zinc-100"
                                      >
                                        商品 <ExternalLink className="h-2.5 w-2.5" />
                                      </a>
                                    </div>
                                  )}
                                  {up.yahoo && (
                                    <div className="flex items-center justify-between gap-1.5">
                                      <span className="truncate text-zinc-600 dark:text-zinc-300">
                                        <span className="font-medium text-zinc-500">Yahoo!:</span>{' '}
                                        <strong className="font-bold tabular-nums text-zinc-900 dark:text-zinc-100">
                                          {yen(up.yahoo.price)}
                                        </strong>{' '}
                                        <span className="text-zinc-500 dark:text-zinc-400">
                                          ({up.yahoo.shopName})
                                        </span>
                                      </span>
                                      <a
                                        data-export-ignore="true"
                                        href={up.yahoo.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex shrink-0 items-center gap-0.5 font-medium text-zinc-500 hover:text-zinc-900 hover:underline dark:text-zinc-400 dark:hover:text-zinc-100"
                                      >
                                        商品 <ExternalLink className="h-2.5 w-2.5" />
                                      </a>
                                    </div>
                                  )}
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      </td>
                    );
                  })}
                </tr>
                {showFlags.fx && (
                  <>
                    <tr className="bg-zinc-50 dark:bg-zinc-800/50">
                      <td colSpan={cols.length + 1} className="px-2.5 sm:px-3 py-1.5 text-[11px] sm:text-xs font-bold uppercase tracking-wider text-zinc-500">
                        為替レート比較 — 当時の市場レート（Frankfurter API） vs Apple適用レート（税抜円÷USD） ＆ 今の為替から見た割安・割高判定
                      </td>
                    </tr>
                    <tr className="border-b border-zinc-100 dark:border-zinc-800">
                      <td
                        className={`${
                          isExporting ? '' : 'sticky left-0 z-10'
                        } bg-white p-2 sm:p-3 align-top text-[11px] sm:text-xs font-semibold text-zinc-500 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.06)] dark:bg-zinc-900 dark:text-zinc-400`}
                      >
                        <div>今の為替レート判定</div>
                        <div className="mt-0.5 text-[10px] font-normal text-zinc-400">現在レート理論価格(税込10%)比</div>
                      </td>
                      {cols.map((c) => {
                        const curPt = c.sku.priceHistory.length ? lastOf(c.sku.priceHistory) : undefined;
                        return (
                          <td key={c.sel.pid} className="p-2 sm:p-3 align-top">
                            {curPt ? (
                              <div className="space-y-1">
                                <CurrentFxFairnessBadge pt={curPt} compact={false} showFairPrice={true} />
                              </div>
                            ) : (
                              <span className="text-zinc-400">—</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                    <tr className="border-b border-zinc-100 dark:border-zinc-800">
                      <td
                        className={`${
                          isExporting ? '' : 'sticky left-0 z-10'
                        } bg-white p-2 sm:p-3 align-top text-[11px] sm:text-xs font-semibold text-zinc-500 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.06)] dark:bg-zinc-900 dark:text-zinc-400`}
                      >
                        <div>当時の市場レート vs Apple適用レート</div>
                        <div className="mt-0.5 text-[10px] font-normal text-zinc-400">発売時 ／ 最新改定時</div>
                      </td>
                      {cols.map((c) => {
                        const launchPt = c.sku.priceHistory[0];
                        const curPt = c.sku.priceHistory.length ? lastOf(c.sku.priceHistory) : undefined;
                        return (
                          <td key={c.sel.pid} className="p-2 sm:p-3 align-top">
                            {launchPt ? (
                              <div className="space-y-1.5">
                                <div>
                                  <div className="mb-0.5 text-[10px] font-semibold text-zinc-500">発売時 ({launchPt.date} / US ${launchPt.usdPrice ?? '—'}):</div>
                                  <FxRatePairChip pt={launchPt} />
                                </div>
                                {curPt && curPt !== launchPt && (
                                  <div>
                                    <div className="mb-0.5 text-[10px] font-semibold text-zinc-500">最新/終売時 ({curPt.date} / US ${curPt.usdPrice ?? '—'}):</div>
                                    <FxRatePairChip pt={curPt} />
                                  </div>
                                )}
                              </div>
                            ) : (
                              <span className="text-zinc-400">—</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  </>
                )}
                <tr className="bg-zinc-50 dark:bg-zinc-800/50">
                  <td colSpan={cols.length + 1} className="px-2.5 sm:px-3 py-2 text-[11px] sm:text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-bold uppercase tracking-wider text-zinc-600 dark:text-zinc-300">
                          スペック比較
                        </span>
                        <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
                          <span className="h-1.5 w-1.5 rounded-full bg-sky-500 dark:bg-sky-400" />
                          <span>違いがある項目 ({totalDiffSpecCount}件)</span>
                        </span>
                      </div>
                      {isExporting ? (
                        <span className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
                          {diffOnly
                            ? '🔍 違いがある項目のみ表示中'
                            : specExpanded
                              ? '📋 全スペック項目を表示中'
                              : `📋 主要スペック${PRIMARY_SPEC_ROWS.length}項目を表示中`}
                        </span>
                      ) : (
                        <div data-export-ignore="true" className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            aria-pressed={diffOnly}
                            onClick={() => setDiffOnly((prev) => !prev)}
                            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition ${
                              diffOnly
                                ? 'border-zinc-900 bg-zinc-900 text-white shadow-sm dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900'
                                : 'border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300 hover:bg-zinc-100 hover:text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800'
                            }`}
                          >
                            <span aria-hidden="true">🔍</span>
                            <span>差分のみ表示（同じ項目を隠す）</span>
                          </button>
                          <div className="inline-flex items-center gap-1.5">
                            <span className="hidden md:inline text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
                              📋 スペック表示範囲:
                            </span>
                            <div
                              role="group"
                              aria-label="スペック表示範囲"
                              className="inline-flex rounded-lg bg-zinc-200/80 p-0.5 text-[11px] font-medium dark:bg-zinc-800"
                            >
                              <button
                                type="button"
                                onClick={() => setSpecExpanded(false)}
                                className={`rounded-md px-2 py-0.5 transition ${
                                  !specExpanded
                                    ? 'bg-white font-semibold text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-100'
                                    : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200'
                                }`}
                              >
                                主要項目のみ（初期）
                              </button>
                              <button
                                type="button"
                                onClick={() => setSpecExpanded(true)}
                                className={`rounded-md px-2 py-0.5 transition ${
                                  specExpanded
                                    ? 'bg-white font-semibold text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-100'
                                    : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200'
                                }`}
                              >
                                すべて展開
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
                {displayedSpecRows.length === 0 ? (
                  <tr className="border-b border-zinc-100 dark:border-zinc-800">
                    <td colSpan={cols.length + 1} className="p-4 text-center text-xs text-zinc-500 dark:text-zinc-400">
                      <span>
                        {cols.length < 2
                          ? '1機種のみ選択中のため、選択中のモデル間で異なるスペック項目はありません'
                          : '選択中のモデル間で異なるスペック項目はありません'}
                      </span>{' '}
                      <button
                        data-export-ignore="true"
                        type="button"
                        onClick={() => setDiffOnly(false)}
                        className="ml-1 font-semibold text-zinc-800 underline underline-offset-2 hover:text-zinc-950 dark:text-zinc-200 dark:hover:text-white"
                      >
                        （すべて表示に戻す）
                      </button>
                      {!specExpanded && visibleDetailRows.length > 0 && (
                        <button
                          data-export-ignore="true"
                          type="button"
                          onClick={() => setSpecExpanded(true)}
                          className="ml-2 font-semibold text-zinc-700 underline underline-offset-2 hover:text-zinc-950 dark:text-zinc-300 dark:hover:text-white"
                        >
                          （詳細スペックの差分 {visibleDetailRows.length}項目を表示）
                        </button>
                      )}
                    </td>
                  </tr>
                ) : (
                  displayedSpecRows.map((er) => (
                    <tr key={er.row.key} className="border-b border-zinc-100 dark:border-zinc-800">
                      <td
                        className={`${
                          isExporting ? '' : 'sticky left-0'
                        } bg-white p-2 sm:p-3 text-[11px] sm:text-xs shadow-[2px_0_5px_-2px_rgba(0,0,0,0.06)] dark:bg-zinc-900 ${
                          er.hasDiff
                            ? 'font-semibold text-zinc-800 dark:text-zinc-200'
                            : 'font-normal text-zinc-500 dark:text-zinc-500'
                        }`}
                      >
                        <div className="inline-flex items-center gap-1.5">
                          {er.hasDiff ? (
                            <span
                              className="h-1.5 w-1.5 shrink-0 rounded-full bg-sky-500 dark:bg-sky-400"
                              title="比較中のモデル間で違いがある項目"
                            />
                          ) : (
                            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-transparent" aria-hidden="true" />
                          )}
                          <span>{er.row.label}</span>
                        </div>
                      </td>
                      {cols.map((c, idx) => (
                        <td
                          key={c.sel.pid}
                          className={`p-2 sm:p-3 align-top ${
                            er.hasDiff
                              ? 'font-medium text-zinc-900 dark:text-zinc-100'
                              : 'text-zinc-500 dark:text-zinc-500'
                          }`}
                        >
                          {er.values[idx]}
                        </td>
                      ))}
                    </tr>
                  ))
                )}
                <tr data-export-ignore="true" className={isExporting ? 'hidden' : ''}>
                  <td colSpan={cols.length + 1} className="p-0">
                    <button
                      type="button"
                      onClick={() => setSpecExpanded((prev) => !prev)}
                      className="flex w-full items-center justify-center gap-1.5 bg-zinc-50/90 px-4 py-2.5 text-xs font-semibold text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-900 dark:bg-zinc-800/50 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                    >
                      {specExpanded ? (
                        <span>
                          ▲ 詳細スペックを折りたたむ（主要{PRIMARY_SPEC_ROWS.length}項目のみ表示に戻す）
                        </span>
                      ) : (
                        <span>
                          ▼ 詳細スペック（アーキテクチャ・ボードID・モデル番号・対応バンド等 残り{detailEvalRows.length}項目{diffOnly ? ` / 差分${visibleDetailRows.length}項目` : ''}）をすべて表示
                        </span>
                      )}
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* 画像出力時のみ最下部に表示される出典クレジット＆免責フッター */}
          {isExporting ? (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-200 pt-3 text-xs dark:border-zinc-800">
              <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
                ※価格は税込の目安（キャリア返却プログラム・MNP割引・中古最安値を含む）。条件・時期により実際の金額は異なります。
              </span>
              <div className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-zinc-100/90 px-2.5 py-1 text-xs font-bold tracking-tight text-zinc-800 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100">
                <Apple className="h-3.5 w-3.5 shrink-0" />
                <span>Apple Price Atlas | apple.azarin.me</span>
              </div>
            </div>
          ) : (
            <p data-export-ignore="true" className="flex items-start gap-1.5 text-xs text-zinc-500">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              キャリア価格・返却時の実質負担額は目安のモデル値です。プログラム条件(回数・手数料・端末状態)により実際の金額は異なります。
            </p>
          )}
        </div>
      )}

      {activeShopModal && (
        <UsedShopOffersModal
          product={activeShopModal.p}
          sku={activeShopModal.sku}
          usedInfo={
            usedMap[`${activeShopModal.p.id}__${activeShopModal.sku.id}`] ??
            estimateUsedMarketData(activeShopModal.p, activeShopModal.sku)
          }
          isLoadingLive={loadingModalKey === `${activeShopModal.p.id}__${activeShopModal.sku.id}`}
          onRefreshLive={() => triggerLiveOffersFetch(activeShopModal.p, activeShopModal.sku, true)}
          onClose={() => setActiveShopModal(null)}
        />
      )}
    </div>
  );
}

/* =====================================================================================
 * 6. タブ2: 価格改定タイムライン＆推移グラフ
 * ===================================================================================== */

function TimelineView({ products, toast }: { products: Product[]; toast: (m: string) => void }) {
  const priced = products.filter(hasPrice);
  return priced.length ? <TimelineInner products={priced} toast={toast} /> : <EmptyNote text="価格データのある機種がありません" />;
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
        {h.length > 0 && (
          <div className="mt-3 rounded-xl border border-sky-200/80 bg-sky-50/50 p-3 dark:border-sky-900/50 dark:bg-sky-950/25">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-bold text-zinc-800 dark:text-zinc-100">
                現在のApple Store価格 × 今の為替レート判定 ({p.name} {sku.label})
              </div>
              <CurrentFxFairnessBadge pt={lastOf(h)} showFairPrice={true} />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
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
                {pt.usdPrice != null && <span className="text-xs font-semibold tabular-nums text-zinc-500">US ${pt.usdPrice}</span>}
                {i === timelineEvents.length - 1 && <CurrentFxFairnessBadge pt={pt} compact showFairPrice={true} />}
              </div>
              <div className="mt-1.5">
                <FxRatePairChip pt={pt} />
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

/** 1行インライン為替レート表示 (Apple適用レート + 市場レート + 割高/割安バッジ) */
function InlineFxRateCell({ pt, showMarket = true }: { pt?: PricePoint; showMarket?: boolean }) {
  if (!pt) return <span className="text-xs text-zinc-400">—</span>;
  const apl = impliedRate(pt);
  const mkt = marketRate(pt);
  const diff = rateDiffVal(pt);
  if (apl == null && mkt == null) return <span className="text-xs text-zinc-400">—</span>;

  return (
    <div className="inline-flex items-center gap-1.5 whitespace-nowrap tabular-nums">
      {apl != null ? (
        <span className="text-xs font-extrabold text-sky-600 dark:text-sky-400">
          Apple ¥{apl.toFixed(1)}/$
        </span>
      ) : (
        <span className="text-xs text-zinc-400">Apple —</span>
      )}
      {showMarket && mkt != null && (
        <span className="text-[11px] text-zinc-400 dark:text-zinc-500">
          （市場 ¥{mkt.toFixed(1)}）
        </span>
      )}
      {diff != null && (
        diff > 0.5 ? (
          <span className="inline-flex items-center rounded border border-rose-200 bg-rose-50 px-1.5 py-0.5 text-[10px] font-bold leading-none text-rose-600 dark:border-rose-500/30 dark:bg-rose-500/15 dark:text-rose-300">
            +¥{diff.toFixed(1)} 割高
          </span>
        ) : diff < -0.5 ? (
          <span className="inline-flex items-center rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold leading-none text-emerald-600 dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-300">
            -¥{Math.abs(diff).toFixed(1)} 割安
          </span>
        ) : (
          <span className="inline-flex items-center rounded border border-zinc-200 bg-zinc-100 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
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
        className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-zinc-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-zinc-600 shadow-2xs transition hover:border-sky-300 hover:bg-sky-50 hover:text-sky-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:border-sky-500/50 dark:hover:bg-sky-500/15 dark:hover:text-sky-300"
      >
        <span>{sources.length > 0 ? `🔗 出典 (${sources.length})` : 'ℹ️ ソース'}</span>
      </button>

      {open && (
        <div className="absolute right-0 bottom-full z-40 mb-1.5 w-72 sm:w-80 rounded-xl border border-zinc-200 bg-white p-3 text-left text-xs shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
          <div className="mb-1.5 flex items-center justify-between gap-2 border-b border-zinc-100 pb-1.5 dark:border-zinc-800">
            <span className="font-bold text-zinc-800 dark:text-zinc-100">📚 出典・エビデンス ({sources.length}件)</span>
            {pt.confidence === 'high' ? (
              <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300">出典確認済</span>
            ) : pt.approx ? (
              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">概算・推定</span>
            ) : null}
          </div>
          {sources.length > 0 && (
            <ul className="space-y-1 text-[11px] text-zinc-600 dark:text-zinc-300">
              {sources.map((s, idx) => {
                const isUrl = /^https?:\/\//.test(s);
                return (
                  <li key={idx} className="flex items-start gap-1.5 break-all">
                    <span className="mt-0.5 text-sky-500">•</span>
                    {isUrl ? (
                      <a href={s} target="_blank" rel="noreferrer" className="text-sky-600 hover:underline dark:text-sky-400">
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
            <div className="mt-2 rounded-lg bg-zinc-50 p-2 text-[11px] leading-relaxed text-zinc-600 dark:bg-zinc-800/70 dark:text-zinc-300">
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
    launch: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300', up: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
    down: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300', end: 'bg-zinc-200 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300',
  };
  const kindLabel: Record<EvRow['kind'], string> = { launch: '発売', up: '値上げ', down: '値下げ', end: '販売終了' };

  const quickFilterPills: { value: EvKind; label: string; count: number; activeCls: string }[] = [
    { value: 'all', label: 'すべて', count: rows.length, activeCls: 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900' },
    { value: 'up', label: '📈 値上げのみ', count: counts.up, activeCls: 'border-rose-600 bg-rose-600 text-white dark:border-rose-500 dark:bg-rose-500 dark:text-white' },
    { value: 'down', label: '📉 値下げのみ', count: counts.down, activeCls: 'border-emerald-600 bg-emerald-600 text-white dark:border-emerald-500 dark:bg-emerald-500 dark:text-white' },
    { value: 'end', label: '📦 販売終了のみ', count: counts.end, activeCls: 'border-zinc-600 bg-zinc-600 text-white dark:border-zinc-400 dark:bg-zinc-300 dark:text-zinc-900' },
    { value: 'launch', label: '🚀 発売時のみ', count: counts.launch, activeCls: 'border-sky-600 bg-sky-600 text-white dark:border-sky-500 dark:bg-sky-500 dark:text-white' },
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
    <div className={`${card} p-3.5 sm:p-5`}>
      {/* 上段: タイトル & 表示モード切替 & 出力ボタン */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2.5">
          <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-50">
            全機種 価格イベント一覧 <span className="text-xs font-semibold text-zinc-500">({filtered.length}件)</span>
          </h3>
          <div className="inline-flex rounded-xl bg-zinc-100 p-0.5 dark:bg-zinc-800">
            <button
              type="button"
              onClick={() => setViewMode('grouped')}
              className={`rounded-lg px-2.5 py-1 text-xs font-bold transition ${viewMode === 'grouped' ? 'bg-white text-zinc-900 shadow-2xs dark:bg-zinc-900 dark:text-zinc-50' : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200'}`}
            >
              📅 日付・イベント別グループ表示
            </button>
            <button
              type="button"
              onClick={() => setViewMode('flat')}
              className={`rounded-lg px-2.5 py-1 text-xs font-bold transition ${viewMode === 'flat' ? 'bg-white text-zinc-900 shadow-2xs dark:bg-zinc-900 dark:text-zinc-50' : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200'}`}
            >
              📋 フラット一覧表
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
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

      {/* 中段: クイックフィルターピル (1クリック絞り込み) */}
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {quickFilterPills.map((pill) => {
          const active = kind === pill.value;
          return (
            <button
              key={pill.value}
              type="button"
              onClick={() => { setKind(pill.value); setLimit(150); }}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold transition ${
                active
                  ? pill.activeCls
                  : 'border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800/80 dark:text-zinc-300 dark:hover:bg-zinc-800'
              }`}
            >
              <span>{pill.label}</span>
              <span className={`rounded-full px-1.5 py-0.2 text-[10px] tabular-nums ${active ? 'bg-white/20 text-current' : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-700 dark:text-zinc-400'}`}>
                {pill.count}
              </span>
            </button>
          );
        })}

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <select className={`${selectCls} py-1 text-xs`} value={cat} onChange={(e) => { setCat(e.target.value); setLimit(150); }}>
            <option value="">全カテゴリ</option>
            {cats.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <input
            value={q}
            onChange={(e) => { setQ(e.target.value); setLimit(150); }}
            placeholder="製品名・イベントで検索..."
            className={`${selectCls} w-44 sm:w-52 py-1 text-xs`}
          />
          <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs font-medium text-zinc-700 dark:text-zinc-300">
            <input type="checkbox" checked={allSkus} onChange={(e) => setAllSkus(e.target.checked)} className="h-3.5 w-3.5 accent-sky-500" />
            全容量SKU
          </label>
          <button className={`${btnCls} py-1 text-xs`} onClick={() => setSortDesc(!sortDesc)}>
            {sortDesc ? '↓ 新しい順' : '↑ 古い順'}
          </button>
        </div>
      </div>

      {filtered.length === 0 && (
        <div className="rounded-xl border border-dashed border-zinc-200 py-8 text-center text-sm text-zinc-500 dark:border-zinc-800">
          条件に一致する価格イベントがありません
        </div>
      )}
      {/* ==================== モードA: 日付・イベント別グループ表示 (デフォルト) ==================== */}
      {viewMode === 'grouped' && filtered.length > 0 && (
        <div className="space-y-3">
          {dateGroups.map((grp) => {
            const allGrpSelected = grp.items.every((r) => selected.has(r.key));
            return (
              <div
                key={grp.date}
                className="overflow-hidden rounded-xl border border-zinc-200/90 bg-white dark:border-zinc-800 dark:bg-zinc-900/70"
              >
                {/* グループヘッダー（見出しバー） */}
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-200/80 bg-zinc-50/90 px-3 py-2 text-xs dark:border-zinc-800 dark:bg-zinc-800/60">
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="checkbox"
                      aria-label={`${grp.date} のイベントをすべて選択`}
                      checked={allGrpSelected}
                      onChange={() => toggleGroup(grp.items)}
                      className="h-3.5 w-3.5 accent-sky-500"
                    />
                    <span className="font-extrabold tabular-nums text-zinc-900 dark:text-zinc-100">
                      📅 {grp.date}
                    </span>
                    <span className="text-zinc-300 dark:text-zinc-600">｜</span>
                    <span className="font-bold text-zinc-800 dark:text-zinc-100">
                      {grp.title}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-[11px] font-medium text-zinc-500 dark:text-zinc-400 tabular-nums">
                    <span>
                      （対象: <strong className="font-bold text-zinc-700 dark:text-zinc-200">{grp.modelCount}モデル</strong>
                      {grp.items.length > grp.modelCount ? `・${grp.items.length}SKU` : ''}
                      {grp.marketUsdJpy != null && (
                        <>
                          {' / '}当日市場レート: <strong className="font-bold text-zinc-700 dark:text-zinc-200">$1 = ¥{grp.marketUsdJpy.toFixed(1)}</strong>
                        </>
                      )}
                      ）
                    </span>
                  </div>
                </div>

                {/* グループ内の各行 (スリムな1行レイアウト・高さ約44〜48px) */}
                <div className="divide-y divide-zinc-100 dark:divide-zinc-800/70">
                  {grp.items.map((r) => {
                    const isSel = selected.has(r.key);
                    const hasDiff = r.prev != null && r.prev !== r.price;
                    return (
                      <div
                        key={r.key}
                        onClick={() => toggleOne(r.key)}
                        className={`flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 px-3 py-2 text-xs transition cursor-pointer sm:flex-nowrap ${
                          isSel
                            ? 'bg-sky-50/70 dark:bg-sky-500/10'
                            : 'hover:bg-zinc-50/80 dark:hover:bg-zinc-800/40'
                        }`}
                      >
                        {/* 左側: チェック + 機種名・容量 + 種別バッジ */}
                        <div className="flex min-w-0 items-center gap-2 sm:w-[32%] sm:shrink-0">
                          <input
                            type="checkbox"
                            checked={isSel}
                            onChange={() => {}}
                            onClick={(e) => { e.stopPropagation(); toggleOne(r.key); }}
                            className="h-3.5 w-3.5 shrink-0 accent-sky-500"
                          />
                          <span className={`shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-bold leading-none ${kindBadge[r.kind]}`}>
                            {kindLabel[r.kind]}
                          </span>
                          <CatIcon cat={r.product.category} className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
                          <span className="truncate font-bold text-zinc-900 dark:text-zinc-100" title={r.product.name}>
                            {r.product.name}
                          </span>
                          <span className="shrink-0 text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
                            {r.sku.label}
                          </span>
                          {r.approx && (
                            <span className="shrink-0 rounded bg-amber-100 px-1 py-0.5 text-[9px] font-bold leading-none text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">
                              概算
                            </span>
                          )}
                        </div>

                        {/* 中央左: 価格推移 (¥124,800 → ¥139,800) + US$ */}
                        <div className="flex items-center gap-1.5 whitespace-nowrap tabular-nums sm:w-[24%] sm:shrink-0">
                          {hasDiff && (
                            <>
                              <span className="text-[11px] text-zinc-400 line-through">{yen(r.prev)}</span>
                              <span className="text-[11px] text-zinc-400">→</span>
                            </>
                          )}
                          <span className="text-sm font-extrabold text-zinc-900 dark:text-zinc-50">{yen(r.price)}</span>
                          {r.usd != null && (
                            <span className="text-[11px] text-zinc-400 dark:text-zinc-500">(${r.usd})</span>
                          )}
                        </div>

                        {/* 中央右: 差額バッジ (+¥15,000 / +12.0%) */}
                        <div className="flex items-center whitespace-nowrap sm:w-[16%] sm:shrink-0">
                          {hasDiff ? (
                            <DeltaBadge diff={r.price - r.prev!} base={r.prev!} />
                          ) : (
                            <span className="text-[11px] text-zinc-400">—</span>
                          )}
                        </div>

                        {/* 右側: Appleレート (市場レートはヘッダーにあるため省略) + 出典ポップオーバー */}
                        <div className="flex items-center justify-end gap-2 sm:ml-auto">
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
        <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
          <table className="w-full min-w-[920px] text-xs">
            <thead>
              <tr className="border-b border-zinc-200 bg-zinc-50/80 text-left text-[11px] text-zinc-500 dark:border-zinc-800 dark:bg-zinc-800/50">
                <th className="w-8 px-2.5 py-2">
                  <input type="checkbox" aria-label="表示中のすべてを選択" checked={allFilteredSelected} onChange={toggleFiltered} className="h-3.5 w-3.5 accent-sky-500" />
                </th>
                <th className="whitespace-nowrap px-2.5 py-2 font-semibold">日付</th>
                <th className="whitespace-nowrap px-2.5 py-2 font-semibold">製品 / SKU</th>
                <th className="whitespace-nowrap px-2.5 py-2 font-semibold">種別</th>
                <th className="whitespace-nowrap px-2.5 py-2 font-semibold">イベント</th>
                <th className="whitespace-nowrap px-2.5 py-2 font-semibold">価格推移 (税込)</th>
                <th className="whitespace-nowrap px-2.5 py-2 font-semibold">差額</th>
                <th className="whitespace-nowrap px-2.5 py-2 font-semibold">Appleレート（市場レート）</th>
                <th className="whitespace-nowrap px-2.5 py-2 text-right font-semibold">出典</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/70">
              {visibleRows.map((r) => {
                const isSel = selected.has(r.key);
                const hasDiff = r.prev != null && r.prev !== r.price;
                return (
                  <tr
                    key={r.key}
                    onClick={() => toggleOne(r.key)}
                    className={`cursor-pointer align-middle text-zinc-800 transition dark:text-zinc-200 ${
                      isSel ? 'bg-sky-50/70 dark:bg-sky-500/10' : 'hover:bg-zinc-50/80 dark:hover:bg-zinc-800/40'
                    }`}
                  >
                    <td className="px-2.5 py-2" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        aria-label={`${r.product.name} ${r.date} を選択`}
                        checked={isSel}
                        onChange={() => toggleOne(r.key)}
                        className="h-3.5 w-3.5 accent-sky-500"
                      />
                    </td>
                    <td className="whitespace-nowrap px-2.5 py-2 font-bold tabular-nums text-zinc-700 dark:text-zinc-300">{r.date}</td>
                    <td className="whitespace-nowrap px-2.5 py-2">
                      <div className="flex items-center gap-1.5">
                        <CatIcon cat={r.product.category} className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
                        <span className="font-bold text-zinc-900 dark:text-zinc-100">{r.product.name}</span>
                        <span className="text-[11px] text-zinc-500">({r.sku.label})</span>
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-2.5 py-2">
                      <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-bold ${kindBadge[r.kind]}`}>
                        {kindLabel[r.kind]}
                      </span>
                    </td>
                    <td className="max-w-[220px] truncate px-2.5 py-2 text-zinc-600 dark:text-zinc-300" title={r.event}>
                      {r.event}
                      {r.approx && <span className="ml-1 rounded bg-amber-100 px-1 py-0.5 text-[9px] font-bold text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">概算</span>}
                    </td>
                    <td className="whitespace-nowrap px-2.5 py-2 tabular-nums">
                      {hasDiff && <span className="text-[11px] text-zinc-400 line-through">{yen(r.prev)}</span>}
                      {hasDiff && <span className="mx-1 text-[11px] text-zinc-400">→</span>}
                      <span className="font-extrabold text-zinc-900 dark:text-zinc-50">{yen(r.price)}</span>
                      {r.usd != null && <span className="ml-1 text-[11px] text-zinc-400">(${r.usd})</span>}
                    </td>
                    <td className="whitespace-nowrap px-2.5 py-2">
                      {hasDiff ? <DeltaBadge diff={r.price - r.prev!} base={r.prev!} /> : <span className="text-zinc-400">—</span>}
                    </td>
                    <td className="whitespace-nowrap px-2.5 py-2">
                      <InlineFxRateCell pt={r.pt} showMarket={true} />
                    </td>
                    <td className="whitespace-nowrap px-2.5 py-2 text-right">
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
        <button className={`${btnCls} mt-3 w-full sm:w-auto`} onClick={() => setLimit(limit + 300)}>
          さらに表示 ({limit}/{filtered.length})
        </button>
      )}
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
  return priced.length ? <FxInner products={priced} toast={toast} /> : <EmptyNote text="USD価格つきの機種がありません" />;
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
        <SectionTitle icon={<Coins className="h-5 w-5" />} title="歴代モデル 発売時価格 vs 為替レート" desc="Frankfurter API の実勢為替レート (marketUsdJpy) と、当時の消費税率 (5%/8%/10%) を除いた厳密な Apple独自レート (税抜円価格 ÷ USD価格) を比較します。" />
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
                    <div className="text-[10px] text-zinc-500">市場 vs Appleレート</div>
                    <div className="font-semibold text-zinc-800 dark:text-zinc-200">{r.fx != null ? `1ドル${r.fx.toFixed(1)}円` : '—'} vs {r.apple != null ? `${r.apple.toFixed(1)}円` : '—'}</div>
                    {r.rateDiff != null && <div className="text-[10px] text-zinc-500">差: {signedRate(r.rateDiff)}/ドル</div>}
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] text-zinc-500">為替比プレミアム</div>
                    <div className="text-sm font-bold">{r.premium != null ? <span className={r.premium > 0 ? 'text-rose-500' : 'text-emerald-500'}>{signedPct(r.premium)}</span> : '—'}</div>
                  </div>
                </div>
                <div className="mt-1.5">
                  <CurrentFxFairnessBadge pt={r.curPt} compact showFairPrice={true} />
                </div>
              </div>
            );
          })}
        </div>

        {/* PC/タブレット向けテーブル (md以上) */}
        <div className="mt-4 hidden overflow-x-auto md:block">
          <table className="w-full min-w-[780px] text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500 dark:border-zinc-800">
                <th className="w-9 p-2">
                  <input type="checkbox" aria-label="表示カテゴリの全モデルを選択" checked={allCatSelected} onChange={toggleLaunchCat} className="h-4 w-4 accent-sky-500" />
                </th>
                {['モデル', '発売日', '日本価格', 'USD価格', '当時の市場レート vs Apple適用レート', '為替比プレミアム', '今の為替から見た判定'].map((x) => <th key={x} className="p-2 font-semibold">{x}</th>)}
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
                    <td className="p-2">{r.usd != null ? `$${r.usd}` : '—'}</td>
                    <td className="p-2"><FxRatePairChip pt={r.pt} compact /></td>
                    <td className="p-2">{r.premium != null ? <span className={r.premium > 0 ? 'font-bold text-rose-500' : 'font-bold text-emerald-500'}>{signedPct(r.premium)}</span> : '—'}</td>
                    <td className="p-2"><CurrentFxFairnessBadge pt={r.curPt} compact showFairPrice={true} /></td>
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
 * 7.5 タブ4: 💰 予算から逆算！最高スペック検索 (BudgetView)
 * ===================================================================================== */

const QUICK_BUDGETS = [
  { value: 30000, label: '3万円以内' },
  { value: 50000, label: '5万円以内' },
  { value: 80000, label: '8万円以内' },
  { value: 100000, label: '10万円以内' },
  { value: 150000, label: '15万円以内' },
  { value: 200000, label: '20万円以内' },
] as const;

const BUDGET_CAT_OPTIONS: { value: BudgetCategoryFilter; label: string }[] = [
  { value: 'all', label: 'すべて' },
  { value: 'iPhone', label: 'iPhone' },
  { value: 'iPad', label: 'iPad' },
  { value: 'Mac', label: 'Mac' },
  { value: 'Apple Watch', label: 'Apple Watch' },
  { value: 'AirPods', label: 'AirPods' },
];

interface BudgetCandidate {
  p: Product;
  sku: Sku;
  score: PerformanceScoreBreakdown;
  usedInfo: UsedMarketData;
  lowestUsedPrice: number;
  unusedPrice: number | null;
  appleNewPrice: number | null;
  isCurrentlySoldNew: boolean;
  bestCarrierReturn: { cid: CarrierId; effectiveCost: number; programName: string } | null;
  qualifyingPrice: number;
  qualifyingRoute: 'used' | 'unused' | 'new' | 'program';
  qualifyingRouteLabel: string;
  qualifyingShopName: string;
  qualifyingUrl: string;
}

function isProductDiscontinued(p: Product, sku: Sku): boolean {
  return getSkuDiscontinuedInfo(p, sku).isDiscontinued;
}

function BudgetView({
  products,
  sels,
  setSels,
  setTab,
  maxPrice,
  setMaxPrice,
  catFilter,
  setCatFilter,
  mnp,
  toast,
}: {
  products: Product[];
  sels: Sel[];
  setSels: (s: Sel[]) => void;
  setTab: (t: Tab) => void;
  maxPrice: number;
  setMaxPrice: (n: number) => void;
  catFilter: BudgetCategoryFilter;
  setCatFilter: (c: BudgetCategoryFilter) => void;
  mnp: boolean;
  toast: (m: string) => void;
}) {
  const [includeUsed, setIncludeUsed] = useState(true);
  const [onlyNew, setOnlyNew] = useState(false);
  const [includeProgram, setIncludeProgram] = useState(false);
  const [urlCopied, setUrlCopied] = useState(false);
  const urlCopyTimer = useRef<number>();

  // カテゴリでフィルタされた製品群
  const targetProducts = useMemo(() => {
    const priced = products.filter(hasPrice);
    if (catFilter === 'all') return priced;
    return priced.filter((p) => p.category === catFilter);
  }, [products, catFilter]);

  // 全SKUの評価データ構築
  const allSkuEvaluations = useMemo(() => {
    const list: {
      p: Product;
      sku: Sku;
      score: PerformanceScoreBreakdown;
      usedInfo: UsedMarketData;
      lowestUsedPrice: number;
      isYahooLowest: boolean;
      bestUsedOffer: UsedMarketData['usedPricing']['rakuten'];
      unusedOffer: UsedMarketData['unused'];
      appleNewPrice: number | null;
      isCurrentlySoldNew: boolean;
      bestCarrierReturn: { cid: CarrierId; effectiveCost: number; programName: string } | null;
    }[] = [];

    for (const p of targetProducts) {
      const skus = pricedSkus(p);
      for (const sku of skus) {
        const score = computePerformanceScore(p, sku);
        const usedInfo = estimateUsedMarketData(p, sku);
        const up = usedInfo.usedPricing;
        const lowestUsedPrice = up.lowestPrice;
        const isYahooLowest = up.lowestPlatform === 'yahoo';
        const bestUsedOffer = isYahooLowest ? up.yahoo ?? up.rakuten : up.rakuten ?? up.yahoo;
        const unusedOffer = usedInfo.unused;
        const isCurrentlySoldNew = !isProductDiscontinued(p, sku);
        const rawApplePrice =
          sku.carriers.apple?.currentPrice ??
          (sku.priceHistory.length ? lastOf(sku.priceHistory).appleStorePrice : null);
        const appleNewPrice = isCurrentlySoldNew ? rawApplePrice : null;

        const carrierReturns = (['docomo', 'au', 'softbank', 'rakuten'] as CarrierId[])
          .map((cid) => {
            const cp = sku.carriers[cid];
            if (!cp?.returnProgram) return null;
            const eff = carrierValue(cp, 'return', mnp) ?? cp.returnProgram.effectiveCost;
            return { cid, effectiveCost: eff, programName: cp.returnProgram.name };
          })
          .filter((x): x is { cid: CarrierId; effectiveCost: number; programName: string } => x !== null)
          .sort((a, b) => a.effectiveCost - b.effectiveCost);

        list.push({
          p,
          sku,
          score,
          usedInfo,
          lowestUsedPrice,
          isYahooLowest,
          bestUsedOffer,
          unusedOffer,
          appleNewPrice,
          isCurrentlySoldNew,
          bestCarrierReturn: carrierReturns[0] ?? null,
        });
      }
    }
    return list;
  }, [targetProducts, mnp]);

  // 1. 🏆 部門1: 予算内で買える「最高スペック王」（主に中古・未使用品・新品一括）
  const bestOverallUsedOrNew = useMemo(() => {
    const byProduct = new Map<string, BudgetCandidate>();
    for (const item of allSkuEvaluations) {
      // 中古・未使用・新品一括のうち予算内に収まるルートを判定
      const options: {
        price: number;
        route: 'used' | 'unused' | 'new';
        label: string;
        shop: string;
        url: string;
      }[] = [];
      if (item.appleNewPrice != null && item.appleNewPrice <= maxPrice) {
        options.push({
          price: item.appleNewPrice,
          route: 'new',
          label: 'Apple Store新品',
          shop: 'Apple Store',
          url: appleStoreUrlForCategory(item.p.category),
        });
      }
      if (item.unusedOffer && item.unusedOffer.price <= maxPrice) {
        options.push({
          price: item.unusedOffer.price,
          route: 'unused',
          label: 'EC未使用品',
          shop: item.unusedOffer.shopName,
          url: item.unusedOffer.itemUrl,
        });
      }
      if (item.lowestUsedPrice <= maxPrice && item.bestUsedOffer) {
        const isEst = Boolean(item.usedInfo.isEstimated || item.usedInfo.source === 'mock' || item.usedInfo.usedPricing.isEstimated);
        options.push({
          price: item.lowestUsedPrice,
          route: 'used',
          label: isEst ? '中古参考推定相場' : `${item.isYahooLowest ? 'Yahoo!中古' : '楽天中古'}`,
          shop: isEst ? '' : item.bestUsedOffer.shopName,
          url: item.bestUsedOffer.url,
        });
      }
      if (!options.length) continue;
      // 予算内で買える最も状態の良い or 安いルートを選択（中古最安を基準にしつつ新品が予算内なら新品も表示）
      const chosen =
        options.find((o) => o.route === 'used') ??
        options.find((o) => o.route === 'unused') ??
        options[0];

      const cand: BudgetCandidate = {
        p: item.p,
        sku: item.sku,
        score: item.score,
        usedInfo: item.usedInfo,
        lowestUsedPrice: item.lowestUsedPrice,
        unusedPrice: item.unusedOffer?.price ?? null,
        appleNewPrice: item.appleNewPrice,
        isCurrentlySoldNew: item.isCurrentlySoldNew,
        bestCarrierReturn: item.bestCarrierReturn,
        qualifyingPrice: chosen.price,
        qualifyingRoute: chosen.route,
        qualifyingRouteLabel: chosen.label,
        qualifyingShopName: chosen.shop,
        qualifyingUrl: chosen.url,
      };

      const prev = byProduct.get(item.p.id);
      if (
        !prev ||
        cand.score.total > prev.score.total ||
        (cand.score.total === prev.score.total && cand.qualifyingPrice < prev.qualifyingPrice)
      ) {
        byProduct.set(item.p.id, cand);
      }
    }
    return Array.from(byProduct.values()).sort(
      (a, b) => b.score.total - a.score.total || a.qualifyingPrice - b.qualifyingPrice,
    );
  }, [allSkuEvaluations, maxPrice]);

  // 2. ✨ 部門2: 予算内で買える「新品（Apple Store直販）」最高モデル（＋あと少し出せば買えるガイド）
  const { bestNewWithinBudget, nearestNewAboveBudget } = useMemo(() => {
    const newItems = allSkuEvaluations.filter((x) => x.appleNewPrice != null && x.isCurrentlySoldNew);
    const withinByProduct = new Map<string, (typeof newItems)[number]>();
    for (const item of newItems) {
      if (item.appleNewPrice! <= maxPrice) {
        const prev = withinByProduct.get(item.p.id);
        if (
          !prev ||
          item.score.total > prev.score.total ||
          (item.score.total === prev.score.total && item.appleNewPrice! < prev.appleNewPrice!)
        ) {
          withinByProduct.set(item.p.id, item);
        }
      }
    }
    const sortedWithin = Array.from(withinByProduct.values()).sort(
      (a, b) => b.score.total - a.score.total || a.appleNewPrice! - b.appleNewPrice!,
    );
    const above = newItems
      .filter((x) => x.appleNewPrice! > maxPrice)
      .sort((a, b) => a.appleNewPrice! - b.appleNewPrice! || b.score.total - a.score.total);
    return {
      bestNewWithinBudget: sortedWithin[0] ?? null,
      nearestNewAboveBudget: above[0] ?? null,
    };
  }, [allSkuEvaluations, maxPrice]);

  // 3. 📱 部門3: キャリア2年返却なら手が届く「ワンランク上の最新機」
  const bestProgramWithinBudget = useMemo(() => {
    const progItems = allSkuEvaluations.filter(
      (x) => x.bestCarrierReturn != null && x.bestCarrierReturn.effectiveCost <= maxPrice,
    );
    const byProduct = new Map<string, (typeof progItems)[number]>();
    for (const item of progItems) {
      const prev = byProduct.get(item.p.id);
      if (
        !prev ||
        item.score.total > prev.score.total ||
        (item.score.total === prev.score.total &&
          item.bestCarrierReturn!.effectiveCost < prev.bestCarrierReturn!.effectiveCost)
      ) {
        byProduct.set(item.p.id, item);
      }
    }
    return (
      Array.from(byProduct.values()).sort(
        (a, b) =>
          b.score.total - a.score.total ||
          a.bestCarrierReturn!.effectiveCost - b.bestCarrierReturn!.effectiveCost,
      )[0] ?? null
    );
  }, [allSkuEvaluations, maxPrice]);

  // 購入方法フィルターを適用したメインランキング一覧 (製品ごとに最高スコアの予算内SKUを抽出)
  const filteredRanking = useMemo(() => {
    const byProduct = new Map<string, BudgetCandidate>();
    for (const item of allSkuEvaluations) {
      const routes: {
        price: number;
        route: 'used' | 'unused' | 'new' | 'program';
        label: string;
        shop: string;
        url: string;
      }[] = [];

      if (onlyNew) {
        if (item.appleNewPrice != null && item.appleNewPrice <= maxPrice) {
          routes.push({
            price: item.appleNewPrice,
            route: 'new',
            label: 'Apple Store新品',
            shop: 'Apple Store',
            url: appleStoreUrlForCategory(item.p.category),
          });
        }
      } else {
        if (item.appleNewPrice != null && item.appleNewPrice <= maxPrice) {
          routes.push({
            price: item.appleNewPrice,
            route: 'new',
            label: 'Apple Store新品',
            shop: 'Apple Store',
            url: appleStoreUrlForCategory(item.p.category),
          });
        }
        if (includeUsed) {
          if (item.lowestUsedPrice <= maxPrice && item.bestUsedOffer) {
            const isEst = Boolean(item.usedInfo.isEstimated || item.usedInfo.source === 'mock' || item.usedInfo.usedPricing.isEstimated);
            routes.push({
              price: item.lowestUsedPrice,
              route: 'used',
              label: isEst ? '中古参考推定相場' : item.isYahooLowest ? 'Yahoo!中古' : '楽天中古',
              shop: isEst ? '' : item.bestUsedOffer.shopName,
              url: item.bestUsedOffer.url,
            });
          }
          if (item.unusedOffer && item.unusedOffer.price <= maxPrice) {
            routes.push({
              price: item.unusedOffer.price,
              route: 'unused',
              label: 'EC未使用品',
              shop: item.unusedOffer.shopName,
              url: item.unusedOffer.itemUrl,
            });
          }
        }
        if (
          includeProgram &&
          item.bestCarrierReturn &&
          item.bestCarrierReturn.effectiveCost <= maxPrice
        ) {
          routes.push({
            price: item.bestCarrierReturn.effectiveCost,
            route: 'program',
            label: `${CARRIER_META[item.bestCarrierReturn.cid].label} 2年返却`,
            shop: CARRIER_META[item.bestCarrierReturn.cid].label,
            url: CARRIER_STORE_URLS[item.bestCarrierReturn.cid],
          });
        }
      }

      if (!routes.length) continue;
      routes.sort((a, b) => a.price - b.price);
      const chosen = routes[0];

      const cand: BudgetCandidate = {
        p: item.p,
        sku: item.sku,
        score: item.score,
        usedInfo: item.usedInfo,
        lowestUsedPrice: item.lowestUsedPrice,
        unusedPrice: item.unusedOffer?.price ?? null,
        appleNewPrice: item.appleNewPrice,
        isCurrentlySoldNew: item.isCurrentlySoldNew,
        bestCarrierReturn: item.bestCarrierReturn,
        qualifyingPrice: chosen.price,
        qualifyingRoute: chosen.route,
        qualifyingRouteLabel: chosen.label,
        qualifyingShopName: chosen.shop,
        qualifyingUrl: chosen.url,
      };

      const prev = byProduct.get(item.p.id);
      if (
        !prev ||
        cand.score.total > prev.score.total ||
        (cand.score.total === prev.score.total && cand.qualifyingPrice < prev.qualifyingPrice)
      ) {
        byProduct.set(item.p.id, cand);
      }
    }

    return Array.from(byProduct.values())
      .sort((a, b) => b.score.total - a.score.total || a.qualifyingPrice - b.qualifyingPrice)
      .slice(0, 18);
  }, [allSkuEvaluations, maxPrice, includeUsed, onlyNew, includeProgram]);

  const addOneToCompare = (pid: string, sid: string, name: string, label: string) => {
    const exists = sels.some((s) => s.pid === pid);
    if (exists) {
      setSels(sels.map((s) => (s.pid === pid ? { pid, sid } : s)));
      toast(`${name} (${label}) の容量を更新しました`);
    } else {
      setSels([...sels, { pid, sid }]);
      toast(`${name} (${label}) を比較リストに追加しました`);
    }
  };

  const compareTopThree = () => {
    const top3 = filteredRanking.slice(0, 3);
    if (!top3.length) return;
    setSels(top3.map((c) => ({ pid: c.p.id, sid: c.sku.id })));
    setTab('compare');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    toast(`予算${yen(maxPrice)}以内の最高スペック上位${top3.length}機種を比較テーブルに反映しました`);
  };

  const copyBudgetShareUrl = async () => {
    const ok = await copyText(window.location.href);
    if (ok) {
      setUrlCopied(true);
      window.clearTimeout(urlCopyTimer.current);
      urlCopyTimer.current = window.setTimeout(() => setUrlCopied(false), 2000);
      toast('予算検索ページのURLをコピーしました');
    }
  };

  const topUsed1 = bestOverallUsedOrNew[0] ?? null;
  const topUsed2 =
    bestOverallUsedOrNew[1] &&
    topUsed1 &&
    Math.abs(bestOverallUsedOrNew[1].score.total - topUsed1.score.total) <= 6
      ? bestOverallUsedOrNew[1]
      : null;

  return (
    <div className="space-y-4 sm:space-y-5">
      {/* 予算指定コントロールカード */}
      <div className={`${card} p-3.5 sm:p-5`}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <SectionTitle
            icon={<Sparkles className="h-5 w-5" />}
            title="💰 予算から逆算！最高スペック検索"
            desc="指定した予算上限の中で、SoC世代・RAM・ProMotion・サポート残年数から「最もスペックが高いApple製品」を自動ランキング抽出します。"
          />
          <div className="flex flex-wrap items-center gap-2 ml-auto">
            <button
              type="button"
              onClick={copyBudgetShareUrl}
              className={`${btnCls} ${
                urlCopied
                  ? '!border-zinc-400 !bg-zinc-200/80 dark:!border-zinc-600 dark:!bg-zinc-700'
                  : ''
              }`}
            >
              {urlCopied ? (
                <>
                  <Check className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                  <span>コピー済</span>
                </>
              ) : (
                <>
                  <Link2 className="h-4 w-4 shrink-0" />
                  <span>この予算検索URLをコピー</span>
                </>
              )}
            </button>
            <button
              type="button"
              disabled={!filteredRanking.length}
              onClick={compareTopThree}
              className={btnCls}
            >
              <Scale className="h-4 w-4 shrink-0" />
              <span>上位3機種をまとめて横並び比較する</span>
            </button>
          </div>
        </div>

        {/* クイック予算選択ボタン + スライダー */}
        <div className="mt-3 border-t border-zinc-200/80 pt-3.5 dark:border-zinc-800/70">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div className="flex items-baseline gap-2">
              <span className="text-xs sm:text-sm font-medium text-zinc-500 dark:text-zinc-400">予算上限:</span>
              <span className="text-2xl sm:text-3xl font-extrabold tabular-nums text-zinc-900 dark:text-zinc-50">
                {yen(maxPrice)}
              </span>
              <span className="text-xs text-zinc-500">以内（税込）</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {QUICK_BUDGETS.map((b) => (
                <button
                  key={b.value}
                  type="button"
                  onClick={() => setMaxPrice(b.value)}
                  className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition ${
                    maxPrice === b.value
                      ? 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-200 dark:bg-zinc-100 dark:text-zinc-900'
                      : 'border-zinc-200 bg-zinc-50 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700'
                  }`}
                >
                  {b.label}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-3">
            <input
              type="range"
              min={10000}
              max={300000}
              step={5000}
              value={maxPrice}
              onChange={(e) => setMaxPrice(Number(e.target.value))}
              aria-label="予算上限スライダー"
              className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-zinc-200 accent-zinc-900 dark:bg-zinc-700 dark:accent-zinc-200"
            />
            <div className="mt-1 flex justify-between text-[10px] sm:text-xs tabular-nums text-zinc-400">
              <span>¥10,000</span>
              <span>¥50,000</span>
              <span>¥100,000</span>
              <span>¥150,000</span>
              <span>¥200,000</span>
              <span>¥250,000</span>
              <span>¥300,000</span>
            </div>
          </div>

          <div className="mt-3.5 flex flex-col gap-3 border-t border-zinc-200/80 pt-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between dark:border-zinc-800/70">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-zinc-500">カテゴリ:</span>
              <Segmented<BudgetCategoryFilter>
                value={catFilter}
                onChange={setCatFilter}
                options={BUDGET_CAT_OPTIONS}
              />
            </div>

            <div className="flex flex-wrap items-center gap-3 text-xs sm:text-sm">
              <label className="inline-flex cursor-pointer items-center gap-1.5 font-medium text-zinc-700 dark:text-zinc-300">
                <input
                  type="checkbox"
                  checked={includeUsed && !onlyNew}
                  disabled={onlyNew}
                  onChange={(e) => setIncludeUsed(e.target.checked)}
                  className="h-4 w-4 accent-zinc-900 dark:accent-zinc-200"
                />
                <span>中古・未使用品を含む</span>
              </label>
              <label className="inline-flex cursor-pointer items-center gap-1.5 font-medium text-zinc-700 dark:text-zinc-300">
                <input
                  type="checkbox"
                  checked={onlyNew}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setOnlyNew(checked);
                    if (checked) setIncludeProgram(false);
                  }}
                  className="h-4 w-4 accent-zinc-900 dark:accent-zinc-200"
                />
                <span>Apple直販（新品）のみ</span>
              </label>
              <label className="inline-flex cursor-pointer items-center gap-1.5 font-medium text-zinc-700 dark:text-zinc-300">
                <input
                  type="checkbox"
                  checked={includeProgram && !onlyNew}
                  disabled={onlyNew}
                  onChange={(e) => setIncludeProgram(e.target.checked)}
                  className="h-4 w-4 accent-zinc-900 dark:accent-zinc-200"
                />
                <span>キャリア2年返却（実質負担額）を含める</span>
              </label>
            </div>
          </div>
        </div>
      </div>

      {/* 予算内ベスト3の部門別ハイライトカード（モノトーン統一） */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        {/* 1. 予算内で買える「最高スペック王」（主に中古・未使用品） */}
        <div className={`${card} flex flex-col justify-between p-4`}>
          <div>
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-md bg-zinc-100 px-2 py-0.5 text-[11px] font-semibold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                予算内「最高スペック」
              </span>
              {topUsed1 && (
                <span className="rounded bg-zinc-100 px-2 py-0.5 text-xs font-semibold tabular-nums text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                  性能スコア {topUsed1.score.total}点
                </span>
              )}
            </div>
            {topUsed1 ? (
              <>
                <div className="mt-2.5">
                  <div className="text-base sm:text-lg font-extrabold text-zinc-900 dark:text-zinc-50">
                    {topUsed1.p.name} ({topUsed1.sku.label})
                    {topUsed2 ? ` / ${topUsed2.p.name} (${topUsed2.sku.label})` : ''}
                  </div>
                  <div className="mt-1 flex flex-wrap items-baseline gap-2">
                    <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                      {topUsed1.qualifyingRouteLabel}
                    </span>
                    <span className="text-xl sm:text-2xl font-extrabold tabular-nums text-zinc-900 dark:text-white">
                      {yen(topUsed1.qualifyingPrice)}
                    </span>
                    <span className="text-xs font-medium tabular-nums text-emerald-600 dark:text-emerald-400">
                      （予算残り {yen(maxPrice - topUsed1.qualifyingPrice)}）
                    </span>
                  </div>
                </div>
                <p className="mt-2.5 border-t border-zinc-200/80 pt-2.5 text-xs leading-relaxed text-zinc-600 dark:border-zinc-800/70 dark:text-zinc-400">
                  搭載チップ「{topUsed1.score.socLabel}」{topUsed1.score.ramGb ? `・RAM ${topUsed1.score.ramGb}GB` : ''}
                  ・{topUsed1.score.releaseYear}年発売（想定サポート残約
                  {topUsed1.score.remainingSupportYears}年）。
                </p>
              </>
            ) : (
              <p className="mt-3 text-xs sm:text-sm text-zinc-500">
                現在の予算（{yen(maxPrice)}）内で購入できる該当カテゴリの製品が見つかりません。
              </p>
            )}
          </div>
          {topUsed1 && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-zinc-200/80 pt-2.5 dark:border-zinc-800/70">
              <button
                type="button"
                onClick={() =>
                  addOneToCompare(topUsed1.p.id, topUsed1.sku.id, topUsed1.p.name, topUsed1.sku.label)
                }
                className={secondaryActionBtnCls}
              >
                <span>
                  {sels.some((s) => s.pid === topUsed1.p.id)
                    ? '✓ 比較リストに追加済'
                    : '＋ 比較リストに追加'}
                </span>
              </button>
              <a
                href={topUsed1.qualifyingUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={secondaryActionBtnCls}
              >
                <span>
                  {topUsed1.qualifyingRoute === 'used' && topUsed1.usedInfo.isEstimated
                    ? '実際の在庫を検索'
                    : '最安ショップを見る'}
                </span>
                <ExternalLink className="h-3 w-3 shrink-0" />
              </a>
            </div>
          )}
        </div>

        {/* 2. 予算内で買える「新品（Apple Store直販）」最高モデル */}
        <div className={`${card} flex flex-col justify-between p-4`}>
          <div>
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-md bg-zinc-100 px-2 py-0.5 text-[11px] font-semibold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                予算内「Apple直販新品」最高機
              </span>
              {bestNewWithinBudget && (
                <span className="rounded bg-zinc-100 px-2 py-0.5 text-xs font-semibold tabular-nums text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                  性能スコア {bestNewWithinBudget.score.total}点
                </span>
              )}
            </div>
            {bestNewWithinBudget ? (
              <>
                <div className="mt-2.5">
                  <div className="text-base sm:text-lg font-extrabold text-zinc-900 dark:text-zinc-50">
                    {bestNewWithinBudget.p.name} ({bestNewWithinBudget.sku.label})
                  </div>
                  <div className="mt-1 flex flex-wrap items-baseline gap-2">
                    <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                      Apple Store直販（新品）
                    </span>
                    <span className="text-xl sm:text-2xl font-extrabold tabular-nums text-zinc-900 dark:text-white">
                      {yen(bestNewWithinBudget.appleNewPrice)}
                    </span>
                    <span className="text-xs font-medium tabular-nums text-emerald-600 dark:text-emerald-400">
                      （予算残り {yen(maxPrice - (bestNewWithinBudget.appleNewPrice ?? 0))}）
                    </span>
                  </div>
                </div>
                <p className="mt-2.5 border-t border-zinc-200/80 pt-2.5 text-xs leading-relaxed text-zinc-600 dark:border-zinc-800/70 dark:text-zinc-400">
                  新品・メーカー保証・バッテリー100%で選べる予算内最高性能（
                  {bestNewWithinBudget.score.socLabel}
                  {bestNewWithinBudget.score.ramGb ? ` / RAM ${bestNewWithinBudget.score.ramGb}GB` : ''}
                  ）。
                </p>
              </>
            ) : nearestNewAboveBudget ? (
              <div className="mt-3 border-t border-zinc-200/80 pt-2.5 text-xs leading-relaxed text-zinc-600 dark:border-zinc-800/70 dark:text-zinc-300">
                <div className="font-semibold text-zinc-800 dark:text-zinc-200">
                  予算 {yen(maxPrice)} 以内の現行Apple Store新品はありません
                </div>
                <p className="mt-1">
                  あと{' '}
                  <strong className="font-bold tabular-nums text-zinc-900 dark:text-white">
                    ＋{yen((nearestNewAboveBudget.appleNewPrice ?? 0) - maxPrice)}
                  </strong>{' '}
                  で{' '}
                  <strong className="font-bold text-zinc-900 dark:text-white">
                    {nearestNewAboveBudget.p.name} ({nearestNewAboveBudget.sku.label})
                  </strong>{' '}
                  新品（{yen(nearestNewAboveBudget.appleNewPrice)}）に届きます。
                </p>
              </div>
            ) : (
              <p className="mt-3 text-xs sm:text-sm text-zinc-500">
                該当カテゴリで現行販売中の新品モデルデータがありません。
              </p>
            )}
          </div>
          {(bestNewWithinBudget ?? nearestNewAboveBudget) && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-zinc-200/80 pt-2.5 dark:border-zinc-800/70">
              {(() => {
                const target = (bestNewWithinBudget ?? nearestNewAboveBudget)!;
                return (
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        addOneToCompare(target.p.id, target.sku.id, target.p.name, target.sku.label)
                      }
                      className={secondaryActionBtnCls}
                    >
                      <span>
                        {sels.some((s) => s.pid === target.p.id)
                          ? '✓ 比較リストに追加済'
                          : '＋ 比較リストに追加'}
                      </span>
                    </button>
                    <a
                      href={appleStoreUrlForCategory(target.p.category)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={secondaryActionBtnCls}
                    >
                      <span>Apple Storeで見る</span>
                      <ExternalLink className="h-3 w-3 shrink-0" />
                    </a>
                  </>
                );
              })()}
            </div>
          )}
        </div>

        {/* 3. キャリア2年返却なら手が届く「ワンランク上の最新機」 */}
        <div className={`${card} flex flex-col justify-between p-4`}>
          <div>
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-md bg-zinc-100 px-2 py-0.5 text-[11px] font-semibold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
                <span className="h-1.5 w-1.5 rounded-full bg-sky-500" />
                キャリア2年返却の最高機
              </span>
              {bestProgramWithinBudget && (
                <span className="rounded bg-zinc-100 px-2 py-0.5 text-xs font-semibold tabular-nums text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                  性能スコア {bestProgramWithinBudget.score.total}点
                </span>
              )}
            </div>
            {bestProgramWithinBudget && bestProgramWithinBudget.bestCarrierReturn ? (
              <>
                <div className="mt-2.5">
                  <div className="text-base sm:text-lg font-extrabold text-zinc-900 dark:text-zinc-50">
                    {bestProgramWithinBudget.p.name} ({bestProgramWithinBudget.sku.label})
                  </div>
                  <div className="mt-1 flex flex-wrap items-baseline gap-2">
                    <CarrierBadge id={bestProgramWithinBudget.bestCarrierReturn.cid} small />
                    <span className="text-xl sm:text-2xl font-extrabold tabular-nums text-zinc-900 dark:text-white">
                      実質 {yen(bestProgramWithinBudget.bestCarrierReturn.effectiveCost)}
                    </span>
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">
                      （月約{yen(Math.round(bestProgramWithinBudget.bestCarrierReturn.effectiveCost / 24))}）
                    </span>
                  </div>
                </div>
                <p className="mt-2.5 border-t border-zinc-200/80 pt-2.5 text-xs leading-relaxed text-zinc-600 dark:border-zinc-800/70 dark:text-zinc-400">
                  一括だと新品 {yen(bestProgramWithinBudget.appleNewPrice)}・中古{' '}
                  {yen(bestProgramWithinBudget.lowestUsedPrice)} の上位機ですが、
                  {CARRIER_META[bestProgramWithinBudget.bestCarrierReturn.cid].label}「
                  {bestProgramWithinBudget.bestCarrierReturn.programName}」なら2年実質{' '}
                  {yen(bestProgramWithinBudget.bestCarrierReturn.effectiveCost)}。
                </p>
              </>
            ) : (
              <p className="mt-3 text-xs sm:text-sm text-zinc-500">
                選択中のカテゴリ・予算条件では、キャリア2年返却プログラムの対象モデルがありません。
              </p>
            )}
          </div>
          {bestProgramWithinBudget && bestProgramWithinBudget.bestCarrierReturn && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-zinc-200/80 pt-2.5 dark:border-zinc-800/70">
              <button
                type="button"
                onClick={() =>
                  addOneToCompare(
                    bestProgramWithinBudget.p.id,
                    bestProgramWithinBudget.sku.id,
                    bestProgramWithinBudget.p.name,
                    bestProgramWithinBudget.sku.label,
                  )
                }
                className={secondaryActionBtnCls}
              >
                <span>
                  {sels.some((s) => s.pid === bestProgramWithinBudget.p.id)
                    ? '✓ 比較リストに追加済'
                    : '＋ 比較リストに追加'}
                </span>
              </button>
              <a
                href={CARRIER_STORE_URLS[bestProgramWithinBudget.bestCarrierReturn.cid]}
                target="_blank"
                rel="noopener noreferrer"
                className={secondaryActionBtnCls}
              >
                <span>
                  {CARRIER_META[bestProgramWithinBudget.bestCarrierReturn.cid].label}公式を見る
                </span>
                <ExternalLink className="h-3 w-3 shrink-0" />
              </a>
            </div>
          )}
        </div>
      </div>

      {/* 予算内スペックランキング一覧 */}
      <div className={`${card} p-3.5 sm:p-5`}>
        <div className="mb-3.5 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm sm:text-base font-extrabold text-zinc-900 dark:text-zinc-50">
              📊 予算 {yen(maxPrice)} 以内のスペック性能ランキング（上位{filteredRanking.length}機種）
            </h3>
            <p className="text-xs text-zinc-500">
              同一機種で複数の容量が予算内に収まる場合、より大容量のSKUを自動選択してランキングしています。
            </p>
          </div>
          {filteredRanking.length > 0 && (
            <button
              type="button"
              onClick={compareTopThree}
              className={btnCls}
            >
              <Scale className="h-4 w-4 shrink-0" />
              <span>上位3機種をまとめて横並び比較する</span>
            </button>
          )}
        </div>

        {!filteredRanking.length ? (
          <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-8 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-800/40">
            指定した予算（{yen(maxPrice)}）・フィルター条件に一致する製品がありません。予算上限を上げるか、「中古・未使用品を含む」をONにしてください。
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            {filteredRanking.map((item, idx) => {
              const inCompare = sels.some((s) => s.pid === item.p.id);
              return (
                <div
                  key={`${item.p.id}__${item.sku.id}`}
                  className="flex flex-col justify-between rounded-xl border border-zinc-200 bg-white p-3.5 transition hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-900/60 dark:hover:border-zinc-700"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span className="inline-flex h-5 min-w-[1.75rem] shrink-0 items-center justify-center rounded bg-zinc-100 px-1.5 text-[11px] font-bold tabular-nums text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
                          #{idx + 1}
                        </span>
                        <CatIcon cat={item.p.category} className="h-4 w-4 shrink-0 text-zinc-400" />
                        <span className="truncate text-sm font-bold text-zinc-900 dark:text-zinc-50">
                          {item.p.name}
                        </span>
                      </div>
                      <span className="shrink-0 rounded bg-zinc-100 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                        スコア {item.score.total}
                      </span>
                    </div>

                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-500">
                      <span className="rounded bg-zinc-100 px-1.5 py-0.5 font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                        {item.sku.label}
                      </span>
                      <span>{item.score.socLabel}</span>
                      {item.score.ramGb > 0 && <span>・RAM {item.score.ramGb}GB</span>}
                      <span>・{item.score.releaseYear}年（残{item.score.remainingSupportYears}年）</span>
                    </div>

                    <div className="mt-2.5 border-t border-zinc-200/80 pt-2.5 dark:border-zinc-800/70">
                      <div className="flex items-baseline justify-between gap-2">
                        <div>
                          <span className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400">
                            {item.qualifyingRouteLabel}
                          </span>
                          <div className="text-lg font-extrabold tabular-nums text-zinc-900 dark:text-white">
                            {yen(item.qualifyingPrice)}
                          </div>
                        </div>
                        <div className="text-right">
                          <span className="text-[10px] text-zinc-400">予算との差額</span>
                          <div className="text-xs font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                            残り {yen(maxPrice - item.qualifyingPrice)}
                          </div>
                        </div>
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] tabular-nums text-zinc-500">
                        <span>中古最安: {yen(item.lowestUsedPrice)}</span>
                        {item.unusedPrice != null && <span>未使用: {yen(item.unusedPrice)}</span>}
                        {item.appleNewPrice != null && <span>Apple新品: {yen(item.appleNewPrice)}</span>}
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 flex items-center justify-between gap-2 border-t border-zinc-200/70 pt-2.5 dark:border-zinc-800/60">
                    <button
                      type="button"
                      onClick={() =>
                        addOneToCompare(item.p.id, item.sku.id, item.p.name, item.sku.label)
                      }
                      className={`${secondaryActionBtnCls} flex-1 ${
                        inCompare
                          ? '!border-zinc-400 !bg-zinc-200/80 dark:!border-zinc-600 dark:!bg-zinc-700'
                          : ''
                      }`}
                    >
                      <span>{inCompare ? '✓ 比較リストに追加済' : '＋ 比較リストに追加'}</span>
                    </button>
                    <a
                      href={item.qualifyingUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={secondaryActionBtnCls}
                    >
                      <span>購入先</span>
                      <ExternalLink className="h-3 w-3 shrink-0" />
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/* =====================================================================================
 * 8. App
 * ===================================================================================== */

const LS_DATA = 'apple-price-atlas:data:v2';
const LS_THEME = 'apple-price-atlas:theme';
const LS_EXT = 'apple-price-atlas:ext-version';
const LS_AUTODB = 'apple-price-atlas:appledb-auto';

export default function App() {
  const initialQueryRef = useRef(() =>
    typeof window !== 'undefined'
      ? parseUrlSearchParams(window.location.search)
      : {
          compareRaw: null as string | null,
          mode: 'bulk' as Mode,
          mnp: false,
          tab: 'compare' as Tab,
          maxPrice: 80000,
          budgetCat: 'all' as BudgetCategoryFilter,
          myRaw: null as string | null,
          sellMode: 'flea' as SellMode,
          sellCustom: 42000,
          showFlags: null as CompareShowFlags | null,
          diffOnly: null as boolean | null,
          specExpanded: null as boolean | null,
        },
  );
  const initQuery = useMemo(() => initialQueryRef.current(), []);
  const pendingCompareRef = useRef<string | null>(initQuery.compareRaw);
  const pendingMyRef = useRef<string | null>(initQuery.myRaw);

  const [dark, setDark] = useState<boolean>(() => {
    try { const t = localStorage.getItem(LS_THEME); if (t) return t === 'dark'; } catch { /* noop */ }
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
  });
  const [products, setProducts] = useState<Product[]>(() => {
    try { const raw = localStorage.getItem(LS_DATA); if (raw) { const r = normalizeDataset(JSON.parse(raw)); if (r.products.length) return r.products; } } catch { /* noop */ }
    return normalizeDataset(BUILTIN_DATASET).products;
  });
  const productsRef = useRef(products);
  productsRef.current = products;
  const [tab, setTab] = useState<Tab>(() => initQuery.tab);
  const [mode, setMode] = useState<Mode>(() => initQuery.mode);
  const [mnp, setMnp] = useState<boolean>(() => initQuery.mnp);
  const [budgetMaxPrice, setBudgetMaxPrice] = useState<number>(() => initQuery.maxPrice);
  const [budgetCat, setBudgetCat] = useState<BudgetCategoryFilter>(() => initQuery.budgetCat);
  const [sellMode, setSellMode] = useState<SellMode>(() => initQuery.sellMode);
  const [sellCustom, setSellCustom] = useState<number>(() => initQuery.sellCustom);
  const [showFlags, setShowFlags] = useState<CompareShowFlags>(() =>
    loadInitialShowFlags(initQuery.showFlags, Boolean(initQuery.myRaw)),
  );
  const [diffOnly, setDiffOnly] = useState<boolean>(
    () => loadInitialSpecPrefs(initQuery.diffOnly, initQuery.specExpanded).diffOnly,
  );
  const [specExpanded, setSpecExpanded] = useState<boolean>(
    () => loadInitialSpecPrefs(initQuery.diffOnly, initQuery.specExpanded).specExpanded,
  );
  const [mySel, setMySel] = useState<Sel | null>(() => {
    if (initQuery.myRaw) {
      const parsed = parseMyDeviceQuery(initQuery.myRaw, products);
      if (parsed.matched && parsed.sel) {
        pendingMyRef.current = null;
        return parsed.sel;
      }
    } else {
      pendingMyRef.current = null;
    }
    return null;
  });
  const [sels, setSels] = useState<Sel[]>(() => {
    if (initQuery.compareRaw) {
      const parsed = parseCompareQuery(initQuery.compareRaw, products);
      if (parsed.matchedAll && parsed.sels.length > 0) {
        pendingCompareRef.current = null;
        return parsed.sels;
      }
      if (parsed.sels.length > 0) {
        return parsed.sels;
      }
    } else {
      pendingCompareRef.current = null;
    }
    return buildDefaultSels(products);
  });
  const [toastMsg, setToastMsg] = useState('');
  const toastTimer = useRef<number>();

  const toast = (m: string) => { setToastMsg(m); window.clearTimeout(toastTimer.current); toastTimer.current = window.setTimeout(() => setToastMsg(''), 2200); };

  useEffect(() => { document.documentElement.classList.toggle('dark', dark); try { localStorage.setItem(LS_THEME, dark ? 'dark' : 'light'); } catch { /* noop */ } }, [dark]);
  useEffect(() => { try { localStorage.setItem(LS_DATA, JSON.stringify({ schemaVersion: 1, products })); } catch { /* noop */ } }, [products]);
  useEffect(() => {
    try {
      localStorage.setItem(LS_COMPARE_SHOW, JSON.stringify(showFlags));
    } catch {
      /* noop */
    }
  }, [showFlags]);
  useEffect(() => {
    try {
      localStorage.setItem(LS_COMPARE_SPEC_PREFS, JSON.stringify({ diffOnly, specExpanded }));
    } catch {
      /* noop */
    }
  }, [diffOnly, specExpanded]);

  // 起動時の自動読み込み:
  //  1) ./products.json (同梱の実データ) を generatedAt が変わったとき、または未ロード時にマージ
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
          if (ver && (localStorage.getItem(LS_EXT) !== ver || cur.length <= SAMPLE_PRODUCTS.length)) {
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
      if (pendingCompareRef.current) {
        const raw = pendingCompareRef.current;
        pendingCompareRef.current = null;
        const parsed = parseCompareQuery(raw, cur);
        if (parsed.sels.length > 0) {
          setSels(parsed.sels);
        } else {
          setSels(buildDefaultSels(cur));
        }
      }
      if (pendingMyRef.current) {
        const rawMy = pendingMyRef.current;
        pendingMyRef.current = null;
        const parsedMy = parseMyDeviceQuery(rawMy, cur);
        if (parsedMy.sel) {
          setMySel(parsedMy.sel);
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 製品が変わったとき選択を整合させる
  useEffect(() => {
    if (pendingMyRef.current) {
      const parsedMy = parseMyDeviceQuery(pendingMyRef.current, products);
      if (parsedMy.matched && parsedMy.sel) {
        pendingMyRef.current = null;
        setMySel(parsedMy.sel);
      }
    }
    if (pendingCompareRef.current) {
      const parsed = parseCompareQuery(pendingCompareRef.current, products);
      if (parsed.matchedAll && parsed.sels.length > 0) {
        pendingCompareRef.current = null;
        setSels(parsed.sels);
        return;
      }
      if (parsed.sels.length > 0) {
        setSels(parsed.sels);
        return;
      }
      return;
    }
    setSels((cur) => {
      const valid = cur.filter((s) => products.some((p) => p.id === s.pid)).map((s) => { const p = products.find((x) => x.id === s.pid)!; return p.skus.some((k) => k.id === s.sid) ? s : { pid: p.id, sid: p.skus[0].id }; });
      if (valid.length) return valid.length === cur.length && valid.every((v, i) => v === cur[i]) ? cur : valid;
      return buildDefaultSels(products);
    });
  }, [products]);

  // ブラウザの戻る・進む操作 (popstate) 時に URL から状態を復元
  useEffect(() => {
    const onPopState = () => {
      const q = parseUrlSearchParams(window.location.search);
      setMode(q.mode);
      setMnp(q.mnp);
      setTab(q.tab);
      setBudgetMaxPrice(q.maxPrice);
      setBudgetCat(q.budgetCat);
      setSellMode(q.sellMode);
      setSellCustom(q.sellCustom);
      if (q.showFlags) {
        setShowFlags(q.showFlags);
      }
      if (q.diffOnly !== null) {
        setDiffOnly(q.diffOnly);
      }
      if (q.specExpanded !== null) {
        setSpecExpanded(q.specExpanded);
      }
      setMySel(parseMyDeviceQuery(q.myRaw, productsRef.current).sel);
      if (q.compareRaw) {
        const parsed = parseCompareQuery(q.compareRaw, productsRef.current);
        if (parsed.sels.length > 0) setSels(parsed.sels);
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // 選択状態 (sels / mode / mnp / tab / budgetMaxPrice / budgetCat / mySel / sellMode / sellCustom / showFlags / diffOnly / specExpanded) を URL クエリパラメータへリアルタイム同期 (リロードなし)
  useEffect(() => {
    if (typeof window === 'undefined' || pendingCompareRef.current || pendingMyRef.current) return;
    const nextSearch = buildShareSearchString(
      products,
      sels,
      mode,
      mnp,
      tab,
      budgetMaxPrice,
      budgetCat,
      mySel,
      sellMode,
      sellCustom,
      showFlags,
      diffOnly,
      specExpanded,
    );
    if (window.location.search !== nextSearch) {
      const nextUrl = `${window.location.pathname}${nextSearch}${window.location.hash}`;
      window.history.replaceState(null, '', nextUrl);
    }
  }, [products, sels, mode, mnp, tab, budgetMaxPrice, budgetCat, mySel, sellMode, sellCustom, showFlags, diffOnly, specExpanded]);

  const tabs: { id: Tab; label: string; shortLabel: string; icon: React.ReactNode }[] = [
    { id: 'compare', label: 'スペック＆キャリア比較', shortLabel: '価格・スペック比較', icon: <Scale className="h-4 w-4 shrink-0" /> },
    { id: 'budget', label: '💰 予算から探す', shortLabel: '💰 予算で探す', icon: <Sparkles className="h-4 w-4 shrink-0" /> },
    { id: 'timeline', label: '価格改定タイムライン', shortLabel: '価格改定履歴', icon: <LineIcon className="h-4 w-4 shrink-0" /> },
    { id: 'fx', label: '発売時価格 × 為替', shortLabel: '発売価格×為替', icon: <Coins className="h-4 w-4 shrink-0" /> },
  ];

  return (
    <ThemeCtx.Provider value={dark}>
      <div className="min-h-screen flex flex-col text-zinc-900 dark:text-zinc-100">
        <header className="sticky top-0 z-30 border-b border-zinc-200 bg-white/85 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/85">
          <div className="mx-auto flex max-w-7xl items-center gap-2 sm:gap-3 px-3 py-2.5 sm:px-4 sm:py-3">
            <a href="./" className="flex min-w-0 items-center gap-2 group">
              <div className="shrink-0 rounded-xl bg-zinc-900 p-1.5 text-white transition group-hover:opacity-85 dark:bg-white dark:text-zinc-900"><Apple className="h-5 w-5" /></div>
              <div className="min-w-0">
                <div className="truncate text-sm sm:text-base font-extrabold leading-tight">Apple Price Atlas</div>
                <div className="truncate text-[10px] sm:text-[11px] text-zinc-500">スペック・キャリア価格・価格改定の完全比較</div>
              </div>
            </a>
            <div className="ml-2 hidden items-center gap-1.5 lg:flex">{CARRIER_ORDER.map((id) => <CarrierBadge key={id} id={id} small />)}</div>
            <button onClick={() => setDark(!dark)} aria-label="テーマ切替" className={`${btnCls} ml-auto shrink-0 !px-2.5 !py-1.5`}>
              {dark ? <Sun className="h-4 w-4 shrink-0" /> : <Moon className="h-4 w-4 shrink-0" />}
              <span className="hidden sm:inline">{dark ? 'ライト' : 'ダーク'}</span>
            </button>
          </div>
          <nav className="mx-auto grid max-w-7xl grid-cols-4 sm:flex sm:gap-1 px-2 sm:px-4">
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

        <main className="mx-auto w-full max-w-7xl flex-1 px-3 py-4 sm:px-4 sm:py-6">
          {tab === 'compare' && (
            <CompareView
              products={products}
              all={products}
              sels={sels}
              setSels={setSels}
              mode={mode}
              setMode={setMode}
              mnp={mnp}
              setMnp={setMnp}
              mySel={mySel}
              setMySel={setMySel}
              sellMode={sellMode}
              setSellMode={setSellMode}
              sellCustom={sellCustom}
              setSellCustom={setSellCustom}
              showFlags={showFlags}
              setShowFlags={setShowFlags}
              diffOnly={diffOnly}
              setDiffOnly={setDiffOnly}
              specExpanded={specExpanded}
              setSpecExpanded={setSpecExpanded}
              toast={toast}
              onOpenBudgetTab={() => setTab('budget')}
            />
          )}
          {tab === 'budget' && (
            <BudgetView
              products={products}
              sels={sels}
              setSels={setSels}
              setTab={setTab}
              maxPrice={budgetMaxPrice}
              setMaxPrice={setBudgetMaxPrice}
              catFilter={budgetCat}
              setCatFilter={setBudgetCat}
              mnp={mnp}
              toast={toast}
            />
          )}
          {tab === 'timeline' && <TimelineView products={products} toast={toast} />}
          {tab === 'fx' && <FxView products={products} toast={toast} />}
        </main>

        <footer className="mx-auto w-full max-w-7xl px-3 pb-10 pt-4 text-[11px] sm:text-xs text-zinc-500 sm:px-4">
          <div className="flex flex-col gap-2 border-t border-zinc-200 pt-4 sm:flex-row sm:items-center sm:justify-between dark:border-zinc-800">
            <div className="space-y-0.5">
              <div>※ 価格は日本国内の税込表示。為替・USD価格・キャリア価格・中古相場には概算/モデル値を含みます。購入前に各公式サイト・販売店で最新情報をご確認ください。</div>
              <div>※ 当サイトは楽天アフィリエイト等のアフィリエイトプログラムに参加しており、一部ショップリンクに広告（PR）を含みます。</div>
            </div>
            <div className="flex flex-wrap shrink-0 items-center gap-4 font-medium">
              <a href="./privacy/" className="hover:text-zinc-900 hover:underline dark:hover:text-zinc-200">プライバシーポリシー</a>
              <a href="./terms/" className="hover:text-zinc-900 hover:underline dark:hover:text-zinc-200">利用規約</a>
              <a href="https://azarin.me/inquiry?category=personal&type=bug&message=Apple%20Price%20Atlas%E3%81%AB%E3%81%A4%E3%81%84%E3%81%A6" target="_blank" rel="noopener noreferrer" className="hover:text-zinc-900 hover:underline dark:hover:text-zinc-200">お問い合わせ</a>
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
