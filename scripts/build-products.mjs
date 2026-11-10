// AppleDB の全商用モデル → public/products.json を生成するビルドスクリプト
//   curl -sSL -o data/cache/appledb-main.json https://api.appledb.dev/device/main.json
//   node scripts/build-products.mjs
// 処理: ① AppleDB (data/cache/appledb-main.json) から対象カテゴリの全モデルを製品ファミリー単位に集約 (internal 除外/未発売除外)
//       ② data/presets.mjs で基本スペック・発売時価格を補完
//       ③ data/catalog/*.json 内の detail メタデータで詳細スペック・SKUを上書き統合
//       ④ data/catalog/*.json (iphone / ipad / mac / watch / airpods) で SKU・価格改定履歴・キャリア価格を統合
//       ⑤ data/cache/live-prices-cache.json および data/cache/fx-cache.json を統合して public/products.json を出力
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { IPHONE, IPAD, WATCH, AIRPODS, MAC } from '../data/presets.mjs';
import { enrichAllProducts } from './spec-enrichment.mjs';
import {
  estimatePlatformOffers,
  buildUsedPricingObject,
  toRakutenAffiliateUrl,
  toYahooAffiliateUrl,
} from './fetch-live-prices.mjs';

const APPLEDB_PATH = 'data/cache/appledb-main.json';
if (!existsSync(APPLEDB_PATH)) {
  console.log(`[info] ${APPLEDB_PATH} が存在しないため api.appledb.dev から取得します...`);
  const res = await fetch('https://api.appledb.dev/device/main.json');
  if (!res.ok) {
    throw new Error(`Failed to fetch AppleDB main.json: HTTP ${res.status}`);
  }
  const text = await res.text();
  mkdirSync('data/cache', { recursive: true });
  writeFileSync(APPLEDB_PATH, text);
}
const db = JSON.parse(readFileSync(APPLEDB_PATH, 'utf8'));
const TODAY = new Date().toISOString().slice(0, 10);
const first = (v) => (Array.isArray(v) ? v[0] : v);
const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);

/* ---------- 為替(Frankfurter API + data/cache/fx-cache.json)・消費税 ---------- */
const FX = [['1998-08-15', 145.2], ['2000-07-01', 108.1], ['2003-06-01', 118.0], ['2005-01-01', 103.5], ['2007-06-01', 123], ['2008-07-01', 106], ['2009-07-01', 95], ['2010-06-01', 90], ['2011-06-01', 80], ['2012-06-01', 79], ['2013-06-01', 97], ['2014-06-01', 102],
  ['2015-06-01', 123], ['2016-06-01', 106], ['2017-06-01', 111], ['2018-06-01', 110], ['2019-06-01', 108], ['2020-06-01', 107], ['2021-06-01', 110], ['2022-03-01', 116],
  ['2022-07-01', 136], ['2022-10-01', 147], ['2023-06-01', 140], ['2024-01-01', 146], ['2024-07-01', 158], ['2025-01-01', 156], ['2025-09-01', 148], ['2026-06-01', 150], ['2026-11-06', 157.8]];
const round1 = (n) => Math.round(n * 10) / 10;
function fxAt(date) {
  const t = Date.parse(date);
  if (t <= Date.parse(FX[0][0])) return FX[0][1];
  for (let i = 1; i < FX.length; i++) {
    const [d1, r1] = FX[i - 1], [d2, r2] = FX[i];
    if (t <= Date.parse(d2)) return round1(r1 + ((r2 - r1) * (t - Date.parse(d1))) / (Date.parse(d2) - Date.parse(d1)));
  }
  return FX.at(-1)[1];
}
/**
 * 日付（YYYY-MM-DD）に応じて日本の消費税率を自動判定:
 * - 2019-10-01 以降：10% (jpy / 1.10)
 * - 2014-04-01 〜 2019-09-30：8% (jpy / 1.08)
 * - 1997-04-01 〜 2014-03-31：5% (jpy / 1.05)
 */
const taxAt = (date) => (date >= '2019-10-01' ? 0.10 : date >= '2014-04-01' ? 0.08 : date >= '1997-04-01' ? 0.05 : 0.03);

const FX_CACHE_FILE = 'data/cache/fx-cache.json';
let fxCache = { updatedAt: null, latestDate: null, latest: 152.8, rates: {} };
if (existsSync(FX_CACHE_FILE)) {
  try {
    const rawFx = JSON.parse(readFileSync(FX_CACHE_FILE, 'utf8'));
    if (rawFx && typeof rawFx === 'object') {
      fxCache = {
        updatedAt: rawFx.updatedAt ?? null,
        latestDate: rawFx.latestDate ?? null,
        latest: typeof rawFx.latest === 'number' ? rawFx.latest : 152.8,
        rates: rawFx.rates && typeof rawFx.rates === 'object' ? { ...rawFx.rates } : {},
      };
    }
  } catch (e) {
    console.warn(`[warn] ${FX_CACHE_FILE} の読み込みに失敗しました: ${e.message}`);
  }
}

async function fetchFrankfurterRate(dateOrLatest) {
  const url =
    dateOrLatest === 'latest'
      ? 'https://api.frankfurter.dev/v1/latest?base=USD&symbols=JPY'
      : `https://api.frankfurter.dev/v1/${dateOrLatest}?base=USD&symbols=JPY`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const data = await res.json();
  const rate = Number(data?.rates?.JPY);
  if (!Number.isFinite(rate) || rate <= 0) throw new Error(`Invalid JPY rate in response for ${url}`);
  return round1(rate);
}

async function ensureFxRatesCached(dates) {
  let dirty = false;
  let fetchedCount = 0;
  let cachedCount = 0;

  if (fxCache.latestDate !== TODAY || typeof fxCache.latest !== 'number') {
    try {
      const latestRate = await fetchFrankfurterRate('latest');
      fxCache.latest = latestRate;
      fxCache.latestDate = TODAY;
      dirty = true;
      fetchedCount++;
    } catch {
      if (typeof fxCache.latest !== 'number') {
        fxCache.latest = fxAt(TODAY);
      }
    }
  }

  const uncached = [...dates].filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && typeof fxCache.rates[d] !== 'number').sort();
  cachedCount = [...dates].filter((d) => typeof fxCache.rates[d] === 'number').length;

  const BATCH_SIZE = 8;
  for (let i = 0; i < uncached.length; i += BATCH_SIZE) {
    const batch = uncached.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map(async (d) => {
        if (d < '1999-01-04') {
          fxCache.rates[d] = fxAt(d);
          dirty = true;
          return;
        }
        try {
          const rate = await fetchFrankfurterRate(d);
          fxCache.rates[d] = rate;
          dirty = true;
          fetchedCount++;
        } catch {
          fxCache.rates[d] = fxAt(d);
          dirty = true;
        }
      }),
    );
  }

  if (dirty || !existsSync(FX_CACHE_FILE)) {
    fxCache.updatedAt = new Date().toISOString();
    const sortedRates = Object.fromEntries(Object.entries(fxCache.rates).sort(([a], [b]) => a.localeCompare(b)));
    fxCache.rates = sortedRates;
    mkdirSync('data/cache', { recursive: true });
    writeFileSync(
      FX_CACHE_FILE,
      JSON.stringify(
        {
          updatedAt: fxCache.updatedAt,
          latestDate: fxCache.latestDate ?? TODAY,
          latest: fxCache.latest,
          source: 'https://api.frankfurter.dev/v1/{YYYY-MM-DD}?base=USD&symbols=JPY',
          rates: fxCache.rates,
        },
        null,
        2,
      ) + '\n',
    );
  }
  return { fetchedCount, cachedCount, latest: fxCache.latest };
}

function getMarketUsdJpy(date) {
  const r = fxCache.rates?.[date];
  return typeof r === 'number' && Number.isFinite(r) ? round1(r) : fxAt(date);
}

function enrichPricePointWithFx(pt, latestUsdJpy) {
  const taxRate = taxAt(pt.date);
  const marketUsdJpy = getMarketUsdJpy(pt.date);
  const usd = typeof pt.usdPrice === 'number' && pt.usdPrice > 0 ? pt.usdPrice : undefined;
  const impliedAppleRate = usd ? round1(pt.appleStorePrice / (1 + taxRate) / usd) : undefined;
  const rateDiff = impliedAppleRate != null ? round1(impliedAppleRate - marketUsdJpy) : undefined;
  const currentFairJpy = usd ? Math.round(usd * latestUsdJpy * 1.10) : undefined;
  return {
    ...pt,
    exchangeRate: marketUsdJpy,
    taxRate,
    marketUsdJpy,
    ...(impliedAppleRate != null ? { impliedAppleRate } : {}),
    ...(rateDiff != null ? { rateDiff } : {}),
    ...(currentFairJpy != null ? { currentFairJpy } : {}),
  };
}

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
      if (!lr && !/AirPods Max/.test(n)) return null;
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
  if (!rel || rel > TODAY) continue;
  const c = classify(x);
  if (!c) continue;
  const key = `${c.cat}|${c.family}`;
  if (!groups.has(key)) groups.set(key, { ...c, devices: [], variants: [] });
  const g = groups.get(key);
  g.devices.push(x);
  g.variants.push({ conn: c.conn, size: c.size });
}

