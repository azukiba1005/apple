import type { PricePoint } from './App';

/* =====================================================================================
 * Apple 純正・準純正アクセサリー カタログデータ (src/accessoriesData.ts)
 * ===================================================================================== */

export type AccessoryTier = 'genuine' | 'semi-genuine';

export type AccessoryTierSubType =
  | 'apple-official'      // Apple純正
  | 'apple-owned-beats'   // Apple傘下ブランド (Beats by Dre)
  | 'apple-collab'        // Apple公式コラボ (Apple × Hermès / Apple × Nike)
  | 'apple-store-partner' // Apple Store公式限定・共同開発パートナー (Logicool, Belkin, OtterBox, Incase 等)
  | 'mfi-qi2-partner';    // MFi / Qi2 / Made for Apple Watch 認証準純正 (Anker, CIO, Spigen, NIMASO 等)

export type AccessoryCategoryId =
  | 'pencil'
  | 'keyboard-input'
  | 'audio'
  | 'charging-cable'
  | 'adapter-hub'
  | 'airtag-tracker'
  | 'case-band-film'
  | 'display-home';

export type DeviceCompatGroupId =
  | 'iphone-16-17'
  | 'iphone-15'
  | 'iphone-12-14'
  | 'ipad-pro-m4-air-m2'
  | 'ipad-pro-air-mini-gen2'
  | 'ipad-10-11-usbc'
  | 'mac-apple-silicon'
  | 'apple-watch-all';

export interface AccessorySku {
  id: string;
  label: string;
  modelNumber?: string;
  launchPrice: number;
  currentPrice: number;
  marketEstimatePrice?: number;
  usdPrice?: number;
  priceHistory: PricePoint[];
  isDiscontinued?: boolean;
  discontinuedDate?: string;
}

export interface AccessoryItem {
  id: string;
  name: string;
  brand: string;
  tier: AccessoryTier;
  subType: AccessoryTierSubType;
  subTypeLabel: string;
  category: AccessoryCategoryId;
  releaseDate: string;
  connection: string;
  compatDevices: string[];
  compatGroups: DeviceCompatGroupId[];
  incompatibleNotice?: string;
  highlights: string[];
  certification?: string;
  specs: {
    interface?: string;
    powerOrBattery?: string;
    dimensionsOrWeight?: string;
    specialFeatures?: string;
    warrantyOrSupport?: string;
  };
  skus: AccessorySku[];
  recommendedAlternativeId?: string;
  comparisonNote?: string;
}

export interface AccessoryCategoryMeta {
  id: AccessoryCategoryId | 'all';
  label: string;
  shortLabel: string;
  description: string;
}

export const ACCESSORY_CATEGORIES: AccessoryCategoryMeta[] = [
  { id: 'all', label: 'すべて', shortLabel: 'すべて', description: 'Apple純正・準純正アクセサリー全ラインナップ' },
  { id: 'pencil', label: 'Apple Pencil・スタイラス', shortLabel: 'Pencil・ペン', description: 'Apple Pencil Pro / USB-C / 第2世代 ＆ Logicool Crayon' },
  { id: 'keyboard-input', label: 'キーボード・マウス・入力機器', shortLabel: 'キーボード・入力', description: 'Magic Keyboard / Trackpad / Mouse ＆ Logicool Combo Touch / MX' },
  { id: 'audio', label: 'AirPods・Beats・オーディオ', shortLabel: 'オーディオ', description: 'AirPods Pro 2 / AirPods 4 / Max ＆ Beats (Apple傘下・H2/独自チップ搭載)' },
  { id: 'charging-cable', label: '充電器・MagSafe・ケーブル', shortLabel: '充電・ケーブル', description: 'MagSafe / USB-C電源アダプタ / Proケーブル ＆ Belkin・Anker Qi2 15W' },
  { id: 'adapter-hub', label: '変換アダプタ・ハブ・ドック', shortLabel: '変換・ハブ', description: 'USB-C Digital AV / カメラアダプタ / イヤホン変換 ＆ Belkin・Ankerハブ' },
  { id: 'airtag-tracker', label: 'AirTag・紛失防止トラッカー', shortLabel: 'AirTag・探す', description: 'AirTag (単体/4個) / Hermès / Belkinホルダー ＆ Anker Eufy (Apple「探す」対応)' },
  { id: 'case-band-film', label: 'ケース・バンド・保護ガラス', shortLabel: 'ケース・バンド', description: '純正シリコーン/クリア/Smart Folio / Apple Watchバンド ＆ Belkin UltraGlass・OtterBox' },
  { id: 'display-home', label: 'ディスプレイ・HomePod・Apple TV', shortLabel: 'モニター・TV', description: 'Studio Display / HomePod mini / Apple TV 4K ＆ LG UltraFine・BenQ Mac向けモニター' },
];

export interface DeviceCompatGroupMeta {
  id: DeviceCompatGroupId | 'all';
  label: string;
  shortLabel: string;
  category: 'iPhone' | 'iPad' | 'Mac' | 'Apple Watch' | 'all';
  warningTip?: string;
}

export const DEVICE_COMPAT_GROUPS: DeviceCompatGroupMeta[] = [
  { id: 'all', label: 'すべての対応機種', shortLabel: '全機種', category: 'all' },
  {
    id: 'iphone-16-17',
    label: 'iPhone 16 / 16 Pro / 17 シリーズ (USB-C・MagSafe最大25W)',
    shortLabel: 'iPhone 16 / 17 (USB-C)',
    category: 'iPhone',
    warningTip: '新型 MagSafe充電器 (25W) ＋ 30W以上のUSB-C電源アダプタで最大25Wの高速ワイヤレス充電に対応。準純正はQi2 (最大15W) がベストコスパ。',
  },
  {
    id: 'iphone-15',
    label: 'iPhone 15 / 15 Pro シリーズ (USB-C・MagSafe 15W)',
    shortLabel: 'iPhone 15 (USB-C)',
    category: 'iPhone',
    warningTip: 'Lightning端子アクセサリーは使用不可。USB-CケーブルおよびMagSafe / Qi2 (最大15W) に対応します。',
  },
  {
    id: 'iphone-12-14',
    label: 'iPhone 12 / 13 / 14 / SE3 (Lightning・MagSafe)',
    shortLabel: 'iPhone 12〜14 / SE (Lightning)',
    category: 'iPhone',
    warningTip: '有線はUSB-C - Lightningケーブルが必要。MagSafe充電 (12〜14シリーズ) にそのまま対応するため、充電器の買い替え時にも流用可能です。',
  },
  {
    id: 'ipad-pro-m4-air-m2',
    label: 'iPad Pro (M4) / iPad Air (M2/M3) / iPad mini (A17 Pro)',
    shortLabel: 'iPad Pro(M4) / Air(M2〜) / mini(A17)',
    category: 'iPad',
    warningTip: '【要注意】Apple Pencil 第2世代は非対応！『Apple Pencil Pro』または『Apple Pencil (USB-C)』/『Logicool Crayon』のみ使用可能です。',
  },
  {
    id: 'ipad-pro-air-mini-gen2',
    label: '旧 iPad Pro (第3〜6世代) / iPad Air (第4・5世代) / mini (第6世代)',
    shortLabel: '旧iPad Pro / Air(4・5) / mini(6)',
    category: 'iPad',
    warningTip: '【要注意】Apple Pencil Proは非対応！『Apple Pencil (第2世代)』または『Apple Pencil (USB-C)』/『Logicool Crayon』に対応します。',
  },
  {
    id: 'ipad-10-11-usbc',
    label: 'iPad (第10世代 / A16 第11世代 無印)',
    shortLabel: 'iPad (第10・11世代 無印)',
    category: 'iPad',
    warningTip: '筆圧検知不要なら『Apple Pencil (USB-C)』または『Logicool Crayon』が磁気吸着に対応し最適。キーボードは『Magic Keyboard Folio』または『Combo Touch』。',
  },
  {
    id: 'mac-apple-silicon',
    label: 'MacBook Air / Pro・Mac mini・iMac・Mac Studio (M1〜M4)',
    shortLabel: 'Mac (Apple Silicon M1〜M4)',
    category: 'Mac',
    warningTip: 'Apple Silicon搭載MacのみMagic Keyboardの『Touch ID』が動作します。2024年10月発売の新型Magic入力機器はすべてUSB-C端子に統一されました。',
  },
  {
    id: 'apple-watch-all',
    label: 'Apple Watch Series 10 / 9 / Ultra 2 / SE',
    shortLabel: 'Apple Watch 全世代',
    category: 'Apple Watch',
    warningTip: 'バンドは【38/40/41/42mm(S10)】と【44/45/46mm(S10)/49mm(Ultra)】の2グループ間で相互互換性があります。高速充電はSeries 7以降で対応。',
  },
];

type HRow = [date: string, event: string, jpy: number, usd: number, fx: number, note?: string];

const ACC_LATEST_USD_JPY = 152.8;
const accRound1 = (n: number) => Math.round(n * 10) / 10;
const accTaxRateAt = (date: string): number =>
  date >= '2019-10-01' ? 0.1 : date >= '2014-04-01' ? 0.08 : date >= '1997-04-01' ? 0.05 : 0.03;

function mkAccHistory(rows: HRow[]): PricePoint[] {
  return rows.map(([date, event, appleStorePrice, usdPrice, exchangeRate, note]) => {
    const taxRate = accTaxRateAt(date);
    const marketUsdJpy = accRound1(exchangeRate);
    const impliedAppleRate = usdPrice > 0 ? accRound1(appleStorePrice / (1 + taxRate) / usdPrice) : undefined;
    const rateDiff = impliedAppleRate != null ? accRound1(impliedAppleRate - marketUsdJpy) : undefined;
    const currentFairJpy = usdPrice > 0 ? Math.round(usdPrice * ACC_LATEST_USD_JPY * 1.1) : undefined;
    return {
      date,
      event,
      appleStorePrice,
      usdPrice,
      exchangeRate: marketUsdJpy,
      taxRate,
      marketUsdJpy,
      ...(impliedAppleRate != null ? { impliedAppleRate } : {}),
      ...(rateDiff != null ? { rateDiff } : {}),
      ...(currentFairJpy != null ? { currentFairJpy } : {}),
      ...(note ? { note } : {}),
    };
  });
}

