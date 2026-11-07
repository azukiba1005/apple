import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { CompareView } from './components/CompareView';
import { UsedOffersModal, UsedShopOffersModal } from './components/UsedOffersModal';
import { BudgetSearchModal, BudgetView } from './components/BudgetSearchModal';
import {
  RefurbishedView,
  type RefurbCategoryFilter,
  type RefurbishedDataset,
  type RefurbishedItem,
  type RefurbishedSpecs,
  type RefurbSortKey,
  type RefurbStockStatus,
} from './components/RefurbishedView';
import { TimelineView } from './components/TimelineView';
import { FxView, LaunchFxView } from './components/LaunchFxView';
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
import { AccessoriesView } from './AccessoriesView';

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
const PROFILES: Record<'phone' | 'tablet' | 'watch', Partial<Record<CarrierKey, Profile>>> = {
  phone: {
    docomo: { mult: 1.19, mnp: 22000, residual: 0.42, program: 'いつでもカエドキプログラム', months: 23 },
    au: { mult: 1.17, mnp: 22000, residual: 0.5, program: 'スマホトクするプログラム', months: 24 },
    softbank: { mult: 1.18, mnp: 21600, residual: 0.5, program: '新トクするサポート', months: 24 },
    rakuten: { mult: 1.02, mnp: 20000, residual: 0.5, program: '楽天モバイル買い替え超トクプログラム', months: 24 },
  },
  tablet: {
    docomo: { mult: 1.15, mnp: 0, residual: 0.5, program: 'いつでもカエドキプログラム', months: 23 },
    au: { mult: 1.14, mnp: 0, residual: 0.52, program: 'スマホトクするプログラム', months: 24 },
    softbank: { mult: 1.15, mnp: 0, residual: 0.51, program: '新トクするサポート', months: 24 },
  },
  watch: {
    docomo: { mult: 1.13, mnp: 0, residual: 0.49, program: 'いつでもカエドキプログラム', months: 23 },
    au: { mult: 1.11, mnp: 0, residual: 0.5, program: 'スマホトクするプログラム', months: 24 },
    softbank: { mult: 1.12, mnp: 0, residual: 0.5, program: '新トクするサポート', months: 24 },
    rakuten: { mult: 1.03, mnp: 0, residual: 0.5, program: '楽天モバイル買い替え超トクプログラム', months: 24 },
  },
};
const r5 = (n: number) => Math.round(n / 5) * 5;

