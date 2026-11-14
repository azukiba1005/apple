import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Apple, Check, ChevronDown, ChevronUp, Coins, Copy, Download, ExternalLink, FileSpreadsheet,
  Headphones, Info, Laptop, Link2, Minus, Scale, Search, ShoppingBag, Smartphone, Sparkles,
  Tablet, TrendingDown, TrendingUp, Trophy, Watch, X,
} from 'lucide-react';
import { toBlob, toPng } from 'html-to-image';
import {
  appleStoreUrlForCategory,
  btnCls,
  buildCompareExcelSheets,
  buildCompareTable,
  buildShareSearchString,
  card,
  CarrierBadge,
  carrierColor,
  CARRIER_META,
  CARRIER_ORDER,
  CARRIER_STORE_URLS,
  carrierValue,
  CatIcon,
  CATEGORY_ORDER,
  CompactCardFxLine,
  compareProducts,
  compareSkus,
  computePerformanceScore,
  copyText,
  CurrentFxFairnessBadge,
  DEFAULT_LATEST_USD_JPY,
  DEFAULT_SHOW_FLAGS,
  DeltaBadge,
  SPEC_GROUPS,
  downloadBlob,
  downloadFile,
  downloadXlsx,
  EmptyNote,
  evaluateCurrentFxFairness,
  evaluateSpecRows,
  excelBtnCls,
  findProductByQueryToken,
  findSiblingCellularSku,
  findSiblingSkuByConnectivity,
  findSkuByQueryToken,
  formatFxComparisonText,
  FxRatePairChip,
  getCarrierUnavailableInfo,
  getColSpecDisplayValue,
  getProductConnectivityOptions,
  getSkuDiscontinuedInfo,
  hasDetail,
  hasPrice,
  impliedRate,
  isProductDiscontinued,
  lastOf,
  marketRate,
  normalizeSpecForCompare,
  pricedSkus,
  ResaleBadge,
  round1,
  secondaryActionBtnCls,
  SectionTitle,
  Segmented,
  selectCls,
  signedPct,
  signedRate,
  signedYen,
  skuPriced,
  skuStorRank,
  sortCategories,
  SPEC_ROWS,
  specText,
  taxRateAt,
  toCSV,
  toMarkdown,
  TrustedShopBadge,
  ts,
  useDark,
  yen,
  type BudgetCategoryFilter,
  type CarrierId,
  type CarrierPrice,
  type CarrierUnavailableInfo,
  type Category,
  type CompareShowFlags,
  type CompareShowKey,
  type ConnectivityType,
  type EvaluatedSpecRow,
  type Mode,
  type PerformanceScoreBreakdown,
  type PricePoint,
  type Product,
  type ReturnProgram,
  type Sel,
  type SellMode,
  type Sku,
  type SpecRowDef,
  type Specs,
  type Tab,
} from '../App';
import {
  estimateUsedMarketData,
  fetchUsedMarketPrice,
  type UsedConditionRank,
  type UsedMarketData,
  type UsedPlatformId,
  type UsedPricing,
  type UsedShopOffer,
} from '../usedPrice';
import { UsedShopOffersModal } from './UsedOffersModal';
import { toMoshimoUrl } from '../utils/moshimo';

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
    <div className={`${card} px-5 py-3.5 sm:px-6 sm:py-4`}>
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex flex-wrap items-center gap-2.5 min-w-0">
          <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#f5f5f7] text-xs dark:bg-[#23252b]">
            🔄
          </span>
          <h3 className="text-xs sm:text-sm font-bold text-zinc-900 dark:text-zinc-100">
            下取り・買い替え追い金シミュレーター
          </h3>
          {tradeInEst ? (
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-[#f5f5f7] px-2.5 py-1 text-xs font-semibold tabular-nums text-zinc-800 dark:bg-[#23252b] dark:text-zinc-200">
              <span className="h-1.5 w-1.5 rounded-full bg-[#649274]" />
              {tradeInEst.myProduct.name} ({tradeInEst.mySku.label}) 売却推計:{' '}
              <strong className="font-bold text-zinc-900 dark:text-zinc-100">−{yen(tradeInEst.activeYen)}</strong>
            </span>
          ) : (
            <span className="hidden text-xs text-zinc-500 sm:inline dark:text-zinc-400">
              現在の機種を選ぶと実質追い金・進化点を算出
            </span>
          )}
          {!expanded && (
            <div className="hidden items-center gap-1.5 lg:inline-flex">
              {TRADEIN_PRESETS.slice(0, 4).map((pr) => {
                const matchedP = findProductByQueryToken(sortedAll, pr.id);
                if (!matchedP) return null;
                const isSelected = mySel?.pid === matchedP.id;
                return (
                  <button
                    key={pr.id}
                    type="button"
                    onClick={() => applyPreset(pr.id, pr.skuHint)}
                    className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                      isSelected
                        ? 'bg-zinc-900 text-zinc-100 dark:bg-zinc-200 dark:text-zinc-900'
                        : 'bg-[#f5f5f7] text-zinc-600 hover:bg-zinc-200/70 dark:bg-[#23252b] dark:text-zinc-300 dark:hover:bg-[#2c2f36]'
                    }`}
                  >
                    {pr.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 ml-auto">
          {mySel && (
            <button
              type="button"
              onClick={() => setMySel(null)}
              className={secondaryActionBtnCls}
            >
              <X className="h-3.5 w-3.5" />
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
        <div className="mt-3.5 rounded-2xl bg-[#f5f5f7] p-4 dark:bg-[#23252b]">
          {/* クイック選択プリセットボタン */}
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">定番の乗り換え元:</span>
            {TRADEIN_PRESETS.map((pr) => {
              const matchedP = findProductByQueryToken(sortedAll, pr.id);
              if (!matchedP) return null;
              const isSelected = mySel?.pid === matchedP.id;
              return (
                <button
                  key={pr.id}
                  type="button"
                  onClick={() => applyPreset(pr.id, pr.skuHint)}
                  className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                    isSelected
                      ? 'bg-zinc-900 text-zinc-100 dark:bg-zinc-200 dark:text-zinc-900'
                      : 'bg-white text-zinc-700 hover:bg-zinc-200/70 dark:bg-[#1c1d22] dark:text-zinc-200 dark:hover:bg-[#2c2f36]'
                  }`}
                >
                  {pr.label}
                </button>
              );
            })}
          </div>

          {/* 機種・容量・売却ルート選択コントロール */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-12 sm:items-center">
            <div className="sm:col-span-5">
              <label className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">
                1. 現在使っている機種
              </label>
              <select
                className={`${selectCls} !bg-white dark:!bg-[#1c1d22] w-full`}
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
              <label className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">
                2. 容量 (SKU)
              </label>
              <select
                className={`${selectCls} !bg-white dark:!bg-[#1c1d22] w-full`}
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
              <label className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">
                3. 売却ルート（状態・方法）
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  className={`${selectCls} !bg-white dark:!bg-[#1c1d22] min-w-0 flex-1`}
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
                      className={`${selectCls} !bg-white dark:!bg-[#1c1d22] w-28 tabular-nums`}
                      aria-label="手入力査定額"
                    />
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* 売却ルート別の推定金額サマリー */}
          {tradeInEst && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 pt-2 text-xs">
              <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5">
                <span className="text-zinc-600 dark:text-zinc-400">
                  {tradeInEst.myProduct.name} ({tradeInEst.mySku.label}) 中古販売相場:{' '}
                  <strong className="font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
                    {yen(tradeInEst.baseUsedPrice)}
                  </strong>
                  {tradeInEst.isFallbackDepreciation && (
                    <span className="ml-1 text-xs text-zinc-400">(年式推計)</span>
                  )}
                </span>
                <div className="flex flex-wrap items-center gap-2 text-xs tabular-nums">
                  <button
                    type="button"
                    onClick={() => setSellMode('flea')}
                    className={`rounded-lg px-2.5 py-1 font-medium transition ${
                      sellMode === 'flea'
                        ? 'bg-zinc-900 text-zinc-100 dark:bg-zinc-200 dark:text-zinc-900'
                        : 'bg-white text-zinc-600 hover:bg-zinc-200/70 dark:bg-[#1c1d22] dark:text-zinc-300'
                    }`}
                  >
                    フリマ手取り: {yen(tradeInEst.fleaYen)}
                  </button>
                  <button
                    type="button"
                    onClick={() => setSellMode('shop')}
                    className={`rounded-lg px-2.5 py-1 font-medium transition ${
                      sellMode === 'shop'
                        ? 'bg-zinc-900 text-zinc-100 dark:bg-zinc-200 dark:text-zinc-900'
                        : 'bg-white text-zinc-600 hover:bg-zinc-200/70 dark:bg-[#1c1d22] dark:text-zinc-300'
                    }`}
                  >
                    ショップ買取: {yen(tradeInEst.shopYen)}
                  </button>
                  <button
                    type="button"
                    onClick={() => setSellMode('tradein')}
                    className={`rounded-lg px-2.5 py-1 font-medium transition ${
                      sellMode === 'tradein'
                        ? 'bg-zinc-900 text-zinc-100 dark:bg-zinc-200 dark:text-zinc-900'
                        : 'bg-white text-zinc-600 hover:bg-zinc-200/70 dark:bg-[#1c1d22] dark:text-zinc-300'
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
          ? `rounded-xl bg-[#f5f5f7] ${compact ? 'p-2.5' : 'p-3.5'} dark:bg-[#23252b]`
          : 'rounded-xl bg-[#f5f5f7] p-3.5 dark:bg-[#23252b]'
      }
    >
      <div className="flex items-center justify-between gap-1.5 text-xs font-semibold text-zinc-500 dark:text-zinc-400">
        <span>
          🔄 {tradeInEst.myProduct.name} (−{yen(sellYen)}) 下取り時の実質追い金
        </span>
      </div>

      <div className="mt-2 space-y-1 text-xs tabular-nums">
        {netNew != null && appleNewPrice != null && (
          <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              新品（{yen(appleNewPrice)}）へ:
            </span>
            {netNew <= 0 ? (
              <span className="font-bold text-[#3d6b4e] dark:text-[#88b396]">
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
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            中古最安（{yen(lowestUsedPrice)}）へ:
          </span>
          {netUsed <= 0 ? (
            <span className="font-bold text-[#3d6b4e] dark:text-[#88b396]">
              追い金 0円（+{yen(Math.abs(netUsed))} プラス）
            </span>
          ) : (
            <span className="font-bold text-zinc-900 dark:text-zinc-100">
              実質追い金 {yen(netUsed)}
            </span>
          )}
        </div>

        {netReturn != null && bestReturnCost != null && (
          <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5 text-xs">
            <span className="text-zinc-500 dark:text-zinc-400">
              2年返却（実質{yen(bestReturnCost)}）:
            </span>
            {netReturn <= 0 ? (
              <span className="font-semibold text-[#3d6b4e] dark:text-[#88b396]">
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
        <div className="mt-2 flex flex-wrap gap-1.5 pt-1">
          {diffBadges.map((b) => (
            <span
              key={b.key}
              className="inline-flex items-center rounded-md bg-white px-2 py-0.5 text-xs font-medium text-zinc-700 dark:bg-[#1c1d22] dark:text-zinc-300"
            >
              {b.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- キャリア価格セルの補足行（トグル連動・「2年返却」に表記統一） ---------- */
function carrierSubParts(cp: CarrierPrice, mode: Mode, mnp: boolean): string[] {
  const parts: string[] = [];
  if (mode === 'bulk') {
    if (!mnp && cp.mnpPrice != null) parts.push(`MNP ${yen(cp.mnpPrice)}`);
    else if (mnp && cp.mnpPrice != null && cp.currentPrice !== cp.mnpPrice) parts.push(`通常 ${yen(cp.currentPrice)}`);
    if (cp.returnProgram) parts.push(`2年返却 ${yen(cp.returnProgram.effectiveCost)}`);
  } else {
    parts.push(`一括 ${yen(cp.currentPrice)}`);
    if (cp.mnpPrice != null) parts.push(`MNP ${yen(cp.mnpPrice)}`);
  }
  return parts;
}

/* ---------- 中古最安値の1行表示（ショップ名・バッジ等は出さず、詳細はモーダルへ集約） ---------- */
function UsedOneLine({ u, loading, onOpen }: { u: UsedMarketData; loading?: boolean; onOpen: () => void }) {
  const up = u.usedPricing;
  const isEstimated = Boolean(u.isEstimated || u.source === 'mock' || up.isEstimated);
  const linkCls = 'inline-flex items-center gap-0.5 text-sm font-medium text-[#0071e3] hover:underline focus:outline-none focus-visible:ring-1 focus-visible:ring-[#0071e3]';
  if (isEstimated) {
    return (
      <div data-export-ignore="true" className="flex flex-wrap items-center gap-x-3 text-sm text-zinc-500 dark:text-zinc-400">
        <span className="text-xs text-zinc-500 dark:text-zinc-400">在庫を探す:</span>
        <a href={toMoshimoUrl(u.rakutenSearchUrl, 'rakuten')} target="_blank" rel="noopener noreferrer sponsored" className={linkCls}>
          楽天市場 <ExternalLink className="h-3.5 w-3.5" />
        </a>
        <a href={toMoshimoUrl(u.yahooSearchUrl, 'yahoo')} target="_blank" rel="noopener noreferrer sponsored" className={linkCls}>
          Yahoo! <ExternalLink className="h-3.5 w-3.5" />
        </a>
        {u.amazonSearchUrl && (
          <a href={toMoshimoUrl(u.amazonSearchUrl, 'amazon')} target="_blank" rel="noopener noreferrer sponsored" className={linkCls}>
            Amazon <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
        <button type="button" onClick={onOpen} className={linkCls}>
          {loading ? '取得中…' : 'ショップ一覧'} <ExternalLink className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-x-3 text-sm text-zinc-600 dark:text-zinc-300">
      <span className="tabular-nums">
        中古最安 <strong className="font-semibold text-zinc-900 dark:text-zinc-100">{yen(up.lowestPrice)}</strong>
      </span>
      <button type="button" data-export-ignore="true" onClick={onOpen} className={linkCls}>
        ショップ一覧 <ExternalLink className="h-3.5 w-3.5" />
      </button>
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

export const CompareView = React.memo(function CompareView({
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
    // モーダルを開くたびに /api/used-price（エッジキャッシュ10分）からリアルタイム出品リストを取得
    triggerLiveOffersFetch(p, sku, true);
  };

  // 全カテゴリ・全項目を最初から展開表示。全機種で値が無い行は自動非表示、差分ONの時は差分行のみ残し、空のカテゴリ見出しも非表示
  const allSpecSections = useMemo(
    () =>
      SPEC_GROUPS.map((g) => ({
        id: g.id,
        title: g.title,
        rows: evaluateSpecRows(cols, g.rows).filter((r) => !r.allEmpty),
      })),
    [cols],
  );
  const specSections = useMemo(
    () =>
      allSpecSections
        .map((sec) => ({ ...sec, rows: diffOnly ? sec.rows.filter((r) => r.hasDiff) : sec.rows }))
        .filter((sec) => sec.rows.length > 0),
    [allSpecSections, diffOnly],
  );
  const totalDiffSpecCount = useMemo(
    () => allSpecSections.reduce((n, sec) => n + sec.rows.filter((r) => r.hasDiff).length, 0),
    [allSpecSections],
  );

  const isSimpleView =
    !showFlags.tradein && !diffOnly;
  const isFullDetailView =
    showFlags.tradein;
  const toggleShowFlag = (key: CompareShowKey) => {
    setShowFlags((prev) => ({ ...prev, [key]: !prev[key] }));
  };
  const applySimpleView = () => {
    setDiffOnly(false);
    setSpecExpanded(false);
    setShowFlags({ ...DEFAULT_SHOW_FLAGS });
  };
  const applyFullDetailView = () => {
    setSpecExpanded(true);
    setShowFlags({ tradein: true });
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
    const bgColor = dark ? '#16171a' : '#f5f5f7';
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
    { key: 'tradein', icon: '🔄', label: '下取り・追い金計算' },
  ];

  return (
    <div className="space-y-5 sm:space-y-6">
      <div className={`${card} p-5 sm:p-6`}>
        <SectionTitle icon={<Scale className="h-5 w-5" />} title="スペック＆キャリア価格 比較" desc="機種を追加し、容量・通信方式を選んで横並び比較。最安キャリアを自動ハイライトします。" />
        <div className="flex flex-col gap-3.5 sm:flex-row sm:flex-wrap sm:items-center">
          <Segmented<Mode> value={mode} onChange={setMode} options={[{ value: 'bulk', label: '一括価格モード' }, { value: 'return', label: '2年返却（実質）モード' }]} />
          <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
            <input type="checkbox" checked={mnp} onChange={(e) => setMnp(e.target.checked)} className="h-4 w-4 accent-zinc-700 dark:accent-zinc-300" />MNP/新規割引を適用
          </label>
          <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
            {/* 画像出力コントロール群（範囲選択 ＋ PNG保存 ＋ クリップボードコピー） */}
            <div className="inline-flex flex-wrap items-center gap-1.5 rounded-xl bg-[#f5f5f7] p-1 dark:bg-[#23252b]">
              <select
                value={imageScope}
                onChange={(e) => setImageScope(e.target.value as ImageExportScope)}
                aria-label="画像キャプチャ範囲を選択"
                className="rounded-lg border-0 bg-transparent py-1.5 pl-2.5 pr-1.5 text-xs font-medium text-zinc-600 focus:outline-none focus:ring-1 focus:ring-zinc-400 dark:text-zinc-300"
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
                className={`${btnCls} !py-1.5 !px-3 !text-xs`}
                title={`選択範囲（${IMAGE_EXPORT_SCOPE_LABELS[imageScope]}）を高解像度PNG画像として保存`}
              >
                <span>{exportingKind === 'download' ? '⏳ 画像生成中...' : '📷 画像として保存 (PNG)'}</span>
              </button>
              <button
                type="button"
                disabled={!cols.length || exportingKind !== null}
                onClick={doCopyImage}
                className={`${btnCls} !py-1.5 !px-3 !text-xs ${
                  imageCopied
                    ? '!bg-[#e3efe7] !text-[#2f573d] dark:!bg-[#22352b] dark:!text-[#9bc4a8]'
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
                  ? '!bg-zinc-200/80 dark:!bg-zinc-700'
                  : ''
              }`}
            >
              {urlCopied ? (
                <>
                  <Check className="h-4 w-4 shrink-0 text-[#3d6b4e] dark:text-[#88b396]" />
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
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {cols.map((c) => (
            <span key={c.sel.pid} className="inline-flex items-center gap-1.5 rounded-full bg-zinc-100 py-1.5 pl-3.5 pr-2 text-xs sm:text-sm font-medium text-zinc-800 dark:bg-[#25272e] dark:text-zinc-100">
              <CatIcon cat={c.p.category} className="h-3.5 w-3.5 shrink-0" />{c.p.name}
              <button aria-label="削除" onClick={() => setSels(sels.filter((s) => s.pid !== c.sel.pid))} className="rounded-full p-1 hover:bg-zinc-300/80 dark:hover:bg-zinc-700"><X className="h-3.5 w-3.5" /></button>
            </span>
          ))}
          {available.length > 0 && (
            <div className="grid w-full grid-cols-2 gap-2 sm:w-auto sm:inline-flex sm:flex-wrap sm:items-center sm:gap-2">
              <select className={`${selectCls} w-full sm:w-auto`} value={catF} onChange={(e) => setCatF(e.target.value)} aria-label="カテゴリ絞り込み">
                <option value="">全カテゴリ</option>{allCats.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <span className="relative w-full sm:w-auto"><Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-zinc-400" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="機種名・識別子で検索" className={`${selectCls} w-full sm:w-48 pl-9`} /></span>
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
        <div className="mt-4 flex flex-col gap-2.5 border-t border-zinc-200/50 pt-3.5 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between dark:border-white/[0.05]">
          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-1 text-xs font-semibold text-zinc-500 dark:text-zinc-400">
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
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition ${
                    active
                      ? 'bg-zinc-800 text-zinc-100 shadow-sm dark:bg-zinc-200 dark:text-zinc-900'
                      : 'bg-[#f5f5f7] text-zinc-600 hover:bg-zinc-200/70 hover:text-zinc-900 dark:bg-[#25272e] dark:text-zinc-400 dark:hover:bg-[#2d3039] dark:hover:text-zinc-200'
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
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition ${
                diffOnly
                  ? 'bg-zinc-800 text-zinc-100 shadow-sm dark:bg-zinc-200 dark:text-zinc-900'
                  : 'bg-[#f5f5f7] text-zinc-600 hover:bg-zinc-200/70 hover:text-zinc-900 dark:bg-[#25272e] dark:text-zinc-400 dark:hover:bg-[#2d3039] dark:hover:text-zinc-200'
              }`}
            >
              <span aria-hidden="true">🔍</span>
              <span>差分のみ表示</span>
            </button>
          </div>
          <div className="flex items-center gap-2 self-end sm:self-auto">
            <button
              type="button"
              onClick={applySimpleView}
              disabled={isSimpleView}
              className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition ${
                isSimpleView
                  ? 'bg-zinc-100 text-zinc-400 cursor-default dark:bg-[#23252b] dark:text-zinc-500'
                  : 'bg-[#f5f5f7] text-zinc-600 hover:bg-zinc-200/70 hover:text-zinc-900 dark:bg-[#25272e] dark:text-zinc-300 dark:hover:bg-[#2d3039] dark:hover:text-zinc-100'
              }`}
            >
              シンプル表示（初期）
            </button>
            <button
              type="button"
              onClick={applyFullDetailView}
              disabled={isFullDetailView}
              className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition ${
                isFullDetailView
                  ? 'bg-zinc-100 text-zinc-400 cursor-default dark:bg-[#23252b] dark:text-zinc-500'
                  : 'bg-[#f5f5f7] text-zinc-600 hover:bg-zinc-200/70 hover:text-zinc-900 dark:bg-[#25272e] dark:text-zinc-300 dark:hover:bg-[#2d3039] dark:hover:text-zinc-100'
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
              ? 'space-y-5 rounded-2xl bg-[#f5f5f7] p-6 text-zinc-900 dark:bg-[#16171a] dark:text-zinc-100'
              : 'space-y-5 sm:space-y-6'
          }
        >
          {/* 画像出力時のみ最上部に表示される図解スライド用タイトル＆条件ヘッダー */}
          {isExporting && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200/60 pb-4 dark:border-white/[0.06]">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-base font-extrabold tracking-tight text-zinc-900 dark:text-zinc-100">
                  <span>📊 Apple製品 スペック＆価格比較（{formatCurrentYearMonthLabel()}）</span>
                </div>
                <div className="mt-1 text-xs font-medium text-zinc-500 dark:text-zinc-400">
                  {cols.map((c) => `${c.p.name} (${c.sku.label})`).join('  vs  ')}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
                <span className="rounded-md bg-zinc-200/70 px-2.5 py-1 text-zinc-800 dark:bg-[#25272e] dark:text-zinc-100">
                  {mode === 'bulk' ? '一括価格モード' : '2年返却（実質負担）モード'}
                </span>
                <span className="rounded-md bg-zinc-200/70 px-2.5 py-1 text-zinc-700 dark:bg-[#25272e] dark:text-zinc-200">
                  {mnp ? 'MNP/新規割引 適用' : '割引なし（通常価格）'}
                </span>
                {diffOnly && activeExportScope !== 'cards' && (
                  <span className="rounded-md bg-zinc-200/70 px-2.5 py-1 text-zinc-700 dark:bg-[#25272e] dark:text-zinc-200">
                    🔍 差分スペックのみ抜粋
                  </span>
                )}
              </div>
            </div>
          )}

          {/* サマリーカード＆自動診断セクション（「比較テーブルのみ」出力時は非表示） */}
          <div
            data-export-ignore={activeExportScope === 'table' ? 'true' : undefined}
            className={activeExportScope === 'table' ? 'hidden' : 'space-y-5'}
          >

            <div
              className={
                isExporting
                  ? `grid gap-4 ${
                      cols.length === 1
                        ? 'grid-cols-1'
                        : cols.length === 2
                          ? 'grid-cols-2'
                          : cols.length === 3
                            ? 'grid-cols-3'
                            : 'grid-cols-4'
                    }`
                  : 'grid gap-4 sm:grid-cols-2 lg:grid-cols-3'
              }
            >
              {cols.map((c) => {
                const ch = cheapest(c);
                const apple = carrierValue(c.sku.carriers.apple, mode, mnp);
                const usedInfo = getUsedData(c);
                const { appleNewPrice, bestReturnCost } = getCardTradeInProps(c);
                const discInfo = getSkuDiscontinuedInfo(c.p, c.sku);
                const isDisc = discInfo.isDiscontinued;
                return (
                  <div key={c.sel.pid} className={`${card} flex flex-col justify-between p-5 sm:p-6`}>
                    <div>
                      {/* 機種名・容量選択（終売機は控えめな「販売終了・最終価格」ラベル） */}
                      <div className="flex items-center justify-between gap-2.5">
                        <div className="flex min-w-0 flex-col">
                          <div className="flex min-w-0 items-center gap-2">
                            <CatIcon cat={c.p.category} className="h-4 w-4 shrink-0 text-zinc-400" />
                            <span className="truncate text-base font-semibold text-zinc-900 dark:text-zinc-100 sm:text-lg">{c.p.name}</span>
                          </div>
                          {isDisc && (
                            <span
                              className="mt-0.5 pl-6 text-xs text-zinc-500 dark:text-zinc-400"
                              title={discInfo.discontinuedDate ? `終売: ${discInfo.discontinuedDate}` : 'Apple Store / キャリア販売終了'}
                            >
                              販売終了・最終価格
                            </span>
                          )}
                        </div>
                        {isExporting ? (
                          <span className="shrink-0 text-sm font-medium text-zinc-700 dark:text-zinc-200">{c.sku.label}</span>
                        ) : (
                          <select
                            data-export-ignore="true"
                            className={`${selectCls} shrink-0 !px-2.5 !py-1.5 !text-xs`}
                            value={c.sku.id}
                            aria-label={`${c.p.name} の容量・通信方式`}
                            onChange={(e) => setSels(sels.map((s) => (s.pid === c.sel.pid ? { ...s, sid: e.target.value } : s)))}
                          >
                            {[...c.p.skus].sort(compareSkus).map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
                          </select>
                        )}
                      </div>

                      {/* メイン価格 */}
                      {ch.min == null ? (
                        (() => {
                          const cellSku = findSiblingCellularSku(c.p, c.sku);
                          const bulkPrice = c.sku.carriers.apple?.currentPrice;
                          return (
                            <div className="mt-4 text-sm text-zinc-500 dark:text-zinc-400">
                              {cellSku
                                ? 'このモードでは対象外（Cellularモデルのみ取扱）'
                                : bulkPrice != null
                                  ? `対象外（一括購入のみ ${yen(bulkPrice)}）`
                                  : 'このモードで購入可能な窓口がありません'}
                              {!isExporting && cellSku && (
                                <button
                                  type="button"
                                  data-export-ignore="true"
                                  onClick={() => setSels(sels.map((s) => (s.pid === c.sel.pid ? { ...s, sid: cellSku.id } : s)))}
                                  className="ml-2 font-medium text-[#0071e3] hover:underline"
                                >
                                  {cellSku.connectivity} に切替
                                </button>
                              )}
                            </div>
                          );
                        })()
                      ) : (
                        <div className="mt-4">
                          <div className={`text-2xl font-semibold tabular-nums sm:text-3xl ${isDisc ? 'text-zinc-700 dark:text-zinc-200' : 'text-zinc-900 dark:text-zinc-100'}`}>
                            {yen(ch.min)}
                          </div>
                          {apple != null && !ch.ids.includes('apple') && (
                            <div className="mt-1 text-sm tabular-nums text-[#3d6b4e] dark:text-[#88b396]">
                              Apple Store比 {signedYen(ch.min - apple)}
                            </div>
                          )}
                        </div>
                      )}

                      {/* 下取り選択時のみ実質追い金 */}
                      {showFlags.tradein && tradeInEst && (
                        <div className="mt-4">
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

                    {/* 中古最安値の1行サマリー */}
                    <div className="mt-5 border-t border-zinc-200/60 pt-3 dark:border-white/[0.06]">
                      <UsedOneLine
                        u={usedInfo}
                        loading={loadingModalKey === `${c.p.id}__${c.sku.id}`}
                        onOpen={() => openShopComparisonModal(c.p, c.sku)}
                      />
                    </div>
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
                <div className={`${card} overflow-hidden`}>
                  <div className="bg-[#f5f5f7] px-4 py-2.5 text-xs font-bold text-zinc-700 dark:bg-[#23252b] dark:text-zinc-200">
                    🔄 買い替え実質追い金 ＆ 進化点（{tradeInEst.myProduct.name} {tradeInEst.mySku.label} 下取り −{yen(tradeInEst.activeYen)}）
                  </div>
                  <div className="space-y-3 p-4">
                    {cols.map((c) => {
                      const u = getUsedData(c);
                      const { appleNewPrice, bestReturnCost } = getCardTradeInProps(c);
                      return (
                        <div key={c.sel.pid}>
                          <div className="mb-1.5 text-xs font-bold text-zinc-900 dark:text-zinc-100">
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
              <div className={`${card} divide-y divide-zinc-200/40 overflow-hidden dark:divide-white/[0.04]`}>
                <div className="bg-[#f5f5f7] px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-zinc-500 dark:bg-[#23252b]">
                  キャリア別価格 — {mode === 'bulk' ? '一括' : '2年返却 実質負担額'}{mnp ? ' (MNP/新規割引後)' : ''}
                </div>
                {CARRIER_ORDER.map((id) => (
                  <div key={id} className="p-4">
                    <div className="mb-3"><CarrierBadge id={id} /></div>
                    <div className="divide-y divide-zinc-200/60 dark:divide-white/[0.06]">
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
                            className={`py-3 text-sm ${isMin ? 'font-medium' : ''}`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-bold text-zinc-900 dark:text-zinc-100">
                                {c.p.name} <span className="font-normal text-zinc-500">({c.sku.label})</span>
                              </span>
                              {v == null ? (
                                (() => {
                                  const unavail = getCarrierUnavailableInfo(c.p, c.sku, id, mode, mnp);
                                  return (
                                    <div className="flex flex-col items-end gap-1 text-right">
                                      <span className="inline-flex items-center rounded-md bg-zinc-200/60 px-2 py-0.5 text-xs text-zinc-500 dark:bg-[#25272e] dark:text-zinc-400">
                                        {unavail.badge}
                                      </span>
                                      {unavail.refPrice != null && (
                                        <div className="flex flex-wrap items-center justify-end gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                                          <span className="rounded bg-zinc-200/70 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:bg-[#25272e] dark:text-zinc-300">
                                            {unavail.refLabel}:{' '}
                                            <strong className="font-bold tabular-nums">{yen(unavail.refPrice)}</strong>
                                          </span>
                                          {!isExporting && unavail.cellularSku && (
                                            <button
                                              type="button"
                                              data-export-ignore="true"
                                              onClick={() =>
                                                setSels(
                                                  sels.map((s) =>
                                                    s.pid === c.sel.pid ? { ...s, sid: unavail.cellularSku!.id } : s,
                                                  ),
                                                )
                                              }
                                              className="text-xs font-semibold text-zinc-700 underline hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100"
                                            >
                                              Cellular版へ切替
                                            </button>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })()
                              ) : (
                                <span className="inline-flex flex-wrap items-center justify-end gap-1.5">
                                  {isDisc ? (
                                    <>
                                      {isMin && (
                                        <span className="inline-flex items-center gap-1 rounded-md bg-zinc-200/80 px-2 py-0.5 text-xs font-medium text-zinc-700 dark:bg-[#25272e] dark:text-zinc-200">
                                          <span className="h-1.5 w-1.5 rounded-full bg-zinc-500 dark:bg-zinc-400" />
                                          終売最安
                                        </span>
                                      )}
                                      <span className="rounded-md bg-zinc-200/70 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:bg-[#25272e] dark:text-zinc-300">
                                        最終価格
                                      </span>
                                    </>
                                  ) : (
                                    isMin && (
                                      <span className="inline-flex items-center gap-1 rounded-md bg-[#e3efe7] px-2 py-0.5 text-xs font-semibold text-[#2f573d] dark:bg-[#22352b] dark:text-[#9bc4a8]">
                                        <span className="h-1.5 w-1.5 rounded-full bg-[#649274]" />
                                        最安
                                      </span>
                                    )
                                  )}
                                  <span
                                    className={`text-base font-extrabold tabular-nums ${
                                      isDisc ? 'text-zinc-700 dark:text-zinc-200' : 'text-zinc-900 dark:text-zinc-100'
                                    }`}
                                  >
                                    {yen(v)}
                                  </span>
                                </span>
                              )}
                            </div>
                            {v != null && cp && (() => {
                              const parts = carrierSubParts(cp, mode, mnp);
                              return parts.length > 0 ? (
                                <div className="mt-1 text-xs tabular-nums text-zinc-500 dark:text-zinc-400">{parts.join(' ｜ ')}</div>
                              ) : null;
                            })()}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>

              {/* スマホ縦並び: 中古最安値（1行サマリー） */}
              <div className={`${card} divide-y divide-zinc-200/60 overflow-hidden dark:divide-white/[0.06]`}>
                <div className="bg-[#f5f5f7] px-4 py-2.5 text-xs font-semibold text-zinc-500 dark:bg-[#23252b]">中古最安</div>
                {cols.map((c) => (
                  <div key={c.sel.pid} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                    <span className="font-medium text-zinc-900 dark:text-zinc-100">
                      {c.p.name} <span className="font-normal text-zinc-500">({c.sku.label})</span>
                    </span>
                    <UsedOneLine
                      u={getUsedData(c)}
                      loading={loadingModalKey === `${c.p.id}__${c.sku.id}`}
                      onOpen={() => openShopComparisonModal(c.p, c.sku)}
                    />
                  </div>
                ))}
              </div>

              <div className={`${card} overflow-hidden`}>
                <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-4">
                  <div className="flex flex-col">
                    <span className="text-base font-semibold text-[#1d1d1f] dark:text-zinc-100">スペック比較</span>
                    <span className="text-sm text-[#6e6e73] dark:text-zinc-400">違いがある項目 {totalDiffSpecCount}件</span>
                  </div>
                  <button
                    type="button"
                    aria-pressed={diffOnly}
                    onClick={() => setDiffOnly((prev) => !prev)}
                    className={`inline-flex items-center rounded-full px-3.5 py-1.5 text-sm font-medium transition ${
                      diffOnly
                        ? 'bg-[#1d1d1f] text-white dark:bg-zinc-200 dark:text-zinc-900'
                        : 'bg-[#f5f5f7] text-[#1d1d1f] dark:bg-[#25272e] dark:text-zinc-200'
                    }`}
                  >
                    差分のみ表示
                  </button>
                </div>
                {specSections.length === 0 ? (
                  <div className="p-5 text-center text-sm text-[#6e6e73] dark:text-zinc-400">
                    <span>{cols.length < 2 ? '1機種のみ選択中のため、違いのあるスペック項目はありません' : '選択中のモデル間で異なるスペック項目はありません'}</span>{' '}
                    <button type="button" onClick={() => setDiffOnly(false)} className="font-medium text-[#0071e3] hover:underline">
                      （すべて表示に戻す）
                    </button>
                  </div>
                ) : (
                  specSections.map((sec) => (
                    <div key={sec.id}>
                      <div className="bg-[#f5f5f7] px-4 pb-3 pt-6 text-sm font-semibold text-[#1d1d1f] dark:bg-[#23252b] dark:text-zinc-100">{sec.title}</div>
                      <div className="divide-y divide-[#e5e5ea] dark:divide-white/[0.06]">
                        {sec.rows.map((er) => (
                          <div key={er.row.key} className="px-4 py-3.5">
                            <div className={`mb-1.5 text-sm ${er.hasDiff ? 'font-semibold text-[#1d1d1f] dark:text-zinc-100' : 'text-[#6e6e73] dark:text-zinc-400'}`}>{er.row.label}</div>
                            <div className="space-y-1.5 text-sm leading-relaxed">
                              {cols.map((c, idx) => (
                                <div key={c.sel.pid} className="flex items-baseline justify-between gap-3">
                                  <span className="shrink-0 text-[#6e6e73] dark:text-zinc-400">{c.p.name}</span>
                                  <span className={`break-words text-right ${er.hasDiff ? 'font-medium text-[#1d1d1f] dark:text-zinc-100' : 'text-[#6e6e73] dark:text-zinc-400'}`}>{er.values[idx]}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))
                )}
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
                  : `${card} overflow-x-auto lg:overflow-x-clip ${mobileView === 'stack' ? 'hidden sm:block' : 'block'}`
            }
          >
            <table
              ref={tableElRef}
              className="w-full min-w-[440px] sm:min-w-[720px] border-collapse text-xs sm:text-sm"
            >
              <thead>
                <tr className="border-b border-zinc-200/50 dark:border-white/[0.05]">
                  <th
                    className={`${
                      isExporting ? '' : 'sticky left-0 top-[var(--app-header-h,0px)] z-30 backdrop-blur-md'
                    } w-28 sm:w-40 bg-white/90 px-4 py-3.5 sm:px-5 sm:py-4 text-left text-xs font-semibold text-zinc-500 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.06)] dark:bg-[#1c1d22]/90 dark:text-zinc-400`}
                  >
                    項目
                  </th>
                  {cols.map((c) => {
                    const discInfo = getSkuDiscontinuedInfo(c.p, c.sku);
                    return (
                      <th key={c.sel.pid} className={`${isExporting ? '' : 'sticky top-[var(--app-header-h,0px)] z-20 bg-white/90 backdrop-blur-md dark:bg-[#1c1d22]/90'} min-w-[170px] sm:min-w-[230px] px-4 py-3.5 sm:px-5 sm:py-4 text-left align-top`}>
                        <div className="flex flex-wrap items-center gap-1.5 text-sm sm:text-base font-bold text-zinc-900 dark:text-zinc-100">
                          <CatIcon cat={c.p.category} className="h-4 w-4 shrink-0" />
                          <span>{c.p.name}</span>
                        </div>
                        <div className="mt-1 mb-2 flex flex-wrap items-center gap-1.5 text-xs font-normal text-zinc-500 dark:text-zinc-400">
                          <span>{c.p.generation} ・ {c.p.releaseDate} 発売</span>
                          {discInfo.isDiscontinued ? (
                            <span className="inline-flex items-center gap-1 rounded-md bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:bg-[#25272e] dark:text-zinc-300">
                              <span className="h-1.5 w-1.5 rounded-full bg-zinc-500 dark:bg-zinc-400" />
                              終売・最終価格{discInfo.discontinuedDate ? ` (${discInfo.discontinuedDate})` : ''}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-md bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:bg-[#25272e] dark:text-zinc-300">
                              <span className="h-1.5 w-1.5 rounded-full bg-[#649274]" />
                              現行販売中
                            </span>
                          )}
                        </div>
                        {isExporting ? (
                          <div className="inline-flex items-center rounded-md bg-zinc-100 px-2.5 py-1 text-xs font-semibold text-zinc-800 dark:bg-[#25272e] dark:text-zinc-100">
                            容量・仕様: {c.sku.label}
                          </div>
                        ) : (
                          <>
                            <select
                              data-export-ignore="true"
                              className={`${selectCls} w-full`}
                              value={c.sku.id}
                              onChange={(e) => setSels(sels.map((s) => (s.pid === c.sel.pid ? { ...s, sid: e.target.value } : s)))}
                            >
                              {c.p.skus.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
                            </select>
                            {(() => {
                              const connOpts = getProductConnectivityOptions(c.p);
                              if (connOpts.length < 2) return null;
                              return (
                                <div
                                  data-export-ignore="true"
                                  role="group"
                                  aria-label={`${c.p.name} の通信方式切り替え`}
                                  className="mt-2 flex items-center justify-between gap-1.5 rounded-lg bg-[#f5f5f7] p-1 text-xs font-normal dark:bg-[#23252b]"
                                >
                                  <span className="pl-2 text-xs font-medium text-zinc-500 dark:text-zinc-400">
                                    通信
                                  </span>
                                  <div className="flex items-center gap-1">
                                    {connOpts.map((conn) => {
                                      const active = c.sku.connectivity === conn;
                                      const targetSku = findSiblingSkuByConnectivity(c.p, c.sku, conn);
                                      return (
                                        <button
                                          key={conn}
                                          type="button"
                                          disabled={!targetSku}
                                          onClick={() => {
                                            if (targetSku) {
                                              setSels(
                                                sels.map((s) =>
                                                  s.pid === c.sel.pid ? { ...s, sid: targetSku.id } : s,
                                                ),
                                              );
                                            }
                                          }}
                                          className={`rounded-md px-2 py-0.5 text-xs font-semibold transition ${
                                            active
                                              ? 'bg-white text-zinc-900 shadow-sm dark:bg-[#1c1d22] dark:text-zinc-100'
                                              : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200'
                                          }`}
                                        >
                                          {conn}
                                        </button>
                                      );
                                    })}
                                  </div>
                                </div>
                              );
                            })()}
                          </>
                        )}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e5e5ea] dark:divide-white/[0.06]">
                {showFlags.tradein && tradeInEst && (
                  <>
                    <tr className="bg-[#f5f5f7]/80 dark:bg-[#23252b]/70">
                      <td colSpan={cols.length + 1} className="px-4 sm:px-5 py-2.5 text-xs font-bold text-zinc-600 dark:text-zinc-300">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span>
                            🔄 買い替え追い金（実質差額）＆スペック進化 — {tradeInEst.myProduct.name} ({tradeInEst.mySku.label}) 下取り差引: −{yen(tradeInEst.activeYen)}
                          </span>
                          <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                            {tradeInEst.sellModeLabel}
                          </span>
                        </div>
                      </td>
                    </tr>
                    <tr>
                      <td
                        className={`${
                          isExporting ? '' : 'sticky left-0 z-10'
                        } bg-white px-4 py-3.5 sm:px-5 sm:py-4 align-top shadow-[2px_0_5px_-2px_rgba(0,0,0,0.06)] dark:bg-[#1c1d22]`}
                      >
                        <div className="inline-flex items-center gap-1.5 text-xs font-bold text-zinc-700 dark:text-zinc-300">
                          <span aria-hidden="true">🔄</span>
                          実質追い金・進化点
                        </div>
                        <div className="mt-1 text-xs text-zinc-400">
                          {tradeInEst.myProduct.name} から乗換
                        </div>
                      </td>
                      {cols.map((c) => {
                        const u = getUsedData(c);
                        const { appleNewPrice, bestReturnCost } = getCardTradeInProps(c);
                        return (
                          <td key={c.sel.pid} className="px-4 py-3 sm:px-5 sm:py-3.5 align-top">
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
                <tr className="bg-[#f5f5f7]/80 dark:bg-[#23252b]/70"><td colSpan={cols.length + 1} className="px-4 sm:px-5 py-2.5 text-xs font-bold uppercase tracking-wider text-zinc-500">価格 — {mode === 'bulk' ? '一括' : '2年返却 実質負担額'}{mnp ? ' (MNP/新規割引後)' : ''}</td></tr>
                {CARRIER_ORDER.map((id) => (
                  <tr key={id}>
                    <td
                      className={`${
                        isExporting ? '' : 'sticky left-0 z-10'
                      } bg-white px-4 py-3.5 sm:px-5 sm:py-4 align-middle shadow-[2px_0_5px_-2px_rgba(0,0,0,0.06)] dark:bg-[#1c1d22]`}
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

                      const subParts: string[] = cp && v != null ? carrierSubParts(cp, mode, mnp) : [];


                      return (
                        <td
                          key={c.sel.pid}
                          className={`px-4 py-3.5 sm:px-5 sm:py-4 align-top transition-colors ${
                            isMin ? 'bg-[#eaf2ed]/45 dark:bg-[#1e2b24]/35' : ''
                          }`}
                        >
                          {v == null ? (
                            (() => {
                              const unavail = getCarrierUnavailableInfo(c.p, c.sku, id, mode, mnp);
                              return (
                                <div className="space-y-1.5">
                                  <span className="inline-flex items-center rounded-md bg-zinc-100 px-2.5 py-0.5 text-xs text-zinc-500 dark:bg-[#25272e] dark:text-zinc-400">
                                    {unavail.badge}
                                  </span>
                                  {unavail.refPrice != null && (
                                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                                      <span className="inline-flex items-center gap-1 rounded bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:bg-[#25272e] dark:text-zinc-300">
                                        <span>{unavail.refLabel}:</span>
                                        <strong className="font-bold tabular-nums text-zinc-700 dark:text-zinc-200">
                                          {yen(unavail.refPrice)}
                                        </strong>
                                      </span>
                                      {!isExporting && unavail.cellularSku && (
                                        <button
                                          type="button"
                                          data-export-ignore="true"
                                          onClick={() =>
                                            setSels(
                                              sels.map((s) =>
                                                s.pid === c.sel.pid ? { ...s, sid: unavail.cellularSku!.id } : s,
                                              ),
                                            )
                                          }
                                          className="text-xs font-semibold text-zinc-700 underline hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100"
                                        >
                                          Cellular版へ切替
                                        </button>
                                      )}
                                    </div>
                                  )}
                                </div>
                              );
                            })()
                          ) : (
                            <div className="space-y-1">
                              {/* 1行目: メイン価格 ＋ 月々目安(返却モード時) ＋ 最安ピル or 最安との差額 */}
                              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 whitespace-nowrap">
                                <span
                                  className={`text-sm sm:text-base font-extrabold tabular-nums ${
                                    isDisc
                                      ? 'text-zinc-700 dark:text-zinc-200'
                                      : 'text-zinc-900 dark:text-zinc-100'
                                  }`}
                                >
                                  {yen(v)}
                                </span>
                                {mode === 'return' && cp?.returnProgram && (
                                  <span className="text-xs font-normal tabular-nums text-zinc-500 dark:text-zinc-400">
                                    （月々約{yen(Math.round(v / (cp.returnProgram.months || 24)))}）
                                  </span>
                                )}
                                {isMin ? (
                                  <span className="inline-flex items-center gap-1 rounded bg-[#e3efe7] px-2 py-0.5 text-xs font-semibold text-[#2f573d] dark:bg-[#22352b] dark:text-[#9bc4a8]">
                                    <span
                                      className={`h-1.5 w-1.5 rounded-full ${
                                        isDisc ? 'bg-zinc-500' : 'bg-[#649274]'
                                      }`}
                                    />
                                    {isDisc ? '終売最安' : '最安'}
                                  </span>
                                ) : ch.min != null ? (
                                  <span className="text-xs font-medium tabular-nums text-zinc-400 dark:text-zinc-500">
                                    ({signedYen(v - ch.min)})
                                  </span>
                                ) : null}
                              </div>

                              {/* 2行目: 補足データ（MNP / 2年返却 / 通常一括 等を1行で凝縮） */}
                              {subParts.length > 0 && (
                                <div className="truncate text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
                                  {subParts.join(' ｜ ')}
                                </div>
                              )}

                            </div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                <tr>
                  <td
                    className={`${
                      isExporting ? '' : 'sticky left-0 z-10'
                    } bg-white px-4 py-3.5 sm:px-5 sm:py-4 align-middle text-sm font-medium text-zinc-600 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.06)] dark:bg-[#1c1d22] dark:text-zinc-300`}
                  >
                    中古最安
                  </td>
                  {cols.map((c) => (
                    <td key={c.sel.pid} className="px-4 py-3.5 sm:px-5 sm:py-4 align-middle">
                      <UsedOneLine
                        u={getUsedData(c)}
                        loading={loadingModalKey === `${c.p.id}__${c.sku.id}`}
                        onOpen={() => openShopComparisonModal(c.p, c.sku)}
                      />
                    </td>
                  ))}
                </tr>
                <tr className="bg-white dark:bg-[#1c1d22]">
                  <td colSpan={cols.length + 1} className="px-4 py-4 sm:px-5">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        <span className="text-base font-semibold text-[#1d1d1f] dark:text-zinc-100">スペック比較</span>
                        <span className="text-sm text-[#6e6e73] dark:text-zinc-400">
                          {specSections.reduce((n, sec) => n + sec.rows.length, 0)}項目 ／ 違いがある項目 {totalDiffSpecCount}件
                        </span>
                      </div>
                      {!isExporting && (
                        <button
                          type="button"
                          data-export-ignore="true"
                          aria-pressed={diffOnly}
                          onClick={() => setDiffOnly((prev) => !prev)}
                          className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium transition ${
                            diffOnly
                              ? 'bg-[#1d1d1f] text-white dark:bg-zinc-200 dark:text-zinc-900'
                              : 'bg-[#f5f5f7] text-[#1d1d1f] hover:bg-[#e5e5ea] dark:bg-[#25272e] dark:text-zinc-200 dark:hover:bg-[#2c2f37]'
                          }`}
                        >
                          差分のみ表示（同じ項目を隠す）
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
                {specSections.length === 0 ? (
                  <tr>
                    <td colSpan={cols.length + 1} className="p-6 text-center text-sm text-[#6e6e73] dark:text-zinc-400">
                      <span>{cols.length < 2 ? '1機種のみ選択中のため、違いのあるスペック項目はありません' : '選択中のモデル間で異なるスペック項目はありません'}</span>{' '}
                      <button type="button" onClick={() => setDiffOnly(false)} className="font-medium text-[#0071e3] hover:underline">
                        （すべて表示に戻す）
                      </button>
                    </td>
                  </tr>
                ) : (
                  specSections.map((sec) => (
                    <React.Fragment key={sec.id}>
                      <tr className="bg-[#f5f5f7] dark:bg-[#23252b]">
                        <td colSpan={cols.length + 1} className="px-4 pb-3 pt-7 text-sm font-semibold text-[#1d1d1f] dark:text-zinc-100 sm:px-5">
                          {sec.title}
                        </td>
                      </tr>
                      {sec.rows.map((er) => (
                        <tr key={er.row.key}>
                          <td
                            className={`${
                              isExporting ? '' : 'sticky left-0'
                            } bg-white px-4 py-3.5 text-sm shadow-[2px_0_5px_-2px_rgba(0,0,0,0.06)] dark:bg-[#1c1d22] sm:px-5 ${
                              er.hasDiff ? 'font-semibold text-[#1d1d1f] dark:text-zinc-100' : 'font-normal text-[#6e6e73] dark:text-zinc-400'
                            }`}
                          >
                            {er.row.label}
                          </td>
                          {cols.map((c, idx) => (
                            <td
                              key={c.sel.pid}
                              className={`break-words px-4 py-3.5 align-top text-sm leading-relaxed sm:px-5 ${
                                er.hasDiff ? 'font-medium text-[#1d1d1f] dark:text-zinc-100' : 'text-[#6e6e73] dark:text-zinc-400'
                              }`}
                            >
                              {er.values[idx]}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </React.Fragment>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* 画像出力時のみ最下部に表示される出典クレジット＆免責フッター */}
          {isExporting ? (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-200/60 pt-3.5 text-xs dark:border-white/[0.06]">
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                ※価格は税込の目安（キャリア返却プログラム・MNP割引・中古最安値を含む）。条件・時期により実際の金額は異なります。
              </span>
              <div className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-200/70 px-3 py-1 text-xs font-bold tracking-tight text-zinc-800 dark:bg-[#25272e] dark:text-zinc-100">
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
});

export default CompareView;