/* ---------- スペック構築 ---------- */
function macSocFallback(n, rel = '') {
  if (/PowerBook G4|iBook G4|Power Mac G4|iMac G4|eMac/.test(n) || (/Mac mini/.test(n) && rel < '2006-01-01')) return 'PowerPC G4 (7400 / 7450 / 7447A)';
  if (/Power Mac G5|iMac G5/.test(n)) return 'PowerPC G5 (970 / 970FX / 970MP)';
  if (/iBook|PowerBook G3|Power Mac G3|iMac/.test(n) && rel < '2002-01-01') return 'PowerPC G3 (750 / 750FX)';
  if (/iMac Pro/.test(n)) return 'Intel Xeon W (8〜18コア Skylake-W)';
  if (/Mac Pro/.test(n)) {
    if (rel >= '2019-01-01') return 'Intel Xeon W (8〜28コア Cascade Lake)';
    if (rel >= '2013-01-01') return 'Intel Xeon E5 v2 (4〜12コア Ivy Bridge-EP)';
    if (rel >= '2009-01-01') return 'Intel Xeon (Nehalem / Westmere 4〜12コア)';
    return 'Intel Xeon (Woodcrest / Harpertown 4〜8コア)';
  }
  if (/MacBook \(Retina, 12-inch/.test(n)) {
    if (/2017/.test(n)) return 'Intel Core m3 / i5 / i7 (第7世代 Kaby Lake)';
    if (/2016/.test(n)) return 'Intel Core m3 / m5 / m7 (第6世代 Skylake)';
    return 'Intel Core M (第5世代 Broadwell)';
  }
  if (rel < '2006-08-01') return 'Intel Core Duo (Yonah)';
  if (rel < '2009-10-01') return 'Intel Core 2 Duo (Merom / Penryn)';
  if (rel < '2011-01-01') {
    if (/MacBook Air|Mac mini|MacBook \(|13-inch/.test(n)) return 'Intel Core 2 Duo (Penryn)';
    return 'Intel Core i3 / i5 / i7 (第1世代 Nehalem / Arrandale)';
  }
  if (rel < '2012-06-01') return 'Intel Core i5 / i7 (第2世代 Sandy Bridge)';
  if (rel < '2013-06-01') return 'Intel Core i5 / i7 (第3世代 Ivy Bridge)';
  if (rel < '2015-03-01') return 'Intel Core i5 / i7 (第4世代 Haswell)';
  if (rel < '2016-10-01') return 'Intel Core i5 / i7 (第5世代 Broadwell / 第4世代 Haswell)';
  if (rel < '2017-06-01') return 'Intel Core i5 / i7 (第6世代 Skylake)';
  if (rel < '2018-07-01') return 'Intel Core i5 / i7 (第7世代 Kaby Lake)';
  if (rel < '2020-03-01') return 'Intel Core i5 / i7 / i9 (第8/9世代 Coffee Lake / Amber Lake)';
  return 'Intel Core i5 / i7 / i9 (第10世代 Ice Lake / Comet Lake)';
}

function macFallback(n, rel = '') {
  const mbp = (d, w, bat) => [d, null, w, 'Thunderbolt ×3 / HDMI / SDXC / MagSafe 3', bat, null, null, null];
  if (/^MacBook Pro.*14-inch.*(M[3-9]|Pro|Max)/.test(n) && /M\d/.test(n)) return mbp('14.2"', '1,600g', '70Wh (最大18〜22時間)');
  if (/^MacBook Pro.*16-inch.*(M[3-9]|Pro|Max)/.test(n) && /M\d/.test(n)) return mbp('16.2"', '2,140g', '100Wh (最大22〜24時間)');
  if (/^MacBook Pro 14-inch \(M/.test(n)) return mbp('14.2"', '1,550g', '72.4Wh (最大24時間)');
  if (/^MacBook Air \(13-inch, M[4-9]/.test(n)) return ['13.6"', '16GB', '1,240g', 'Thunderbolt/USB 4 ×2 + MagSafe 3', '53.8Wh (最大18時間)', null, null, null];
  if (/^MacBook Air \(15-inch, M[4-9]/.test(n)) return ['15.3"', '16GB', '1,510g', 'Thunderbolt/USB 4 ×2 + MagSafe 3', '66.5Wh (最大18時間)', null, null, null];
  if (/^Mac Studio/.test(n)) return ['—', null, /Ultra/.test(n) ? '3,640g' : '2,700g', 'Thunderbolt ×4-6 / USB-A ×2 / HDMI / 10Gb Ethernet', 'AC電源 (デスクトップ)', null, null, null];
  if (/^MacBook Pro \(13-inch, 2020/.test(n)) return ['13.3"', null, '1,400g', 'Thunderbolt 3 ×2-4', '58Wh (最大10時間)', null, null, null];
  if (/^MacBook Air \(Retina, 13-inch, 2020/.test(n)) return ['13.3"', null, '1,290g', 'Thunderbolt 3 ×2', '49.9Wh (最大11時間)', null, null, null];
  if (/^MacBook Pro \(16-inch, 2019/.test(n)) return ['16"', null, '2,000g', 'Thunderbolt 3 ×4', '100Wh (最大11時間)', null, null, null];
  if (/^iMac \(Retina 5K, 27-inch, 2020/.test(n)) return ['27" 5K', null, '8,920g', 'Thunderbolt 3 ×2 / USB-A ×4 / SDXC / Ethernet', 'AC電源 (デスクトップ)', null, null, null];

  if (/^MacBook \(Retina, 12-inch/.test(n)) return ['12" Retina (2304×1440)', '8GB', '920g', 'USB-C ×1 / 3.5mmジャック', '41.4Wh (最大10時間)', null, null, null];
  if (/^MacBook Air/.test(n)) {
    if (/Retina, 13-inch/.test(n)) return ['13.3" Retina (2560×1600)', '8GB', '1,250g', 'Thunderbolt 3 (USB-C) ×2', '49.9Wh (最大12時間)', null, null, null];
    if (/11-inch/.test(n)) return ['11.6" (1366×768)', rel >= '2012-01-01' ? '4GB' : '2GB', '1,080g', rel >= '2011-01-01' ? 'Thunderbolt / USB ×2 / MagSafe' : 'USB 2.0 ×2 / Mini DisplayPort / MagSafe', '35Wh〜38Wh (最大5〜9時間)', null, null, null];
    return ['13.3" (1440×900)', rel >= '2016-01-01' ? '8GB' : rel >= '2012-01-01' ? '4GB' : '2GB', '1,350g', rel >= '2011-01-01' ? 'Thunderbolt / USB ×2 / SDXC / MagSafe' : 'USB 2.0 / Micro-DVI or Mini DP / MagSafe', '50Wh〜54Wh (最大7〜12時間)', null, null, null];
  }
  if (/^MacBook Pro/.test(n)) {
    if (/13-inch/.test(n)) {
      if (rel >= '2016-10-01') return ['13.3" Retina (2560×1600)', '8GB', '1,370g', 'Thunderbolt 3 (USB-C) ×2〜4', '54.5Wh〜58.2Wh (最大10時間)', null, null, null];
      if (/Retina/.test(n)) return ['13.3" Retina (2560×1600)', '8GB', '1,580g', 'Thunderbolt 2 ×2 / USB 3 ×2 / HDMI / SDXC / MagSafe 2', '74Wh (最大9〜10時間)', null, null, null];
      return ['13.3" (1280×800)', rel >= '2011-01-01' ? '4GB' : '2GB', '2,040g', 'FireWire 800 / USB ×2 / SD / MagSafe / 光学ドライブ', '58Wh〜63.5Wh (最大7〜10時間)', null, null, null];
    }
    if (/15-inch/.test(n)) {
      if (rel >= '2016-10-01') return ['15.4" Retina (2880×1800)', '16GB', '1,830g', 'Thunderbolt 3 (USB-C) ×4', '76Wh〜83.6Wh (最大10時間)', null, null, null];
      if (/Retina/.test(n)) return ['15.4" Retina (2880×1800)', rel >= '2014-01-01' ? '16GB' : '8GB', '2,020g', 'Thunderbolt ×2 / USB 3 ×2 / HDMI / SDXC / MagSafe 2', '95Wh〜99.5Wh (最大8〜9時間)', null, null, null];
      return ['15.4" (1440×900)', rel >= '2010-01-01' ? '4GB' : '2GB', '2,540g', 'FireWire / USB ×2 / ExpressCard or SD / MagSafe / 光学ドライブ', '60Wh〜77.5Wh (最大5〜8時間)', null, null, null];
    }
    if (/17-inch/.test(n)) {
      return ['17" (1920×1200)', rel >= '2009-01-01' ? '4GB' : '2GB', '2,990g', 'FireWire 800 / USB 2.0 ×3 / ExpressCard/34 / MagSafe / 光学ドライブ', '68Wh〜95Wh (最大5〜8時間)', null, null, null];
    }
  }
  if (/^MacBook \(/.test(n)) {
    return ['13.3" (1280×800)', rel >= '2009-05-01' ? '2GB' : '1GB', '2,130g', 'USB 2.0 ×2 / Mini-DVI or Mini DP / MagSafe / 光学ドライブ', '55Wh〜63.5Wh (最大5〜10時間)', null, null, null];
  }
  if (/^PowerBook G4/.test(n)) {
    if (/12-inch/.test(n)) return ['12.1" (1024×768)', '256MB〜512MB', '2,100g', 'FireWire 400 / USB 2.0 ×2 / Mini-DVI / 光学ドライブ', '47Wh〜50Wh (最大5時間)', null, null, null];
    if (/17-inch/.test(n)) return ['17" (1440×900 / 1680×1050)', '512MB〜1GB', '3,100g', 'FireWire 400/800 / USB 2.0 ×2 / DVI / 光学ドライブ', '58Wh (最大4.5〜5.5時間)', null, null, null];
    return ['15.2" (1280×854 / 1440×960)', '256MB〜512MB', '2,500g', 'FireWire 400/800 / USB ×2 / DVI or VGA / 光学ドライブ', '50Wh〜55Wh (最大4.5〜5.5時間)', null, null, null];
  }
  if (/^iBook/.test(n)) {
    if (/14-inch/.test(n)) return ['14.1" (1024×768)', '256MB〜512MB', '2,700g', 'FireWire 400 / USB ×2 / 光学ドライブ', '61Wh (最大6時間)', null, null, null];
    return ['12.1" (800×600 / 1024×768)', '64MB〜512MB', '2,200g', 'FireWire 400 / USB ×1〜2 / 光学ドライブ', '45Wh〜50Wh (最大5〜6時間)', null, null, null];
  }

  if (/^iMac Pro/.test(n)) return ['27" Retina 5K (5120×2880)', '32GB', '9,700g', 'Thunderbolt 3 ×4 / USB-A ×4 / SDXC / 10Gb Ethernet', 'AC電源 (デスクトップ)', null, null, null];
  if (/^iMac/.test(n)) {
    if (/27-inch/.test(n)) {
      if (/5K/.test(n)) return ['27" Retina 5K (5120×2880)', '8GB', '9,440g', 'Thunderbolt 2/3 ×2 / USB-A ×4 / SDXC / Gigabit Ethernet', 'AC電源 (デスクトップ)', null, null, null];
      return ['27" (2560×1440)', rel >= '2012-01-01' ? '8GB' : '4GB', '9,540g〜13,800g', 'Thunderbolt or Mini DP / USB ×4 / SDXC / Gigabit Ethernet', 'AC電源 (デスクトップ)', null, null, null];
    }
    if (/21\.5-inch/.test(n)) {
      if (/4K/.test(n)) return ['21.5" Retina 4K (4096×2304)', '8GB', '5,600g', 'Thunderbolt 2/3 ×2 / USB-A ×4 / SDXC / Gigabit Ethernet', 'AC電源 (デスクトップ)', null, null, null];
      return ['21.5" (1920×1080)', rel >= '2012-01-01' ? '8GB' : '4GB', '5,680g〜9,300g', 'Thunderbolt or Mini DP / USB ×4 / SDXC / Gigabit Ethernet', 'AC電源 (デスクトップ)', null, null, null];
    }
    if (/24-inch/.test(n)) return ['24" (1920×1200)', rel >= '2009-01-01' ? '4GB' : '1GB〜2GB', '11,500g', 'FireWire 400/800 / USB 2.0 ×3〜4 / Mini-DVI or Mini DP / Ethernet', 'AC電源 (デスクトップ)', null, null, null];
    if (/20-inch/.test(n)) return ['20" (1680×1050)', rel >= '2008-01-01' ? '2GB' : '512MB〜1GB', '9,100g〜11,400g', 'FireWire 400 / USB 2.0 ×3 / Mini-DVI or VGA / Ethernet', 'AC電源 (デスクトップ)', null, null, null];
    if (/17-inch/.test(n)) return ['17" (1440×900)', '256MB〜1GB', '7,000g〜10,400g', 'FireWire 400 / USB 2.0 ×3 / Mini-DVI or VGA / Ethernet', 'AC電源 (デスクトップ)', null, null, null];
    return ['15" CRT (1024×768)', '32MB〜256MB', '15,800g', 'USB 1.1 ×2 / FireWire 400 (DVモデル) / Ethernet / 光学ドライブ', 'AC電源 (デスクトップ)', null, null, null];
  }
  if (/^eMac/.test(n)) return ['17" フラットCRT (1280×960)', '128MB〜512MB', '22,700g', 'FireWire 400 ×2 / USB ×3 / Ethernet / 光学ドライブ', 'AC電源 (デスクトップ)', null, null, null];
  if (/^Mac mini/.test(n)) {
    if (rel >= '2018-01-01') return ['—', '8GB', '1,300g', 'Thunderbolt 3 ×4 / USB-A ×2 / HDMI 2.0 / Gigabit Ethernet', 'AC電源 (デスクトップ)', null, null, null];
    if (rel >= '2010-01-01') return ['—', rel >= '2012-01-01' ? '4GB' : '2GB', '1,220g', 'Thunderbolt / HDMI / USB ×4 / FireWire 800 / SDXC / Ethernet', 'AC電源 (デスクトップ)', null, null, null];
    return ['—', rel >= '2009-01-01' ? '1GB〜2GB' : '512MB〜1GB', '1,310g', 'DVI / USB 2.0 ×4〜5 / FireWire 400/800 / Ethernet / 光学ドライブ', 'AC電源 (デスクトップ)', null, null, null];
  }
  if (/^Mac Pro/.test(n)) {
    if (rel >= '2019-01-01') return ['—', '32GB', '18,000g', 'Thunderbolt 3 ×4 / USB-A ×2 / 10Gb Ethernet ×2 / PCIe ×8', 'AC電源 (デスクトップ)', null, null, null];
    if (rel >= '2013-01-01') return ['—', '12GB〜16GB', '5,000g', 'Thunderbolt 2 ×6 / USB 3 ×4 / HDMI 1.4 / Dual Gigabit Ethernet', 'AC電源 (デスクトップ)', null, null, null];
    return ['—', rel >= '2009-01-01' ? '3GB〜6GB' : '1GB〜2GB', '18,100g〜19,200g', 'FireWire 800 ×4 / USB 2.0 ×5 / Dual Gigabit Ethernet / PCIe ×4', 'AC電源 (デスクトップ)', null, null, null];
  }
  if (/^Power Mac/.test(n)) return ['—', '64MB〜512MB', '13,600g〜20,200g', 'FireWire 400/800 / USB ×2〜3 / Gigabit Ethernet / PCI / AGP', 'AC電源 (デスクトップ)', null, null, null];
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
  const pre = PRESETS[g.cat]?.[g.family] ?? (g.cat === 'Mac' ? macFallback(g.family, rel) : undefined);
  const withInfo = devs.find((d) => d.info);
  const cores = withInfo ? info(withInfo, 'Cores') : {}, mem = withInfo ? info(withInfo, 'Memory') : {}, pow = withInfo ? info(withInfo, 'Power') : {}, con = withInfo ? info(withInfo, 'Connectivity') : {};
  const specs = {};
  const put = (k, v) => { if (v !== undefined && v !== null && v !== '') specs[k] = v; };

  const socRaw = devs.find((d) => d.soc)?.soc ?? (g.cat === 'Mac' ? macSocFallback(g.family, rel) : undefined);
  put('soc', socRaw ? (cores.CPU_Core_Count ? `${socRaw} (${cores.CPU_Core_Count}コアCPU${cores.GPU_Core_Count ? ` / ${cores.GPU_Core_Count}コアGPU` : ''}${cores.Neural_Engine_Core_Count ? ` / Neural Engine ${cores.Neural_Engine_Core_Count}コア` : ''})` : socRaw) : undefined);
  const inch = g.family.match(/(\d+(?:\.\d+)?)-inch/)?.[1];
  const disp = pre?.[0] ? (/インチ|"/.test(pre[0]) ? pre[0].replace('"', 'インチ').replace('インチ ', 'インチ ') : pre[0]) : inch ? `${inch}インチ` : undefined;
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
  return { id: slug(g.family), category: g.cat, name: g.family, generation: `${year}年発売${g.macType ? ` (${g.macType})` : ''}`, releaseDate: rel, specs, skus, detail: false, _family: g.family };
}

const products = [...groups.values()].map(buildProduct);
const ids = new Set();
products.forEach((p) => { let id = p.id, n = 2; while (ids.has(id)) id = `${p.id}-${n++}`; p.id = id; ids.add(id); });

/* ---------- ③ & ④ カタログデータ (data/catalog/*.json) から詳細メタデータ・価格履歴・キャリア価格を統合 ---------- */
const CATALOG_DIR = 'data/catalog';
const DETAIL_MATCH = { 'ipad-air-11-m2': 'iPad Air 11-inch (M2)', 'mba-13-m2': 'MacBook Air (M2, 2022)', 'ipad-10': 'iPad (10th generation)', 'watch-s10': 'Apple Watch Series 10' };
const report = [];
const storBytes = (s) => { const m = String(s).match(/([\d.]+)\s*(TB|GB|MB)/i); return m ? parseFloat(m[1]) * ({ TB: 1e6, GB: 1e3, MB: 1 }[m[2].toUpperCase()]) : 0; };
const skuLabel = (r) => [r.size, r.storage && r.storage !== '-' ? r.storage : '', r.connectivity && r.connectivity !== '-' ? r.connectivity : ''].filter(Boolean).join(' ') || '標準';
const EVENT_ALIAS = [
  [/^部材(コスト)?高騰に伴う価格改定（値上げ）$/, '部品コスト高騰に伴う価格改定（値上げ）'],
  [/^Apple ?Store ?(で )?SIM ?フリー(版)?販売開始$/, 'Apple Store で SIM フリー版販売開始'],
];
const normEvent = (e) => EVENT_ALIAS.reduce((s, [re, to]) => (re.test(s) ? to : s), String(e ?? '').trim());
const fillEnd = (hist) => {
  const hs = hist.filter((h) => /^\d{4}-\d{2}-\d{2}$/.test(h.date)).sort((a, b) => a.date.localeCompare(b.date));
  let last = null;
  let lastUsd = null;
  return hs.map((h) => {
    if (typeof h.usd === 'number' && h.usd > 0) lastUsd = h.usd;
    const withUsd = typeof h.usd === 'number' ? h : lastUsd != null ? { ...h, usd: lastUsd } : h;
    if (typeof withUsd.jpy === 'number') { last = withUsd.jpy; return withUsd; }
    if (/販売終了/.test(withUsd.event) && last != null) return { ...withUsd, jpy: last, confidence: withUsd.confidence === 'high' ? 'medium' : (withUsd.confidence ?? 'low'), note: [withUsd.note, '終了時価格不明のため直前価格を表示'].filter(Boolean).join(' / ') };
    return withUsd;
  });
};
const toPoints = (hist) => fillEnd(hist)
  .filter((h) => typeof h.jpy === 'number')
  .map((h) => ({
    date: h.date, event: normEvent(h.event), appleStorePrice: h.jpy,
    ...(typeof h.usd === 'number' ? { usdPrice: h.usd } : {}),
    exchangeRate: fxAt(h.date), taxRate: h.taxRate ?? taxAt(h.date),
    ...(h.confidence !== 'high' ? { approx: true } : {}),
    ...(h.confidence ? { confidence: h.confidence } : {}),
    ...(h.note ? { note: h.note } : {}), ...(h.source ? { source: h.source } : {}),
  }));

const priceStats = { families: 0, skus: 0, points: 0, unmatched: [] };
const catalogFiles = existsSync(CATALOG_DIR)
  ? readdirSync(CATALOG_DIR).filter((f) => f.endsWith('.json')).sort()
  : [];

// Step ③: カタログ内の detail メタデータをまず反映
for (const f of catalogFiles) {
  let ds;
  try { ds = JSON.parse(readFileSync(`${CATALOG_DIR}/${f}`, 'utf8')); } catch (e) { report.push(`✗ ${f}: JSON 解析失敗 ${e.message}`); continue; }
  for (const [fam, entry] of Object.entries(ds.families ?? {})) {
    const d = entry.detail;
    if (!d) continue;
    const idents = String(d.specs?.identifier ?? '').split(';').filter(Boolean);
    let idx = products.findIndex((p) => p._family === fam);
    if (idx < 0) idx = products.findIndex((p) => idents.length && String(p.specs.identifier ?? '').split(';').some((i) => idents.includes(i)));
    if (idx < 0 && DETAIL_MATCH[d.id]) idx = products.findIndex((p) => p.name === DETAIL_MATCH[d.id]);
    if (idx < 0) idx = products.findIndex((p) => p.name === d.name);
    if (idx >= 0) {
      const g = products[idx];
      products[idx] = { ...g, ...d, id: d.id, specs: { ...g.specs, ...d.specs }, skus: d.skus, detail: true, _family: g._family };
      report.push(`✓ 詳細統合 ${f}: ${d.name} ← ${g.name}`);
    } else {
      products.push({ ...d, detail: true, _family: fam });
      report.push(`＋ 詳細追加 ${f}: ${d.name} (AppleDB に対応なし)`);
    }
  }
}

// Step ④: カタログ内の価格履歴・carrierPricing を統合
for (const f of catalogFiles) {
  let ds;
  try { ds = JSON.parse(readFileSync(`${CATALOG_DIR}/${f}`, 'utf8')); } catch { continue; }
  for (const [fam, entry] of Object.entries(ds.families ?? {})) {
    const p = products.find((x) => x._family === fam) ?? products.find((x) => x.name === fam);
    if (!p) { priceStats.unmatched.push(`${f}:${fam}`); continue; }
    const rs = (entry.skus ?? []).filter((r) => Array.isArray(r.history));
    if (!rs.length) continue;
    priceStats.families++;
    const sorted = rs.slice().sort((a, b) => parseInt(a.size ?? 0) - parseInt(b.size ?? 0) || String(a.connectivity).localeCompare(String(b.connectivity)) || storBytes(a.storage) - storBytes(b.storage));
    const newSkus = sorted.map((r) => {
      const priceHistory = toPoints(r.history);
      priceStats.skus++; priceStats.points += priceHistory.length;
      const usdOnly = r.history.filter((h) => h.jpy == null && typeof h.usd === 'number');
      return {
        id: slug(`${r.size ?? ''}-${r.storage ?? ''}-${r.connectivity ?? ''}`) || 'base', label: skuLabel(r), storage: r.storage === '-' ? '' : (r.storage ?? ''),
        connectivity: r.connectivity ?? '-', priceHistory, carriers: {},
        ...(r.carrierPricing !== undefined ? { carrierPricing: r.carrierPricing } : {}),
        ...(usdOnly.length && !priceHistory.length ? { note: `日本 Apple Store 未販売。米国価格 $${usdOnly[0].usd}` } : {}),
      };
    });
    if (p.detail) {
      const matchDetailSku = (n, s) => {
        if (n.label && s.label && n.label === s.label) return true;
        const nNorm = String(n.label ?? '').replace(/\s+|SSD/gi, '').toUpperCase();
        const sNorm = String(s.label ?? '').replace(/\s+|SSD/gi, '').toUpperCase();
        if (nNorm && nNorm === sNorm) return true;
        const connMatch = n.connectivity === s.connectivity || n.connectivity === '-' || s.connectivity === '-';
        return Boolean(n.storage && s.storage && n.storage === s.storage && connMatch);
      };
      const merged = p.skus.map((s) => {
        const hit = newSkus.find((n) => matchDetailSku(n, s));
        if (!hit || !hit.priceHistory.length) return s;
        const ph = hit.priceHistory;
        const oldCur = s.priceHistory.at(-1)?.appleStorePrice, newCur = ph.at(-1).appleStorePrice;
        const k = oldCur ? newCur / oldCur : 1;
        const r10 = (n) => Math.round(n / 10) * 10;
        const carriers = Object.fromEntries(Object.entries(s.carriers).filter(([id]) => id !== 'apple').map(([id, c]) => {
          const cur = r10(c.currentPrice * k), disc = c.mnpPrice != null ? c.currentPrice - c.mnpPrice : null;
          const rp = c.returnProgram ? { ...c.returnProgram, effectiveCost: r10(c.returnProgram.effectiveCost * k), ...(c.returnProgram.residualValue != null ? { residualValue: r10(c.returnProgram.residualValue * k) } : {}) } : c.returnProgram;
          return [id, { ...c, currentPrice: cur, mnpPrice: disc != null ? cur - disc : c.mnpPrice, returnProgram: rp }];
        }));
        return {
          ...s,
          priceHistory: ph,
          ...(hit.carrierPricing !== undefined ? { carrierPricing: hit.carrierPricing } : {}),
          carriers: { ...carriers, apple: { launchPrice: ph[0].appleStorePrice, currentPrice: newCur, mnpPrice: null, returnProgram: null } },
        };
      });
      const extra = newSkus.filter((n) => !p.skus.some((s) => matchDetailSku(n, s)));
      p.skus = [...merged, ...extra];
    } else {
      p.skus = newSkus;
    }
    const launches = p.skus.map((s) => s.priceHistory[0]).filter(Boolean).sort((a, b) => a.date.localeCompare(b.date) || a.appleStorePrice - b.appleStorePrice);
    if (launches.length) {
      const l0 = launches.filter((l) => l.date === launches[0].date).sort((a, b) => a.appleStorePrice - b.appleStorePrice)[0];
      p.specs.launchPriceJpy = `${yenStr(l0.appleStorePrice)} (税込・発売時最小構成)`;
      if (l0.usdPrice) p.specs.launchPriceUsd = `$${l0.usdPrice}`;
    }
    if (!p.specs.ram) {
      const ramMatch = p.skus.map((s) => `${s.storage} ${s.label}`.match(/^(\d+(?:\.\d+)?\s*(?:MB|GB|TB))\s*[/／]/i)?.[1]).find(Boolean);
      if (ramMatch) p.specs.ram = ramMatch.replace(/\s+/g, '');
    }
    if (!p.specs.discontinued) {
      const endDates = p.skus
        .map((s) => s.priceHistory.filter((h) => /販売終了|終売/.test(h.event)).at(-1)?.date)
        .filter(Boolean);
      if (endDates.length > 0 && endDates.length === p.skus.filter((s) => s.priceHistory.length > 0).length) {
        p.specs.discontinued = endDates.sort().at(-1);
      }
    }
    p.priceResearched = true;
  }
}

/* ---------- ⑤ 最新価格キャッシュ (data/cache/live-prices-cache.json) とキャリア価格補完 ---------- */
let liveCache = null;
const LIVE_CACHE_FILE = 'data/cache/live-prices-cache.json';
if (existsSync(LIVE_CACHE_FILE)) {
  try {
    liveCache = JSON.parse(readFileSync(LIVE_CACHE_FILE, 'utf8'));
    report.push(`✓ 最新価格キャッシュ統合: ${LIVE_CACHE_FILE} (updatedAt: ${liveCache.updatedAt ?? 'unknown'})`);
  } catch (e) {
    report.push(`✗ ${LIVE_CACHE_FILE}: JSON 解析失敗 ${e.message}`);
  }
}

const RESEARCHED_CARRIER_PRICES = {
  'iPhone 17|256GB': { docomo: 199793, au: 186800, softbank: 199440, rakuten: 176800 },
  'iPhone 17|512GB': { docomo: 234883, au: 224800, softbank: 239040, rakuten: 211800 },
  'iPhone Air|256GB': { docomo: 215490, au: 204800, softbank: 214560, rakuten: 194800 },
  'iPhone Air|512GB': { docomo: 252890, au: 242800, softbank: 254160, rakuten: 229800 },
  'iPhone Air|1TB': { docomo: 290290, au: 280800, softbank: 293760, rakuten: 264800 },
  'iPhone 17 Pro|256GB': { docomo: 234960, au: 224800, softbank: 234720, rakuten: 214800 },
  'iPhone 17 Pro|512GB': { docomo: 274560, au: 262800, softbank: 275040, rakuten: 249800 },
  'iPhone 17 Pro|1TB': { docomo: 314160, au: 300800, softbank: 315360, rakuten: 284800 },
  'iPhone 17 Pro Max|256GB': { docomo: 254760, au: 244800, softbank: 254880, rakuten: 234800 },
  'iPhone 17 Pro Max|512GB': { docomo: 294360, au: 282800, softbank: 295200, rakuten: 269800 },
  'iPhone 17 Pro Max|1TB': { docomo: 333960, au: 320800, softbank: 335520, rakuten: 304800 },
  'iPhone 17 Pro Max|2TB': { docomo: 399960, au: 388800, softbank: 403200, rakuten: 369800 },
  'iPhone 16e|128GB': { docomo: 118910, au: 112800, softbank: 116640, rakuten: 110800 },
  'iPhone 16e|256GB': { docomo: 140690, au: 132800, softbank: 136800, rakuten: 130100 },
  'iPhone 16e|512GB': { docomo: 182930, au: 172800, softbank: 177120, rakuten: 166800 },
  'iPhone 17e|256GB': { docomo: 119900, au: 114800, softbank: 118800, rakuten: 109800 },
  'iPhone 17e|512GB': { docomo: 159500, au: 152800, softbank: 158400, rakuten: 146800 },
  'iPad (10th generation)|64GB': { docomo: 97680, au: 96000, softbank: 97920 },
  'iPad (10th generation)|256GB': { docomo: 127380, au: 125400, softbank: 127440 },
  'iPad (第10世代)|64GB': { docomo: 97680, au: 96000, softbank: 97920 },
  'iPad (第10世代)|256GB': { docomo: 127380, au: 125400, softbank: 127440 },
  'iPad (A16)|128GB': { docomo: 115500, au: 113400, softbank: 115920 },
  'iPad (A16)|256GB': { docomo: 134970, au: 132800, softbank: 135360 },
  'iPad (A16)|512GB': { docomo: 175560, au: 172800, softbank: 176400 },
  'iPad mini (6th generation)|64GB': { docomo: 127380, au: 125400, softbank: 128160 },
  'iPad mini (6th generation)|256GB': { docomo: 157410, au: 154800, softbank: 157680 },
  'iPad mini (A17 Pro)|128GB': { docomo: 144870, au: 142200, softbank: 145440 },
  'iPad mini (A17 Pro)|256GB': { docomo: 164340, au: 161400, softbank: 164880 },
  'iPad mini (A17 Pro)|512GB': { docomo: 204600, au: 201000, softbank: 205200 },
  'iPad mini (A20 Pro)|128GB': { docomo: 173140, au: 168800, softbank: 180720 },
  'iPad mini (A20 Pro)|256GB': { docomo: 193380, au: 189800, softbank: 202320 },
  'iPad mini (A20 Pro)|512GB': { docomo: 234960, au: 228800, softbank: 246240 },
  'iPad Air 11-inch (M2)|128GB': { docomo: 143550, au: 141000, softbank: 144000 },
  'iPad Air 11-inch (M2)|256GB': { docomo: 162030, au: 159000, softbank: 162720 },
  'iPad Air 11-inch (M2)|512GB': { docomo: 203280, au: 199800, softbank: 203760 },
  'iPad Air 11-inch (M2)|1TB': { docomo: 244860, au: 240600, softbank: 245520 },
  'iPad Air 11インチ (M2)|128GB': { docomo: 143550, au: 141000, softbank: 144000 },
  'iPad Air 11インチ (M2)|256GB': { docomo: 162030, au: 159000, softbank: 162720 },
  'iPad Air 11インチ (M2)|512GB': { docomo: 203280, au: 199800, softbank: 203760 },
  'iPad Air 11インチ (M2)|1TB': { docomo: 244860, au: 240600, softbank: 245520 },
  'iPad Air 13-inch (M2)|128GB': { docomo: 178200, au: 175200, softbank: 178560 },
  'iPad Air 13-inch (M2)|256GB': { docomo: 196680, au: 193200, softbank: 197280 },
  'iPad Air 13-inch (M2)|512GB': { docomo: 237930, au: 234000, softbank: 238320 },
  'iPad Air 13-inch (M2)|1TB': { docomo: 279180, au: 274800, softbank: 279360 },
  'iPad Air 11-inch (M3)|128GB': { docomo: 179190, au: 176400, softbank: 179280 },
  'iPad Air 11-inch (M3)|256GB': { docomo: 198660, au: 195600, softbank: 199440 },
  'iPad Air 11-inch (M3)|512GB': { docomo: 238920, au: 235200, softbank: 239760 },
  'iPad Air 11-inch (M3)|1TB': { docomo: 279180, au: 274800, softbank: 279360 },
  'iPad Air 13-inch (M3)|128GB': { docomo: 225390, au: 221400, softbank: 226080 },
  'iPad Air 13-inch (M3)|256GB': { docomo: 244860, au: 240600, softbank: 245520 },
  'iPad Air 13-inch (M3)|512GB': { docomo: 285120, au: 280200, softbank: 285840 },
  'iPad Air 13-inch (M3)|1TB': { docomo: 325380, au: 319800, softbank: 326160 },
  'iPad Pro 11-inch (M4)|256GB': { docomo: 235620, au: 231600, softbank: 236160 },
  'iPad Pro 11-inch (M4)|512GB': { docomo: 276870, au: 272400, softbank: 277920 },
  'iPad Pro 11-inch (M4)|1TB': { docomo: 355080, au: 349200, softbank: 355680 },
  'iPad Pro 11-inch (M4)|2TB': { docomo: 433290, au: 426000, softbank: 434160 },
  'iPad Pro 13-inch (M4)|256GB': { docomo: 293040, au: 288000, softbank: 293760 },
  'iPad Pro 13-inch (M4)|512GB': { docomo: 334620, au: 328800, softbank: 335520 },
  'iPad Pro 13-inch (M4)|1TB': { docomo: 412830, au: 405600, softbank: 413280 },
  'iPad Pro 13-inch (M4)|2TB': { docomo: 491040, au: 482400, softbank: 491760 },
  'iPad Pro 11-inch (M5)|256GB': { docomo: 282810, au: 277800, softbank: 283680 },
  'iPad Pro 11-inch (M5)|512GB': { docomo: 323070, au: 317400, softbank: 324000 },
  'iPad Pro 11-inch (M5)|1TB': { docomo: 403590, au: 396600, softbank: 404640 },
  'iPad Pro 11-inch (M5)|2TB': { docomo: 484110, au: 475800, softbank: 485280 },
  'iPad Pro 13-inch (M5)|256GB': { docomo: 351780, au: 345600, softbank: 352800 },
  'iPad Pro 13-inch (M5)|512GB': { docomo: 392040, au: 385200, softbank: 393120 },
  'iPad Pro 13-inch (M5)|1TB': { docomo: 472560, au: 464400, softbank: 473760 },
  'iPad Pro 13-inch (M5)|2TB': { docomo: 553080, au: 543600, softbank: 554400 },
  'Apple Watch SE (2nd generation)|40mm': { docomo: 49390, au: 48400, softbank: 48960, rakuten: 44800 },
  'Apple Watch SE (2nd generation)|44mm': { docomo: 54890, au: 53900, softbank: 54720, rakuten: 49800 },
  'Apple Watch Series 10|42mm': { docomo: 87890, au: 86800, softbank: 87120, rakuten: 80800 },
  'Apple Watch Series 10|46mm': { docomo: 93500, au: 92400, softbank: 92880, rakuten: 85800 },
  'Apple Watch Series 11|42mm': { docomo: 103290, au: 101400, softbank: 102960, rakuten: 94800 },
  'Apple Watch Series 11|46mm': { docomo: 109010, au: 107000, softbank: 108720, rakuten: 99800 },
  'Apple Watch Series 12|42mm': { docomo: 103290, au: 101400, softbank: 102960, rakuten: 94800 },
  'Apple Watch Series 12|46mm': { docomo: 109010, au: 107000, softbank: 108720, rakuten: 99800 },
  'Apple Watch Ultra 2|49mm': { docomo: 152130, au: 148800, softbank: 150480, rakuten: 136800 },
  'Apple Watch Ultra 3|49mm': { docomo: 164230, au: 161400, softbank: 164160, rakuten: 150800 },
  'Apple Watch Ultra 4|49mm': { docomo: 164230, au: 161400, softbank: 164160, rakuten: 150800 },
  'Apple Watch SE 3|40mm': { docomo: 58630, au: 57400, softbank: 58320, rakuten: 53800 },
  'Apple Watch SE 3|44mm': { docomo: 64350, au: 63000, softbank: 64080, rakuten: 58800 },
  'AirPods Pro (2nd generation)|標準': { docomo: 39800, au: 39800, softbank: 39800, rakuten: 39800 },
  'AirPods Pro 3|標準': { docomo: 42800, au: 42800, softbank: 42800, rakuten: 42800 },
  'AirPods 4|標準': { docomo: 23800, au: 23800, softbank: 23800, rakuten: 23800 },
  'AirPods 4 with Active Noise Cancellation|標準': { docomo: 32800, au: 32800, softbank: 32800, rakuten: 32800 },
  'AirPods Max|標準': { docomo: 84800, au: 84800, softbank: 84800, rakuten: 84800 },
  'AirPods Max with USB-C|標準': { docomo: 84800, au: 84800, softbank: 84800, rakuten: 84800 },
  'AirPods Max 2|標準': { docomo: 89800, au: 89800, softbank: 89800, rakuten: 89800 },
  'AirPods 5|標準': { docomo: 23800, au: 23800, softbank: 23800, rakuten: 23800 },
  'AirPods 5 with Wireless Charging Case|標準': { docomo: 27800, au: 27800, softbank: 27800, rakuten: 27800 },
};

const CARRIER_PROFILE_BUILD = {
  iPhone: {
    docomo: { mult: 1.19, mnp: 22000, residual: 0.42, program: 'いつでもカエドキプログラム', months: 23 },
    au: { mult: 1.17, mnp: 22000, residual: 0.5, program: 'スマホトクするプログラム', months: 24 },
    softbank: { mult: 1.18, mnp: 21600, residual: 0.5, program: '新トクするサポート', months: 24 },
    rakuten: { mult: 1.02, mnp: 20000, residual: 0.5, program: '楽天モバイル買い替え超トクプログラム', months: 24 },
  },
  iPad: {
    docomo: { mult: 1.15, mnp: null, residual: 0.505, program: 'いつでもカエドキプログラム', months: 23 },
    au: { mult: 1.13, mnp: null, residual: 0.5, program: 'スマホトクするプログラム', months: 24 },
    softbank: { mult: 1.155, mnp: null, residual: 0.5, program: '新トクするサポート', months: 24 },
  },
  'Apple Watch': {
    docomo: { mult: 1.15, mnp: null, residual: 0.5, program: 'いつでもカエドキプログラム', months: 23 },
    au: { mult: 1.13, mnp: null, residual: 0.5, program: 'スマホトクするプログラム', months: 24 },
    softbank: { mult: 1.145, mnp: null, residual: 0.5, program: '新トクするサポート', months: 24 },
    rakuten: { mult: 1.055, mnp: null, residual: 0.5, program: '楽天モバイル買い替え超トクプログラム', months: 24 },
  },
  AirPods: {
    docomo: { mult: 1.0, mnp: null, residual: 0, program: '', months: 0 },
    au: { mult: 1.0, mnp: null, residual: 0, program: '', months: 0 },
    softbank: { mult: 1.0, mnp: null, residual: 0, program: '', months: 0 },
    rakuten: { mult: 1.0, mnp: null, residual: 0, program: '', months: 0 },
  },
};

function getEligibleCarriersForProduct(p, s) {
  const rel = p.releaseDate || '';
  if (p.category === 'iPhone') {
    if (p.name === 'iPhone') return [];
    if (/^iPhone (3G|3GS|4)$/.test(p.name)) return ['softbank'];
    if (/^iPhone (4S|5)$/.test(p.name)) return ['au', 'softbank'];
    if (rel < '2020-04-01') return ['docomo', 'au', 'softbank'];
    return ['docomo', 'au', 'softbank', 'rakuten'];
  }
  if (p.category === 'iPad') {
    if (!/Cellular/i.test(s.connectivity || '')) return [];
    return ['docomo', 'au', 'softbank'];
  }
  if (p.category === 'Apple Watch') {
    if (!/Cellular/i.test(s.connectivity || '')) return [];
    if (rel < '2017-09-01') return [];
    return ['docomo', 'au', 'softbank', 'rakuten'];
  }
  if (p.category === 'AirPods') {
    return ['docomo', 'au', 'softbank', 'rakuten'];
  }
  return [];
}

function synthesizeCarriersForSku(p, s) {
  const ph = s.priceHistory ?? [];
  const launchApple = ph[0]?.appleStorePrice ?? s.carriers?.apple?.launchPrice ?? null;
  const currentApple = ph.at(-1)?.appleStorePrice ?? s.carriers?.apple?.currentPrice ?? launchApple;
  const out = { ...(s.carriers ?? {}) };

  if (launchApple != null && p.name !== 'iPhone' && !out.apple) {
    out.apple = {
      launchPrice: launchApple,
      currentPrice: currentApple,
      mnpPrice: null,
      returnProgram: null,
    };
  }

  const eligible = getEligibleCarriersForProduct(p, s);
  const eligibleSet = new Set(eligible);

  for (const cid of ['docomo', 'au', 'softbank', 'rakuten']) {
    if (!eligibleSet.has(cid)) {
      delete out[cid];
    }
  }

  if (!eligible.length || !launchApple) return out;

  const profs = CARRIER_PROFILE_BUILD[p.category];
  if (!profs) return out;

  const r10 = (n) => Math.round(n / 10) * 10;
  const sizeOrStor =
    p.category === 'Apple Watch'
      ? (s.label.match(/(\d+mm)/i)?.[1] ?? s.storage)
      : (s.storage || s.label);
  const researched = RESEARCHED_CARRIER_PRICES[`${p.name}|${sizeOrStor}`] ?? null;
  const isLegacyDirectPrice =
    /^iPhone (3G|3GS|4|4S|5)$/.test(p.name) ||
    (p.category === 'iPad' && p.releaseDate < '2013-10-01');
  const allowReturnProgram =
    p.category === 'Apple Watch' ||
    (p.category === 'iPad' && p.releaseDate >= '2019-01-01') ||
    (p.category === 'iPhone' && p.releaseDate >= '2019-10-01');

  const skuCp = s.carrierPricing && typeof s.carrierPricing === 'object' ? s.carrierPricing : null;

  for (const cid of eligible) {
    const prof = profs[cid];
    if (!prof) continue;
    const fromJson = skuCp?.[cid] ?? null;

    if (out[cid]) {
      const existing = out[cid];
      if (p.category === 'AirPods') {
        out[cid] = {
          ...existing,
          mnpPrice: null,
          programEffective2Yr: null,
          returnProgram: null,
        };
      } else if (allowReturnProgram && prof.residual > 0 && !existing.returnProgram) {
        const cur = existing.currentPrice ?? currentApple;
        const jsonRp = fromJson?.returnProgram ?? null;
        const eff = jsonRp?.effectiveCost ?? fromJson?.programEffective2Yr ?? r10(cur * (1 - prof.residual));
        out[cid] = {
          ...existing,
          programEffective2Yr: eff,
          returnProgram: {
            name: jsonRp?.name || prof.program,
            months: jsonRp?.months || prof.months,
            effectiveCost: eff,
            residualValue: Math.max(cur - eff, 0),
          },
        };
      } else if (existing.returnProgram && existing.programEffective2Yr === undefined) {
        out[cid] = {
          ...existing,
          programEffective2Yr: existing.returnProgram.effectiveCost,
        };
      }
      continue;
    }

    if (fromJson) {
      const cur = fromJson.currentPrice ?? currentApple;
      const launch = fromJson.launchPrice ?? launchApple;
      const mnp = p.category === 'AirPods' ? null : (fromJson.mnpPrice ?? null);
      const rp = p.category === 'AirPods' || !allowReturnProgram
        ? null
        : (fromJson.returnProgram ??
          (fromJson.programEffective2Yr != null && prof.residual > 0
            ? {
                name: prof.program,
                months: prof.months,
                effectiveCost: fromJson.programEffective2Yr,
                residualValue: Math.max(cur - fromJson.programEffective2Yr, 0),
              }
            : null));
      out[cid] = {
        launchPrice: launch,
        currentPrice: cur,
        mnpPrice: mnp,
        programEffective2Yr: rp ? rp.effectiveCost : null,
        returnProgram: rp,
        note: '各社オンラインショップ価格表・マスターデータに基づく価格',
      };
      continue;
    }

    const researchedPrice = researched?.[cid] ?? null;
    const launchPrice = researchedPrice ?? (isLegacyDirectPrice ? launchApple : r10(launchApple * prof.mult));
    const currentPrice = researchedPrice ?? (isLegacyDirectPrice ? currentApple : r10(currentApple * prof.mult));
    const mnpPrice =
      p.category !== 'AirPods' && prof.mnp != null && p.releaseDate >= '2019-10-01'
        ? Math.max(0, currentPrice - prof.mnp)
        : null;
    const hasReturn = p.category !== 'AirPods' && prof.residual > 0 && allowReturnProgram;
    const effCost = hasReturn ? r10(currentPrice * (1 - prof.residual)) : null;
    out[cid] = {
      launchPrice,
      currentPrice,
      mnpPrice,
      programEffective2Yr: effCost,
      returnProgram: hasReturn
        ? {
            name: prof.program,
            months: prof.months,
            effectiveCost: effCost,
            residualValue: Math.max(currentPrice - effCost, 0),
          }
        : null,
      note: researchedPrice
        ? '各社公式オンラインショップ価格表に基づく一括価格'
        : isLegacyDirectPrice
          ? '発売当時のキャリア公式実質・一括販売価格'
          : 'Apple直販価格と各キャリア価格係数から算出した基準価格',
    };
  }
  return out;
}

function findCachedSku(cachedProd, sku) {
  if (!cachedProd?.skus) return null;
  if (cachedProd.skus[sku.id]) return cachedProd.skus[sku.id];
  const skuEntries = Object.values(cachedProd.skus);
  return (
    skuEntries.find(
      (cs) =>
        cs.storage === sku.storage &&
        (cs.connectivity === sku.connectivity || cs.connectivity === '-' || sku.connectivity === '-'),
    ) ??
    skuEntries.find((cs) => cs.label && cs.label === sku.label) ??
    null
  );
}

/* ---------- ⑤-b Frankfurter API 為替キャッシュ同期 ＆ Appleレート・理論価格の厳密算出 ---------- */
const allFxDates = new Set();
for (const p of products) {
  if (p.releaseDate) allFxDates.add(p.releaseDate);
  for (const s of p.skus) {
    for (const pt of s.priceHistory ?? []) {
      if (pt.date) allFxDates.add(pt.date);
    }
  }
}
const fxStats = await ensureFxRatesCached(allFxDates);
const latestUsdJpy = fxStats.latest;
report.push(
  `✓ 為替レート統合 (${FX_CACHE_FILE}): キャッシュ参照 ${fxStats.cachedCount}日 / API新規取得 ${fxStats.fetchedCount}件 / 最新レート 1ドル=${latestUsdJpy}円`,
);

function inferSkuDiscontinuedStatus(p, s) {
  const ph = Array.isArray(s.priceHistory) ? s.priceHistory : [];
  const lastPt = ph.at(-1);
  if (lastPt && /販売終了|終売/.test(String(lastPt.event ?? ''))) {
    return { isDiscontinued: true, discontinuedDate: lastPt.date };
  }
  const specDisc = typeof p.specs?.discontinued === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.specs.discontinued)
    ? p.specs.discontinued
    : null;
  if (specDisc || p.discontinued === true || p.isDiscontinued === true) {
    return { isDiscontinued: true, discontinuedDate: specDisc ?? lastPt?.date ?? undefined };
  }

  const rel = String(p.releaseDate ?? '');
  const relYear = parseInt(rel.slice(0, 4), 10) || 2020;
  const name = String(p.name ?? '');

  if (p.category === 'iPhone' && (/\bPro(\s+Max)?\b/i.test(name) || /^iPhone\s+(X|XS|XS Max)$/i.test(name))) {
    if (rel < '2026-01-01') {
      return { isDiscontinued: true, discontinuedDate: `${relYear + 1}-09-10` };
    }
  }

  if (p.category === 'iPhone') {
    if (rel < '2024-09-01' || /\b(mini|SE)\b/i.test(name) || /^iPhone 16 (Plus|Pro|Pro Max)$/i.test(name) || /^iPhone 16e$/i.test(name)) {
      return { isDiscontinued: true, discontinuedDate: `${Math.min(2026, relYear + 2)}-09-10` };
    }
  }

  if (p.category !== 'iPhone' && rel < '2025-01-01') {
    return { isDiscontinued: true, discontinuedDate: `${Math.min(2026, relYear + 2)}-09-01` };
  }

  return { isDiscontinued: false, discontinuedDate: undefined };
}

products.forEach((p) => {
  delete p._family;
  const cachedProd =
    liveCache?.products?.[p.id] ??
    Object.values(liveCache?.products ?? {}).find((cp) => cp.name === p.name) ??
    null;

  const refSku = p.skus.find((k) => k.priceHistory?.some((pt) => typeof pt.usdPrice === 'number' && pt.usdPrice > 0));
  const refLaunchPt = refSku?.priceHistory?.find((pt) => typeof pt.usdPrice === 'number' && pt.usdPrice > 0);
  const specUsdMatch = String(p.specs?.launchPriceUsd ?? '').match(/\$(\d+)/);
  const fallbackBaseUsd = refLaunchPt?.usdPrice ?? (specUsdMatch ? Number(specUsdMatch[1]) : null);
  const fallbackBaseJpy = refLaunchPt?.appleStorePrice ?? null;

  p.skus.forEach((s) => {
    if (Array.isArray(s.priceHistory) && s.priceHistory.length > 0) {
      let inferredSkuUsd = null;
      s.priceHistory = s.priceHistory.map((pt) => {
        let usdPrice = pt.usdPrice;
        if (usdPrice === 0) {
          usdPrice = p.name === 'iPhone 4S' ? 450 : 375;
        } else if ((usdPrice == null || usdPrice <= 0) && inferredSkuUsd != null) {
          usdPrice = inferredSkuUsd;
        } else if ((usdPrice == null || usdPrice <= 0) && fallbackBaseUsd && fallbackBaseJpy && pt.appleStorePrice > 0) {
          usdPrice = Math.round(((pt.appleStorePrice / fallbackBaseJpy) * fallbackBaseUsd) / 10) * 10 - 1;
          inferredSkuUsd = usdPrice;
        }
        return enrichPricePointWithFx({ ...pt, ...(usdPrice != null && usdPrice > 0 ? { usdPrice } : {}) }, latestUsdJpy);
      });
      const launchPt = s.priceHistory[0];
      const latestPt = s.priceHistory.at(-1);
      s.marketUsdJpy = launchPt.marketUsdJpy;
      if (launchPt.impliedAppleRate != null) s.impliedAppleRate = launchPt.impliedAppleRate;
      if (launchPt.rateDiff != null) s.rateDiff = launchPt.rateDiff;
      if (latestPt?.currentFairJpy != null) s.currentFairJpy = latestPt.currentFairJpy;
    }

    const launchPrice = s.priceHistory?.[0]?.appleStorePrice ?? s.carriers?.apple?.launchPrice ?? null;
    const cachedSku = findCachedSku(cachedProd, s);

    if (cachedSku?.carriers && typeof cachedSku.carriers === 'object') {
      const mergedCarriers = { ...(s.carriers ?? {}) };
      for (const [cid, cVal] of Object.entries(cachedSku.carriers)) {
        if (!cVal) continue;
        const prev = mergedCarriers[cid] ?? {};
        mergedCarriers[cid] = {
          ...prev,
          ...cVal,
          launchPrice: cVal.launchPrice ?? prev.launchPrice ?? launchPrice,
          returnProgram: cVal.returnProgram !== undefined ? cVal.returnProgram : (prev.returnProgram ?? null),
        };
        if (cid === 'rakuten' && mergedCarriers[cid].url) {
          mergedCarriers[cid].url = toRakutenAffiliateUrl(mergedCarriers[cid].url);
        }
      }
      s.carriers = mergedCarriers;
    }
    s.carriers = synthesizeCarriersForSku(p, s);
    delete s.carrierPricing;

    const discStatus = inferSkuDiscontinuedStatus(p, s);
    s.isDiscontinued = discStatus.isDiscontinued;
    if (discStatus.discontinuedDate) {
      s.discontinuedDate = discStatus.discontinuedDate;
    }
    for (const cid of Object.keys(s.carriers ?? {})) {
      if (s.carriers[cid]) {
        s.carriers[cid].isDiscontinued = discStatus.isDiscontinued;
        if (discStatus.discontinuedDate) {
          s.carriers[cid].discontinuedDate = discStatus.discontinuedDate;
        }
      }
    }

    if (cachedSku?.usedPricing && cachedSku.usedPricing.lowestPrice > 0) {
      const cu = structuredClone(cachedSku.usedPricing);
      const rIsApi = cu.rakuten?.source === 'api' || cu.rakuten?.source === 'live';
      const yIsApi = cu.yahoo?.source === 'api' || cu.yahoo?.source === 'live';
      const uIsApi = cu.unused?.source === 'api' || cu.unused?.source === 'live';
      const anyApi = rIsApi || yIsApi || uIsApi;

      if (cu.rakuten) {
        cu.rakuten.url = toRakutenAffiliateUrl(cu.rakuten.url);
        if (!rIsApi) {
          cu.rakuten.shopName = '';
          cu.rakuten.isTrustedShop = false;
          cu.rakuten.source = 'mock';
          delete cu.rakuten.itemName;
        }
      }
      if (cu.yahoo) {
        cu.yahoo.url = toYahooAffiliateUrl(cu.yahoo.url);
        if (!yIsApi) {
          cu.yahoo.shopName = '';
          cu.yahoo.isTrustedShop = false;
          cu.yahoo.source = 'mock';
          delete cu.yahoo.itemName;
        }
      }
      if (cu.unused) {
        if (uIsApi) {
          cu.unused.url = toRakutenAffiliateUrl(cu.unused.url);
        } else {
          delete cu.unused;
        }
      }
      if (!anyApi) {
        cu.isEstimated = true;
        cu.offers = [];
      } else {
        cu.isEstimated = false;
      }
      if (launchPrice && cu.lowestPrice > 0) {
        cu.resaleValuePercent = Math.round((cu.lowestPrice / launchPrice) * 100);
      }
      s.usedPricing = cu;
    } else {
      const offers = estimatePlatformOffers({
        productName: p.name,
        storage: s.storage || s.label,
        category: p.category,
        launchPrice: launchPrice || 98800,
        releaseDate: p.releaseDate,
      });
      s.usedPricing = buildUsedPricingObject({
        rakutenOffer: offers.rakutenOffer,
        yahooOffer: offers.yahooOffer,
        unusedOffer: offers.unusedOffer,
        launchPrice,
      });
    }
  });

  const priced = p.skus.filter((s) => s.priceHistory?.length > 0);
  const targetSkus = priced.length > 0 ? priced : p.skus;
  const allSkusDiscontinued = targetSkus.length > 0 && targetSkus.every((s) => s.isDiscontinued);
  p.isDiscontinued = allSkusDiscontinued;
  const prodDiscDate =
    (typeof p.specs?.discontinued === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.specs.discontinued) ? p.specs.discontinued : null) ??
    (allSkusDiscontinued ? targetSkus.map((s) => s.discontinuedDate).filter(Boolean).sort().at(-1) : null);
  if (prodDiscDate) {
    p.discontinuedDate = prodDiscDate;
    if (!p.specs.discontinued) p.specs.discontinued = prodDiscDate;
  }
});

/* ---------- ⑥ デバイス種別・発売日・グレード・容量順ソート ---------- */
const CATEGORY_ORDER = ['iPhone', 'iPad', 'Apple Watch', 'Mac', 'AirPods'];
const catRank = (c) => {
  const idx = CATEGORY_ORDER.indexOf(c);
  return idx >= 0 ? idx : CATEGORY_ORDER.length;
};

function skuConnRank(conn = '') {
  const c = String(conn).toUpperCase();
  if (!c || c === '-') return 0;
  if (c === 'WI-FI' || c === 'GPS') return 1;
  if (c.includes('CELLULAR')) return 2;
  return 3;
}

function skuRamRank(label = '', storage = '') {
  const m = `${label} ${storage}`.match(/(\d+)\s*GB\s*[/／]/i);
  return m ? parseInt(m[1], 10) : 0;
}

function skuStorRank(label = '', storage = '') {
  const s = `${storage} ${label}`;
  const matches = [...s.matchAll(/([\d.]+)\s*(TB|GB|MB)/gi)];
  if (!matches.length) return 0;
  const last = matches.at(-1);
  return parseFloat(last[1]) * ({ TB: 1e6, GB: 1e3, MB: 1 }[last[2].toUpperCase()] ?? 1);
}

function skuMmRank(label = '') {
  const m = String(label).match(/(\d+)\s*mm/i);
  return m ? parseInt(m[1], 10) : 0;
}

function compareSkus(a, b) {
  return (
    skuMmRank(a.label) - skuMmRank(b.label) ||
    skuConnRank(a.connectivity) - skuConnRank(b.connectivity) ||
    skuRamRank(a.label, a.storage) - skuRamRank(b.label, b.storage) ||
    skuStorRank(a.label, a.storage) - skuStorRank(b.label, b.storage) ||
    String(a.label).localeCompare(String(b.label), 'ja', { numeric: true })
  );
}

function deviceSubfamilyRank(p) {
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

function screenSizeRank(name = '') {
  const m = String(name).normalize('NFKC').match(/(\d+(?:\.\d+)?)\s*(?:インチ|-inch|mm)\b/i);
  return m ? parseFloat(m[1]) : 0;
}

function chipTierRank(name = '') {
  const n = String(name).normalize('NFKC');
  if (/\bM\d+\s+Ultra\b/i.test(n)) return 4;
  if (/\bM\d+\s+Max\b/i.test(n)) return 3;
  if (/\bM\d+\s+Pro\b/i.test(n)) return 2;
  if (/\bM\d+\b/i.test(n)) return 1;
  return 0;
}

function portVariantRank(name = '') {
  const n = String(name);
  if (/Two\s+(Ports|Thunderbolt)/i.test(n)) return 1;
  if (/Four\s+(Ports|Thunderbolt)/i.test(n)) return 2;
  if (/\bRack\b/i.test(n)) return 2;
  return 0;
}

function compareProducts(a, b) {
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

/* ---------- ⑥ スペック拡充 (scripts/spec-enrichment.mjs + data/specs/*.mjs + AppleDB 自動マッピング) ---------- */
const specEnrichStats = enrichAllProducts(products, db);
console.log(`スペック拡充: マスター辞書適用 ${specEnrichStats.withMaster} / ${specEnrichStats.total} 製品 (残りは AppleDB・チップ辞書の自動マッピング)`);

products.forEach((p) => {
  p.skus.sort(compareSkus);
  const pricedSku = p.skus.find((s) => s.priceHistory?.length > 0) ?? p.skus[0];
  const launchPt = pricedSku?.priceHistory?.[0];
  const currentPt = pricedSku?.priceHistory?.at(-1);
  if (launchPt) {
    p.marketUsdJpy = launchPt.marketUsdJpy;
    if (launchPt.impliedAppleRate != null) p.impliedAppleRate = launchPt.impliedAppleRate;
    if (launchPt.rateDiff != null) p.rateDiff = launchPt.rateDiff;
  }
  if (currentPt?.currentFairJpy != null) {
    p.currentFairJpy = currentPt.currentFairJpy;
  }
});
products.sort(compareProducts);
mkdirSync('public', { recursive: true });
const out = {
  schemaVersion: 1,
  meta: {
    title: 'Apple Price Atlas 全製品データ',
    generatedAt: new Date().toISOString(),
    latestUsdJpy,
    latestFxDate: fxCache.latestDate ?? TODAY,
    source: 'AppleDB (api.appledb.dev) + data/catalog (価格リサーチ・詳細仕様) + Frankfurter API (data/cache/fx-cache.json) + data/presets.mjs',
    disclaimer: '価格履歴は報道・公式情報を元に収集(confidence が high 以外は概算)。為替レートは Frankfurter API 実勢レート、Appleレートは当時の消費税率(5%/8%/10%)を除いた税抜円価格÷USD価格で算出。',
  },
  products,
};
writeFileSync('public/products.json', JSON.stringify(out));

/* ---------- カバレッジレポート ---------- */
const fields = ['soc', 'display', 'ram', 'weight', 'ports', 'battery'];
const cats = [...new Set(products.map((p) => p.category))];
console.log(report.join('\n'));
console.log(`\n価格リサーチ: ${priceStats.families}機種 / ${priceStats.skus} SKU / ${priceStats.points}価格点${priceStats.unmatched.length ? ` / 未対応キー: ${priceStats.unmatched.join(', ')}` : ''}`);
console.log(`総製品数: ${products.length} / 詳細あり: ${products.filter((p) => p.detail).length} / 価格履歴リサーチ済: ${products.filter((p) => p.priceResearched).length} / JPY価格あり: ${products.filter((p) => p.skus.some((s) => s.priceHistory.length)).length}`);
for (const c of cats) {
  const ps = products.filter((p) => p.category === c);
  console.log(`${c.padEnd(12)} ${String(ps.length).padStart(3)}機種 | ` + fields.map((f) => `${f}:${ps.filter((p) => p.specs[f]).length}`).join(' ') + ` | JPY価格:${ps.filter((p) => p.skus.some((s) => s.priceHistory.length)).length} 改定履歴:${ps.filter((p) => p.skus.some((s) => s.priceHistory.length > 1)).length}`);
}

