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
  DETAIL_SPEC_ROWS,
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
  PRIMARY_SPEC_ROWS,
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
    <div className={`${card} px-5 py-3.5 sm:px-6 sm:py-4`}>
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#f5f5f7] text-xs text-zinc-700 dark:bg-[#23252b] dark:text-zinc-300">
            💡
          </span>
          <h3 className="text-xs sm:text-sm font-bold text-zinc-900 dark:text-zinc-100">
            この比較の結論・おすすめ購入ルート診断
          </h3>
          <span className="rounded-lg bg-[#f5f5f7] px-2 py-0.5 text-xs font-medium text-zinc-500 dark:bg-[#23252b] dark:text-zinc-400">
            {enriched.length}機種分析
          </span>
        </div>

        <div data-export-ignore="true" className="flex items-center gap-2 ml-auto">
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
        <div className="mt-3.5 grid grid-cols-1 gap-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
          {/* 1. 中古コスパ最適 */}
          <div className="rounded-xl bg-[#f5f5f7] p-3.5 dark:bg-[#23252b]">
            <div className="flex items-center justify-between gap-1.5">
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-zinc-500 dark:text-zinc-400">
                <span className="h-2 w-2 rounded-full bg-[#649274]" />
                中古コスパ最適
              </span>
              {bestUsedValue.bestUsedOffer && (
                <a
                  data-export-ignore="true"
                  href={bestUsedValue.bestUsedOffer.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-0.5 text-xs font-medium text-zinc-500 hover:text-zinc-900 hover:underline dark:text-zinc-400 dark:hover:text-zinc-100"
                >
                  <span>{bestUsedValue.usedInfo.isEstimated ? '在庫検索' : 'ショップ'}</span>
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
            <div className="mt-1.5 leading-relaxed text-zinc-700 dark:text-zinc-300">
              <strong className="font-bold text-zinc-900 dark:text-zinc-100">
                {bestUsedValue.p.name} ({bestUsedValue.sku.label})
              </strong>{' '}
              — {bestUsedValue.usedInfo.isEstimated ? '参考推定 約' : '最安 '}
              <strong className="font-bold tabular-nums text-zinc-900 dark:text-zinc-100">
                {yen(bestUsedValue.lowestUsed)}
              </strong>{' '}
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                （年あたり {yen(bestUsedValue.annualUsedCost)} / 残{bestUsedValue.score.remainingSupportYears}年）
              </span>
            </div>
          </div>

          {/* 2. 2年返却最安 */}
          <div className="rounded-xl bg-[#f5f5f7] p-3.5 dark:bg-[#23252b]">
            <div className="flex items-center justify-between gap-1.5">
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-zinc-500 dark:text-zinc-400">
                <span className="h-2 w-2 rounded-full bg-zinc-500" />
                2年返却最安
              </span>
              {bestReturnRoute?.bestCarrierReturn && (
                <div data-export-ignore="true" className="flex items-center gap-2">
                  {mode !== 'return' && (
                    <button
                      type="button"
                      onClick={() => setMode('return')}
                      className="text-xs font-medium text-zinc-500 underline hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                    >
                      返却表示へ
                    </button>
                  )}
                  <a
                    href={CARRIER_STORE_URLS[bestReturnRoute.bestCarrierReturn.cid]}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-0.5 text-xs font-medium text-zinc-500 hover:text-zinc-900 hover:underline dark:text-zinc-400 dark:hover:text-zinc-100"
                  >
                    <span>詳細</span>
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              )}
            </div>
            <div className="mt-1.5 leading-relaxed text-zinc-700 dark:text-zinc-300">
              {bestReturnRoute?.bestCarrierReturn ? (
                <>
                  <strong className="font-bold text-zinc-900 dark:text-zinc-100">
                    {bestReturnRoute.p.name} ({bestReturnRoute.sku.label})
                  </strong>{' '}
                  — {CARRIER_META[bestReturnRoute.bestCarrierReturn.cid].label} 実質{' '}
                  <strong className="font-bold tabular-nums text-zinc-900 dark:text-zinc-100">
                    {yen(bestReturnRoute.bestCarrierReturn.effectiveCost)}
                  </strong>{' '}
                  <span className="text-xs text-zinc-500 dark:text-zinc-400">
                    （月約{yen(Math.round(bestReturnRoute.bestCarrierReturn.effectiveCost / 24))}）
                  </span>
                </>
              ) : (
                <span className="text-zinc-500">対象プログラムなし（直販・中古推奨）</span>
              )}
            </div>
          </div>

          {/* 3. リセールNo.1 */}
          <div className="rounded-xl bg-[#f5f5f7] p-3.5 dark:bg-[#23252b]">
            <div className="flex items-center justify-between gap-1.5">
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-zinc-500 dark:text-zinc-400">
                <span className="h-2 w-2 rounded-full bg-[#649274]" />
                リセールNo.1
              </span>
              <a
                data-export-ignore="true"
                href={appleStoreUrlForCategory(bestResaleModel.p.category)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-0.5 text-xs font-medium text-zinc-500 hover:text-zinc-900 hover:underline dark:text-zinc-400 dark:hover:text-zinc-100"
              >
                <span>公式</span>
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
            <div className="mt-1.5 leading-relaxed text-zinc-700 dark:text-zinc-300">
              <strong className="font-bold text-zinc-900 dark:text-zinc-100">
                {bestResaleModel.p.name} ({bestResaleModel.sku.label})
              </strong>{' '}
              — 残価率{' '}
              <strong className="font-bold tabular-nums text-zinc-900 dark:text-zinc-100">
                {bestResaleModel.resalePct ?? '—'}%
              </strong>{' '}
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                （中古相場 {yen(bestResaleModel.lowestUsed)}）
              </span>
            </div>
          </div>

          {/* 4. 価格逆転注目 / 価格バランス */}
          <div className="rounded-xl bg-[#f5f5f7] p-3.5 dark:bg-[#23252b]">
            <div className="flex items-center justify-between gap-1.5">
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-zinc-500 dark:text-zinc-400">
                <span className="h-2 w-2 rounded-full bg-zinc-400" />
                {primaryAlert.label}
              </span>
              {primaryAlert.linkUrl && (
                <a
                  data-export-ignore="true"
                  href={primaryAlert.linkUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-0.5 text-xs font-medium text-zinc-500 hover:text-zinc-900 hover:underline dark:text-zinc-400 dark:hover:text-zinc-100"
                >
                  <span>詳細</span>
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
            <div className="mt-1.5 leading-relaxed text-zinc-700 dark:text-zinc-300">
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
    const bgColor = dark ? '#141518' : '#f5f5f7';
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
              ? 'space-y-5 rounded-2xl bg-[#f5f5f7] p-6 text-zinc-900 dark:bg-[#141518] dark:text-zinc-100'
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
                    className={`${card} flex flex-col justify-between p-5 sm:p-6`}
                  >
                    <div>
                      {/* 要素1: 機種名・容量セレクター（販売終了機種は機種名横に小さく控えめな販売終了バッジのみ） */}
                      <div className="flex items-center justify-between gap-2.5">
                        <div className="flex min-w-0 items-center gap-2">
                          <CatIcon cat={c.p.category} className="h-4 w-4 shrink-0 text-zinc-400" />
                          <span className="truncate text-base sm:text-lg font-bold text-zinc-900 dark:text-zinc-100">
                            {c.p.name}
                          </span>
                          {isDisc && (
                            <span
                              className="shrink-0 rounded-md bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-500 dark:bg-[#25272e] dark:text-zinc-400"
                              title={discInfo.discontinuedDate ? `終売: ${discInfo.discontinuedDate}` : 'Apple Store / キャリア販売終了'}
                            >
                              販売終了
                            </span>
                          )}
                        </div>
                        {isExporting ? (
                          <span className="shrink-0 rounded-md bg-zinc-100 px-2.5 py-1 text-xs font-semibold text-zinc-800 dark:bg-[#25272e] dark:text-zinc-100">
                            {c.sku.label}
                          </span>
                        ) : (
                          <select
                            data-export-ignore="true"
                            className={`${selectCls} shrink-0 !py-1.5 !px-2.5 !text-xs`}
                            value={c.sku.id}
                            aria-label={`${c.p.name} の容量・通信方式`}
                            onChange={(e) => setSels(sels.map((s) => (s.pid === c.sel.pid ? { ...s, sid: e.target.value } : s)))}
                          >
                            {[...c.p.skus].sort(compareSkus).map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
                          </select>
                        )}
                      </div>

                      {/* iPad / Apple Watch 用: 通信方式（Wi-Fi / Cellular または GPS / Cellular）1クリック切替トグル */}
                      {!isExporting && (() => {
                        const connOpts = getProductConnectivityOptions(c.p);
                        if (connOpts.length < 2) return null;
                        return (
                          <div
                            data-export-ignore="true"
                            role="group"
                            aria-label={`${c.p.name} の通信方式切り替え`}
                            className="mt-2.5 flex items-center justify-between gap-2 rounded-lg bg-[#f5f5f7] p-1 text-xs dark:bg-[#23252b]"
                          >
                            <span className="pl-2 text-xs font-medium text-zinc-500 dark:text-zinc-400">
                              通信方式
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
                                        setSels(sels.map((s) => (s.pid === c.sel.pid ? { ...s, sid: targetSku.id } : s)));
                                      }
                                    }}
                                    className={`rounded-md px-2.5 py-1 text-xs font-semibold transition ${
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

                      {/* 販売終了モデルの主役価格切替はショップ詳細表示ON時のみ補助表示 */}
                      {isDisc && isShopsOpen && (
                        <div
                          data-export-ignore="true"
                          role="group"
                          aria-label="販売終了モデルの主役価格切り替え"
                          className="mt-2.5 grid grid-cols-2 gap-1 rounded-lg bg-[#f5f5f7] p-1 text-xs font-medium dark:bg-[#23252b]"
                        >
                          <button
                            type="button"
                            onClick={() => setDiscontinuedHeroMode('archive')}
                            className={`rounded-md px-2.5 py-1 transition ${
                              discontinuedHeroMode === 'archive'
                                ? 'bg-white font-semibold text-zinc-900 shadow-sm dark:bg-[#1c1d22] dark:text-zinc-100'
                                : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200'
                            }`}
                          >
                            最終定価で比較
                          </button>
                          <button
                            type="button"
                            onClick={() => setDiscontinuedHeroMode('used')}
                            className={`rounded-md px-2.5 py-1 transition ${
                              discontinuedHeroMode === 'used'
                                ? 'bg-white font-semibold text-zinc-900 shadow-sm dark:bg-[#1c1d22] dark:text-zinc-100'
                                : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200'
                            }`}
                          >
                            現在の中古・未使用で比較
                          </button>
                        </div>
                      )}

                      {/* 要素2: メイン価格 */}
                      {isDisc && isShopsOpen && discontinuedHeroMode === 'used' ? (
                        <div className="mt-3">
                          <div className="flex flex-wrap items-baseline justify-between gap-2">
                            <div className="flex flex-wrap items-baseline gap-1.5">
                              <span className="text-xl sm:text-2xl font-extrabold tabular-nums text-zinc-900 dark:text-zinc-100">
                                {yen(usedInfo.usedPricing.lowestPrice)}
                              </span>
                              <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                                （現在の中古最安）
                              </span>
                            </div>
                            {usedInfo.unused && (
                              <span className="rounded-md bg-zinc-100 px-2 py-0.5 text-xs font-medium tabular-nums text-zinc-600 dark:bg-[#25272e] dark:text-zinc-300">
                                未使用: {yen(usedInfo.unused.price)}
                              </span>
                            )}
                          </div>
                          <div className="mt-1 text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
                            発売時 {yen(launchApplePrice ?? ch.min)} → 終売時最終 {yen(finalApplePrice ?? ch.min)}
                            {finalApplePrice != null && (
                              <span className="ml-1.5 font-medium text-zinc-600 dark:text-zinc-300">
                                （最終定価比 {signedYen(usedInfo.usedPricing.lowestPrice - finalApplePrice)}）
                              </span>
                            )}
                          </div>
                        </div>
                      ) : ch.min == null ? (
                        (() => {
                          const cellSku = findSiblingCellularSku(c.p, c.sku);
                          if (cellSku) {
                            const cellVals = CARRIER_ORDER.map((id) => ({
                              id,
                              v: carrierValue(cellSku.carriers[id], mode, mnp),
                            })).filter((x): x is { id: CarrierId; v: number } => x.v != null);
                            const cellMin = cellVals.length ? Math.min(...cellVals.map((x) => x.v)) : null;
                            const cellBestIds = cellMin != null ? cellVals.filter((x) => x.v === cellMin).map((x) => x.id) : [];
                            return (
                              <div className="mt-3 space-y-2">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <span className="inline-flex items-center rounded-md bg-zinc-100 px-2.5 py-1 text-xs text-zinc-500 dark:bg-[#25272e] dark:text-zinc-400">
                                    ー（Cellularモデルのみ取扱）
                                  </span>
                                  {!isExporting && (
                                    <button
                                      type="button"
                                      data-export-ignore="true"
                                      onClick={() =>
                                        setSels(sels.map((s) => (s.pid === c.sel.pid ? { ...s, sid: cellSku.id } : s)))
                                      }
                                      className="rounded-md bg-zinc-200/80 px-2.5 py-1 text-xs font-semibold text-zinc-800 transition hover:bg-zinc-300/80 dark:bg-[#25272e] dark:text-zinc-200 dark:hover:bg-[#2d3039]"
                                    >
                                      {cellSku.connectivity} に切替
                                    </button>
                                  )}
                                </div>
                                {cellMin != null && (
                                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[#f5f5f7] px-3 py-2 text-xs dark:bg-[#23252b]">
                                    <span className="text-zinc-500 dark:text-zinc-400">
                                      ※Cellular版の2年返却最安:{' '}
                                      <strong className="font-extrabold tabular-nums text-zinc-800 dark:text-zinc-100">
                                        {yen(cellMin)}
                                      </strong>
                                    </span>
                                    <div className="flex flex-wrap items-center gap-1">
                                      {cellBestIds.map((id) => (
                                        <CarrierBadge key={id} id={id} small />
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          }
                          const bulkPrice = c.sku.carriers.apple?.currentPrice;
                          return (
                            <div className="mt-3">
                              <span className="inline-flex items-center rounded-md bg-zinc-100 px-2.5 py-1 text-xs text-zinc-500 dark:bg-[#25272e] dark:text-zinc-400">
                                {bulkPrice != null
                                  ? `対象外（一括購入のみ：${yen(bulkPrice)}）`
                                  : 'このモードで購入可能な窓口がありません'}
                              </span>
                            </div>
                          );
                        })()
                      ) : isDisc ? (
                        <div className="mt-3 flex flex-wrap items-baseline justify-between gap-2">
                          <div>
                            <div className="text-xl sm:text-2xl font-extrabold tabular-nums text-zinc-700 dark:text-zinc-200">
                              {yen(ch.min)}
                            </div>
                            <div className="mt-1 text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
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
                        <div className="mt-3 flex flex-wrap items-baseline justify-between gap-2">
                          <div>
                            <div className="text-xl sm:text-2xl font-extrabold tabular-nums text-zinc-900 dark:text-zinc-100">{yen(ch.min)}</div>
                            {apple != null && !ch.ids.includes('apple') ? (
                              <div className="mt-1 text-xs font-medium text-[#3d6b4e] dark:text-[#88b396]">Apple Store比 {signedYen(ch.min - apple)}</div>
                            ) : launchApplePrice != null && finalApplePrice != null ? (
                              <div className="mt-1 text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
                                発売時 {yen(launchApplePrice)} → 現在 {yen(finalApplePrice)}
                              </div>
                            ) : null}
                          </div>
                          <div className="flex flex-wrap items-center gap-1">{ch.ids.map((id) => <CarrierBadge key={id} id={id} small />)}</div>
                        </div>
                      )}

                      {/* 💱 為替・Appleレート分析（ONの時のみ表示） */}
                      {showFlags.fx && c.sku.priceHistory.length > 0 && (
                        <div className="mt-3 border-t border-zinc-200/50 pt-3 dark:border-white/[0.05]">
                          <CompactCardFxLine pt={lastOf(c.sku.priceHistory)} />
                        </div>
                      )}

                      {/* 🔄 下取り・追い金計算（ONの時のみ表示） */}
                      {showFlags.tradein && tradeInEst && (
                        <div className="mt-3">
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
                        <div className="mt-3 border-t border-zinc-200/50 pt-3 dark:border-white/[0.05]">
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
                                  <span className="ml-1 text-xs text-zinc-500 dark:text-zinc-400">
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
                                    <span className="ml-1 text-xs text-zinc-500 dark:text-zinc-400">
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
                              className="inline-flex shrink-0 items-center gap-0.5 rounded px-1.5 py-0.5 text-xs text-zinc-400 transition hover:text-zinc-700 focus:outline-none focus-visible:ring-1 focus-visible:ring-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300"
                            >
                              <span>{isShopsOpen ? '閉じる' : '内訳'}</span>
                              {isShopsOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                            </button>
                          </div>

                          {!isEstimated && offerCount > 0 && (
                            <div data-export-ignore="true" className="mt-2.5">
                              <button
                                type="button"
                                onClick={() => openShopComparisonModal(c.p, c.sku)}
                                className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-[#f5f5f7] px-3 py-2 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-200/70 hover:text-zinc-900 focus:outline-none focus-visible:ring-1 focus-visible:ring-zinc-600 dark:bg-[#23252b] dark:text-zinc-200 dark:hover:bg-[#2c2f37]"
                              >
                                <span aria-hidden="true">🏪</span>
                                <span>中古ショップを安い順に見る ({offerCount}件)</span>
                              </button>
                            </div>
                          )}

                          {isShopsOpen && (
                            <div className="mt-2.5 space-y-2 border-t border-zinc-200/50 pt-2.5 text-xs dark:border-white/[0.05]">
                              {isEstimated ? (
                                <>
                                  <div className="flex flex-wrap items-center justify-between gap-1.5">
                                    <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300 tabular-nums">
                                      📊 参考推定相場: 約{yen(up.lowestPrice)}（実在庫データ未取得）
                                    </span>
                                    <ResaleBadge rate={up.resaleValuePercent} launchPrice={usedInfo.launchPrice} />
                                  </div>
                                  <div data-export-ignore="true" className="flex flex-col gap-1.5 pt-0.5">
                                    <a
                                      href={usedInfo.rakutenSearchUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="inline-flex items-center justify-between rounded-lg bg-[#f5f5f7] px-3 py-1.5 text-xs font-medium text-zinc-600 transition hover:bg-zinc-200/70 hover:text-zinc-900 focus:outline-none focus-visible:ring-1 focus-visible:ring-zinc-600 dark:bg-[#23252b] dark:text-zinc-300 dark:hover:bg-[#2c2f37] dark:hover:text-zinc-100"
                                    >
                                      <span>楽天市場で実際の在庫を検索</span>
                                      <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                                    </a>
                                    <a
                                      href={usedInfo.yahooSearchUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="inline-flex items-center justify-between rounded-lg bg-[#f5f5f7] px-3 py-1.5 text-xs font-medium text-zinc-600 transition hover:bg-zinc-200/70 hover:text-zinc-900 focus:outline-none focus-visible:ring-1 focus-visible:ring-zinc-600 dark:bg-[#23252b] dark:text-zinc-300 dark:hover:bg-[#2c2f37] dark:hover:text-zinc-100"
                                    >
                                      <span>Yahoo!で実際の在庫を検索</span>
                                      <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                                    </a>
                                  </div>
                                </>
                              ) : (
                                <>
                                  <div className="flex flex-wrap items-center justify-between gap-1.5">
                                    <span className="inline-flex flex-wrap items-center gap-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">
                                      <span className="inline-flex items-center gap-1.5 rounded-md bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-700 dark:bg-[#25272e] dark:text-zinc-300">
                                        <span
                                          className={`h-1.5 w-1.5 rounded-full ${
                                            isYahooLowest ? 'bg-[#ad8755]' : 'bg-[#a66c75]'
                                          }`}
                                        />
                                        {isYahooLowest ? 'Yahoo!最安' : '楽天最安'}
                                      </span>
                                      <TrustedShopBadge isTrusted={bestOffer?.isTrustedShop} compact />
                                    </span>
                                    <ResaleBadge rate={up.resaleValuePercent} launchPrice={usedInfo.launchPrice} />
                                  </div>
                                  <div className="space-y-1.5">
                                    {up.rakuten && (
                                      <div className="flex items-center justify-between gap-2">
                                        <span className="inline-flex min-w-0 items-center gap-1.5 truncate">
                                          <span className="inline-flex shrink-0 items-center gap-1 rounded bg-zinc-100 px-1.5 py-0.5 text-xs font-medium text-zinc-600 dark:bg-[#25272e] dark:text-zinc-300">
                                            <span className="h-1.5 w-1.5 rounded-full bg-[#a66c75]" />
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
                                      <div className="flex items-center justify-between gap-2">
                                        <span className="inline-flex min-w-0 items-center gap-1.5 truncate">
                                          <span className="inline-flex shrink-0 items-center gap-1 rounded bg-zinc-100 px-1.5 py-0.5 text-xs font-medium text-zinc-600 dark:bg-[#25272e] dark:text-zinc-300">
                                            <span className="h-1.5 w-1.5 rounded-full bg-[#ad8755]" />
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
                    <div className="space-y-2.5">
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
                            className={`rounded-xl p-3.5 text-xs ${
                              v == null
                                ? 'bg-[#f5f5f7]/70 dark:bg-[#23252b]/60'
                                : isDisc
                                  ? 'bg-[#f5f5f7]/90 dark:bg-[#23252b]/80'
                                  : isMin
                                    ? 'bg-[#eaf2ed]/60 dark:bg-[#1e2b24]/45'
                                    : 'bg-[#f5f5f7] dark:bg-[#23252b]'
                            }`}
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
                            {v != null && cp && (
                              <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-zinc-500 dark:text-zinc-400">
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
              <div className={`${card} overflow-hidden`}>
                <div className="bg-[#f5f5f7] px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-zinc-500 dark:bg-[#23252b]">
                  現在の中古相場（最安値）・リセールバリュー (楽天市場 ＆ Yahoo!ショッピング)
                </div>
                <div className="space-y-3 p-4">
                  {cols.map((c) => {
                    const u = getUsedData(c);
                    const up = u.usedPricing;
                    const isEstimated = Boolean(u.isEstimated || u.source === 'mock' || up.isEstimated);
                    const isYahooLowest = up.lowestPlatform === 'yahoo';
                    const isShopsOpen = openShopCards[c.sel.pid] ?? showFlags.shops;
                    const offerCount = (up.offers ?? u.offers ?? []).length;
                    return (
                      <div key={c.sel.pid} className="rounded-xl bg-[#f5f5f7] p-3.5 text-xs dark:bg-[#23252b]">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-bold text-zinc-900 dark:text-zinc-100">
                            {c.p.name} <span className="font-normal text-zinc-500">({c.sku.label})</span>
                          </span>
                          <ResaleBadge rate={up.resaleValuePercent} launchPrice={u.launchPrice} />
                        </div>
                        {isEstimated ? (
                          <div className="mt-2 space-y-2">
                            <div className="text-xs font-semibold tabular-nums text-zinc-800 dark:text-zinc-200">
                              📊 参考推定相場: 約{yen(up.lowestPrice)}（実在庫データ未取得）
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <a
                                href={u.rakutenSearchUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-900 dark:bg-[#1c1d22] dark:text-zinc-300 dark:hover:bg-[#25272e]"
                              >
                                <span>楽天市場で実際の在庫を検索</span>
                                <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                              </a>
                              <a
                                href={u.yahooSearchUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-900 dark:bg-[#1c1d22] dark:text-zinc-300 dark:hover:bg-[#25272e]"
                              >
                                <span>Yahoo!で実際の在庫を検索</span>
                                <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                              </a>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div className="mt-2 flex flex-wrap items-baseline justify-between gap-2">
                              <div className="flex flex-wrap items-baseline gap-1.5">
                                <span className="text-xs text-zinc-500">横断最安:</span>
                                <span className="text-base font-extrabold tabular-nums text-zinc-900 dark:text-zinc-100">{yen(up.lowestPrice)}</span>
                                <span className="inline-flex items-center gap-1 rounded-md bg-zinc-200/70 px-2 py-0.5 text-xs font-medium text-zinc-700 dark:bg-[#25272e] dark:text-zinc-300">
                                  <span className={`h-1.5 w-1.5 rounded-full ${isYahooLowest ? 'bg-[#ad8755]' : 'bg-[#a66c75]'}`} />
                                  {isYahooLowest ? 'Yahoo!最安' : '楽天最安'}
                                </span>
                                {u.unused && (
                                  <span className="text-xs tabular-nums text-zinc-500">
                                    / 未使用: <strong className="font-bold text-zinc-800 dark:text-zinc-200">{yen(u.unused.price)}</strong>
                                  </span>
                                )}
                              </div>
                              {u.launchPrice && (
                                <span className="text-xs tabular-nums text-zinc-400">発売時直販 {yen(u.launchPrice)}</span>
                              )}
                            </div>
                            {offerCount > 0 && (
                              <div className="mt-2.5">
                                <button
                                  type="button"
                                  onClick={() => openShopComparisonModal(c.p, c.sku)}
                                  className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-white px-3 py-2 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-100 hover:text-zinc-900 focus:outline-none focus-visible:ring-1 focus-visible:ring-zinc-600 dark:bg-[#1c1d22] dark:text-zinc-200 dark:hover:bg-[#25272e]"
                                >
                                  <span aria-hidden="true">🏪</span>
                                  <span>中古ショップを安い順に見る ({offerCount}件)</span>
                                </button>
                              </div>
                            )}
                            {isShopsOpen && (
                              <div className="mt-2.5 space-y-1.5 border-t border-zinc-200/50 pt-2 text-xs dark:border-white/[0.05]">
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
                <div className={`${card} overflow-hidden`}>
                  <div className="bg-[#f5f5f7] px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-zinc-500 dark:bg-[#23252b]">
                    為替レート比較（当時の市場レート vs Apple適用レート・割安判定）
                  </div>
                  <div className="space-y-3 p-4">
                    {cols.map((c) => {
                      const launchPt = c.sku.priceHistory[0];
                      const curPt = c.sku.priceHistory.length ? lastOf(c.sku.priceHistory) : undefined;
                      return (
                        <div key={c.sel.pid} className="space-y-2 rounded-xl bg-[#f5f5f7] p-3.5 text-xs dark:bg-[#23252b]">
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
                              <div className="text-xs font-semibold text-zinc-500">発売時 ({launchPt.date}):</div>
                              <FxRatePairChip pt={launchPt} compact />
                            </div>
                          )}
                          {curPt && curPt !== launchPt && (
                            <div className="space-y-1 pt-0.5">
                              <div className="text-xs font-semibold text-zinc-500">最新/終売時 ({curPt.date}):</div>
                              <FxRatePairChip pt={curPt} compact />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className={`${card} divide-y divide-zinc-200/40 overflow-hidden dark:divide-white/[0.04]`}>
                <div className="flex flex-wrap items-center justify-between gap-2 bg-[#f5f5f7] px-4 py-3 dark:bg-[#23252b]">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold uppercase tracking-wider text-zinc-600 dark:text-zinc-300">
                      スペック比較
                    </span>
                    <span className="inline-flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                      <span className="h-1.5 w-1.5 rounded-full bg-zinc-600 dark:bg-zinc-300" />
                      違いあり ({totalDiffSpecCount})
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      aria-pressed={diffOnly}
                      onClick={() => setDiffOnly((prev) => !prev)}
                      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition ${
                        diffOnly
                          ? 'bg-zinc-800 text-zinc-100 dark:bg-zinc-200 dark:text-zinc-900'
                          : 'bg-white text-zinc-600 hover:bg-zinc-100 dark:bg-[#1c1d22] dark:text-zinc-300'
                      }`}
                    >
                      <span aria-hidden="true">🔍</span>
                      <span>差分のみ表示</span>
                    </button>
                    <div
                      role="group"
                      aria-label="スペック表示範囲"
                      className="inline-flex rounded-lg bg-zinc-200/70 p-0.5 text-xs font-medium dark:bg-[#1c1d22]"
                    >
                      <button
                        type="button"
                        onClick={() => setSpecExpanded(false)}
                        className={`rounded-md px-2.5 py-1 transition ${
                          !specExpanded
                            ? 'bg-white font-semibold text-zinc-900 shadow-sm dark:bg-[#25272e] dark:text-zinc-100'
                            : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400'
                        }`}
                      >
                        主要項目のみ
                      </button>
                      <button
                        type="button"
                        onClick={() => setSpecExpanded(true)}
                        className={`rounded-md px-2.5 py-1 transition ${
                          specExpanded
                            ? 'bg-white font-semibold text-zinc-900 shadow-sm dark:bg-[#25272e] dark:text-zinc-100'
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
                      className="font-semibold text-zinc-800 underline underline-offset-2 hover:text-zinc-950 dark:text-zinc-200 dark:hover:text-zinc-100"
                    >
                      （すべて表示に戻す）
                    </button>
                  </div>
                ) : (
                  displayedSpecRows.map((er) => (
                    <div key={er.row.key} className="p-4">
                      <div className="mb-2 flex items-center gap-1.5 text-xs">
                        {er.hasDiff ? (
                          <>
                            <span
                              className="h-1.5 w-1.5 shrink-0 rounded-full bg-zinc-700 dark:bg-zinc-300"
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
                            className="flex items-baseline justify-between gap-3 rounded-lg bg-[#f5f5f7] px-3 py-2 dark:bg-[#23252b]"
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
                  className="flex w-full items-center justify-center gap-1.5 bg-[#f5f5f7] px-4 py-3 text-xs font-semibold text-zinc-600 transition hover:bg-zinc-200/70 hover:text-zinc-900 dark:bg-[#23252b] dark:text-zinc-300 dark:hover:bg-[#2c2f37] dark:hover:text-zinc-100"
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
                <tr className="border-b border-zinc-200/50 dark:border-white/[0.05]">
                  <th
                    className={`${
                      isExporting ? '' : 'sticky left-0 z-10'
                    } w-28 sm:w-40 bg-white px-4 py-3.5 sm:px-5 sm:py-4 text-left text-xs font-semibold text-zinc-500 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.06)] dark:bg-[#1c1d22] dark:text-zinc-400`}
                  >
                    項目
                  </th>
                  {cols.map((c) => {
                    const discInfo = getSkuDiscontinuedInfo(c.p, c.sku);
                    return (
                      <th key={c.sel.pid} className="min-w-[170px] sm:min-w-[230px] px-4 py-3.5 sm:px-5 sm:py-4 text-left align-top">
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
              <tbody className="divide-y divide-zinc-200/40 dark:divide-white/[0.04]">
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

                              {/* 3行目: 発売時と現在価格が異なる場合のみ小さく表示 */}
                              {hasLaunchDiff && cp && subParts[0] !== `発売時 ${yen(cp.launchPrice)}` && (
                                <div className="text-xs tabular-nums text-zinc-400 dark:text-zinc-500">
                                  発売時 {yen(cp.launchPrice)}
                                </div>
                              )}

                              {/* Apple Store行の為替1行コンパクト表示（為替トグルON時のみ） */}
                              {fxEval && fxEval.status !== 'none' && fxEval.pctDiff != null && (
                                <div className="truncate whitespace-nowrap text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
                                  為替:{' '}
                                  <span
                                    className={
                                      fxEval.status === 'bargain'
                                        ? 'font-semibold text-[#3d6b4e] dark:text-[#88b396]'
                                        : fxEval.status === 'expensive'
                                          ? 'font-semibold text-zinc-700 dark:text-zinc-300'
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
                <tr className="bg-[#f5f5f7]/80 dark:bg-[#23252b]/70">
                  <td colSpan={cols.length + 1} className="px-4 sm:px-5 py-2.5 text-xs font-bold uppercase tracking-wider text-zinc-500">
                    中古相場・資産価値 — 楽天市場 ＆ Yahoo!ショッピング 横断比較
                  </td>
                </tr>
                <tr>
                  <td
                    className={`${
                      isExporting ? '' : 'sticky left-0 z-10'
                    } bg-white px-4 py-3.5 sm:px-5 sm:py-4 align-top shadow-[2px_0_5px_-2px_rgba(0,0,0,0.06)] dark:bg-[#1c1d22]`}
                  >
                    <div className="inline-flex items-center gap-1.5 text-xs font-bold text-zinc-700 dark:text-zinc-200">
                      <ShoppingBag className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
                      現在の中古相場
                    </div>
                    <div className="mt-1 text-xs text-zinc-400">楽天・Yahoo!横断比較</div>
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
                      <td key={c.sel.pid} className="px-4 py-3.5 sm:px-5 sm:py-4 align-top">
                        <div className="space-y-1.5">
                          {/* 1行目: ステータスバッジ + メイン価格 + リセール率バッジを横1行で揃え段落ちを防止 */}
                          <div className="flex flex-wrap items-baseline gap-2 whitespace-nowrap">
                            <span className="text-sm sm:text-base font-extrabold tabular-nums text-zinc-900 dark:text-zinc-100">
                              {isEstimated ? `約${yen(up.lowestPrice)}` : yen(up.lowestPrice)}
                            </span>
                            {up.resaleValuePercent != null && (
                              <span
                                className="inline-flex items-center gap-1 rounded bg-zinc-100 px-2 py-0.5 text-xs font-medium tabular-nums text-zinc-700 dark:bg-[#25272e] dark:text-zinc-300"
                                title={
                                  u.launchPrice
                                    ? `発売時定価 ${yen(u.launchPrice)} に対する残価率`
                                    : undefined
                                }
                              >
                                <span
                                  className={`h-1.5 w-1.5 rounded-full ${
                                    up.resaleValuePercent >= 70
                                      ? 'bg-[#649274]'
                                      : 'bg-zinc-400 dark:bg-zinc-500'
                                  }`}
                                />
                                リセール {up.resaleValuePercent}%
                              </span>
                            )}
                            {isEstimated ? (
                              <span className="inline-flex items-center rounded bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-500 dark:bg-[#25272e] dark:text-zinc-400">
                                参考推定相場
                              </span>
                            ) : (
                              <>
                                <span className="inline-flex items-center gap-1 rounded bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-700 dark:bg-[#25272e] dark:text-zinc-300">
                                  <span
                                    className={`h-1.5 w-1.5 rounded-full ${
                                      isYahooLowest ? 'bg-[#ad8755]' : 'bg-[#a66c75]'
                                    }`}
                                  />
                                  {isYahooLowest ? 'Yahoo!最安' : '楽天最安'}
                                </span>
                                <TrustedShopBadge isTrusted={bestOffer?.isTrustedShop} compact />
                              </>
                            )}
                          </div>

                          {/* 2行目: 未使用品目安 ｜ 発売時定価 */}
                          {metaLineParts.length > 0 && (
                            <div className="truncate text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
                              {metaLineParts.join(' ｜ ')}
                            </div>
                          )}

                          {/* 3行目: アクションリンク / ボタン */}
                          {isEstimated ? (
                            <div data-export-ignore="true" className="flex flex-wrap items-center gap-2 pt-0.5">
                              <a
                                href={u.rakutenSearchUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 rounded-md bg-[#f5f5f7] px-2.5 py-1 text-xs font-medium text-zinc-600 transition hover:bg-zinc-200/70 hover:text-zinc-900 focus:outline-none focus-visible:ring-1 focus-visible:ring-zinc-600 dark:bg-[#23252b] dark:text-zinc-300 dark:hover:bg-[#2c2f37] dark:hover:text-zinc-100"
                              >
                                <span>楽天市場で実際の在庫を検索</span>
                                <ExternalLink className="h-3 w-3 shrink-0" />
                              </a>
                              <a
                                href={u.yahooSearchUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 rounded-md bg-[#f5f5f7] px-2.5 py-1 text-xs font-medium text-zinc-600 transition hover:bg-zinc-200/70 hover:text-zinc-900 focus:outline-none focus-visible:ring-1 focus-visible:ring-zinc-600 dark:bg-[#23252b] dark:text-zinc-300 dark:hover:bg-[#2c2f37] dark:hover:text-zinc-100"
                              >
                                <span>Yahoo!で実際の在庫を検索</span>
                                <ExternalLink className="h-3 w-3 shrink-0" />
                              </a>
                            </div>
                          ) : (
                            <>
                              <div data-export-ignore="true" className="flex flex-wrap items-center gap-2 pt-0.5">
                                {offerCount > 0 && (
                                  <button
                                    type="button"
                                    onClick={() => openShopComparisonModal(c.p, c.sku)}
                                    className="inline-flex items-center gap-1 rounded-md bg-[#f5f5f7] px-2.5 py-1 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-200/70 hover:text-zinc-900 focus:outline-none focus-visible:ring-1 focus-visible:ring-zinc-600 dark:bg-[#23252b] dark:text-zinc-200 dark:hover:bg-[#2c2f37]"
                                  >
                                    <span aria-hidden="true">🏪</span>
                                    <span>ショップ比較 ({offerCount}件)</span>
                                  </button>
                                )}
                                {!isShopsOpen && (
                                  <button
                                    type="button"
                                    onClick={() => setOpenShopCards((prev) => ({ ...prev, [c.sel.pid]: true }))}
                                    className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-xs font-medium text-zinc-500 hover:text-zinc-900 focus:outline-none focus-visible:ring-1 focus-visible:ring-zinc-600 dark:text-zinc-400 dark:hover:text-zinc-100"
                                  >
                                    <span>内訳</span>
                                    <ChevronDown className="h-3 w-3" />
                                  </button>
                                )}
                              </div>

                              {isShopsOpen && (
                                <div className="space-y-1 pt-1 text-xs">
                                  {up.rakuten && (
                                    <div className="flex items-center justify-between gap-2">
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
                                        商品 <ExternalLink className="h-3 w-3" />
                                      </a>
                                    </div>
                                  )}
                                  {up.yahoo && (
                                    <div className="flex items-center justify-between gap-2">
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
                                        商品 <ExternalLink className="h-3 w-3" />
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
                    <tr className="bg-[#f5f5f7]/80 dark:bg-[#23252b]/70">
                      <td colSpan={cols.length + 1} className="px-4 sm:px-5 py-2.5 text-xs font-bold uppercase tracking-wider text-zinc-500">
                        為替レート比較 — 当時の市場レート（Frankfurter API） vs Apple適用レート（税抜円÷USD） ＆ 今の為替から見た割安・割高判定
                      </td>
                    </tr>
                    <tr>
                      <td
                        className={`${
                          isExporting ? '' : 'sticky left-0 z-10'
                        } bg-white px-4 py-3.5 sm:px-5 sm:py-4 align-top text-xs font-semibold text-zinc-500 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.06)] dark:bg-[#1c1d22] dark:text-zinc-400`}
                      >
                        <div>今の為替レート判定</div>
                        <div className="mt-1 text-xs font-normal text-zinc-400">現在レート理論価格(税込10%)比</div>
                      </td>
                      {cols.map((c) => {
                        const curPt = c.sku.priceHistory.length ? lastOf(c.sku.priceHistory) : undefined;
                        return (
                          <td key={c.sel.pid} className="px-4 py-3.5 sm:px-5 sm:py-4 align-top">
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
                    <tr>
                      <td
                        className={`${
                          isExporting ? '' : 'sticky left-0 z-10'
                        } bg-white px-4 py-3.5 sm:px-5 sm:py-4 align-top text-xs font-semibold text-zinc-500 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.06)] dark:bg-[#1c1d22] dark:text-zinc-400`}
                      >
                        <div>当時の市場レート vs Apple適用レート</div>
                        <div className="mt-1 text-xs font-normal text-zinc-400">発売時 ／ 最新改定時</div>
                      </td>
                      {cols.map((c) => {
                        const launchPt = c.sku.priceHistory[0];
                        const curPt = c.sku.priceHistory.length ? lastOf(c.sku.priceHistory) : undefined;
                        return (
                          <td key={c.sel.pid} className="px-4 py-3.5 sm:px-5 sm:py-4 align-top">
                            {launchPt ? (
                              <div className="space-y-2">
                                <div>
                                  <div className="mb-1 text-xs font-semibold text-zinc-500">発売時 ({launchPt.date} / US ${launchPt.usdPrice ?? '—'}):</div>
                                  <FxRatePairChip pt={launchPt} />
                                </div>
                                {curPt && curPt !== launchPt && (
                                  <div>
                                    <div className="mb-1 text-xs font-semibold text-zinc-500">最新/終売時 ({curPt.date} / US ${curPt.usdPrice ?? '—'}):</div>
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
                <tr className="bg-[#f5f5f7]/80 dark:bg-[#23252b]/70">
                  <td colSpan={cols.length + 1} className="px-4 sm:px-5 py-2.5 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-bold uppercase tracking-wider text-zinc-600 dark:text-zinc-300">
                          スペック比較
                        </span>
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">
                          <span className="h-1.5 w-1.5 rounded-full bg-zinc-600 dark:bg-zinc-300" />
                          <span>違いがある項目 ({totalDiffSpecCount}件)</span>
                        </span>
                      </div>
                      {isExporting ? (
                        <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
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
                            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition ${
                              diffOnly
                                ? 'bg-zinc-800 text-zinc-100 shadow-sm dark:bg-zinc-200 dark:text-zinc-900'
                                : 'bg-white text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:bg-[#1c1d22] dark:text-zinc-300 dark:hover:bg-[#25272e]'
                            }`}
                          >
                            <span aria-hidden="true">🔍</span>
                            <span>差分のみ表示（同じ項目を隠す）</span>
                          </button>
                          <div className="inline-flex items-center gap-2">
                            <span className="hidden md:inline text-xs font-medium text-zinc-500 dark:text-zinc-400">
                              📋 スペック表示範囲:
                            </span>
                            <div
                              role="group"
                              aria-label="スペック表示範囲"
                              className="inline-flex rounded-lg bg-zinc-200/80 p-0.5 text-xs font-medium dark:bg-[#1c1d22]"
                            >
                              <button
                                type="button"
                                onClick={() => setSpecExpanded(false)}
                                className={`rounded-md px-2.5 py-1 transition ${
                                  !specExpanded
                                    ? 'bg-white font-semibold text-zinc-900 shadow-sm dark:bg-[#25272e] dark:text-zinc-100'
                                    : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200'
                                }`}
                              >
                                主要項目のみ（初期）
                              </button>
                              <button
                                type="button"
                                onClick={() => setSpecExpanded(true)}
                                className={`rounded-md px-2.5 py-1 transition ${
                                  specExpanded
                                    ? 'bg-white font-semibold text-zinc-900 shadow-sm dark:bg-[#25272e] dark:text-zinc-100'
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
                  <tr>
                    <td colSpan={cols.length + 1} className="p-5 text-center text-xs text-zinc-500 dark:text-zinc-400">
                      <span>
                        {cols.length < 2
                          ? '1機種のみ選択中のため、選択中のモデル間で異なるスペック項目はありません'
                          : '選択中のモデル間で異なるスペック項目はありません'}
                      </span>{' '}
                      <button
                        data-export-ignore="true"
                        type="button"
                        onClick={() => setDiffOnly(false)}
                        className="ml-1 font-semibold text-zinc-800 underline underline-offset-2 hover:text-zinc-950 dark:text-zinc-200 dark:hover:text-zinc-100"
                      >
                        （すべて表示に戻す）
                      </button>
                      {!specExpanded && visibleDetailRows.length > 0 && (
                        <button
                          data-export-ignore="true"
                          type="button"
                          onClick={() => setSpecExpanded(true)}
                          className="ml-2 font-semibold text-zinc-700 underline underline-offset-2 hover:text-zinc-950 dark:text-zinc-300 dark:hover:text-zinc-100"
                        >
                          （詳細スペックの差分 {visibleDetailRows.length}項目を表示）
                        </button>
                      )}
                    </td>
                  </tr>
                ) : (
                  displayedSpecRows.map((er) => (
                    <tr key={er.row.key}>
                      <td
                        className={`${
                          isExporting ? '' : 'sticky left-0'
                        } bg-white px-4 py-3.5 sm:px-5 sm:py-4 text-xs shadow-[2px_0_5px_-2px_rgba(0,0,0,0.06)] dark:bg-[#1c1d22] ${
                          er.hasDiff
                            ? 'font-semibold text-zinc-800 dark:text-zinc-200'
                            : 'font-normal text-zinc-500 dark:text-zinc-500'
                        }`}
                      >
                        <div className="inline-flex items-center gap-1.5">
                          {er.hasDiff ? (
                            <span
                              className="h-1.5 w-1.5 shrink-0 rounded-full bg-zinc-700 dark:bg-zinc-300"
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
                          className={`px-4 py-3.5 sm:px-5 sm:py-4 align-top ${
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
                      className="flex w-full items-center justify-center gap-1.5 bg-[#f5f5f7] px-4 py-3 text-xs font-semibold text-zinc-600 transition hover:bg-zinc-200/70 hover:text-zinc-900 dark:bg-[#23252b] dark:text-zinc-300 dark:hover:bg-[#2c2f37] dark:hover:text-zinc-100"
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