function mkCarriers(h: PricePoint[], kind: 'phone' | 'tablet' | 'watch'): Sku['carriers'] {
  const first = h[0].appleStorePrice, last = h[h.length - 1].appleStorePrice;
  const out: Sku['carriers'] = {};
  (Object.keys(PROFILES[kind]) as CarrierKey[]).forEach((c) => {
    const p = PROFILES[kind][c];
    if (!p) return;
    const current = r5(last * p.mult);
    out[c] = {
      launchPrice: r5(first * p.mult),
      currentPrice: current,
      mnpPrice: p.mnp > 0 ? Math.max(current - p.mnp, 0) : null,
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
  apple: { label: 'Apple Store', light: '#27272a', dark: '#d4d4d8' },
  docomo: { label: 'docomo', light: '#99525e', dark: '#b87682' },
  au: { label: 'au', light: '#a66b46', dark: '#c28c69' },
  softbank: { label: 'SoftBank', light: '#5c738a', dark: '#8fa4b8' },
  rakuten: { label: '楽天モバイル', light: '#8f567a', dark: '#b37da0' },
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
      const rawCarriers = { ...((s as any).carrierPricing ?? {}), ...(s.carriers ?? {}) } as Record<string, any>;
      const carriers: Sku['carriers'] = {};
      (['docomo', 'au', 'softbank', 'rakuten', 'apple'] as CarrierId[]).forEach((cid) => {
        const rawCp = rawCarriers[cid];
        if (!rawCp || typeof rawCp !== 'object') return;
        if (p.category === 'iPad' && cid === 'rakuten') return;
        const currentPrice = rawCp.currentPrice ?? rawCp.launchPrice;
        if (typeof currentPrice !== 'number') return;
        const launchPrice = typeof rawCp.launchPrice === 'number' ? rawCp.launchPrice : currentPrice;
        let returnProgram = rawCp.returnProgram ?? null;
        if (!returnProgram && typeof rawCp.programEffective2Yr === 'number') {
          const progNames: Record<string, { name: string; months: number }> = {
            docomo: { name: 'いつでもカエドキプログラム', months: 23 },
            au: { name: 'スマホトクするプログラム', months: 24 },
            softbank: { name: '新トクするサポート', months: 24 },
            rakuten: { name: '楽天モバイル買い替え超トクプログラム', months: 24 },
          };
          const meta = progNames[cid] ?? { name: '2年返却プログラム', months: 24 };
          returnProgram = {
            name: meta.name,
            months: meta.months,
            effectiveCost: rawCp.programEffective2Yr,
            residualValue: Math.max(currentPrice - rawCp.programEffective2Yr, 0),
          };
        }
        carriers[cid] = {
          launchPrice,
          currentPrice,
          mnpPrice: typeof rawCp.mnpPrice === 'number' ? rawCp.mnpPrice : null,
          returnProgram,
          ...(rawCp.isDiscontinued != null ? { isDiscontinued: rawCp.isDiscontinued } : {}),
          ...(rawCp.discontinuedDate ? { discontinuedDate: rawCp.discontinuedDate } : {}),
        };
      });
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

/**
 * iPad (Wi-Fi / Wi-Fi + Cellular) や Apple Watch (GPS / GPS + Cellular) で
 * 1クリックで通信方式を切り替えられる候補リストを返す
 */
function getProductConnectivityOptions(p: Product): ConnectivityType[] {
  if (p.category === 'iPad') {
    const hasWifi = p.skus.some((s) => s.connectivity === 'Wi-Fi');
    const hasCell = p.skus.some((s) => s.connectivity === 'Wi-Fi + Cellular');
    return hasWifi && hasCell ? ['Wi-Fi', 'Wi-Fi + Cellular'] : [];
  }
  if (p.category === 'Apple Watch') {
    const hasGps = p.skus.some((s) => s.connectivity === 'GPS');
    const hasCell = p.skus.some((s) => s.connectivity === 'GPS + Cellular');
    return hasGps && hasCell ? ['GPS', 'GPS + Cellular'] : [];
  }
  return [];
}

/**
 * 同じ容量/ケースサイズで指定した通信方式のペアSKUを検索する
 */
function findSiblingSkuByConnectivity(p: Product, currentSku: Sku, targetConn: ConnectivityType): Sku | undefined {
  if (currentSku.connectivity === targetConn) return currentSku;
  return (
    p.skus.find((s) => s.connectivity === targetConn && s.storage === currentSku.storage) ??
    p.skus.find((s) => s.connectivity === targetConn)
  );
}

/**
 * Wi-Fi / GPS 単体モデルが選択されている場合、同じ容量/ケースサイズの Cellular 版SKUを返す
 */
function findSiblingCellularSku(p: Product, currentSku: Sku): Sku | undefined {
  if (p.category === 'iPad' && currentSku.connectivity === 'Wi-Fi') {
    return findSiblingSkuByConnectivity(p, currentSku, 'Wi-Fi + Cellular');
  }
  if (p.category === 'Apple Watch' && currentSku.connectivity === 'GPS') {
    return findSiblingSkuByConnectivity(p, currentSku, 'GPS + Cellular');
  }
  return undefined;
}

export interface CarrierUnavailableInfo {
  badge: string;
  refPrice?: number;
  refLabel?: string;
  cellularSku?: Sku;
}

/**
 * キャリア価格が null（未設定・対象外）のセルに対して、
 * カテゴリ別の販売ルールに応じたスマートな理由バッジと参考価格情報を返す
 */
function getCarrierUnavailableInfo(
  p: Product,
  sku: Sku,
  carrierId: CarrierId,
  mode: Mode,
  mnp: boolean,
): CarrierUnavailableInfo {
  const cp = sku.carriers[carrierId];

  // 1. Apple Store 直販
  if (carrierId === 'apple') {
    if (cp && mode === 'return') {
      return { badge: `対象外（一括購入のみ：${yen(cp.currentPrice)}）` };
    }
    return {
      badge: p.specs.launchPriceUsd
        ? `日本未発売 (米国 ${String(p.specs.launchPriceUsd)})`
        : '価格データなし',
    };
  }

  // 2. iPad × 楽天モバイル（端末取扱なし・SIMのみ対応）
  if (p.category === 'iPad' && carrierId === 'rakuten') {
    return { badge: '取扱なし（SIMのみ対応）' };
  }

  // 3. AirPods × 2年返却モード（MNP割引・返却プログラム対象外、一括購入のみ）
  if (p.category === 'AirPods' && mode === 'return' && cp) {
    return { badge: `対象外（一括購入のみ：${yen(cp.currentPrice)}）` };
  }

  // 4. キャリア販売はあるが2年返却プログラム非対応（旧世代iPad・旧世代iPhoneなど）
  if (cp && mode === 'return' && !cp.returnProgram) {
    return { badge: `一括販売のみ（${yen(cp.currentPrice)}）` };
  }

  // 5. iPad (Wi-Fiモデル) / Apple Watch (GPSモデル) が選ばれている場合 → Cellular版のみ取扱 ＋ Cellular版参考価格
  if ((p.category === 'iPad' || p.category === 'Apple Watch') && !/Cellular/i.test(sku.connectivity)) {
    const cellSku = findSiblingCellularSku(p, sku);
    const cellCp = cellSku?.carriers[carrierId];
    if (cellCp) {
      const cellVal = carrierValue(cellCp, mode, mnp);
      if (cellVal != null) {
        return {
          badge: 'ー（Cellularモデルのみ取扱）',
          refPrice: cellVal,
          refLabel: mode === 'return' ? '※Cellular版の2年返却実質' : '※Cellular版の価格',
          cellularSku: cellSku,
        };
      }
      return {
        badge: 'ー（Cellularモデルのみ取扱）',
        refPrice: cellCp.currentPrice,
        refLabel: '※Cellular版（一括のみ）',
        cellularSku: cellSku,
      };
    }
    return { badge: 'ー（Cellularモデルのみ取扱）', cellularSku: cellSku };
  }

  // 6. Mac シリーズ
  if (p.category === 'Mac') {
    return { badge: '取扱なし（直販・量販店のみ）' };
  }

  return { badge: '取扱なし' };
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
  CARRIER_ORDER.forEach((id) =>
    rows.push([
      `${CARRIER_META[id].label} ${modeLabel}`,
      ...cols.map((c) => {
        const v = carrierValue(c.sku.carriers[id], mode, mnp);
        if (v != null) return yen(v);
        const unavail = getCarrierUnavailableInfo(c.p, c.sku, id, mode, mnp);
        return unavail.refPrice != null ? `${unavail.badge} (${unavail.refLabel}: ${yen(unavail.refPrice)})` : unavail.badge;
      }),
    ]),
  );
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
        if (v == null) {
          const unavail = getCarrierUnavailableInfo(c.p, c.sku, id, mode, mnp);
          return unavail.refPrice != null ? `${unavail.badge} (${unavail.refLabel}: ${yen(unavail.refPrice)})` : unavail.badge;
        }
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

const card = 'rounded-2xl bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04)] dark:bg-[#1c1d22] dark:shadow-none';
const selectCls = 'rounded-xl bg-[#f5f5f7] px-3.5 py-2 text-base sm:text-sm text-zinc-800 outline-none transition focus:ring-2 focus:ring-zinc-400/50 dark:bg-[#25272e] dark:text-zinc-100';
const btnCls = 'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-zinc-100 px-3.5 py-2 text-xs sm:text-sm font-medium text-zinc-700 transition hover:bg-zinc-200/80 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40 dark:bg-[#25272e] dark:text-zinc-200 dark:hover:bg-[#2d3039]';
const excelBtnCls = 'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-zinc-100 px-3.5 py-2 text-xs sm:text-sm font-medium text-zinc-700 transition hover:bg-zinc-200/80 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40 dark:bg-[#25272e] dark:text-zinc-200 dark:hover:bg-[#2d3039]';
const secondaryActionBtnCls = 'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-xl bg-zinc-100 px-3 py-1.5 text-xs sm:text-sm font-medium text-zinc-700 transition hover:bg-zinc-200/80 dark:bg-[#25272e] dark:text-zinc-300 dark:hover:bg-[#2d3039]';

function CarrierBadge({ id, small }: { id: CarrierId; small?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-zinc-100 font-medium text-zinc-700 dark:bg-[#25272e] dark:text-zinc-300 ${small ? 'px-2.5 py-1 text-xs' : 'px-3 py-1 text-xs sm:text-sm'}`}>
      {CARRIER_META[id].label}
    </span>
  );
}

function DeltaBadge({ diff, base }: { diff: number; base: number }) {
  const pct = base ? (diff / base) * 100 : 0;
  const up = diff > 0, down = diff < 0;
  const dotCls = up ? 'bg-[#a66c75]' : down ? 'bg-[#649274]' : 'bg-zinc-400';
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-semibold tabular-nums text-zinc-700 dark:bg-[#25272e] dark:text-zinc-300">
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotCls}`} />
      {signedYen(diff)} ({signedPct(pct)})
    </span>
  );
}

/** リセールバリュー（残価率）バッジ: （現在の中古最安値 ÷ 発売時Apple直販価格）× 100 */
function ResaleBadge({ rate, launchPrice }: { rate: number | null; launchPrice?: number | null }) {
  if (rate == null || !Number.isFinite(rate)) {
    return (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-500 dark:bg-[#25272e] dark:text-zinc-400">
        リセール率 —
      </span>
    );
  }
  const dotCls = rate >= 65 ? 'bg-[#649274]' : 'bg-zinc-400 dark:bg-zinc-500';
  return (
    <span
      title={launchPrice ? `（現在の中古最安値 ÷ 発売時Apple直販価格 ${yen(launchPrice)}）× 100` : '（現在の中古最安値 ÷ 発売時Apple直販価格）× 100'}
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-semibold tabular-nums text-zinc-700 dark:bg-[#25272e] dark:text-zinc-300"
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
        className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-medium text-zinc-600 dark:bg-[#25272e] dark:text-zinc-300"
      >
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#649274]" />
        {compact ? '大手認定' : '大手ショップ認定'}
      </span>
    );
  }
  return (
    <span
      title="大手ショップ在庫0件のため、タイトル検証を通過した一般ショップの最安値を表示しています"
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-medium text-zinc-500 dark:bg-[#25272e] dark:text-zinc-400"
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-zinc-400" />
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
      ? 'bg-[#649274]'
      : res.status === 'expensive'
        ? 'bg-[#a66c75]'
        : 'bg-zinc-400';

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs sm:text-sm tabular-nums text-zinc-500 dark:text-zinc-400">
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
        <span className="text-xs text-zinc-500 dark:text-zinc-400">
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
        ? 'bg-[#a66c75]'
        : diff < -0.5
          ? 'bg-[#649274]'
          : 'bg-zinc-400';

  return (
    <span className="inline-flex flex-wrap items-center gap-2 tabular-nums text-xs sm:text-sm">
      <span className="inline-flex flex-wrap items-center gap-1.5 rounded-xl bg-zinc-100 px-3 py-1 font-medium text-zinc-700 dark:bg-[#25272e] dark:text-zinc-300">
        <span className="text-zinc-500 dark:text-zinc-400">{compact ? '市場' : '当時の市場レート'}:</span>
        <strong className="font-semibold text-zinc-800 dark:text-zinc-100">
          {mkt != null ? `1ドル ${mkt.toFixed(1)}円` : '—'}
        </strong>
        <span className="mx-0.5 text-zinc-400">/</span>
        <span className="text-zinc-500 dark:text-zinc-400">{compact ? 'Apple' : 'Apple適用レート'}:</span>
        <strong className="font-semibold text-zinc-800 dark:text-zinc-100">
          {apl != null ? `1ドル ${apl.toFixed(1)}円` : '—'}
        </strong>
        {!compact && <span className="text-xs text-zinc-400">(税抜・税{taxPct}%)</span>}
      </span>
      {diff != null && (
        <span
          title={`当時の実勢為替 (${mkt?.toFixed(1)}円) と比べて1ドルあたり ${signedRate(diff)} (${diff > 0 ? '上乗せ' : diff < 0 ? '割引' : '同水準'})`}
          className="inline-flex items-center gap-1.5 rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-600 dark:bg-[#25272e] dark:text-zinc-300"
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
      ? 'bg-[#649274]'
      : res.status === 'expensive'
        ? 'bg-[#a66c75]'
        : 'bg-zinc-400';
  const verdictWord = res.status === 'bargain' ? '割安' : res.status === 'expensive' ? '割高' : '適正水準';

  return (
    <span className="inline-flex flex-wrap items-center gap-2 tabular-nums">
      <span
        title={`現在の為替レート (1ドル ${latestUsdJpy.toFixed(1)}円・税込10%) で US $${pt.usdPrice} を換算した理論価格 ${yen(res.fairJpy)} との比較`}
        className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-zinc-100 px-3 py-1 text-xs sm:text-sm font-semibold text-zinc-700 dark:bg-[#25272e] dark:text-zinc-300"
      >
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotCls}`} />
        {compact
          ? `為替評価: ${verdictWord} (${signedPct(res.pctDiff)})`
          : `今の為替比: ${verdictWord} (${signedYen(res.jpyDiff)} / ${signedPct(res.pctDiff)})`}
      </span>
      {showFairPrice && (
        <span className="text-xs sm:text-sm text-zinc-500 dark:text-zinc-400">
          理論価格: <strong className="font-semibold text-zinc-700 dark:text-zinc-300">{yen(res.fairJpy)}</strong>
        </span>
      )}
    </span>
  );
}

function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <div className="no-scrollbar inline-flex max-w-full overflow-x-auto rounded-xl bg-zinc-200/60 p-1 dark:bg-[#23252b]">
      {options.map((o) => (
        <button key={o.value} onClick={() => onChange(o.value)}
          className={`flex-1 sm:flex-initial whitespace-nowrap rounded-lg px-3 py-1.5 text-xs sm:px-4 sm:text-sm font-semibold transition ${value === o.value ? 'bg-white text-zinc-900 shadow-xs dark:bg-[#31343d] dark:text-zinc-100' : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200'}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function SectionTitle({ icon, title, desc }: { icon: React.ReactNode; title: string; desc?: string }) {
  return (
    <div className="mb-4 sm:mb-5 flex items-start gap-3 sm:gap-3.5">
      <div className="shrink-0 rounded-xl bg-zinc-900 p-2.5 text-zinc-100 dark:bg-[#262830] dark:text-zinc-200">{icon}</div>
      <div className="min-w-0"><h2 className="text-base sm:text-lg font-bold leading-snug text-zinc-900 dark:text-zinc-100">{title}</h2>{desc && <p className="mt-1 text-xs sm:text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">{desc}</p>}</div>
    </div>
  );
}

function ProductSkuPicker({ products, sel, onChange }: { products: Product[]; sel: Sel; onChange: (s: Sel) => void }) {
  const sortedProducts = useMemo(() => [...products].sort(compareProducts), [products]);
  const p = sortedProducts.find((x) => x.id === sel.pid) ?? sortedProducts[0];
  const cats = useMemo(() => sortCategories(Array.from(new Set(sortedProducts.map((x) => x.category)))), [sortedProducts]);
  const skus = useMemo(() => [...(pricedSkus(p).length ? pricedSkus(p) : p.skus)].sort(compareSkus), [p]);
  return (
    <div className="flex w-full sm:w-auto flex-wrap items-center gap-2.5">
      <select className={`${selectCls} min-w-0 flex-1 sm:flex-initial max-w-full`} value={p.id} onChange={(e) => { const np = sortedProducts.find((x) => x.id === e.target.value)!; const nextSkus = [...(pricedSkus(np).length ? pricedSkus(np) : np.skus)].sort(compareSkus); onChange({ pid: np.id, sid: nextSkus[0].id }); }}>
        {cats.map((c) => (<optgroup key={c} label={c}>{sortedProducts.filter((x) => x.category === c).map((x) => <option key={x.id} value={x.id}>{x.name}{x.releaseDate ? ` (${x.releaseDate.slice(0, 4)})` : ''}{hasDetail(x) ? ' ★' : ''}</option>)}</optgroup>))}
      </select>
      <select className={selectCls} value={sel.sid} onChange={(e) => onChange({ pid: p.id, sid: e.target.value })}>
        {skus.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
      </select>
    </div>
  );
}

const EmptyNote = ({ text }: { text: string }) => <div className={`${card} p-12 text-center text-sm text-zinc-500 dark:text-zinc-400`}>{text}</div>;

const useChartColors = () => { const d = useDark(); return { axis: d ? '#9ca0ab' : '#555863', grid: d ? '#262830' : '#e6e7ec', tipBg: d ? '#1c1d22' : '#ffffff', tipBorder: d ? '#2c2e36' : '#e6e7ec', text: d ? '#ececef' : '#1d1d1f' }; };

/* ---------- URLクエリパラメータの双方向同期ユーティリティ ---------- */
export type Tab = 'compare' | 'budget' | 'refurbished' | 'timeline' | 'fx' | 'accessories';

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
      : tabRaw === 'refurbished' || tabRaw === 'refurb'
        ? 'refurbished'
        : tabRaw === 'timeline'
          ? 'timeline'
          : tabRaw === 'fx'
            ? 'fx'
            : tabRaw === 'accessories' || tabRaw === 'accessory'
              ? 'accessories'
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


export function isProductDiscontinued(p: Product, sku: Sku): boolean {
  return getSkuDiscontinuedInfo(p, sku).isDiscontinued;
}

const MemoizedAccessoriesView = React.memo(AccessoriesView);

export {
  CompareView,
  UsedOffersModal,
  UsedShopOffersModal,
  BudgetSearchModal,
  BudgetView,
  RefurbishedView,
  TimelineView,
  LaunchFxView,
  FxView,
  round1,
  SAMPLE_PRODUCTS,
  APPLEDB_IDS,
  SAMPLE_DISCONTINUED,
  BUILTIN_DATASET,
  TAX,
  CARRIER_ORDER,
  CARRIER_META,
  ThemeCtx,
  useDark,
  carrierColor,
  yen,
  signedYen,
  signedPct,
  ts,
  ym,
  ymJp,
  lastOf,
  impliedRate,
  marketRate,
  rateDiffVal,
  fairJpyVal,
  signedRate,
  yenAxis,
  buildYenAxis,
  buildDeviceTimeline,
  skuPriced,
  pricedSkus,
  CATEGORY_ORDER,
  catRank,
  sortCategories,
  skuConnRank,
  skuRamRank,
  skuStorRank,
  skuMmRank,
  compareSkus,
  deviceSubfamilyRank,
  screenSizeRank,
  chipTierRank,
  portVariantRank,
  compareProducts,
  CATEGORY_ICON,
  CatIcon,
  carrierValue,
  getProductConnectivityOptions,
  findSiblingSkuByConnectivity,
  findSiblingCellularSku,
  getCarrierUnavailableInfo,
  PRIMARY_SPEC_ROWS,
  DETAIL_SPEC_ROWS,
  SPEC_ROWS,
  APPLEDB_URL,
  addDays,
  specText,
  getColSpecDisplayValue,
  evaluateSpecRows,
  formatFxComparisonText,
  evaluateCurrentFxFairness,
  buildCompareTable,
  toMarkdown,
  toCSV,
  copyText,
  downloadBlob,
  downloadFile,
  downloadXlsx,
  buildCompareExcelSheets,
  card,
  selectCls,
  btnCls,
  excelBtnCls,
  secondaryActionBtnCls,
  CarrierBadge,
  DeltaBadge,
  ResaleBadge,
  TrustedShopBadge,
  CompactCardFxLine,
  FxRatePairChip,
  CurrentFxFairnessBadge,
  Segmented,
  SectionTitle,
  ProductSkuPicker,
  EmptyNote,
  useChartColors,
  DEFAULT_COMPARE_IDS,
  CARRIER_STORE_URLS,
  appleStoreUrlForCategory,
  computePerformanceScore,
  toSlug,
  encodeSkuToken,
  findProductByQueryToken,
  findSkuByQueryToken,
  parseCompareQuery,
  buildDefaultSels,
  parseBudgetCategoryParam,
  encodeBudgetCategoryParam,
  parseSellModeParam,
  parseMyDeviceQuery,
  COMPARE_SHOW_KEYS,
  DEFAULT_SHOW_FLAGS,
  LS_COMPARE_SHOW,
  parseShowFlagsParam,
  encodeShowFlagsParam,
  loadInitialShowFlags,
  LS_COMPARE_SPEC_PREFS,
  loadInitialSpecPrefs,
  parseUrlSearchParams,
  buildShareSearchString,
};

export type {
  DeviceTimelinePoint,
  Mode,
  Sel,
  XlsCellKind,
  XlsCell,
  XlsSheet,
  RefurbCategoryFilter,
  RefurbishedDataset,
  RefurbishedItem,
  RefurbishedSpecs,
  RefurbSortKey,
  RefurbStockStatus,
};

/* =====================================================================================
 * 8. App
 * ===================================================================================== */

const LS_DATA = 'apple-price-atlas:data:v3';
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
  const [refurbDataset, setRefurbDataset] = useState<RefurbishedDataset | null>(null);
  const toastTimer = useRef<number>();

  const toast = useCallback((m: string) => { setToastMsg(m); window.clearTimeout(toastTimer.current); toastTimer.current = window.setTimeout(() => setToastMsg(''), 2200); }, []);
  const handleOpenBudgetTab = useCallback(() => setTab('budget'), []);

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
  //  2) ./refurbished.json (Apple認定整備済品データ) を読み込み
  //  3) AppleDB が有効なら api.appledb.dev から取得してスペック/販売終了日を補強
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
      try {
        const rr = await fetch('./refurbished.json');
        if (rr.ok) {
          const rj = await rr.json();
          if (rj && Array.isArray(rj.items)) {
            setRefurbDataset(rj as RefurbishedDataset);
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
    { id: 'refurbished', label: 'Apple認定整備済品', shortLabel: '整備済品', icon: <Apple className="h-4 w-4 shrink-0" /> },
    { id: 'timeline', label: '価格改定タイムライン', shortLabel: '価格改定履歴', icon: <LineIcon className="h-4 w-4 shrink-0" /> },
    { id: 'fx', label: '発売時価格 × 為替', shortLabel: '発売価格×為替', icon: <Coins className="h-4 w-4 shrink-0" /> },
    { id: 'accessories', label: 'アクセサリー', shortLabel: 'アクセサリー', icon: <ShoppingBag className="h-4 w-4 shrink-0" /> },
  ];

  return (
    <ThemeCtx.Provider value={dark}>
      <div className="min-h-screen flex flex-col bg-[#f5f5f7] text-[#1d1d1f] dark:bg-[#141518] dark:text-zinc-100">
        <header className="sticky top-0 z-30 border-b border-zinc-200/50 bg-[#f5f5f7]/85 backdrop-blur-md dark:border-white/[0.04] dark:bg-[#141518]/85">
          <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3 sm:px-6 sm:py-3.5">
            <a href="./" className="flex min-w-0 items-center gap-2.5 group">
              <div className="shrink-0 rounded-xl bg-zinc-900 p-2 text-zinc-100 transition group-hover:opacity-85 dark:bg-[#25272e] dark:text-zinc-100"><Apple className="h-5 w-5" /></div>
              <div className="min-w-0">
                <div className="truncate text-sm sm:text-base font-bold leading-tight text-zinc-900 dark:text-zinc-100">Apple Price Atlas</div>
                <div className="truncate text-xs text-zinc-500 dark:text-zinc-400">スペック・キャリア価格・価格改定の完全比較</div>
              </div>
            </a>
            <button onClick={() => setDark(!dark)} aria-label="テーマ切替" className={`${btnCls} ml-auto shrink-0 !px-3 !py-1.5`}>
              {dark ? <Sun className="h-4 w-4 shrink-0" /> : <Moon className="h-4 w-4 shrink-0" />}
              <span className="hidden sm:inline">{dark ? 'ライト' : 'ダーク'}</span>
            </button>
          </div>
          <nav className="mx-auto grid max-w-7xl grid-cols-6 sm:flex sm:gap-1.5 px-2 sm:px-6">
            {tabs.map((t) => (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`inline-flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 whitespace-nowrap border-b-2 px-1.5 sm:px-4 py-2.5 sm:py-3 text-xs sm:text-sm font-semibold transition ${tab === t.id ? 'border-zinc-900 text-zinc-900 dark:border-zinc-200 dark:text-zinc-100' : 'border-transparent text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200'}`}>
                {t.icon}
                <span className="sm:hidden">{t.shortLabel}</span>
                <span className="hidden sm:inline">{t.label}</span>
              </button>
            ))}
          </nav>
        </header>

        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
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
              onOpenBudgetTab={handleOpenBudgetTab}
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
          {tab === 'refurbished' && (
            <RefurbishedView
              products={products}
              refurbDataset={refurbDataset}
              sels={sels}
              setSels={setSels}
              setTab={setTab}
              toast={toast}
            />
          )}
          {tab === 'timeline' && <TimelineView products={products} toast={toast} />}
          {tab === 'fx' && <FxView products={products} toast={toast} />}
          {tab === 'accessories' && <MemoizedAccessoriesView toast={toast} />}
        </main>

        <footer className="mx-auto w-full max-w-7xl px-4 pb-12 pt-6 text-xs text-zinc-500 dark:text-zinc-400 sm:px-6">
          <div className="flex flex-col gap-3 pt-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1 leading-relaxed">
              <div>※ 価格は日本国内の税込表示。為替・USD価格・キャリア価格・中古相場には概算/モデル値を含みます。購入前に各公式サイト・販売店で最新情報をご確認ください。</div>
              <div>※ 当サイトは楽天アフィリエイト等のアフィリエイトプログラムに参加しており、一部ショップリンクに広告（PR）を含みます。</div>
            </div>
            <div className="flex flex-wrap shrink-0 items-center gap-5 font-medium">
              <a href="./privacy/" className="hover:text-zinc-900 hover:underline dark:hover:text-zinc-200">プライバシーポリシー</a>
              <a href="./terms/" className="hover:text-zinc-900 hover:underline dark:hover:text-zinc-200">利用規約</a>
              <a href="https://azarin.me/inquiry?category=personal&type=bug&message=Apple%20Price%20Atlas%E3%81%AB%E3%81%A4%E3%81%84%E3%81%A6" target="_blank" rel="noopener noreferrer" className="hover:text-zinc-900 hover:underline dark:hover:text-zinc-200">お問い合わせ</a>
            </div>
          </div>
        </footer>

        {toastMsg && (
          <div className="fixed bottom-5 left-1/2 z-50 w-max max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-full bg-zinc-800 px-5 py-2.5 text-center text-xs sm:text-sm font-medium text-zinc-100 shadow-lg dark:bg-[#282b33] dark:text-zinc-100">
            <span className="inline-flex items-center gap-2"><Check className="h-4 w-4 shrink-0 text-[#7ea88c]" /><span>{toastMsg}</span></span>
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