export const ACCESSORIES_CATALOG: AccessoryItem[] = [
  /* =========================================================================
   * 1. Apple Pencil・スタイラス
   * ========================================================================= */
  {
    id: 'apple-pencil-pro',
    name: 'Apple Pencil Pro',
    brand: 'Apple',
    tier: 'genuine',
    subType: 'apple-official',
    subTypeLabel: 'Apple純正',
    category: 'pencil',
    releaseDate: '2024-05-15',
    connection: 'マグネット吸着・ワイヤレスペアリング＆充電',
    compatDevices: [
      'iPad Pro (M4 / 11・13インチ)',
      'iPad Air (M2 / M3 / 11・13インチ)',
      'iPad mini (A17 Pro / 第7世代)',
    ],
    compatGroups: ['ipad-pro-m4-air-m2'],
    incompatibleNotice: '旧iPad Pro (M2以前)・iPad Air (第5世代以前)・iPad (第10/11世代) では使用できません（磁気コイル位置が異なります）。',
    highlights: [
      'スクイーズ（指で強く握る）でツールパレットを瞬時に呼び出し',
      'バレルロール（ジャイロ搭載でペン軸の回転に応じたブラシ制御）',
      '触覚フィードバック（シェイプ確定時などに軽い振動で応答）',
      'Apple「探す」アプリに完全対応・ホバー＆筆圧・傾き検知',
    ],
    certification: 'Apple 純正',
    specs: {
      interface: 'マグネット磁気装着・ワイヤレス充電',
      powerOrBattery: 'iPad側面からワイヤレス充電',
      dimensionsOrWeight: '長さ 166mm / 直径 8.9mm / 重量 19.15g',
      specialFeatures: 'スクイーズ・バレルロール・触覚エンジン・「探す」・筆圧/傾き/ホバー',
      warrantyOrSupport: 'Apple 1年限定保証 / AppleCare+ for iPad 対象',
    },
    recommendedAlternativeId: 'logicool-crayon-usbc',
    comparisonNote: 'イラスト制作で「筆圧検知・バレルロール・スクイーズ」が必要なら一択。メモ・PDF注釈中心ならApple Pencil (USB-C) や Logicool Crayonで半額以下に抑えられます。',
    skus: [
      {
        id: 'std',
        label: '標準モデル (MX2D3ZA/A)',
        modelNumber: 'MX2D3ZA/A',
        launchPrice: 21800,
        currentPrice: 21800,
        marketEstimatePrice: 19800,
        usdPrice: 129,
        priceHistory: mkAccHistory([
          ['2024-05-15', '発売時', 21800, 129, 155.8, 'iPad Pro (M4) / iPad Air (M2) と同時発売'],
        ]),
      },
    ],
  },
  {
    id: 'apple-pencil-usbc',
    name: 'Apple Pencil (USB-C)',
    brand: 'Apple',
    tier: 'genuine',
    subType: 'apple-official',
    subTypeLabel: 'Apple純正',
    category: 'pencil',
    releaseDate: '2023-11-01',
    connection: 'USB-Cケーブルでペアリング＆充電（側面マグネット吸着スリープ対応）',
    compatDevices: [
      'iPad Pro (M4 / 第3〜6世代 12.9 / 第1〜4世代 11)',
      'iPad Air (M2 / M3 / 第4・5世代)',
      'iPad mini (A17 Pro / 第6世代)',
      'iPad (第10世代 / A16 第11世代)',
    ],
    compatGroups: ['ipad-pro-m4-air-m2', 'ipad-pro-air-mini-gen2', 'ipad-10-11-usbc'],
    incompatibleNotice: '筆圧検知・ダブルタップツール切替・ワイヤレス充電には非対応です（傾き検知・ホバーには対応）。',
    highlights: [
      'USB-Cポート搭載の全iPadで使える最も汎用性の高い純正ペン',
      'スライド式キャップにUSB-C端子を内蔵、iPad側面に磁力で吸着し自動スリープ',
      '傾き検知＆M2/M4搭載機でのApple Pencilホバーに対応',
    ],
    certification: 'Apple 純正',
    specs: {
      interface: 'USB-C有線ペアリング・充電（側面マグネット保持）',
      powerOrBattery: 'USB-C充電',
      dimensionsOrWeight: '長さ 155mm / 直径 8.9mm / 重量 20.5g',
      specialFeatures: 'ピクセルレベルの精度・低遅延・傾き検知・ホバー対応（※筆圧非対応）',
      warrantyOrSupport: 'Apple 1年限定保証',
    },
    recommendedAlternativeId: 'logicool-crayon-usbc',
    comparisonNote: 'ノート取りや学習用途なら上位機と遜色ない書き心地。ペアリング不要で電源オン即書き始めたい場合はLogicool Crayonが便利です。',
    skus: [
      {
        id: 'std',
        label: '標準モデル (MUWA3ZA/A)',
        modelNumber: 'MUWA3ZA/A',
        launchPrice: 12880,
        currentPrice: 13800,
        marketEstimatePrice: 12400,
        usdPrice: 79,
        priceHistory: mkAccHistory([
          ['2023-11-01', '発売時', 12880, 79, 150.9],
          ['2024-05-07', '円安に伴う価格改定（値上げ）', 13800, 79, 155.5],
        ]),
      },
    ],
  },
  {
    id: 'apple-pencil-2nd',
    name: 'Apple Pencil (第2世代)',
    brand: 'Apple',
    tier: 'genuine',
    subType: 'apple-official',
    subTypeLabel: 'Apple純正',
    category: 'pencil',
    releaseDate: '2018-11-07',
    connection: 'マグネット吸着・ワイヤレスペアリング＆充電',
    compatDevices: [
      'iPad Pro 12.9インチ (第3〜6世代)',
      'iPad Pro 11インチ (第1〜4世代)',
      'iPad Air (第4・第5世代)',
      'iPad mini (第6世代)',
    ],
    compatGroups: ['ipad-pro-air-mini-gen2'],
    incompatibleNotice: '2024年以降の iPad Pro (M4) / iPad Air (M2/M3) / iPad mini (A17 Pro) および無印iPad (第10・11世代) では使用できません。',
    highlights: [
      '2018年発売時は15,950円（税込）→2回の円安改定で21,800円まで値上がりした象徴的モデル',
      '筆圧検知・傾き検知・ダブルタップでのツール切り替え・側面ワイヤレス充電対応',
    ],
    certification: 'Apple 純正',
    specs: {
      interface: 'マグネット磁気装着・ワイヤレス充電',
      powerOrBattery: 'iPad側面からワイヤレス充電',
      dimensionsOrWeight: '長さ 166mm / 直径 8.9mm / 重量 20.7g',
      specialFeatures: '筆圧検知・傾き検知・ダブルタップ・ホバー対応(M2機)',
      warrantyOrSupport: 'Apple 1年限定保証',
    },
    recommendedAlternativeId: 'logicool-crayon-usbc',
    skus: [
      {
        id: 'std',
        label: '標準モデル (MU8F2J/A)',
        modelNumber: 'MU8F2J/A',
        launchPrice: 15950,
        currentPrice: 21800,
        marketEstimatePrice: 16800,
        usdPrice: 129,
        priceHistory: mkAccHistory([
          ['2018-11-07', '発売時', 15950, 129, 113.2, '発売時より約37%値上がり'],
          ['2022-07-01', '円安に伴う価格改定（値上げ）', 19880, 129, 136.0],
          ['2024-05-07', '円安に伴う価格改定（値上げ）', 21800, 129, 155.5],
        ]),
      },
    ],
  },
  {
    id: 'logicool-crayon-usbc',
    name: 'Logicool Crayon (USB-C)',
    brand: 'Logicool (Logitech)',
    tier: 'semi-genuine',
    subType: 'apple-store-partner',
    subTypeLabel: '準純正 (Apple公式パートナー)',
    category: 'pencil',
    releaseDate: '2022-10-18',
    connection: 'Apple Pencil独自周波数技術 (ペアリング不要・スイッチONで即使用)',
    compatDevices: [
      '2018年以降に発売されたすべてのiPad (iPad Pro M4 / Air M2・M3 / mini A17 Pro / 無印 第10・11世代 含む)',
    ],
    compatGroups: ['ipad-pro-m4-air-m2', 'ipad-pro-air-mini-gen2', 'ipad-10-11-usbc'],
    incompatibleNotice: '筆圧検知と磁気ワイヤレス充電には非対応です（傾き検知・パームリジェクション・スクリブルは純正同等）。',
    highlights: [
      'Apple Storeで唯一公式販売されているApple Pencil技術ライセンス採用スタイラス',
      'Bluetoothペアリング不要！電源スイッチを入れるだけで複数台のiPadを即座に行き来可能',
      '机から転がり落ちないフラットなアルミ形状＆1.2m落下耐性',
    ],
    certification: 'Apple Pencil テクノロジー公式採用 / Apple Store 取扱',
    specs: {
      interface: 'USB-C充電 / Apple Pencil無線プロトコル',
      powerOrBattery: '最大7時間連続使用（2分充電で30分使用の急速充電対応）',
      dimensionsOrWeight: '163 × 12 × 8 mm / 重量 20g',
      specialFeatures: 'ペアリング不要・傾き検知・パームリジェクション・3段階バッテリーLED',
      warrantyOrSupport: 'ロジクール 2年間無償保証',
    },
    recommendedAlternativeId: 'apple-pencil-usbc',
    comparisonNote: '新旧のiPadを複数台併用する人や、教育・ビジネス現場ではペアリング不要のCrayonがApple Pencil (USB-C) 以上に快適です。',
    skus: [
      {
        id: 'usbc',
        label: 'USB-Cモデル (iP11SL)',
        modelNumber: 'iP11SL',
        launchPrice: 10780,
        currentPrice: 11880,
        marketEstimatePrice: 9800,
        usdPrice: 69.95,
        priceHistory: mkAccHistory([
          ['2022-10-18', '発売時', 10780, 69.95, 148.8],
          ['2024-04-01', '価格改定', 11880, 69.95, 151.5],
        ]),
      },
    ],
  },

  /* =========================================================================
   * 2. キーボード・マウス・トラックパッド
   * ========================================================================= */
  {
    id: 'magic-keyboard-ipad-pro-m4',
    name: 'iPad Pro (M4) 用 Magic Keyboard',
    brand: 'Apple',
    tier: 'genuine',
    subType: 'apple-official',
    subTypeLabel: 'Apple純正',
    category: 'keyboard-input',
    releaseDate: '2024-05-15',
    connection: 'Smart Connector (ペアリング・充電不要 / パススルーUSB-C充電対応)',
    compatDevices: ['iPad Pro 11インチ (M4)', 'iPad Pro 13インチ (M4)'],
    compatGroups: ['ipad-pro-m4-air-m2'],
    incompatibleNotice: 'iPad Pro (M4) 専用設計です。iPad Air (M2/M3) や旧世代iPad Proには装着できません。',
    highlights: [
      'アルミニウム製パームレスト＆触覚フィードバック付き大型ガラス製トラックパッドに全面刷新',
      '画面輝度や音量などを即座に操作できる14キーのファンクションキー列を新搭載',
      'ヒンジ部にパススルー充電用USB-Cポートを搭載し、本体USB-Cを高速データ通信に開放',
    ],
    certification: 'Apple 純正 (Smart Connector)',
    specs: {
      interface: 'Smart Connector + パススルーUSB-Cポート (充電専用)',
      powerOrBattery: 'iPad本体から給電（充電不要）',
      dimensionsOrWeight: '11インチ用: 約580g / 13インチ用: 約660g',
      specialFeatures: '14キーファンクション列・触覚トラックパッド・バックライトキー・フローティングカンチレバー',
      warrantyOrSupport: 'AppleCare+ for iPad の保証対象に含まれる',
    },
    recommendedAlternativeId: 'logicool-combo-touch-m4',
    comparisonNote: 'MacBook並みの打鍵感とトラックパッド品質を求めるなら純正一択。キーボードを取り外して読書・手書きしたい場合や価格を約1.7万円抑えたい場合は『Logicool Combo Touch』が最適。',
    skus: [
      {
        id: '11-inch',
        label: '11インチ iPad Pro (M4) 用',
        modelNumber: 'MWR23J/A',
        launchPrice: 49800,
        currentPrice: 49800,
        marketEstimatePrice: 46800,
        usdPrice: 299,
        priceHistory: mkAccHistory([
          ['2024-05-15', '発売時', 49800, 299, 155.8],
        ]),
      },
      {
        id: '13-inch',
        label: '13インチ iPad Pro (M4) 用',
        modelNumber: 'MWR53J/A',
        launchPrice: 59800,
        currentPrice: 59800,
        marketEstimatePrice: 55800,
        usdPrice: 349,
        priceHistory: mkAccHistory([
          ['2024-05-15', '発売時', 59800, 349, 155.8],
        ]),
      },
    ],
  },
  {
    id: 'magic-keyboard-ipad-air',
    name: 'iPad Air 用 Magic Keyboard',
    brand: 'Apple',
    tier: 'genuine',
    subType: 'apple-official',
    subTypeLabel: 'Apple純正',
    category: 'keyboard-input',
    releaseDate: '2020-04-22',
    connection: 'Smart Connector (ペアリング・充電不要 / パススルーUSB-C充電対応)',
    compatDevices: [
      'iPad Air 11インチ (M2 / M3) / iPad Air (第4・第5世代)',
      'iPad Air 13インチ (M2 / M3)',
      'iPad Pro 11インチ (第1〜4世代) / 12.9インチ (第3〜6世代)',
    ],
    compatGroups: ['ipad-pro-m4-air-m2', 'ipad-pro-air-mini-gen2'],
    highlights: [
      'フローティングカンチレバー設計で無段階の角度調整が可能',
      'バックライトキーとMulti-Touchジェスチャー対応トラックパッド搭載',
      'ヒンジ部にパススルーUSB-C充電ポートを搭載',
    ],
    certification: 'Apple 純正 (Smart Connector)',
    specs: {
      interface: 'Smart Connector + パススルーUSB-Cポート',
      powerOrBattery: 'iPad本体から給電',
      dimensionsOrWeight: '11インチ用: 約601g',
      specialFeatures: 'フローティングデザイン・バックライトキー・トラックパッド',
      warrantyOrSupport: 'AppleCare+ for iPad の保証対象に含まれる',
    },
    recommendedAlternativeId: 'logicool-combo-touch-m4',
    skus: [
      {
        id: '11-inch',
        label: '11インチ iPad Air 用',
        modelNumber: 'MXQT2J/A',
        launchPrice: 34980,
        currentPrice: 49800,
        marketEstimatePrice: 44800,
        usdPrice: 299,
        priceHistory: mkAccHistory([
          ['2020-04-22', '発売時', 34980, 299, 107.6, '発売時から+14,820円値上がり'],
          ['2022-07-01', '円安に伴う価格改定（値上げ）', 44800, 299, 136.0],
          ['2024-05-07', '円安に伴う価格改定（値上げ）', 49800, 299, 155.5],
        ]),
      },
      {
        id: '13-inch',
        label: '13インチ iPad Air 用',
        modelNumber: 'MJQK3J/A',
        launchPrice: 41580,
        currentPrice: 59800,
        marketEstimatePrice: 53800,
        usdPrice: 349,
        priceHistory: mkAccHistory([
          ['2020-04-22', '発売時', 41580, 349, 107.6],
          ['2022-07-01', '円安に伴う価格改定（値上げ）', 53800, 349, 136.0],
          ['2024-05-07', '円安に伴う価格改定（値上げ）', 59800, 349, 155.5],
        ]),
      },
    ],
  },
  {
    id: 'logicool-combo-touch-m4',
    name: 'Logicool Combo Touch (iPad Pro / Air / 無印用)',
    brand: 'Logicool (Logitech)',
    tier: 'semi-genuine',
    subType: 'apple-store-partner',
    subTypeLabel: '準純正 (Apple Store公式取扱)',
    category: 'keyboard-input',
    releaseDate: '2024-05-15',
    connection: 'Smart Connector (ペアリング・充電不要・Apple公式ライセンス)',
    compatDevices: [
      'iPad Pro 11 / 13インチ (M4)',
      'iPad Air 11 / 13インチ (M2 / M3 / 第4・5世代)',
      'iPad (第10世代 / A16 第11世代)',
    ],
    compatGroups: ['ipad-pro-m4-air-m2', 'ipad-pro-air-mini-gen2', 'ipad-10-11-usbc'],
    highlights: [
      'AppleのSmart Connectorを公式搭載し、Bluetoothペアリングも充電も一切不要',
      'キーボード部分がマグネットで着脱可能！動画視聴やApple Pencil手書き時に邪魔にならない',
      'iPadの四隅・側面までしっかり守る耐衝撃バンパーケース一体型で、純正より1.3万〜1.7万円安価',
    ],
    certification: 'Apple Smart Connector 公式ライセンス / Apple Store 取扱',
    specs: {
      interface: 'Smart Connector (物理接点による電力・データ直結)',
      powerOrBattery: 'iPad本体から給電（充電不要）',
      dimensionsOrWeight: 'iPad Pro 11用: 約474g（旧世代比で大幅軽量化）',
      specialFeatures: '着脱式バックライトキーボード・大型トラックパッド・16キーショートカット列・キックスタンド',
      warrantyOrSupport: 'ロジクール 2年間無償保証',
    },
    recommendedAlternativeId: 'magic-keyboard-ipad-pro-m4',
    comparisonNote: '純正Magic Keyboardの弱点である「キーボードを外せない」「側面が保護されない」「5万円超の価格」をすべて解消した、準純正キーボードの決定版。',
    skus: [
      {
        id: 'ipad-10',
        label: 'iPad (第10・11世代) 用 (iK1059GRA)',
        modelNumber: 'iK1059GRA',
        launchPrice: 24750,
        currentPrice: 27830,
        marketEstimatePrice: 23800,
        usdPrice: 159.95,
        priceHistory: mkAccHistory([
          ['2022-10-26', '発売時', 24750, 159.95, 146.5],
          ['2024-05-15', '価格改定', 27830, 159.95, 155.8],
        ]),
      },
      {
        id: 'air-11',
        label: '11インチ iPad Air (M2/M3) 用 (iK1178GRA)',
        modelNumber: 'iK1178GRA',
        launchPrice: 32780,
        currentPrice: 32780,
        marketEstimatePrice: 29500,
        usdPrice: 199.95,
        priceHistory: mkAccHistory([
          ['2024-05-15', '発売時', 32780, 199.95, 155.8],
        ]),
      },
      {
        id: 'pro-11-m4',
        label: '11インチ iPad Pro (M4) 用 (iK1177GRA)',
        modelNumber: 'iK1177GRA',
        launchPrice: 36740,
        currentPrice: 36740,
        marketEstimatePrice: 32800,
        usdPrice: 229.95,
        priceHistory: mkAccHistory([
          ['2024-05-15', '発売時', 36740, 229.95, 155.8],
        ]),
      },
      {
        id: 'pro-13-m4',
        label: '13インチ iPad Pro (M4) 用 (iK1276GRA)',
        modelNumber: 'iK1276GRA',
        launchPrice: 42790,
        currentPrice: 42790,
        marketEstimatePrice: 38500,
        usdPrice: 259.95,
        priceHistory: mkAccHistory([
          ['2024-05-15', '発売時', 42790, 259.95, 155.8],
        ]),
      },
    ],
  },
  {
    id: 'magic-keyboard-touch-id-usbc',
    name: 'Touch ID搭載 Magic Keyboard (USB-C・Mac用)',
    brand: 'Apple',
    tier: 'genuine',
    subType: 'apple-official',
    subTypeLabel: 'Apple純正',
    category: 'keyboard-input',
    releaseDate: '2024-10-28',
    connection: 'Bluetooth / USB-C有線接続＆充電 (編み込みUSB-C充電ケーブル同梱)',
    compatDevices: ['Apple Silicon (M1 / M2 / M3 / M4) 搭載のすべてのMac'],
    compatGroups: ['mac-apple-silicon'],
    incompatibleNotice: 'Touch ID機能はApple Silicon搭載Mac専用です（Intel MacやiPadではTouch IDは動作しません）。',
    highlights: [
      '2024年10月に待望のUSB-Cポート化！クラムシェル運用のMacBookでも指紋認証・Apple Pay決済が可能',
      '編み込み式USB-C充電ケーブルをMacに挿すだけで自動ペアリング完了',
      '1回の充電で約1か月以上駆動するロングバッテリー',
    ],
    certification: 'Apple 純正',
    specs: {
      interface: 'Bluetooth / USB-Cポート',
      powerOrBattery: '内蔵リチャージャブルバッテリー（約1か月以上駆動）',
      dimensionsOrWeight: 'テンキーなし: 239g / テンキー付き: 369g',
      specialFeatures: 'Touch ID生体認証・Secure Enclave連携・JIS/US配列選択可',
      warrantyOrSupport: 'Apple 1年限定保証',
    },
    recommendedAlternativeId: 'logicool-mx-keys-mini-mac',
    comparisonNote: '外付けモニターでMacBookを閉じて使う場合、「Touch IDが使える唯一のキーボード」として純正の価値が極めて高い製品です。',
    skus: [
      {
        id: 'compact-touchid',
        label: 'テンキーなし・Touch ID搭載 (MXCK3J/A)',
        modelNumber: 'MXCK3J/A',
        launchPrice: 21800,
        currentPrice: 21800,
        marketEstimatePrice: 19800,
        usdPrice: 149,
        priceHistory: mkAccHistory([
          ['2021-08-03', 'Lightning版 発売時', 15800, 149, 109.2],
          ['2022-07-01', '円安に伴う価格改定（値上げ）', 19800, 149, 136.0],
          ['2024-10-28', 'USB-Cモデル刷新', 21800, 149, 153.2],
        ]),
      },
      {
        id: 'numpad-touchid',
        label: 'テンキー付き・Touch ID搭載 (MXK73J/A)',
        modelNumber: 'MXK73J/A',
        launchPrice: 25800,
        currentPrice: 25800,
        marketEstimatePrice: 23500,
        usdPrice: 179,
        priceHistory: mkAccHistory([
          ['2021-08-03', 'Lightning版 発売時', 18800, 179, 109.2],
          ['2022-07-01', '円安に伴う価格改定（値上げ）', 23800, 179, 136.0],
          ['2024-10-28', 'USB-Cモデル刷新 (ホワイト)', 25800, 179, 153.2, 'ブラックキーは¥27,800'],
        ]),
      },
    ],
  },
  {
    id: 'magic-trackpad-mouse-usbc',
    name: 'Magic Trackpad / Magic Mouse (USB-C)',
    brand: 'Apple',
    tier: 'genuine',
    subType: 'apple-official',
    subTypeLabel: 'Apple純正',
    category: 'keyboard-input',
    releaseDate: '2024-10-28',
    connection: 'Bluetooth / USB-C充電',
    compatDevices: ['Mac 全モデル', 'iPad 全モデル (iPadOS 13.4以降)'],
    compatGroups: ['mac-apple-silicon', 'ipad-pro-m4-air-m2', 'ipad-pro-air-mini-gen2'],
    highlights: [
      '2024年10月にLightningからUSB-Cポートへ刷新（編み込みUSB-Cケーブル付属）',
      'Magic Trackpadは感圧タッチ（Force Touch）とmacOS/iPadOSの全Multi-Touchジェスチャーに完全対応',
      '※Magic MouseはUSB-C化後も充電ポートは底面に配置されています',
    ],
    certification: 'Apple 純正',
    specs: {
      interface: 'Bluetooth / USB-Cポート',
      powerOrBattery: '内蔵バッテリー（1回の充電で約1か月以上駆動）',
      dimensionsOrWeight: 'Magic Trackpad: 230g / Magic Mouse: 99g',
      specialFeatures: '感圧タッチ(Trackpad)・Multi-Touch全面ガラスサーフェス',
      warrantyOrSupport: 'Apple 1年限定保証',
    },
    recommendedAlternativeId: 'logicool-mx-keys-mini-mac',
    skus: [
      {
        id: 'mouse-white',
        label: 'Magic Mouse (USB-C・ホワイト MXK53ZA/A)',
        modelNumber: 'MXK53ZA/A',
        launchPrice: 10800,
        currentPrice: 10800,
        marketEstimatePrice: 9800,
        usdPrice: 79,
        priceHistory: mkAccHistory([
          ['2021-08-03', 'Lightning版', 8800, 79, 109.2],
          ['2022-07-01', '円安に伴う価格改定', 10800, 79, 136.0],
          ['2024-10-28', 'USB-Cモデル刷新', 10800, 79, 153.2, 'ブラックは¥14,800'],
        ]),
      },
      {
        id: 'trackpad-white',
        label: 'Magic Trackpad (USB-C・ホワイト MXK93ZA/A)',
        modelNumber: 'MXK93ZA/A',
        launchPrice: 18800,
        currentPrice: 18800,
        marketEstimatePrice: 16800,
        usdPrice: 129,
        priceHistory: mkAccHistory([
          ['2021-08-03', 'Lightning版', 13800, 129, 109.2],
          ['2022-07-01', '円安に伴う価格改定', 16800, 129, 136.0],
          ['2024-10-28', 'USB-Cモデル刷新', 18800, 129, 153.2, 'ブラックは¥21,800'],
        ]),
      },
    ],
  },
  {
    id: 'logicool-mx-keys-mini-mac',
    name: 'Logicool MX Keys Mini for Mac / MX Master 3S for Mac',
    brand: 'Logicool (Logitech)',
    tier: 'semi-genuine',
    subType: 'apple-store-partner',
    subTypeLabel: '準純正 (Designed for Mac・Apple Store取扱)',
    category: 'keyboard-input',
    releaseDate: '2022-08-18',
    connection: 'Bluetooth Low Energy (最大3台のMac / iPad / iPhoneをワンタッチ切替)',
    compatDevices: ['Mac 全モデル', 'iPad 全モデル', 'iPhone'],
    compatGroups: ['mac-apple-silicon', 'ipad-pro-m4-air-m2', 'ipad-pro-air-mini-gen2'],
    highlights: [
      'Apple Storeでも公式販売されている「Designed for Mac」最上位シリーズ（スペースグレー＆ペイルグレー）',
      'Easy-SwitchボタンでMacBook・iPad・Mac miniなど最大3台のAppleデバイスを1秒で切り替え',
      '手を近づけると自動点灯するスマートイルミネーション＆球状くぼみキートップ（MX Keys Mini）',
    ],
    certification: 'Designed for Mac / Apple Store 公式取扱',
    specs: {
      interface: 'Bluetooth Low Energy / USB-C充電',
      powerOrBattery: 'MX Keys Mini: バックライトON最大10日・OFF最大5ヶ月 / MX Master 3S: 最大70日',
      dimensionsOrWeight: 'MX Keys Mini: 506g / MX Master 3S: 141g',
      specialFeatures: '3台マルチペアリング・Logi Options+対応・MagSpeed電磁気スクロール(3S)',
      warrantyOrSupport: 'ロジクール 2年間無償保証',
    },
    recommendedAlternativeId: 'magic-keyboard-touch-id-usbc',
    skus: [
      {
        id: 'mx-keys-mini-mac',
        label: 'MX Keys Mini for Mac (US配列 KX700MPG)',
        modelNumber: 'KX700MPG',
        launchPrice: 15950,
        currentPrice: 16720,
        marketEstimatePrice: 14500,
        usdPrice: 99.99,
        priceHistory: mkAccHistory([
          ['2022-08-18', '発売時', 15950, 99.99, 135.0],
          ['2024-04-01', '価格改定', 16720, 99.99, 151.5],
        ]),
      },
      {
        id: 'mx-master-3s-mac',
        label: 'MX Master 3S for Mac (MX2300MSG)',
        modelNumber: 'MX2300MSG',
        launchPrice: 15400,
        currentPrice: 16940,
        marketEstimatePrice: 14800,
        usdPrice: 99.99,
        priceHistory: mkAccHistory([
          ['2022-06-30', '発売時', 15400, 99.99, 136.0],
          ['2024-04-01', '価格改定', 16940, 99.99, 151.5],
        ]),
      },
    ],
  },

  /* =========================================================================
   * 3. AirPods・Beats・オーディオ
   * ========================================================================= */
  {
    id: 'airpods-pro-2-usbc',
    name: 'AirPods Pro 2 (MagSafe充電ケース USB-C)',
    brand: 'Apple',
    tier: 'genuine',
    subType: 'apple-official',
    subTypeLabel: 'Apple純正',
    category: 'audio',
    releaseDate: '2023-09-22',
    connection: 'Apple H2チップ (Bluetooth 5.3 / 超広帯域U1チップ搭載ケース)',
    compatDevices: ['iPhone', 'iPad', 'Mac', 'Apple Watch', 'Apple Vision Pro (ロスレス対応)', 'Apple TV 4K'],
    compatGroups: ['iphone-16-17', 'iphone-15', 'iphone-12-14', 'ipad-pro-m4-air-m2', 'mac-apple-silicon', 'apple-watch-all'],
    highlights: [
      '前世代比最大2倍のアクティブノイズキャンセリング＆適応型オーディオ・会話感知',
      'ケースにスピーカーとU1チップを内蔵し、「探す」の正確な場所を見つける機能に対応',
      'USB-C・MagSafe・Apple Watch磁気充電器・Qiの4通りの充電方法に対応＆IP54防塵耐水',
      'ヒアリングチェック＆臨床グレードのヒアリング補助機能（iOS 18.1以降）に対応',
    ],
    certification: 'Apple 純正 (H2 + U1チップ)',
    specs: {
      interface: 'Bluetooth 5.3 / USB-C・MagSafe・Apple Watch充電器対応',
      powerOrBattery: '単体最大6時間 / ケース併用最大30時間',
      dimensionsOrWeight: 'イヤホン片耳 5.3g / ケース 50.8g (IP54防塵耐水)',
      specialFeatures: 'H2チップ・ANC・外部音取り込み・適応型オーディオ・空間オーディオ・「探す」精密検索',
      warrantyOrSupport: 'AppleCare+ for Headphones 加入可 (¥4,600)',
    },
    recommendedAlternativeId: 'beats-fit-pro',
    skus: [
      {
        id: 'usbc',
        label: 'MagSafe充電ケース (USB-C) MTJV3J/A',
        modelNumber: 'MTJV3J/A',
        launchPrice: 39800,
        currentPrice: 39800,
        marketEstimatePrice: 34800,
        usdPrice: 249,
        priceHistory: mkAccHistory([
          ['2022-09-23', 'Lightning版 発売時', 39800, 249, 143.3],
          ['2023-09-22', 'USB-Cケース版 発売', 39800, 249, 148.3],
        ]),
      },
    ],
  },
  {
    id: 'airpods-4',
    name: 'AirPods 4 (標準モデル / アクティブノイズキャンセリング搭載モデル)',
    brand: 'Apple',
    tier: 'genuine',
    subType: 'apple-official',
    subTypeLabel: 'Apple純正',
    category: 'audio',
    releaseDate: '2024-09-20',
    connection: 'Apple H2チップ (Bluetooth 5.3)',
    compatDevices: ['iPhone', 'iPad', 'Mac', 'Apple Watch', 'Apple TV 4K'],
    compatGroups: ['iphone-16-17', 'iphone-15', 'iphone-12-14', 'ipad-pro-m4-air-m2', 'mac-apple-silicon'],
    highlights: [
      '耳を塞がないオープンイヤー型でありながら、上位モデルはH2チップによるANC（ノイズキャンセリング）と外部音取り込みを実現',
      'ANC搭載モデルのケースはスピーカー内蔵で「探す」のサウンド再生＆Apple Watch充電器/Qiワイヤレス充電に対応',
      'カナル型のイヤーチップが苦手な人にとって最高の純正選択肢',
    ],
    certification: 'Apple 純正 (H2チップ)',
    specs: {
      interface: 'Bluetooth 5.3 / USB-C (ANC版はワイヤレス充電対応)',
      powerOrBattery: '単体最大5時間 (ANC ON時4時間) / ケース併用最大30時間',
      dimensionsOrWeight: '片耳 4.3g / ケース 32.3g〜34.7g (IP54防塵耐水)',
      specialFeatures: 'H2チップ・空間オーディオ・声を分離・Siriヘッドジェスチャー',
      warrantyOrSupport: 'AppleCare+ for Headphones 加入可',
    },
    recommendedAlternativeId: 'beats-solo-buds',
    skus: [
      {
        id: 'std',
        label: '標準モデル (MXP63J/A)',
        modelNumber: 'MXP63J/A',
        launchPrice: 21800,
        currentPrice: 21800,
        marketEstimatePrice: 19800,
        usdPrice: 129,
        priceHistory: mkAccHistory([
          ['2024-09-20', '発売時', 21800, 129, 143.8],
        ]),
      },
      {
        id: 'anc',
        label: 'アクティブノイズキャンセリング搭載 (MXP93J/A)',
        modelNumber: 'MXP93J/A',
        launchPrice: 29800,
        currentPrice: 29800,
        marketEstimatePrice: 26800,
        usdPrice: 179,
        priceHistory: mkAccHistory([
          ['2024-09-20', '発売時', 29800, 179, 143.8],
        ]),
      },
    ],
  },
  {
    id: 'airpods-max-usbc',
    name: 'AirPods Max (USB-C)',
    brand: 'Apple',
    tier: 'genuine',
    subType: 'apple-official',
    subTypeLabel: 'Apple純正',
    category: 'audio',
    releaseDate: '2024-09-20',
    connection: 'Apple H1チップ（両耳各1基） / USB-C充電＆USB-Cロスレス有線オーディオ対応',
    compatDevices: ['iPhone', 'iPad', 'Mac', 'Apple TV 4K'],
    compatGroups: ['iphone-16-17', 'iphone-15', 'ipad-pro-m4-air-m2', 'mac-apple-silicon'],
    highlights: [
      '2024年9月にUSB-Cポート化＆5色の新カラーに刷新（ミッドナイト・スターライト・ブルー・パープル・オレンジ）',
      'iOS 18.4 / macOS 15.4以降でUSB-Cケーブル直結による24bit/48kHzロスレス＆超低遅延オーディオに対応',
      '酸化皮膜処理されたアルミニウムカップとステンレスフレームによる圧倒的なビルドクオリティ',
    ],
    certification: 'Apple 純正',
    specs: {
      interface: 'Bluetooth 5.0 / USB-C (充電・有線ロスレスオーディオ対応)',
      powerOrBattery: '最大20時間（ANC・空間オーディオ有効時）',
      dimensionsOrWeight: '本体 386.2g / Smart Case 134.5g',
      specialFeatures: 'プロレベルのANC・外部音取り込み・ダイナミックヘッドトラッキング空間オーディオ・Digital Crown',
      warrantyOrSupport: 'AppleCare+ for Headphones 加入可',
    },
    recommendedAlternativeId: 'beats-studio-pro',
    comparisonNote: '発売時67,980円→現在84,800円。半額近い価格で178g軽量・USB-C DAC内蔵・Apple「探す」対応の傘下モデル『Beats Studio Pro』も有力な比較対象です。',
    skus: [
      {
        id: 'usbc',
        label: 'USB-Cモデル (MWW43ZA/A ほか)',
        modelNumber: 'MWW43ZA/A',
        launchPrice: 84800,
        currentPrice: 84800,
        marketEstimatePrice: 78800,
        usdPrice: 549,
        priceHistory: mkAccHistory([
          ['2020-12-15', 'Lightning版 発売時', 67980, 549, 104.0, '発売時より+16,820円値上がり'],
          ['2022-07-01', '円安に伴う価格改定（値上げ）', 84800, 549, 136.0],
          ['2024-09-20', 'USB-Cモデル発売', 84800, 549, 143.8],
        ]),
      },
    ],
  },
  {
    id: 'earpods-usbc',
    name: 'EarPods (USB-C / Lightning / 3.5mm)',
    brand: 'Apple',
    tier: 'genuine',
    subType: 'apple-official',
    subTypeLabel: 'Apple純正',
    category: 'audio',
    releaseDate: '2023-09-22',
    connection: '有線直結 (USB-Cモデルは高音質DAC内蔵・ロスレス対応)',
    compatDevices: ['iPhone 15 / 16 / 17', 'iPad 全モデル', 'Mac 全モデル', 'iPhone 14以前 (Lightning版)'],
    compatGroups: ['iphone-16-17', 'iphone-15', 'iphone-12-14', 'ipad-pro-m4-air-m2', 'ipad-10-11-usbc', 'mac-apple-silicon'],
    highlights: [
      '2,780円で買える「隠れた神純正アクセサリー」。Web会議用マイクの品質が数万円のワイヤレス機を凌駕',
      'USB-C版はコネクタ内部にApple純正DACチップを内蔵し、Apple Musicのハイレゾ・ロスレス（最大24bit/48kHz）再生にネイティブ対応',
      '充電切れゼロ・遅延ゼロで動画編集や音ゲー、オンライン会議の常備用に必携',
    ],
    certification: 'Apple 純正',
    specs: {
      interface: 'USB-C / Lightning / 3.5mmヘッドフォンプラグ',
      powerOrBattery: '不要（バスパワー駆動）',
      dimensionsOrWeight: '防汗・耐水設計 / インラインリモコン＆高音質マイク搭載',
      specialFeatures: '内蔵DACによる24bit/48kHzロスレス再生（USB-C版）・通話/音量コントロール',
      warrantyOrSupport: 'Apple 1年限定保証',
    },
    skus: [
      {
        id: 'usbc',
        label: 'USB-C (MTJY3FE/A)',
        modelNumber: 'MTJY3FE/A',
        launchPrice: 2780,
        currentPrice: 2780,
        marketEstimatePrice: 2480,
        usdPrice: 19,
        priceHistory: mkAccHistory([
          ['2023-09-22', '発売時', 2780, 19, 148.3],
        ]),
      },
      {
        id: 'lightning',
        label: 'Lightning (MWTY3FE/A)',
        modelNumber: 'MWTY3FE/A',
        launchPrice: 2200,
        currentPrice: 2780,
        marketEstimatePrice: 2480,
        usdPrice: 19,
        priceHistory: mkAccHistory([
          ['2016-09-16', '発売時', 2200, 19, 102.0],
          ['2022-07-01', '円安に伴う価格改定', 2780, 19, 136.0],
        ]),
      },
    ],
  },
  {
    id: 'beats-fit-pro',
    name: 'Beats Fit Pro (Apple H1チップ搭載)',
    brand: 'Beats by Dre (Apple傘下)',
    tier: 'semi-genuine',
    subType: 'apple-owned-beats',
    subTypeLabel: '準純正 (Apple傘下・H1チップ搭載)',
    category: 'audio',
    releaseDate: '2022-01-28',
    connection: 'Apple H1チップ (iCloudデバイス自動切替・空間オーディオ・探す対応)',
    compatDevices: ['iPhone', 'iPad', 'Mac', 'Apple Watch', 'Android'],
    compatGroups: ['iphone-16-17', 'iphone-15', 'iphone-12-14', 'ipad-pro-m4-air-m2', 'mac-apple-silicon', 'apple-watch-all'],
    highlights: [
      'Apple傘下ブランド「Beats」の中で唯一Apple純正『H1チップ』を直接搭載したスポーツ特化モデル',
      'iPhone / iPad / Mac間のiCloud自動切り替え、ダイナミックヘッドトラッキング空間オーディオ、オーディオ共有に完全対応',
      '柔軟なウィングチップで激しいランニングやジムワークアウトでも絶対に外れない安定感',
    ],
    certification: 'Apple 傘下自社ブランド (Apple H1チップ内蔵)',
    specs: {
      interface: 'Bluetooth Class 1 / USB-C充電ケース',
      powerOrBattery: '単体最大6時間（ANC ON） / ケース併用最大24時間（Fast Fuel 5分充電=1時間再生）',
      dimensionsOrWeight: '片耳 5.6g / IPX4耐汗耐水',
      specialFeatures: 'Apple H1チップ・ANC・外部音取り込み・空間オーディオ・ウィングチップ一体構造',
      warrantyOrSupport: 'AppleCare+ for Headphones 加入可',
    },
    recommendedAlternativeId: 'airpods-pro-2-usbc',
    comparisonNote: 'AirPods Proが耳から外れやすい人やスポーツ用途なら、Apple純正機能をそのまま使えるBeats Fit Proが最適解です。',
    skus: [
      {
        id: 'std',
        label: '標準モデル (MK2F3PA/A ほか)',
        modelNumber: 'MK2F3PA/A',
        launchPrice: 24800,
        currentPrice: 28800,
        marketEstimatePrice: 24800,
        usdPrice: 199.99,
        priceHistory: mkAccHistory([
          ['2022-01-28', '発売時', 24800, 199.99, 115.3],
          ['2022-08-01', '円安に伴う価格改定', 28800, 199.99, 135.0],
        ]),
      },
    ],
  },
  {
    id: 'beats-studio-pro',
    name: 'Beats Studio Pro',
    brand: 'Beats by Dre (Apple傘下)',
    tier: 'semi-genuine',
    subType: 'apple-owned-beats',
    subTypeLabel: '準純正 (Apple傘下ブランド)',
    category: 'audio',
    releaseDate: '2023-08-09',
    connection: 'Beats独自第2世代プラットフォーム (ワンタッチAppleペアリング・「探す」対応)',
    compatDevices: ['iPhone', 'iPad', 'Mac', 'Android', 'PC (USB-C / 3.5mm有線対応)'],
    compatGroups: ['iphone-16-17', 'iphone-15', 'iphone-12-14', 'ipad-pro-m4-air-m2', 'mac-apple-silicon'],
    highlights: [
      'AirPods Max (386g / ¥84,800) に対し、わずか260gの軽量設計＆折りたたみ可能で価格は約4.9万円',
      'USB-Cケーブル接続による内蔵DACロスレス再生（3つのサウンドプロファイル）と3.5mmアナログ有線の両対応',
      'AppleデバイスへのワンタッチiCloudペアリング、パーソナライズされた空間オーディオ、「探す」アプリに対応',
    ],
    certification: 'Apple 傘下自社ブランド',
    specs: {
      interface: 'Bluetooth 5.3 / USB-C (充電＆ロスレスDACオーディオ) / 3.5mmアナログ入力',
      powerOrBattery: '最大40時間 (ANC OFF) / 最大24時間 (ANC ON)',
      dimensionsOrWeight: '重量 260g（折りたたみ式キャリングケース付属）',
      specialFeatures: 'ANC・外部音取り込み・ヘッドトラッキング空間オーディオ・USB-C内蔵DACロスレス',
      warrantyOrSupport: 'AppleCare+ for Headphones 加入可',
    },
    recommendedAlternativeId: 'airpods-max-usbc',
    skus: [
      {
        id: 'std',
        label: '全カラー (MQTP3PA/A ほか)',
        modelNumber: 'MQTP3PA/A',
        launchPrice: 49800,
        currentPrice: 49800,
        marketEstimatePrice: 41800,
        usdPrice: 349.99,
        priceHistory: mkAccHistory([
          ['2023-08-09', '発売時', 49800, 349.99, 143.5],
        ]),
      },
    ],
  },
  {
    id: 'beats-solo-buds',
    name: 'Beats Solo Buds / Beats Studio Buds +',
    brand: 'Beats by Dre (Apple傘下)',
    tier: 'semi-genuine',
    subType: 'apple-owned-beats',
    subTypeLabel: '準純正 (Apple傘下ブランド)',
    category: 'audio',
    releaseDate: '2024-06-20',
    connection: 'Beats独自プラットフォーム (iOSワンタッチペアリング・「探す」対応)',
    compatDevices: ['iPhone', 'iPad', 'Mac', 'Android'],
    compatGroups: ['iphone-16-17', 'iphone-15', 'iphone-12-14', 'ipad-pro-m4-air-m2', 'mac-apple-silicon'],
    highlights: [
      'Solo Budsは12,800円でApple Store公式購入できる最も手頃なApple傘下ワイヤレスイヤホン（単体最大18時間再生）',
      'Studio Buds + はスケルトン（トランスペアレント）デザインを採用し、強力なANC・外部音取り込みを搭載',
      'iPhoneに近づけるだけでワンタッチセットアップ＆Apple「探す」アプリにネイティブ統合',
    ],
    certification: 'Apple 傘下自社ブランド',
    specs: {
      interface: 'Bluetooth 5.3 / USB-C充電',
      powerOrBattery: 'Solo Buds: イヤホン単体最大18時間 / Studio Buds +: ケース込み最大36時間',
      dimensionsOrWeight: 'Solo Buds ケース重量わずか22g（シリーズ最小）',
      specialFeatures: 'iOSワンタッチペアリング・「探す」対応・4サイズイヤーチップ (XS/S/M/L)',
      warrantyOrSupport: 'AppleCare+ for Headphones 加入可',
    },
    recommendedAlternativeId: 'airpods-4',
    skus: [
      {
        id: 'solo-buds',
        label: 'Beats Solo Buds (MUW03PA/A)',
        modelNumber: 'MUW03PA/A',
        launchPrice: 12800,
        currentPrice: 12800,
        marketEstimatePrice: 11500,
        usdPrice: 79.99,
        priceHistory: mkAccHistory([
          ['2024-06-20', '発売時', 12800, 79.99, 158.0],
        ]),
      },
      {
        id: 'studio-buds-plus',
        label: 'Beats Studio Buds + (ANC搭載 MQLK3PA/A)',
        modelNumber: 'MQLK3PA/A',
        launchPrice: 24800,
        currentPrice: 24800,
        marketEstimatePrice: 21800,
        usdPrice: 169.99,
        priceHistory: mkAccHistory([
          ['2023-06-15', '発売時', 24800, 169.99, 140.2],
        ]),
      },
    ],
  },

  /* =========================================================================
   * 4. 充電器・MagSafe・ケーブル
   * ========================================================================= */
  {
    id: 'apple-magsafe-charger-25w',
    name: 'Apple MagSafe充電器 (最大25W・新型 / 1m・2m)',
    brand: 'Apple',
    tier: 'genuine',
    subType: 'apple-official',
    subTypeLabel: 'Apple純正',
    category: 'charging-cable',
    releaseDate: '2024-09-10',
    connection: 'USB-C直結 (編み込みケーブル) / MagSafe (Qi2互換)',
    compatDevices: [
      'iPhone 16 / 16 Pro / 17 シリーズ (最大25W高速ワイヤレス充電 ※30W以上のアダプタ使用時)',
      'iPhone 12 / 13 / 14 / 15 シリーズ (最大15W MagSafe充電)',
      'AirPods Pro 2 / AirPods 4 (ANC) / Qi対応デバイス',
    ],
    compatGroups: ['iphone-16-17', 'iphone-15', 'iphone-12-14'],
    highlights: [
      '2024年9月に刷新！iPhone 16以降と30W電源アダプタとの組み合わせで最大25W（約30分で50%充電）を実現',
      '断線に強い編み込み（ウーブン）ケーブルを採用し、新たに2mモデルもラインナップ',
      'Qi2規格にも対応し、iPhone 12〜15でも最大15WのMagSafe充電が可能',
    ],
    certification: 'Apple 純正 MagSafe (Qi2認証)',
    specs: {
      interface: 'USB-Cコネクタ一体型（電源アダプタ別売）',
      powerOrBattery: '最大25W (iPhone 16以降 + 30W以上のアダプタ) / 最大15W (iPhone 12〜15)',
      dimensionsOrWeight: '1m または 2m 編み込みケーブル',
      specialFeatures: 'マグネット自動位置合わせ・Qi2互換・NFC充電アニメーション対応',
      warrantyOrSupport: 'Apple 1年限定保証',
    },
    recommendedAlternativeId: 'anker-maggo-qi2-stand',
    comparisonNote: 'iPhone 16/17で「25Wワイヤレス急速充電」を出せるのは現状この新型純正MagSafe充電器のみ。3台同時充電したいならBelkinやAnkerのQi2 3-in-1が便利です。',
    skus: [
      {
        id: '1m',
        label: '1m (MX6X3AM/A)',
        modelNumber: 'MX6X3AM/A',
        launchPrice: 6480,
        currentPrice: 6480,
        marketEstimatePrice: 5880,
        usdPrice: 39,
        priceHistory: mkAccHistory([
          ['2020-10-16', '初代15W (1m) 発売時', 4950, 39, 105.2],
          ['2022-07-01', '円安に伴う価格改定', 6180, 39, 136.0],
          ['2024-09-10', '第2世代 25W (1m) 発売', 6480, 39, 143.0],
        ]),
      },
      {
        id: '2m',
        label: '2m (MX6Y3AM/A)',
        modelNumber: 'MX6Y3AM/A',
        launchPrice: 8480,
        currentPrice: 8480,
        marketEstimatePrice: 7680,
        usdPrice: 49,
        priceHistory: mkAccHistory([
          ['2024-09-10', '第2世代 25W (2m) 発売', 8480, 49, 143.0],
        ]),
      },
    ],
  },
  {
    id: 'belkin-boostcharge-pro-3in1-qi2',
    name: 'Belkin BoostCharge Pro MagSafe / Qi2 3-in-1 ワイヤレス充電スタンド',
    brand: 'Belkin',
    tier: 'semi-genuine',
    subType: 'apple-store-partner',
    subTypeLabel: '準純正 (Apple Store公式取扱・Made for MagSafe)',
    category: 'charging-cable',
    releaseDate: '2024-03-15',
    connection: 'MagSafe / Qi2 15W + Apple Watch 高速充電 + AirPods Qi (電源アダプタ付属)',
    compatDevices: [
      'iPhone 12〜17 全シリーズ (MagSafe / Qi2 15W)',
      'Apple Watch Series 1〜10 / Ultra / SE (Series 7以降は高速充電対応)',
      'AirPods Pro / AirPods (ワイヤレス充電ケース)',
    ],
    compatGroups: ['iphone-16-17', 'iphone-15', 'iphone-12-14', 'apple-watch-all'],
    highlights: [
      'Apple Store店頭の展示什器にも採用されるBelkinの定番3-in-1充電スタンド（Qi2 / MagSafe公式認証）',
      'iPhoneを横向きに吸着させるだけでiOSの「スタンバイ（StandBy）」モードのおしゃれな置き時計に早変わり',
      'Apple Watch Series 7〜10 / Ultraの高速充電モジュールを公式搭載し、ACアダプタも同梱',
    ],
    certification: 'Made for MagSafe / Qi2 公式認証・Made for Apple Watch',
    specs: {
      interface: '専用ACアダプタ（または36W USB-C PD電源アダプタ）同梱',
      powerOrBattery: 'iPhone 最大15W + Apple Watch 高速充電5W + AirPods 5W',
      dimensionsOrWeight: 'ステンレススチール支柱＆角度調整機能（パッド型〜スタンド型可変モデルあり）',
      specialFeatures: 'iOSスタンバイモード最適角度・Apple Watch高速充電対応',
      warrantyOrSupport: 'Belkin 2年保証 ＋ 最大28万円の接続機器保証（CEW）',
    },
    recommendedAlternativeId: 'anker-maggo-qi2-stand',
    skus: [
      {
        id: '3in1-stand',
        label: '3-in-1 磁気スタンド (WIZ023dq)',
        modelNumber: 'WIZ023dq',
        launchPrice: 21800,
        currentPrice: 22100,
        marketEstimatePrice: 18800,
        usdPrice: 149.99,
        priceHistory: mkAccHistory([
          ['2021-04-01', '初代モデル発売時', 16478, 149.99, 110.5],
          ['2024-03-15', 'Qi2 / 角度調整対応モデル', 22100, 149.99, 149.0],
        ]),
      },
      {
        id: '2in1-pad',
        label: '2-in-1 磁気パッド (WIZ021dq)',
        modelNumber: 'WIZ021dq',
        launchPrice: 11900,
        currentPrice: 11900,
        marketEstimatePrice: 9980,
        usdPrice: 79.99,
        priceHistory: mkAccHistory([
          ['2024-03-15', '発売時', 11900, 79.99, 149.0],
        ]),
      },
    ],
  },
  {
    id: 'anker-maggo-qi2-stand',
    name: 'Anker MagGo Wireless Charging Station (Foldable 3-in-1 / Power Bank Qi2)',
    brand: 'Anker',
    tier: 'semi-genuine',
    subType: 'mfi-qi2-partner',
    subTypeLabel: '準純正 (Qi2 15W ＆ Made for Apple Watch認証)',
    category: 'charging-cable',
    releaseDate: '2024-02-08',
    connection: 'Qi2 15W (MagSafe互換) + Made for Apple Watch高速充電 + Qi (充電器・ケーブル同梱)',
    compatDevices: [
      'iPhone 12〜17 全シリーズ (Qi2 / MagSafe)',
      'Apple Watch 全シリーズ (高速充電対応)',
      'AirPods (ワイヤレス充電対応モデル)',
    ],
    compatGroups: ['iphone-16-17', 'iphone-15', 'iphone-12-14', 'apple-watch-all'],
    highlights: [
      'AppleのMagSafeをベースにした国際標準「Qi2 (最大15W)」と「Made for Apple Watch」のW公式認証を取得',
      '折りたたみ式3-in-1はマカロンサイズ（約195g）に畳めて出張・旅行用にも据え置き用にも無敵の使い勝手',
      '40W USB-C急速充電器とケーブルまでフルセット同梱でBelkinの約3分の2の価格',
    ],
    certification: 'Qi2 公式認証 / Made for Apple Watch 公式認証',
    specs: {
      interface: 'USB-C入力（3-in-1は40W USB-C充電器＆ケーブル付属）',
      powerOrBattery: 'Qi2 15W + Apple Watch 5W高速充電 + ワイヤレスイヤホン 5W',
      dimensionsOrWeight: '3-in-1 Foldable: 約89×60×25mm / 約195g',
      specialFeatures: 'ActiveShield 2.0 温度管理・折りたたみ機構・パススルー充電',
      warrantyOrSupport: 'Anker 最大24ヶ月保証（会員登録時）',
    },
    recommendedAlternativeId: 'belkin-boostcharge-pro-3in1-qi2',
    skus: [
      {
        id: 'foldable-3in1',
        label: 'Foldable 3-in-1 充電ステーション (B2557)',
        modelNumber: 'B2557',
        launchPrice: 14990,
        currentPrice: 14990,
        marketEstimatePrice: 12490,
        usdPrice: 109.99,
        priceHistory: mkAccHistory([
          ['2024-02-08', '発売時', 14990, 109.99, 149.2],
        ]),
      },
      {
        id: 'powerbank-10000',
        label: 'MagGo Power Bank (10000mAh Qi2 15W モバイルバッテリー A1654)',
        modelNumber: 'A1654',
        launchPrice: 9990,
        currentPrice: 9990,
        marketEstimatePrice: 8490,
        usdPrice: 89.99,
        priceHistory: mkAccHistory([
          ['2024-02-08', '発売時', 9990, 89.99, 149.2, '折りたたみスタンド＆残量液晶ディスプレイ付き'],
        ]),
      },
    ],
  },
  {
    id: 'apple-usbc-power-adapters',
    name: 'Apple USB-C電源アダプタ (20W / 35Wデュアル / 70W / 140W)',
    brand: 'Apple',
    tier: 'genuine',
    subType: 'apple-official',
    subTypeLabel: 'Apple純正',
    category: 'charging-cable',
    releaseDate: '2020-10-16',
    connection: 'USB-C Power Delivery (PD)',
    compatDevices: ['iPhone 全モデル', 'iPad 全モデル', 'MacBook Air / Pro', 'Apple Watch / AirPods'],
    compatGroups: ['iphone-16-17', 'iphone-15', 'iphone-12-14', 'ipad-pro-m4-air-m2', 'ipad-10-11-usbc', 'mac-apple-silicon', 'apple-watch-all'],
    highlights: [
      'iPhone / iPadの標準急速充電器（20W）から、2台同時充電の35Wデュアル、MacBook高速充電の70W / 140W（GaN採用）までラインナップ',
      '35WデュアルUSB-Cポート（コンパクト）はプラグが折りたたみ式でiPhoneとMacBook Airの同時充電に便利',
      '※ケーブルは別売りのため要注意',
    ],
    certification: 'Apple 純正',
    specs: {
      interface: 'USB-Cポート × 1 (35WのみUSB-C × 2)',
      powerOrBattery: '20W / 35W / 70W / 140W (USB PD 3.1 EPR対応)',
      dimensionsOrWeight: '35Wコンパクトは折りたたみ式プラグ採用',
      specialFeatures: 'Apple機器に最適化された安定した電圧制御',
      warrantyOrSupport: 'Apple 1年限定保証',
    },
    recommendedAlternativeId: 'anker-prime-nano-chargers',
    comparisonNote: '純正は安心感が高い一方、20Wはプラグが折りたためずサイズも大きめ。小型・軽量・高出力を求めるならAnkerやCIOのGaN充電器が圧倒的に有利です。',
    skus: [
      {
        id: '20w',
        label: '20W USB-C電源アダプタ (MU7V3J/A)',
        modelNumber: 'MU7V3J/A',
        launchPrice: 1980,
        currentPrice: 2780,
        marketEstimatePrice: 2480,
        usdPrice: 19,
        priceHistory: mkAccHistory([
          ['2020-10-16', '発売時', 1980, 19, 105.2],
          ['2022-07-01', '円安に伴う価格改定', 2780, 19, 136.0],
        ]),
      },
      {
        id: '35w-dual',
        label: 'デュアルUSB-Cポート搭載35Wコンパクト (MNWM3J/A)',
        modelNumber: 'MNWM3J/A',
        launchPrice: 7800,
        currentPrice: 9800,
        marketEstimatePrice: 8800,
        usdPrice: 59,
        priceHistory: mkAccHistory([
          ['2022-06-17', '発売時', 7800, 59, 134.5],
          ['2024-05-07', '円安に伴う価格改定', 9800, 59, 155.5],
        ]),
      },
      {
        id: '70w',
        label: '70W USB-C電源アダプタ (MQLN3J/A)',
        modelNumber: 'MQLN3J/A',
        launchPrice: 8800,
        currentPrice: 9800,
        marketEstimatePrice: 8800,
        usdPrice: 59,
        priceHistory: mkAccHistory([
          ['2023-06-06', '発売時', 8800, 59, 139.5],
          ['2024-05-07', '円安に伴う価格改定', 9800, 59, 155.5],
        ]),
      },
      {
        id: '140w',
        label: '140W USB-C電源アダプタ (MLYU3J/A)',
        modelNumber: 'MLYU3J/A',
        launchPrice: 10680,
        currentPrice: 14800,
        marketEstimatePrice: 13200,
        usdPrice: 99,
        priceHistory: mkAccHistory([
          ['2021-10-26', '発売時', 10680, 99, 114.0],
          ['2022-07-01', '円安に伴う価格改定', 13800, 99, 136.0],
          ['2024-05-07', '円安に伴う価格改定', 14800, 99, 155.5],
        ]),
      },
    ],
  },
  {
    id: 'anker-prime-nano-chargers',
    name: 'Anker Nano II / Prime GaN 急速充電器 (30W / 67W / 100W)',
    brand: 'Anker',
    tier: 'semi-genuine',
    subType: 'mfi-qi2-partner',
    subTypeLabel: '準純正 (Apple Store取扱ブランド・GaN搭載)',
    category: 'charging-cable',
    releaseDate: '2023-08-02',
    connection: 'USB-C PD / PPS / GaNPrime',
    compatDevices: ['iPhone 全モデル', 'iPad 全モデル', 'MacBook Air / Pro', 'Apple Watch / AirPods'],
    compatGroups: ['iphone-16-17', 'iphone-15', 'iphone-12-14', 'ipad-pro-m4-air-m2', 'ipad-10-11-usbc', 'mac-apple-silicon'],
    highlights: [
      'Apple純正アダプタの半分以下の体積で折りたたみプラグを搭載した窒化ガリウム（GaN）急速充電器',
      '30WモデルはiPhone 16/17の高速充電＆新型MagSafe 25W駆動＆MacBook Air充電を1台でカバー',
      '67W / 100W 3ポートモデルはMacBook Pro・iPad・iPhoneをコンセント1口で3台同時に急速充電可能',
    ],
    certification: 'PSE認証 / USB PD 3.0 PPS対応 / Apple Store 取扱ブランド',
    specs: {
      interface: '30W: USB-C×1 / 67W・100W: USB-C×2 + USB-A×1',
      powerOrBattery: '最大30W / 67W / 100W (GaNPrime電力自動配分)',
      dimensionsOrWeight: '30W: 約3cm角・47g / 67W: 約50×40×39mm・144g',
      specialFeatures: '折りたたみ式プラグ・ActiveShield 2.0常時温度監視',
      warrantyOrSupport: 'Anker 最大24ヶ月保証',
    },
    recommendedAlternativeId: 'apple-usbc-power-adapters',
    skus: [
      {
        id: 'nano-30w',
        label: 'Anker 511 Charger (Nano 3, 30W 折りたたみプラグ)',
        modelNumber: 'A2147',
        launchPrice: 2790,
        currentPrice: 2790,
        marketEstimatePrice: 2290,
        usdPrice: 22.99,
        priceHistory: mkAccHistory([
          ['2022-09-15', '発売時', 2790, 22.99, 143.0],
        ]),
      },
      {
        id: 'prime-67w',
        label: 'Anker Prime Wall Charger (67W, 3 ports, GaN)',
        modelNumber: 'A2669',
        launchPrice: 8490,
        currentPrice: 8490,
        marketEstimatePrice: 6990,
        usdPrice: 59.99,
        priceHistory: mkAccHistory([
          ['2023-08-02', '発売時', 8490, 59.99, 143.0],
        ]),
      },
      {
        id: 'prime-100w',
        label: 'Anker Prime Wall Charger (100W, 3 ports, GaN)',
        modelNumber: 'A2688',
        launchPrice: 9990,
        currentPrice: 9990,
        marketEstimatePrice: 8490,
        usdPrice: 84.99,
        priceHistory: mkAccHistory([
          ['2024-08-08', '発売時', 9990, 84.99, 146.5],
        ]),
      },
    ],
  },
  {
    id: 'apple-cables-thunderbolt-usbc',
    name: 'Apple 純正ケーブル (USB-C充電 / Thunderbolt 4・5 Pro / MagSafe 3)',
    brand: 'Apple',
    tier: 'genuine',
    subType: 'apple-official',
    subTypeLabel: 'Apple純正',
    category: 'charging-cable',
    releaseDate: '2023-09-22',
    connection: 'USB-C (60W / 240W) / Thunderbolt 4 (40Gbps) / Thunderbolt 5 (最大120Gbps) / MagSafe 3',
    compatDevices: ['iPhone 15 / 16 / 17', 'iPad 全モデル', 'Mac 全モデル', 'Studio Display'],
    compatGroups: ['iphone-16-17', 'iphone-15', 'ipad-pro-m4-air-m2', 'ipad-10-11-usbc', 'mac-apple-silicon'],
    incompatibleNotice: '白い「USB-C充電ケーブル（60W / 240W）」はデータ転送速度がUSB 2.0（最大480Mbps）です。SSD接続や映像出力にはThunderboltケーブルが必要です。',
    highlights: [
      '現行の純正ケーブルはすべて絡みにくく高耐久な「編み込み（ウーブン）デザイン」に統一',
      'Thunderbolt 4 / 5 Proケーブルは1本で最大120Gbpsデータ転送・6K/8K映像出力・最大240W給電のすべてに完全対応',
      'コネクタ内部に精巧な制御基板を搭載し、相性問題が最も起きにくいリファレンスケーブル',
    ],
    certification: 'Apple 純正',
    specs: {
      interface: 'USB-C to USB-C / USB-C to MagSafe 3',
      powerOrBattery: '60W (1m) / 240W (2m・TB5) / 140W (MagSafe 3)',
      dimensionsOrWeight: '高耐久ウーブン（編み込み）被覆',
      specialFeatures: 'TB4/5 ProはDisplayPort HBR3 / PCIe / USB4 完全互換',
      warrantyOrSupport: 'Apple 1年限定保証',
    },
    recommendedAlternativeId: 'anker-usbc-thunderbolt-cables',
    skus: [
      {
        id: 'usbc-60w-1m',
        label: '60W USB-C充電ケーブル (1m 編み込み MU2G3FE/A)',
        modelNumber: 'MU2G3FE/A',
        launchPrice: 2780,
        currentPrice: 2780,
        marketEstimatePrice: 2480,
        usdPrice: 19,
        priceHistory: mkAccHistory([
          ['2023-09-22', '発売時', 2780, 19, 148.3, 'データ通信はUSB 2.0 (480Mbps)'],
        ]),
      },
      {
        id: 'usbc-240w-2m',
        label: '240W USB-C充電ケーブル (2m 編み込み MU2G3FE/A)',
        modelNumber: 'MYQT3FE/A',
        launchPrice: 4480,
        currentPrice: 4480,
        marketEstimatePrice: 3980,
        usdPrice: 29,
        priceHistory: mkAccHistory([
          ['2023-09-22', '発売時', 4480, 29, 148.3, 'データ通信はUSB 2.0 (480Mbps)'],
        ]),
      },
      {
        id: 'tb4-pro-1m',
        label: 'Thunderbolt 4 (USB-C) Proケーブル (1m MN713FE/A)',
        modelNumber: 'MN713FE/A',
        launchPrice: 9800,
        currentPrice: 9800,
        marketEstimatePrice: 8800,
        usdPrice: 69,
        priceHistory: mkAccHistory([
          ['2023-10-31', '発売時', 9800, 69, 150.2, '40Gbps / 映像出力 / 100W充電対応'],
        ]),
      },
      {
        id: 'tb5-pro-1m',
        label: 'Thunderbolt 5 (USB-C) Proケーブル (1m MC9C4FE/A)',
        modelNumber: 'MC9C4FE/A',
        launchPrice: 9980,
        currentPrice: 9980,
        marketEstimatePrice: 9200,
        usdPrice: 69,
        priceHistory: mkAccHistory([
          ['2024-10-30', '発売時', 9980, 69, 153.2, '最大120Gbps / 240W給電対応'],
        ]),
      },
      {
        id: 'magsafe3-2m',
        label: 'USB-C - MagSafe 3ケーブル (2m MLYV3FE/A)',
        modelNumber: 'MLYV3FE/A',
        launchPrice: 5280,
        currentPrice: 7480,
        marketEstimatePrice: 6800,
        usdPrice: 49,
        priceHistory: mkAccHistory([
          ['2021-10-26', '発売時', 5280, 49, 114.0],
          ['2022-07-01', '円安に伴う価格改定', 6780, 49, 136.0],
          ['2024-05-07', '円安に伴う価格改定', 7480, 49, 155.5],
        ]),
      },
    ],
  },
  {
    id: 'anker-usbc-thunderbolt-cables',
    name: 'Anker PowerLine III Flow (シリコン絡まないケーブル) / USB4・Thunderbolt 4 ケーブル',
    brand: 'Anker',
    tier: 'semi-genuine',
    subType: 'mfi-qi2-partner',
    subTypeLabel: '準純正 (USB-IF / Intel Thunderbolt公式認証)',
    category: 'charging-cable',
    releaseDate: '2023-05-01',
    connection: 'USB-C 240W (シリコン) / USB4・Thunderbolt 4 (40Gbps・映像出力・240W)',
    compatDevices: ['iPhone 15 / 16 / 17', 'iPad 全モデル', 'Mac 全モデル', 'iPhone 14以前 (MFi Lightning版)'],
    compatGroups: ['iphone-16-17', 'iphone-15', 'iphone-12-14', 'ipad-pro-m4-air-m2', 'ipad-10-11-usbc', 'mac-apple-silicon'],
    highlights: [
      'PowerLine III Flowは3層医療グレードシリコン採用で「束ねてもバッグに入れても絶対に絡まない」ベストセラーケーブル',
      'iPhone 15/16 ProのProRes外部SSD撮影や4Kモニター出力には、純正の半額以下で買えるAnker USB4 / Thunderbolt 4ケーブルが活躍',
    ],
    certification: 'USB-IF 認証 / MFi 認証 (Lightning版)',
    specs: {
      interface: 'USB-C to USB-C / USB-C to Lightning (MFi)',
      powerOrBattery: '最大240W PD EPR対応',
      dimensionsOrWeight: '25,000回以上の折り曲げ耐久テストクリア',
      specialFeatures: 'シリコン柔軟素材(Flow) / 40Gbps・8K映像出力(USB4版)',
      warrantyOrSupport: 'Anker 最大24ヶ月保証',
    },
    recommendedAlternativeId: 'apple-cables-thunderbolt-usbc',
    skus: [
      {
        id: 'flow-usbc-18m',
        label: 'PowerLine III Flow USB-C & USB-C (240W 1.8m)',
        modelNumber: 'A8553',
        launchPrice: 2290,
        currentPrice: 2290,
        marketEstimatePrice: 1890,
        usdPrice: 19.99,
        priceHistory: mkAccHistory([
          ['2023-09-12', '発売時', 2290, 19.99, 147.0],
        ]),
      },
      {
        id: 'usb4-1m',
        label: 'Anker USB4 ケーブル (40Gbps / 240W / 8K映像 1.0m)',
        modelNumber: 'A8856',
        launchPrice: 2990,
        currentPrice: 2990,
        marketEstimatePrice: 2490,
        usdPrice: 24.99,
        priceHistory: mkAccHistory([
          ['2023-05-01', '発売時', 2990, 24.99, 137.0],
        ]),
      },
    ],
  },
  {
    id: 'apple-watch-fast-charger-usbc',
    name: 'Apple Watch 磁気高速充電 - USB-Cケーブル (1m)',
    brand: 'Apple',
    tier: 'genuine',
    subType: 'apple-official',
    subTypeLabel: 'Apple純正',
    category: 'charging-cable',
    releaseDate: '2021-10-15',
    connection: 'USB-C (編み込みケーブル) / Apple Watch磁気高速充電モジュール',
    compatDevices: [
      'Apple Watch Series 10 (約30分で0%→80%の超高速充電)',
      'Apple Watch Series 7 / 8 / 9 / Ultra / Ultra 2 (約45分で0%→80%の高速充電)',
      'Apple Watch SE / Series 1〜6 (通常充電) / AirPods Pro 2 / AirPods 4 (ANC)',
    ],
    compatGroups: ['apple-watch-all'],
    highlights: [
      'Apple Watch Series 7以降およびSeries 10の高速充電（お風呂に入っている間に満充電）にフル対応',
      'AirPods Pro 2 や AirPods 4 (ANC搭載モデル) のケースも磁力でピタッと吸着してワイヤレス充電可能',
    ],
    certification: 'Apple 純正',
    specs: {
      interface: 'USB-Cコネクタ / アルミニウム製磁気充電パック',
      powerOrBattery: '18W以上のUSB-C PDアダプタと併用で高速充電動作',
      dimensionsOrWeight: '1m 編み込みケーブル',
      specialFeatures: 'Apple Watch高速充電 + AirPods Pro 2 / 4 充電互換',
      warrantyOrSupport: 'Apple 1年限定保証',
    },
    skus: [
      {
        id: '1m',
        label: '1m 編み込みケーブル (MT0H3FE/A)',
        modelNumber: 'MT0H3FE/A',
        launchPrice: 3850,
        currentPrice: 4780,
        marketEstimatePrice: 4280,
        usdPrice: 29,
        priceHistory: mkAccHistory([
          ['2021-10-15', '発売時', 3850, 29, 113.5],
          ['2022-07-01', '円安に伴う価格改定', 4780, 29, 136.0],
        ]),
      },
    ],
  },

  /* =========================================================================
   * 5. 変換アダプタ・ハブ・ドック
   * ========================================================================= */
  {
    id: 'apple-usbc-digital-av-adapter',
    name: 'Apple USB-C Digital AV Multiportアダプタ',
    brand: 'Apple',
    tier: 'genuine',
    subType: 'apple-official',
    subTypeLabel: 'Apple純正',
    category: 'adapter-hub',
    releaseDate: '2019-08-01',
    connection: 'USB-C → HDMI 2.0 (4K/60Hz・HDCP 2.2) + USB-A + USB-Cパススルー充電',
    compatDevices: ['iPhone 15 / 16 / 17', 'iPad (USB-C搭載全モデル)', 'Mac 全モデル'],
    compatGroups: ['iphone-16-17', 'iphone-15', 'ipad-pro-m4-air-m2', 'ipad-pro-air-mini-gen2', 'ipad-10-11-usbc', 'mac-apple-silicon'],
    highlights: [
      'Netflix・Amazon Prime Video・Disney+・U-NEXT等の著作権保護（HDCP 2.2）動画が「真っ暗にならず確実にテレビへ映る」信頼性No.1アダプタ',
      'iPhone 15/16やiPad、MacBookを充電しながら4K/60Hz HDR出力とUSBメモリ接続が同時に可能',
      'macOS / iOSアップデート時にファームウェア更新が自動提供されるのはApple純正ならでは',
    ],
    certification: 'Apple 純正',
    specs: {
      interface: 'HDMI (4K 60Hz / HDR10 / Dolby Vision) + USB 3.1 Gen 1 (USB-A) + USB-C充電パススルー',
      powerOrBattery: 'USB-Cパススルー給電対応',
      dimensionsOrWeight: 'ホワイトショートケーブル一体型',
      specialFeatures: 'HDCP 2.2完全準拠・Apple純正ファームウェアアップデート対応',
      warrantyOrSupport: 'Apple 1年限定保証',
    },
    recommendedAlternativeId: 'anker-belkin-usbc-hubs',
    comparisonNote: 'ホテルや会議室のプロジェクター・TVにiPhone/iPadの動画配信アプリを映すなら純正が最も確実。SDカードやLANポートも欲しい場合はAnker/Belkinの多機能ハブを選びましょう。',
    skus: [
      {
        id: 'muf82',
        label: '4K/60Hz対応モデル (MUF82ZA/A)',
        modelNumber: 'MUF82ZA/A',
        launchPrice: 7480,
        currentPrice: 9980,
        marketEstimatePrice: 8980,
        usdPrice: 69,
        priceHistory: mkAccHistory([
          ['2019-08-01', '発売時', 7480, 69, 106.5],
          ['2022-07-01', '円安に伴う価格改定', 9980, 69, 136.0],
        ]),
      },
    ],
  },
  {
    id: 'apple-usbc-audio-lightning-adapters',
    name: 'Apple USB-C - 3.5mmヘッドフォンジャック / USB-C - Lightningアダプタ',
    brand: 'Apple',
    tier: 'genuine',
    subType: 'apple-official',
    subTypeLabel: 'Apple純正',
    category: 'adapter-hub',
    releaseDate: '2018-10-30',
    connection: 'USB-C → 3.5mmステレオミニ (DAC内蔵) / USB-C → Lightningメス (MFiフル対応)',
    compatDevices: ['iPhone 15 / 16 / 17', 'iPad (USB-C全モデル)', 'Mac 全モデル'],
    compatGroups: ['iphone-16-17', 'iphone-15', 'ipad-pro-m4-air-m2', 'ipad-pro-air-mini-gen2', 'ipad-10-11-usbc', 'mac-apple-silicon'],
    highlights: [
      '「USB-C - 3.5mmアダプタ（¥1,380）」はオーディオ界隈でもS/N比の高さと歪みの少なさで絶賛される超コスパ内蔵DAC',
      '「USB-C - Lightningアダプタ（¥4,780）」は従来のLightningアクセサリ（CarPlay・オーディオ・充電）をiPhone 15/16でそのまま使える唯一の純正変換',
    ],
    certification: 'Apple 純正',
    specs: {
      interface: 'USB-Cオス → 3.5mmメス (4極マイク対応) / Lightningメス',
      powerOrBattery: 'バスパワー（USB-C - Lightningは最大24W充電対応）',
      dimensionsOrWeight: '超小型ショートケーブル',
      specialFeatures: '24bit/48kHz AppleカスタムDAC内蔵 (3.5mm版) / CarPlay完全対応 (Lightning版)',
      warrantyOrSupport: 'Apple 1年限定保証',
    },
    skus: [
      {
        id: '35mm-dac',
        label: 'USB-C - 3.5mmヘッドフォンジャックアダプタ (MW2Q3FE/A)',
        modelNumber: 'MW2Q3FE/A',
        launchPrice: 1100,
        currentPrice: 1380,
        marketEstimatePrice: 1280,
        usdPrice: 9,
        priceHistory: mkAccHistory([
          ['2018-10-30', '発売時', 1100, 9, 112.5],
          ['2022-07-01', '円安に伴う価格改定', 1380, 9, 136.0],
        ]),
      },
      {
        id: 'usbc-to-lightning',
        label: 'USB-C - Lightningアダプタ (MUQX3FE/A)',
        modelNumber: 'MUQX3FE/A',
        launchPrice: 4780,
        currentPrice: 4780,
        marketEstimatePrice: 4280,
        usdPrice: 29,
        priceHistory: mkAccHistory([
          ['2023-09-22', '発売時', 4780, 29, 148.3, '充電・データ通信・オーディオ・CarPlayの全てに対応'],
        ]),
      },
    ],
  },
  {
    id: 'anker-belkin-usbc-hubs',
    name: 'Anker 332 / 555 USB-C ハブ ＆ Belkin Connect USB-C 7-in-1 マルチポートハブ',
    brand: 'Anker / Belkin',
    tier: 'semi-genuine',
    subType: 'apple-store-partner',
    subTypeLabel: '準純正 (Mac / iPad 最適化ハブ)',
    category: 'adapter-hub',
    releaseDate: '2023-03-01',
    connection: 'USB-C (PDパススルー 85W〜100W + 4K HDMI + SD/microSD + USB-A/C)',
    compatDevices: ['MacBook Air / Pro (M1〜M4)', 'iPad Pro / Air / mini / 無印(USB-C)', 'iPhone 15 / 16 Pro'],
    compatGroups: ['iphone-16-17', 'iphone-15', 'ipad-pro-m4-air-m2', 'ipad-pro-air-mini-gen2', 'ipad-10-11-usbc', 'mac-apple-silicon'],
    highlights: [
      'Apple純正Multiportアダプタ（¥9,980 / 3ポート）より安く、SDカードスロットや複数USBポートを一括拡張',
      'MacBookのスペースグレイ・シルバーと一体化するアルミ筐体を採用し、85W〜100Wのパススルー急速充電に対応',
    ],
    certification: 'Apple Store 取扱パートナー (Belkin) / USB PD対応',
    specs: {
      interface: 'HDMI (4K 30Hz/60Hz) + USB-C PD + USB-A×2 + SD/microSDスロット',
      powerOrBattery: '最大100W PD入力（本体へ最大85Wパススルー給電）',
      dimensionsOrWeight: 'アルミ削り出しコンパクトボディ（約50g〜110g）',
      specialFeatures: 'SD/microSD同時認識・10Gbps高速データ転送（Anker 555）',
      warrantyOrSupport: '最大24ヶ月保証',
    },
    recommendedAlternativeId: 'apple-usbc-digital-av-adapter',
    skus: [
      {
        id: 'anker-332-5in1',
        label: 'Anker 332 USB-C ハブ (5-in-1, 4K HDMI, 100W PD)',
        modelNumber: 'A8355',
        launchPrice: 2990,
        currentPrice: 2990,
        marketEstimatePrice: 2490,
        usdPrice: 24.99,
        priceHistory: mkAccHistory([
          ['2023-03-01', '発売時', 2990, 24.99, 136.2],
        ]),
      },
      {
        id: 'belkin-7in1',
        label: 'Belkin Connect USB-C 7-in-1 マルチポートアダプタ (AVC009btSGY)',
        modelNumber: 'AVC009btSGY',
        launchPrice: 6990,
        currentPrice: 7700,
        marketEstimatePrice: 6480,
        usdPrice: 49.99,
        priceHistory: mkAccHistory([
          ['2022-04-01', '発売時', 6990, 49.99, 122.0],
          ['2024-04-01', '価格改定', 7700, 49.99, 151.5],
        ]),
      },
      {
        id: 'anker-555-8in1',
        label: 'Anker 555 USB-C ハブ (8-in-1, 4K 60Hz, 10Gbps, イーサネット)',
        modelNumber: 'A8383',
        launchPrice: 7990,
        currentPrice: 7990,
        marketEstimatePrice: 6490,
        usdPrice: 59.99,
        priceHistory: mkAccHistory([
          ['2022-06-01', '発売時', 7990, 59.99, 130.0],
        ]),
      },
    ],
  },

  /* =========================================================================
   * 6. AirTag・紛失防止トラッカー・ホルダー
   * ========================================================================= */
  {
    id: 'apple-airtag',
    name: 'Apple AirTag (1個入り / 4個入りパック)',
    brand: 'Apple',
    tier: 'genuine',
    subType: 'apple-official',
    subTypeLabel: 'Apple純正',
    category: 'airtag-tracker',
    releaseDate: '2021-04-30',
    connection: 'Bluetooth + Apple U1超広帯域チップ (「探す」ネットワーク＋「正確な場所を見つける」対応)',
    compatDevices: ['iPhone (U1/U2搭載機で矢印ナビ対応)', 'iPad', 'Mac（「探す」アプリ）'],
    compatGroups: ['iphone-16-17', 'iphone-15', 'iphone-12-14', 'ipad-pro-m4-air-m2', 'mac-apple-silicon'],
    highlights: [
      '世界中の数億台のAppleデバイス網で位置を特定し、さらにU1チップにより数メートル圏内で「方向（矢印）と距離（cm単位）」を画面表示できる唯一のトラッカー',
      'iOS 18.2以降で「持ち物の位置情報を航空会社（JAL/ANA等）や第三者と一時共有する機能（Share Item Location）」に公式対応',
      '市販のコイン電池（CR2032）で約1年以上駆動し、ユーザー自身で簡単に電池交換可能',
    ],
    certification: 'Apple 純正 (U1チップ内蔵)',
    specs: {
      interface: 'Bluetooth LE + 超広帯域 (UWB) U1チップ + NFC（紛失モード連絡先表示）',
      powerOrBattery: 'CR2032コイン型リチウム電池（約1年以上駆動・交換可）',
      dimensionsOrWeight: '直径 31.9mm × 厚さ 8.0mm / 重量 11g (IP67防沫・耐水・防塵)',
      specialFeatures: '「正確な場所を見つける（Precision Finding）」・内蔵スピーカー・航空会社位置共有',
      warrantyOrSupport: 'Apple 1年限定保証（Apple Storeでの無料刻印サービス対応）',
    },
    recommendedAlternativeId: 'anker-eufy-smarttrack',
    comparisonNote: '「矢印で方向まで案内してほしい（UWB）」なら純正AirTag一択。財布に入る薄型カード型が欲しい場合やコストを半額に抑えたい場合はAnker Eufyが最適です。',
    skus: [
      {
        id: '1pack',
        label: '1個入り (MX532ZP/A)',
        modelNumber: 'MX532ZP/A',
        launchPrice: 3800,
        currentPrice: 4980,
        marketEstimatePrice: 4280,
        usdPrice: 29,
        priceHistory: mkAccHistory([
          ['2021-04-30', '発売時', 3800, 29, 109.3, '発売時より+1,180円値上がり'],
          ['2022-07-01', '円安に伴う価格改定', 4780, 29, 136.0],
          ['2024-05-07', '円安に伴う価格改定', 4980, 29, 155.5],
        ]),
      },
      {
        id: '4pack',
        label: '4個入りパック (MX542ZP/A・1個あたり¥4,245)',
        modelNumber: 'MX542ZP/A',
        launchPrice: 12800,
        currentPrice: 16980,
        marketEstimatePrice: 14480,
        usdPrice: 99,
        priceHistory: mkAccHistory([
          ['2021-04-30', '発売時', 12800, 99, 109.3, '発売時は1個あたり3,200円'],
          ['2022-07-01', '円安に伴う価格改定', 15980, 99, 136.0],
          ['2024-05-07', '円安に伴う価格改定', 16980, 99, 155.5],
        ]),
      },
    ],
  },
  {
    id: 'anker-eufy-smarttrack',
    name: 'Anker Eufy Security SmartTrack Link / SmartTrack Card (Apple「探す」対応)',
    brand: 'Anker (Eufy)',
    tier: 'semi-genuine',
    subType: 'mfi-qi2-partner',
    subTypeLabel: '準純正 (Apple Works with Find My 公式認証)',
    category: 'airtag-tracker',
    releaseDate: '2022-11-01',
    connection: 'Apple Find My (「探す」ネットワーク公式認証) + Bluetooth',
    compatDevices: ['iPhone', 'iPad', 'Mac（Apple標準「探す」アプリに直接登録可能）'],
    compatGroups: ['iphone-16-17', 'iphone-15', 'iphone-12-14', 'ipad-pro-m4-air-m2', 'mac-apple-silicon'],
    incompatibleNotice: 'U1超広帯域チップ非搭載のため、近距離での「矢印による方向ガイド」には非対応です（大音量アラームで場所を特定します）。',
    highlights: [
      'Appleの「探す（Find My）」ネットワークに公式対応！専用アプリ不要でiPhone標準の「探す」アプリでそのまま追跡可能',
      '「SmartTrack Card」は厚さわずか2.4mmのクレジットカード型で、AirTagが入らない薄い財布やパスケースに最適',
      '「SmartTrack Link」は最初からキーホルダー穴が開いているため、別途数千円のホルダーを買う必要がなくトータル費用が純正の約3分の1',
    ],
    certification: 'Works with Apple Find My 公式認証',
    specs: {
      interface: 'Bluetooth LE / Apple Find My ネットワーク',
      powerOrBattery: 'Link: CR2032交換可(約1年) / Card: 内蔵バッテリー(最大3年・充電式モデルあり)',
      dimensionsOrWeight: 'Link: 37×37×6.5mm / Card: 85×54×2.4mm（クレカ約2枚分）',
      specialFeatures: 'スマホを鳴らす逆탐知機能・置き忘れ通知・QRコード落し物連絡',
      warrantyOrSupport: 'Anker 最大24ヶ月保証',
    },
    recommendedAlternativeId: 'apple-airtag',
    skus: [
      {
        id: 'link-tag',
        label: 'SmartTrack Link (キー穴一体型タグ T87B0)',
        modelNumber: 'T87B0',
        launchPrice: 2990,
        currentPrice: 2990,
        marketEstimatePrice: 2490,
        usdPrice: 19.99,
        priceHistory: mkAccHistory([
          ['2022-11-01', '発売時', 2990, 19.99, 148.0],
        ]),
      },
      {
        id: 'card-wallet',
        label: 'SmartTrack Card (財布用薄型カード T87B2)',
        modelNumber: 'T87B2',
        launchPrice: 3990,
        currentPrice: 3990,
        marketEstimatePrice: 3390,
        usdPrice: 29.99,
        priceHistory: mkAccHistory([
          ['2023-02-16', '発売時', 3990, 29.99, 134.0],
        ]),
      },
    ],
  },
  {
    id: 'airtag-holders-apple-belkin-hermes',
    name: 'AirTag ホルダー (Apple純正ファインウーブン / Belkin Secure Holder / Hermès)',
    brand: 'Apple / Belkin / Hermès',
    tier: 'semi-genuine',
    subType: 'apple-store-partner',
    subTypeLabel: '純正・準純正・Hermèsコラボ (Apple Store取扱)',
    category: 'airtag-tracker',
    releaseDate: '2021-04-30',
    connection: 'AirTag専用ホルダー（キーリング / ワイヤーケーブル / ストラップ）',
    compatDevices: ['Apple AirTag'],
    compatGroups: ['iphone-16-17', 'iphone-15', 'iphone-12-14'],
    highlights: [
      'Belkinのセキュアホルダー（¥1,980）はApple Storeで最も売れている準純正ホルダーで、ツイストロック構造により激しい衝撃でもAirTagが脱落しない',
      'Apple純正ファインウーブンキーリング（¥6,800）や、フランス製ヴォー・バレニア革にClou de Selle刻印を施した『AirTag Hermès（¥54,800〜）』もApple Store限定展開',
    ],
    certification: 'Apple 純正 / Apple Store 公式パートナー / Apple × Hermès',
    specs: {
      interface: 'AirTag（直径31.9mm）専用設計',
      powerOrBattery: '—',
      dimensionsOrWeight: 'Belkin: ツイストロック＆エッジ保護構造 / Hermès: 特製Hermès刻印AirTag本体同梱',
      specialFeatures: '用途別にキーリング・ストラップ・ワイヤーケーブルから選択可能',
      warrantyOrSupport: 'Apple / Belkin 公式保証',
    },
    skus: [
      {
        id: 'belkin-holder',
        label: 'Belkin Secure Holder with Key Ring / Strap (F8W973bt)',
        modelNumber: 'F8W973bt',
        launchPrice: 1580,
        currentPrice: 1980,
        marketEstimatePrice: 1780,
        usdPrice: 12.95,
        priceHistory: mkAccHistory([
          ['2021-04-30', '発売時', 1580, 12.95, 109.3],
          ['2022-07-01', '円安に伴う価格改定', 1980, 12.95, 136.0],
        ]),
      },
      {
        id: 'apple-finewoven-keyring',
        label: 'Apple AirTagファインウーブンキーリング (MT2H3FE/A)',
        modelNumber: 'MT2H3FE/A',
        launchPrice: 6800,
        currentPrice: 6800,
        marketEstimatePrice: 6200,
        usdPrice: 35,
        priceHistory: mkAccHistory([
          ['2023-09-22', '発売時', 6800, 35, 148.3],
        ]),
      },
      {
        id: 'hermes-airtag',
        label: 'AirTag Hermès キーリング / バッグチャーム (特製AirTag本体付属)',
        modelNumber: 'MX8C3FE/A',
        launchPrice: 41800,
        currentPrice: 54800,
        marketEstimatePrice: 54800,
        usdPrice: 349,
        priceHistory: mkAccHistory([
          ['2021-04-30', '発売時', 41800, 349, 109.3],
          ['2022-07-01', '円安に伴う価格改定', 49800, 349, 136.0],
          ['2024-05-07', '円安に伴う価格改定', 54800, 349, 155.5],
        ]),
      },
    ],
  },

  /* =========================================================================
   * 7. ケース・バンド・保護ガラス・ウォレット
   * ========================================================================= */
  {
    id: 'apple-iphone-magsafe-cases',
    name: 'Apple純正 MagSafe対応 iPhoneシリコーンケース / クリアケース (カメラコントロール対応)',
    brand: 'Apple',
    tier: 'genuine',
    subType: 'apple-official',
    subTypeLabel: 'Apple純正',
    category: 'case-band-film',
    releaseDate: '2024-09-20',
    connection: 'MagSafe内蔵マグネット + NFC（装着カラーアニメーション） + カメラコントロール用サファイアクリスタル',
    compatDevices: ['iPhone 16 / 16 Plus / 16 Pro / 16 Pro Max / 17', 'iPhone 15 / 14 / 13 / SE 各専用サイズ'],
    compatGroups: ['iphone-16-17', 'iphone-15', 'iphone-12-14'],
    highlights: [
      'iPhone 16世代の純正ケースは、側面の「カメラコントロール」ボタン部分に導電層を備えたサファイアクリスタルを内蔵し、ケース越しでも滑らかなスライド操作が可能',
      'クリアケースは内側・外側の両面に傷防止コーティングと黄ばみ（経年変色）を防ぐ特殊ポリカーボネート素材を採用',
      '装着した瞬間にケースと同じ色のMagSafeエフェクトが画面に広がるNFC連携',
    ],
    certification: 'Apple 純正 MagSafe',
    specs: {
      interface: 'MagSafeマグネットリング内蔵 / カメラコントロール連動機構',
      powerOrBattery: 'MagSafe最大25W / Qi2ワイヤレス充電パススルー',
      dimensionsOrWeight: '内側マイクロファイバー裏地（シリコーンケース）',
      specialFeatures: 'サファイアクリスタル導電カメラコントロール・黄ばみ防止光学クリア素材',
      warrantyOrSupport: 'Apple 1年限定保証',
    },
    recommendedAlternativeId: 'beats-otterbox-spigen-iphone-cases',
    skus: [
      {
        id: 'silicone-16',
        label: 'MagSafe対応 シリコーンケース (MYY13FE/A ほか)',
        modelNumber: 'MYY13FE/A',
        launchPrice: 7980,
        currentPrice: 7980,
        marketEstimatePrice: 7180,
        usdPrice: 49,
        priceHistory: mkAccHistory([
          ['2021-09-24', 'iPhone 13世代 発売時', 6050, 49, 110.5],
          ['2022-09-08', 'iPhone 14世代', 7580, 49, 143.5],
          ['2023-09-13', 'iPhone 15 / 16世代', 7980, 49, 147.5],
        ]),
      },
      {
        id: 'clear-16',
        label: 'MagSafe対応 クリアケース (MA6A4FE/A ほか)',
        modelNumber: 'MA6A4FE/A',
        launchPrice: 7980,
        currentPrice: 7980,
        marketEstimatePrice: 7180,
        usdPrice: 49,
        priceHistory: mkAccHistory([
          ['2021-09-24', 'iPhone 13世代 発売時', 6050, 49, 110.5],
          ['2023-09-13', 'iPhone 15 / 16世代', 7980, 49, 147.5],
        ]),
      },
    ],
  },
  {
    id: 'beats-otterbox-spigen-iphone-cases',
    name: 'Beats iPhone 16 Case (MagSafe・カメラコントロール対応) / OtterBox Lumen',
    brand: 'Beats (Apple傘下) / OtterBox',
    tier: 'semi-genuine',
    subType: 'apple-owned-beats',
    subTypeLabel: '準純正 (Beats純正 / Apple Store限定OtterBox)',
    category: 'case-band-film',
    releaseDate: '2024-09-10',
    connection: 'MagSafe内蔵 + サファイアクリスタル導電カメラコントロールボタン搭載',
    compatDevices: ['iPhone 16 / 16 Plus / 16 Pro / 16 Pro Max'],
    compatGroups: ['iphone-16-17'],
    highlights: [
      '2024年9月にApple傘下の「Beats」から史上初の純正iPhoneケースが登場！Apple純正ケースと全く同じ『サファイアクリスタル製カメラコントロール機構』を搭載',
      'シリコンのベタつきが苦手な人に最適な「さらさら・ツヤありのハードポリカーボネート背面＋柔軟なTPU側面＋マイクロファイバー裏地」のハイブリッド構造',
      'Apple Store限定の『OtterBox Lumenシリーズ』も同様にカメラコントロールボタンを公式内蔵し、高い耐落下性能を両立',
    ],
    certification: 'Apple 傘下 Beats 純正設計 / Apple Store 限定 OtterBox',
    specs: {
      interface: 'MagSafeマグネット内蔵 / サファイアクリスタル導電ボタン',
      powerOrBattery: 'MagSafe 25W / Qi2 完全対応',
      dimensionsOrWeight: 'ポリカーボネート背面 + 衝撃吸収サイドウォール',
      specialFeatures: 'サファイアクリスタルカメラコントロールボタン・マイクロファイバー内張り',
      warrantyOrSupport: 'Apple 1年保証 (Beats) / OtterBox 限定保証',
    },
    recommendedAlternativeId: 'apple-iphone-magsafe-cases',
    comparisonNote: 'Apple純正がファインウーブンケースを廃止した代わりに登場した「実質的なApple第3の純正ケース」がBeatsケースです。ポケットへの出し入れが滑らかで指紋も目立ちにくい隠れた名作。',
    skus: [
      {
        id: 'beats-case-16',
        label: 'Beats iPhone 16 Case with MagSafe (MCF64FE/A ほか)',
        modelNumber: 'MCF64FE/A',
        launchPrice: 7980,
        currentPrice: 7980,
        marketEstimatePrice: 7180,
        usdPrice: 49,
        priceHistory: mkAccHistory([
          ['2024-09-10', '発売時', 7980, 49, 143.0],
        ]),
      },
      {
        id: 'otterbox-lumen-16',
        label: 'OtterBox Lumen Series Case with MagSafe (Apple Store限定)',
        modelNumber: 'HRPG2ZM/A',
        launchPrice: 7980,
        currentPrice: 7980,
        marketEstimatePrice: 7480,
        usdPrice: 49.95,
        priceHistory: mkAccHistory([
          ['2024-09-10', '発売時', 7980, 49.95, 143.0],
        ]),
      },
    ],
  },
  {
    id: 'apple-magsafe-finewoven-wallet',
    name: 'Apple「探す」対応 iPhoneファインウーブンウォレット with MagSafe',
    brand: 'Apple',
    tier: 'genuine',
    subType: 'apple-official',
    subTypeLabel: 'Apple純正',
    category: 'case-band-film',
    releaseDate: '2023-09-22',
    connection: 'MagSafe磁気吸着 + NFC（「探す」アプリの最後の既知の場所通知）',
    compatDevices: ['iPhone 12〜17 全シリーズ (MagSafe搭載モデル)'],
    compatGroups: ['iphone-16-17', 'iphone-15', 'iphone-12-14'],
    highlights: [
      'iPhoneの背面にピタッと吸着するカードケース（最大3枚収納・磁気シールド内蔵でクレジットカードも安全）',
      '万が一iPhoneから外れて落ちた場合、外れた瞬間の位置情報をiPhoneの「探す」アプリに即座に通知する純正ならではのセキュリティ機能',
    ],
    certification: 'Apple 純正 MagSafe',
    specs: {
      interface: 'MagSafeマグネット + NFCチップ内蔵',
      powerOrBattery: '充電不要',
      dimensionsOrWeight: '68%再生マイクロツイル素材（ファインウーブン）',
      specialFeatures: 'Apple「探す」対応（外れた場所の記録・通知）・磁気シールド内蔵',
      warrantyOrSupport: 'Apple 1年限定保証',
    },
    skus: [
      {
        id: 'finewoven-wallet',
        label: 'ファインウーブンウォレット (MT2N3FE/A ほか)',
        modelNumber: 'MT2N3FE/A',
        launchPrice: 9980,
        currentPrice: 9980,
        marketEstimatePrice: 8980,
        usdPrice: 59,
        priceHistory: mkAccHistory([
          ['2021-09-24', 'レザーウォレット(探す対応) 発売時', 7480, 59, 110.5],
          ['2022-07-01', '円安に伴う価格改定', 9380, 59, 136.0],
          ['2023-09-22', 'ファインウーブン刷新 / 2024新色', 9980, 59, 148.3],
        ]),
      },
    ],
  },
  {
    id: 'ipad-smart-folio',
    name: 'Apple Smart Folio (iPad Pro / iPad Air / iPad mini / 無印iPad用)',
    brand: 'Apple',
    tier: 'genuine',
    subType: 'apple-official',
    subTypeLabel: 'Apple純正',
    category: 'case-band-film',
    releaseDate: '2024-05-15',
    connection: '背面マグネット吸着 + カバー開閉オートスリープ連動',
    compatDevices: [
      'iPad Pro 11 / 13インチ (M4)',
      'iPad Air 11 / 13インチ (M2 / M3 / 第4・5世代)',
      'iPad mini (A17 Pro / 第6世代)',
      'iPad (第10世代 / A16 第11世代)',
    ],
    compatGroups: ['ipad-pro-m4-air-m2', 'ipad-pro-air-mini-gen2', 'ipad-10-11-usbc'],
    highlights: [
      '2024年モデル（iPad Pro M4 / Air M2 / mini A17 Pro用）からマグネット配置が進化し、従来の2段階から「より幅広い複数のスタンド角度」に調整可能へ大幅改善',
      'iPadの薄さと軽さを一切損なわず、前面と背面の両方をスマートに保護し、開閉で自動スリープ/ロック解除',
    ],
    certification: 'Apple 純正',
    specs: {
      interface: '背面マグネット直接吸着（ベゼルレス保持）',
      powerOrBattery: '—',
      dimensionsOrWeight: '薄型ポリウレタン外装 + マイクロファイバー裏地',
      specialFeatures: 'マルチアングルスタンド（2024世代〜）・自動スリープ/ウェイク連動',
      warrantyOrSupport: 'Apple 1年限定保証',
    },
    skus: [
      {
        id: 'mini-folio',
        label: 'iPad mini (A17 Pro / 第6世代) 用 (MC2Q4FE/A)',
        modelNumber: 'MC2Q4FE/A',
        launchPrice: 7480,
        currentPrice: 9800,
        marketEstimatePrice: 8800,
        usdPrice: 59,
        priceHistory: mkAccHistory([
          ['2021-09-24', '発売時', 7480, 59, 110.5],
          ['2022-07-01', '円安に伴う価格改定', 9380, 59, 136.0],
          ['2024-05-07', '円安に伴う価格改定', 9800, 59, 155.5],
        ]),
      },
      {
        id: '11-folio',
        label: '11インチ iPad Pro (M4) / iPad Air / 無印iPad 用 (MWK33FE/A)',
        modelNumber: 'MWK33FE/A',
        launchPrice: 9800,
        currentPrice: 13800,
        marketEstimatePrice: 12400,
        usdPrice: 79,
        priceHistory: mkAccHistory([
          ['2020-04-22', '発売時', 9800, 79, 107.6],
          ['2022-07-01', '円安に伴う価格改定', 12480, 79, 136.0],
          ['2024-05-07', '円安に伴う価格改定', 13800, 79, 155.5],
        ]),
      },
      {
        id: '13-folio',
        label: '13インチ iPad Pro (M4) / iPad Air 用 (MWK93FE/A)',
        modelNumber: 'MWK93FE/A',
        launchPrice: 12100,
        currentPrice: 17800,
        marketEstimatePrice: 15800,
        usdPrice: 99,
        priceHistory: mkAccHistory([
          ['2020-04-22', '発売時', 12100, 99, 107.6],
          ['2022-07-01', '円安に伴う価格改定', 15980, 99, 136.0],
          ['2024-05-07', '円安に伴う価格改定', 17800, 99, 155.5],
        ]),
      },
    ],
  },
  {
    id: 'belkin-ultraglass-2',
    name: 'Belkin UltraGlass 2 スクリーンプロテクター (Apple Store店頭マシン貼り付け対応)',
    brand: 'Belkin',
    tier: 'semi-genuine',
    subType: 'apple-store-partner',
    subTypeLabel: '準純正 (Apple Store公式貼り付けサービス採用)',
    category: 'case-band-film',
    releaseDate: '2023-09-22',
    connection: 'iPhone専用設計（Easy Alignトレイ同梱 / Apple Store店頭専用マシン施工可）',
    compatDevices: ['iPhone 16 / 16 Plus / 16 Pro / 16 Pro Max / 17', 'iPhone 15 / 14 / 13 / SE'],
    compatGroups: ['iphone-16-17', 'iphone-15', 'iphone-12-14'],
    highlights: [
      'Apple StoreでiPhoneを購入した際、スタッフ専用の貼り付けマシン（Screen Protection Application System）で埃ゼロ・ズレゼロで施工してもらえる唯一の公式採用ガラスフィルム',
      'リチウムアルミノケイ酸塩（LAS）ガラスへの二重イオン交換処理により、一般的な強化ガラス比で最大2.7倍の耐落下強度を実現',
      'オンライン購入時も専用の「Easy Alignトレイ」が付属し自宅でも簡単に貼り付け可能',
    ],
    certification: 'Apple Store 公式採用プロテクター',
    specs: {
      interface: '厚さわずか 0.29mm / 表面硬度 9H',
      powerOrBattery: '—',
      dimensionsOrWeight: '二重イオン交換強化LASガラス・抗菌＆指紋防止コーティング',
      specialFeatures: 'Apple Store店頭専用機でのプロ施工対応・Easy Alignトレイ付属',
      warrantyOrSupport: 'Belkin 制限付き無期限保証（破損時の交換プログラム対応）',
    },
    skus: [
      {
        id: 'ultraglass-2',
        label: 'Belkin UltraGlass 2 (OVA137zz ほか)',
        modelNumber: 'OVA137zz',
        launchPrice: 4800,
        currentPrice: 6800,
        marketEstimatePrice: 5800,
        usdPrice: 39.95,
        priceHistory: mkAccHistory([
          ['2020-10-16', '初代 UltraGlass 発売時', 4800, 39.95, 105.2],
          ['2022-09-08', '円安に伴う価格改定', 5800, 39.95, 143.5],
          ['2023-09-22', 'UltraGlass 2 発売', 6800, 39.95, 148.3],
        ]),
      },
    ],
  },
  {
    id: 'apple-watch-bands-official',
    name: 'Apple Watch 純正バンド (スポーツバンド / ミラネーゼループ / Nike / Hermès)',
    brand: 'Apple / Nike / Hermès',
    tier: 'genuine',
    subType: 'apple-official',
    subTypeLabel: 'Apple純正 ＆ Nike・Hermès公式コラボ',
    category: 'case-band-film',
    releaseDate: '2024-09-20',
    connection: 'Apple Watch スライドロック機構（38/40/41/42mm互換 ＆ 44/45/46/49mm互換）',
    compatDevices: [
      '小型グループ: 38mm (S1-3) / 40mm (S4-6・SE) / 41mm (S7-9) / 42mm (Series 10)',
      '大型グループ: 42mm (S1-3) / 44mm (S4-6・SE) / 45mm (S7-9) / 46mm (Series 10) / 49mm (Ultra 1・2)',
    ],
    compatGroups: ['apple-watch-all'],
    highlights: [
      '初代Apple Watchから最新Series 10 / Ultra 2まで、世代を超えてバンドをそのまま使い回せる高い互換性',
      '2024年9月に新登場した「チタニウムミラネーゼループ（¥30,800）」は航空宇宙グレードのグレード5チタンを編み込み、パラシュート式バックルを備えた人気モデル',
      'Apple × Nike（通気孔付きスポーツバンド/ループ）や Apple × Hermès（フランス製レザー/キリム/ツイルジャンプ）も公式展開',
    ],
    certification: 'Apple 純正 / Apple × Nike / Apple × Hermès',
    specs: {
      interface: 'Apple Watch 独自スライドラグ機構',
      powerOrBattery: '—',
      dimensionsOrWeight: 'フルオロエラストマー / 再生ナイロン / 316Lステンレス / グレード5チタニウム / Hermèsレザー・ラバー',
      specialFeatures: '水泳対応（スポーツ/ソロループ/オーシャン/キリム）',
      warrantyOrSupport: 'Apple 1年限定保証',
    },
    skus: [
      {
        id: 'sport-band-loop',
        label: 'スポーツバンド / スポーツループ / ソロループ / Nikeバンド',
        modelNumber: 'MXL33FE/A',
        launchPrice: 5280,
        currentPrice: 6800,
        marketEstimatePrice: 6480,
        usdPrice: 49,
        priceHistory: mkAccHistory([
          ['2020-09-18', '発売時', 5280, 49, 105.0],
          ['2022-07-01', '円安に伴う価格改定', 6800, 49, 136.0],
        ]),
      },
      {
        id: 'braided-milanese-ultra',
        label: 'ブレイデッドソロループ / ミラネーゼループ / Ultraバンド (アルパイン・トレイル・オーシャン)',
        modelNumber: 'MXMN3FE/A',
        launchPrice: 10780,
        currentPrice: 14800,
        marketEstimatePrice: 13800,
        usdPrice: 99,
        priceHistory: mkAccHistory([
          ['2020-09-18', '発売時', 10780, 99, 105.0],
          ['2022-07-01', '円安に伴う価格改定', 14800, 99, 136.0],
        ]),
      },
      {
        id: 'titanium-milanese',
        label: '49mm チタニウムミラネーゼループ (Ultra 1・2 / 44〜46mm対応 MXKC3FE/A)',
        modelNumber: 'MXKC3FE/A',
        launchPrice: 30800,
        currentPrice: 30800,
        marketEstimatePrice: 29800,
        usdPrice: 199,
        priceHistory: mkAccHistory([
          ['2024-09-20', '発売時', 30800, 199, 143.8],
        ]),
      },
      {
        id: 'hermes-band',
        label: 'Apple Watch Hermès シンプルトゥール (キリム / トワルH / ツイルジャンプ)',
        modelNumber: 'MXJ53FE/A',
        launchPrice: 39380,
        currentPrice: 54800,
        marketEstimatePrice: 54800,
        usdPrice: 349,
        priceHistory: mkAccHistory([
          ['2020-09-18', '発売時', 39380, 339, 105.0],
          ['2022-07-01', '円安に伴う価格改定', 49800, 349, 136.0],
          ['2024-05-07', '円安に伴う価格改定', 54800, 349, 155.5],
        ]),
      },
    ],
  },
  {
    id: 'apple-polishing-cloth',
    name: 'Apple ポリッシングクロス',
    brand: 'Apple',
    tier: 'genuine',
    subType: 'apple-official',
    subTypeLabel: 'Apple純正',
    category: 'case-band-film',
    releaseDate: '2021-10-19',
    connection: 'Nano-textureガラス対応 特殊非研磨マイクロファイバー',
    compatDevices: [
      'Studio Display / Pro Display XDR (Nano-textureガラス)',
      'iPad Pro (M4) / MacBook Pro (M4) Nano-textureディスプレイモデル',
      'iPhone / iPad / Mac / Apple Watch 全モデルの画面・筐体',
    ],
    compatGroups: ['iphone-16-17', 'iphone-15', 'iphone-12-14', 'ipad-pro-m4-air-m2', 'ipad-10-11-usbc', 'mac-apple-silicon', 'apple-watch-all'],
    highlights: [
      '微細な凹凸を持つデリケートな「Nano-textureガラス」のコーティングを傷つけずに皮脂・指紋を拭き取れるApple純正クロス',
      '2枚貼り合わせのしっかりとした厚みと右下のAppleロゴ型押しで、ガジェット好きへのプレゼントにも定番',
    ],
    certification: 'Apple 純正 (Nano-textureガラス公式指定ケア用品)',
    specs: {
      interface: '約 160 × 160 mm',
      powerOrBattery: '水洗い（中性洗剤手洗い・自然乾燥）で繰り返し使用可能',
      dimensionsOrWeight: '表面を傷つけない非研磨性不織布マイクロファイバー',
      specialFeatures: 'Nano-textureガラス公式対応',
      warrantyOrSupport: 'Apple 1年限定保証',
    },
    skus: [
      {
        id: 'cloth',
        label: 'ポリッシングクロス (MM6F3FE/A)',
        modelNumber: 'MM6F3FE/A',
        launchPrice: 1980,
        currentPrice: 2780,
        marketEstimatePrice: 2480,
        usdPrice: 19,
        priceHistory: mkAccHistory([
          ['2021-10-19', '発売時', 1980, 19, 114.0],
          ['2022-07-01', '円安に伴う価格改定', 2780, 19, 136.0],
        ]),
      },
    ],
  },

  /* =========================================================================
   * 8. ディスプレイ・HomePod・Apple TV・スマートホーム
   * ========================================================================= */
  {
    id: 'apple-studio-display',
    name: 'Apple Studio Display (27インチ 5K Retinaディスプレイ)',
    brand: 'Apple',
    tier: 'genuine',
    subType: 'apple-official',
    subTypeLabel: 'Apple純正',
    category: 'display-home',
    releaseDate: '2022-03-18',
    connection: 'Thunderbolt 3 (USB-C・最大96Wホスト充電) × 1 + USB-C (10Gbps) × 3',
    compatDevices: ['Mac Studio / Mac mini / MacBook Pro / MacBook Air / Mac Pro', 'iPad Pro / iPad Air (M1以降)'],
    compatGroups: ['mac-apple-silicon', 'ipad-pro-m4-air-m2'],
    highlights: [
      'macOSのRetinaスケーリング（218ppi = 5120×2880）に1ドット単位で完全一致し、文字のにじみやGPU負荷が一切発生しない唯一無二の27インチ5K純正モニター',
      'A13 Bionicチップを内蔵し、12MPセンターフレームカメラ、空間オーディオ対応6スピーカー、スタジオ品質3マイクアレイ、96W給電ハブを1本のケーブルに統合',
    ],
    certification: 'Apple 純正 (A13 Bionic内蔵)',
    specs: {
      interface: 'Thunderbolt 3 (96W給電) × 1 + USB-C (10Gbps) × 3',
      powerOrBattery: 'MacBook Pro 14インチの高速充電に対応する96W給電',
      dimensionsOrWeight: '27インチ 5K (5120×2880 / 600ニト / P3広色域 / True Tone)',
      specialFeatures: '12MPセンターフレームカメラ・空間オーディオ6スピーカー・Nano-texture選択可',
      warrantyOrSupport: 'AppleCare+ for Apple Display 加入可',
    },
    recommendedAlternativeId: 'benq-lg-mac-displays',
    comparisonNote: 'アルミ筐体の美しさとスピーカー・カメラの一体感は純正Studio Displayが圧倒的。一方で120Hzではない点と約22万円の価格がネックなら、BenQ MAシリーズやLG UltraFineが有力な選択肢になります。',
    skus: [
      {
        id: 'std-tilt',
        label: '標準ガラス・傾き調整スタンド (MK0U3J/A)',
        modelNumber: 'MK0U3J/A',
        launchPrice: 199800,
        currentPrice: 219800,
        marketEstimatePrice: 204800,
        usdPrice: 1599,
        priceHistory: mkAccHistory([
          ['2022-03-18', '発売時', 199800, 1599, 118.5],
          ['2022-07-01', '円安に伴う価格改定', 219800, 1599, 136.0],
        ]),
      },
      {
        id: 'nano-tilt',
        label: 'Nano-textureガラス・傾き調整スタンド (MMYW3J/A)',
        modelNumber: 'MMYW3J/A',
        launchPrice: 242800,
        currentPrice: 267800,
        marketEstimatePrice: 252800,
        usdPrice: 1899,
        priceHistory: mkAccHistory([
          ['2022-03-18', '発売時', 242800, 1899, 118.5],
          ['2022-07-01', '円安に伴う価格改定', 267800, 1899, 136.0],
        ]),
      },
    ],
  },
  {
    id: 'benq-lg-mac-displays',
    name: 'LG UltraFine 5K / 4K for Mac ＆ BenQ MA270U (MacBook色味完全同期モニター)',
    brand: 'LG / BenQ',
    tier: 'semi-genuine',
    subType: 'apple-store-partner',
    subTypeLabel: '準純正 (Apple共同開発LG / Mac特化BenQ)',
    category: 'display-home',
    releaseDate: '2024-09-04',
    connection: 'Thunderbolt 3/4 または USB-C (90W〜96W給電) + DisplayPilot 2 (Macキーボード輝度・音量連動)',
    compatDevices: ['MacBook Air / Pro (M1〜M4)', 'Mac mini / Mac Studio', 'iPad Pro / Air'],
    compatGroups: ['mac-apple-silicon', 'ipad-pro-m4-air-m2'],
    highlights: [
      'LG UltraFineシリーズはAppleと共同開発され、Apple Storeでも公式販売されてきたMac専用設計モニター（macOSから直接輝度・音量をネイティブ制御）',
      '2024年登場の『BenQ MA270U / MA320U』は、MacBook本体の画面と色味（M-bookモード）を完璧に一致させ、Magic Keyboardの輝度・音量キー操作にも連動しつつ7万円台という高コスパを実現',
    ],
    certification: 'Apple 共同開発 (LG UltraFine) / Mac Color Tuning特化 (BenQ MA)',
    specs: {
      interface: 'USB-C (90W給電) / Thunderbolt + HDMI + USBハブ',
      powerOrBattery: 'USB-Cケーブル1本で映像出力＋最大90W/94W給電',
      dimensionsOrWeight: '27インチ 4K/5K または 31.5インチ 4K (高さ・チルト・ピボット標準対応)',
      specialFeatures: 'MacBookのファンクションキーでモニター輝度・音量を直接操作可能',
      warrantyOrSupport: 'メーカー3年保証',
    },
    recommendedAlternativeId: 'apple-studio-display',
    skus: [
      {
        id: 'benq-ma270u',
        label: 'BenQ MA270U (27インチ 4K Mac向けモニター・90W給電)',
        modelNumber: 'MA270U',
        launchPrice: 78000,
        currentPrice: 78000,
        marketEstimatePrice: 69800,
        usdPrice: 499.99,
        priceHistory: mkAccHistory([
          ['2024-09-04', '発売時', 78000, 499.99, 145.0, '高さ調整スタンド標準搭載・ナノマットパネル'],
        ]),
      },
      {
        id: 'lg-ultrafine-4k-ergo',
        label: 'LG UltraFine Display Ergo 27UN880-B / 27UQ850V-W (27インチ 4K USB-C 90W)',
        modelNumber: '27UQ850V-W',
        launchPrice: 79800,
        currentPrice: 79800,
        marketEstimatePrice: 68000,
        usdPrice: 549.99,
        priceHistory: mkAccHistory([
          ['2023-05-01', '発売時', 79800, 549.99, 137.0],
        ]),
      },
    ],
  },
  {
    id: 'apple-homepod-appletv',
    name: 'Apple HomePod mini / HomePod (第2世代) / Apple TV 4K (第3世代)',
    brand: 'Apple',
    tier: 'genuine',
    subType: 'apple-official',
    subTypeLabel: 'Apple純正',
    category: 'display-home',
    releaseDate: '2022-11-04',
    connection: 'Wi-Fi / AirPlay 2 / Thread / Matter スマートホームハブ / eARC (Apple TV連携)',
    compatDevices: ['iPhone', 'iPad', 'Mac', 'Apple Watch', 'HomeKit / Matter対応スマート家電'],
    compatGroups: ['iphone-16-17', 'iphone-15', 'iphone-12-14', 'ipad-pro-m4-air-m2', 'mac-apple-silicon', 'apple-watch-all'],
    highlights: [
      'HomePod mini（¥14,800）は内部に「温度・湿度センサー」を内蔵しており、エアコン自動制御などのスマートホームハブ（HomeKit / Matter / Thread）として最小・最安の純正機',
      'Apple TV 4KとHomePod 2台を組み合わせると、テレビの音声（ゲーム機や地上波含むeARC音声）をDolby Atmosホームシアター化可能',
      'iPhoneをHomePod miniに近づけるだけで再生中の音楽がU1チップ経由で引き継がれるHandoff体験',
    ],
    certification: 'Apple 純正 (Thread / Matter ボーダールーター対応)',
    specs: {
      interface: 'Wi-Fi / Bluetooth / Ultra Wideband (U1) / HDMI 2.1 eARC (Apple TV 4K)',
      powerOrBattery: 'AC電源（HomePod miniは20W USB-C電源アダプタ同梱）',
      dimensionsOrWeight: 'HomePod mini: 345g / HomePod 第2世代: 2.3kg / Apple TV 4K: 208g',
      specialFeatures: '温湿度センサー内蔵(HomePod)・空間オーディオ・Siri・スマートホームハブ',
      warrantyOrSupport: 'AppleCare+ 加入可',
    },
    skus: [
      {
        id: 'homepod-mini',
        label: 'HomePod mini (MY5G2J/A ほか全5色)',
        modelNumber: 'MY5G2J/A',
        launchPrice: 11880,
        currentPrice: 14800,
        marketEstimatePrice: 13400,
        usdPrice: 99,
        priceHistory: mkAccHistory([
          ['2020-11-16', '発売時', 11880, 99, 104.5],
          ['2022-07-01', '円安に伴う価格改定', 14800, 99, 136.0],
        ]),
      },
      {
        id: 'apple-tv-4k-64',
        label: 'Apple TV 4K 第3世代 (64GB Wi-Fi MN873J/A)',
        modelNumber: 'MN873J/A',
        launchPrice: 19800,
        currentPrice: 19800,
        marketEstimatePrice: 18400,
        usdPrice: 129,
        priceHistory: mkAccHistory([
          ['2022-11-04', '発売時', 19800, 129, 147.5, '128GB Wi-Fi+Ethernet版(Thread対応)は¥23,800'],
        ]),
      },
      {
        id: 'homepod-2',
        label: 'HomePod 第2世代 (MQJ73J/A ミッドナイト・ホワイト)',
        modelNumber: 'MQJ73J/A',
        launchPrice: 44800,
        currentPrice: 44800,
        marketEstimatePrice: 41800,
        usdPrice: 299,
        priceHistory: mkAccHistory([
          ['2023-02-03', '発売時', 44800, 299, 130.0],
        ]),
      },
    ],
  },
];

/* =====================================================================================
 * 「純正 vs 準純正」定番比較プリセット
 * ===================================================================================== */
export interface AccessoryComparisonPreset {
  id: string;
  title: string;
  subtitle: string;
  itemIds: string[];
  verdict: string;
}

export const ACCESSORY_COMPARISON_PRESETS: AccessoryComparisonPreset[] = [
  {
    id: 'ipad-pencil-compare',
    title: 'iPad用ペン対決：Apple Pencil Pro vs USB-C vs Logicool Crayon',
    subtitle: '21,800円のProが必要か？1万円台のUSB-C / Crayonで十分か？',
    itemIds: ['apple-pencil-pro', 'apple-pencil-usbc', 'logicool-crayon-usbc'],
    verdict: 'イラスト制作（筆圧検知・バレルロール）や側面ワイヤレス充電が必須なら『Apple Pencil Pro』。ノート・PDF注釈・勉強メインなら『Apple Pencil (USB-C)』またはペアリング不要の『Logicool Crayon』で約1万円節約できます。',
  },
  {
    id: 'ipad-keyboard-compare',
    title: 'iPadキーボード対決：純正 Magic Keyboard vs Logicool Combo Touch',
    subtitle: '約5万円の純正か、着脱可能＆側面保護付きで1.3万円安い準純正か',
    itemIds: ['magic-keyboard-ipad-pro-m4', 'magic-keyboard-ipad-air', 'logicool-combo-touch-m4'],
    verdict: '両方ともAppleの『Smart Connector（ペアリング・充電不要）』を採用。膝の上での安定感とアルミ質感なら純正『Magic Keyboard』、キーボードを取り外してタブレットや手書きモードでも使いたいなら『Logicool Combo Touch』が圧勝です。',
  },
  {
    id: 'magsafe-qi2-compare',
    title: 'MagSafe / Qi2 ワイヤレス充電対決：Apple純正 25W vs Belkin vs Anker',
    subtitle: 'iPhone 16/17の25W最速充電をとるか、Watch・AirPodsとの3台同時充電をとるか',
    itemIds: ['apple-magsafe-charger-25w', 'belkin-boostcharge-pro-3in1-qi2', 'anker-maggo-qi2-stand'],
    verdict: 'iPhone単体を最速（25W）で充電したいなら新型『Apple MagSafe充電器』。デスクやベッドサイドでApple Watch・AirPodsも同時にスッキリ充電したいならQi2 15W＋Watch高速充電対応の『Anker MagGo 3-in-1（¥14,990・充電器同梱）』がコスパ最強です。',
  },
  {
    id: 'tracker-compare',
    title: '紛失防止タグ対決：Apple AirTag vs Anker Eufy SmartTrack',
    subtitle: 'U1チップの「矢印ナビ」か、財布に入るカード型＆ホルダー不要のコスパか',
    itemIds: ['apple-airtag', 'anker-eufy-smarttrack', 'airtag-holders-apple-belkin-hermes'],
    verdict: '両方ともiPhone標準の『探す』アプリに対応。部屋の中で数cm単位の矢印ガイド（UWB）を使いたいなら『AirTag』。薄い財布に入れたい場合（Card）や、別売りホルダー代を含めず3,000円以下で鍵に付けたい場合（Link）は『Anker Eufy』が最適です。',
  },
  {
    id: 'headphone-compare',
    title: 'オーバーイヤー＆イヤホン対決：AirPods Pro 2 / Max vs Beats Fit Pro / Studio Pro',
    subtitle: 'Apple純正H2/H1チップの連携力と、Apple傘下Beatsの軽量・高コスパ比較',
    itemIds: ['airpods-pro-2-usbc', 'airpods-max-usbc', 'beats-fit-pro', 'beats-studio-pro'],
    verdict: '日常のノイキャン・外音取り込み完成度は『AirPods Pro 2』が頂点。激しい運動で絶対に落ちないH1チップ機なら『Beats Fit Pro』、ヘッドホンで軽さ(260g)とUSB-C DAC有線接続・価格(約3.5万円差)を重視するなら『Beats Studio Pro』が賢い選択です。',
  },
  {
    id: 'mac-display-compare',
    title: 'Mac用モニター対決：Apple Studio Display (5K) vs BenQ MA270U / LG UltraFine',
    subtitle: '21.9万円の純正5Kか、MacBookと色味＆キーボード輝度操作が完全連動する7.8万円の準純正か',
    itemIds: ['apple-studio-display', 'benq-lg-mac-displays'],
    verdict: '5K解像度(218ppi)と6スピーカー・アルミ筐体の究極の一体感は『Studio Display』だけの特権。一方、予算8万円以下でMacBookと同じ色味・キーボードでの輝度/音量操作・USB-C 90W給電1本接続を叶えたいなら『BenQ MA270U』がベストバイです。',
  },
];
