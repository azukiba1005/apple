/**
 * Apple認定整備済製品 在庫取得 ＆ 既存DB（public/products.json / data/catalog/）スマート名寄せスクリプト
 * 出力先: public/refurbished.json
 *
 * 【ハイブリッド設計】
 * 1. マルチソース取得＋フォールバック:
 *    - プライマリ1: Refurb Tracker 日本向けRSSフィード (jp_mac.xml, jp_ipad.xml, jp_iphone.xml, jp_watch.xml 等)
 *    - プライマリ2: Apple公式 認定整備済製品ページ (https://www.apple.com/jp/shop/refurbished/mac 等)
 *      から最小限の「タイトル・整備済価格（税込）・商品URL」のみを軽量抽出（stockStatus: "Live"）
 *    - セカンダリ（フォールバック）: 外部フィードが通信エラーや在庫切れのカテゴリでも、
 *      既存カタログ（public/products.json & data/catalog/）の主要モデルからApple認定整備済製品の
 *      実勢価格（新品価格の約15%OFF相当）を自動算出し、「実在庫（Live）」か「参考整備済相場（Reference）」かの
 *      フラグを付与して出力
 *
 * 2. 3ステップ自動名寄せ（マッチング）＆データ注入（Enrich）:
 *    - ステップA: 正規化したタイトルからモデル名・画面サイズ・世代・チップ名（M1〜M6, A14〜A20, S8〜S11, H1/H2）を抽出し既存製品を特定
 *    - ステップB: 容量（64GB〜2TB）・メモリ構成（8GB/256GB, 16GB/512GB等）・ケースサイズ（40mm〜49mm）・通信方式（Wi-Fi / Cellular / GPS）で該当SKUを特定
 *    - ステップC: 紐付いた既存SKUから originalNewPrice / discountAmount / discountPercent /
 *      usedLowestPrice / usedShopName / usedUrl / priceGapVsUsed / specs を自動注入
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/* ============================================================================
 * 1. 定数・フィードURL定義
 * ============================================================================ */

export const OUTPUT_PATH = 'public/refurbished.json';
export const PRODUCTS_JSON_PATH = 'public/products.json';
export const CATALOG_DIR = 'data/catalog';
export const FETCH_TIMEOUT_MS = 9000;

export const REFURB_TRACKER_FEEDS = [
  { category: 'Mac', url: 'https://refurb-tracker.com/feeds/jp_mac.xml' },
  { category: 'iPad', url: 'https://refurb-tracker.com/feeds/jp_ipad.xml' },
  { category: 'iPhone', url: 'https://refurb-tracker.com/feeds/jp_iphone.xml' },
  { category: 'Apple Watch', url: 'https://refurb-tracker.com/feeds/jp_watch.xml' },
  { category: 'AirPods', url: 'https://refurb-tracker.com/feeds/jp_airpods.xml' },
  { category: 'AirPods', url: 'https://refurb-tracker.com/feeds/jp_accessories.xml' },
];

export const APPLE_REFURBISHED_PAGES = [
  { category: 'Mac', url: 'https://www.apple.com/jp/shop/refurbished/mac' },
  { category: 'iPad', url: 'https://www.apple.com/jp/shop/refurbished/ipad' },
  { category: 'iPhone', url: 'https://www.apple.com/jp/shop/refurbished/iphone' },
  { category: 'Apple Watch', url: 'https://www.apple.com/jp/shop/refurbished/watch' },
  { category: 'AirPods', url: 'https://www.apple.com/jp/shop/refurbished/airpods' },
];

export const APPLE_REFURB_CATEGORY_URLS = {
  Mac: 'https://www.apple.com/jp/shop/refurbished/mac',
  iPad: 'https://www.apple.com/jp/shop/refurbished/ipad',
  iPhone: 'https://www.apple.com/jp/shop/refurbished/iphone',
  'Apple Watch': 'https://www.apple.com/jp/shop/refurbished/watch',
  AirPods: 'https://www.apple.com/jp/shop/refurbished/airpods',
};

/**
 * Apple認定整備済製品の典型的な価格丸め（新品価格の約15%OFF、末尾800円または400円基準）
 */
export function calcStandardRefurbishedPrice(newPrice, discountRatio = 0.15) {
  if (!Number.isFinite(newPrice) || newPrice <= 0) return 0;
  const raw = newPrice * (1 - discountRatio);
  if (newPrice >= 100000) {
    return Math.round(raw / 1000) * 1000 - 200;
  }
  return Math.round(raw / 100) * 100;
}

/* ============================================================================
 * 2. 既存データベース（public/products.json + data/catalog/）の読み込み
 * ============================================================================ */

export function loadExistingProductsDatabase() {
  let products = [];
  if (existsSync(PRODUCTS_JSON_PATH)) {
    try {
      const raw = JSON.parse(readFileSync(PRODUCTS_JSON_PATH, 'utf8'));
      products = Array.isArray(raw) ? raw : (raw.products ?? []);
    } catch (err) {
      console.warn(`[warn] ${PRODUCTS_JSON_PATH} の読み込みに失敗しました: ${err.message}`);
    }
  }

  // 万一 products.json が未生成の場合でも data/catalog/*.json から構築可能にするフォールバック
  if (products.length === 0 && existsSync(CATALOG_DIR)) {
    const catMap = {
      'mac.json': 'Mac',
      'ipad.json': 'iPad',
      'iphone.json': 'iPhone',
      'watch.json': 'Apple Watch',
      'airpods.json': 'AirPods',
    };
    for (const file of readdirSync(CATALOG_DIR).filter((f) => f.endsWith('.json'))) {
      try {
        const category = catMap[file] || 'Mac';
        const data = JSON.parse(readFileSync(`${CATALOG_DIR}/${file}`, 'utf8'));
        for (const [familyName, entry] of Object.entries(data.families ?? {})) {
          const id = familyName
            .normalize('NFKC')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '');
          const skus = (entry.skus ?? []).map((s, idx) => {
            const hist = (s.history ?? [])
              .filter((h) => typeof h.jpy === 'number' && h.jpy > 0)
              .map((h) => ({
                date: h.date,
                event: h.event || '発売時',
                appleStorePrice: h.jpy,
                usdPrice: h.usd,
              }));
            const curPrice = hist.at(-1)?.appleStorePrice ?? 0;
            const launchPrice = hist[0]?.appleStorePrice ?? curPrice;
            return {
              id: `${(s.storage || `sku-${idx}`).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
              label: [s.storage, s.connectivity && s.connectivity !== '-' ? s.connectivity : '']
                .filter(Boolean)
                .join(' ') || '標準',
              storage: s.storage || '',
              connectivity: s.connectivity || '-',
              priceHistory: hist,
              carriers: curPrice > 0 ? { apple: { launchPrice, currentPrice: curPrice } } : {},
            };
          });
          products.push({
            id,
            category,
            name: entry.detail?.name || familyName,
            generation: `${String(entry.releaseDate ?? '').slice(0, 4)}年発売`,
            releaseDate: entry.releaseDate || '2024-01-01',
            specs: entry.detail?.specs || {},
            skus,
          });
        }
      } catch {
        /* ignore */
      }
    }
  }

  return products;
}

/* ============================================================================
 * 3. プライマリ取得ルート: Refurb Tracker RSS & Apple公式整備済ページ
 * ============================================================================ */

function decodeXmlEntities(str) {
  return String(str ?? '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)));
}

function stripHtmlTags(str) {
  return String(str ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * テキスト（タイトルや説明文）から税込円価格を抽出する
 */
export function extractYenPriceFromText(text) {
  const norm = String(text ?? '').normalize('NFKC');
  const patterns = [
    /(?:¥|￥)\s*([0-9]{1,3}(?:,[0-9]{3})+)/g,
    /([0-9]{1,3}(?:,[0-9]{3})+)\s*円/g,
  ];
  const candidates = [];
  for (const re of patterns) {
    for (const m of norm.matchAll(re)) {
      const val = Number(m[1].replace(/,/g, ''));
      if (Number.isFinite(val) && val >= 10000 && val <= 1500000) {
        candidates.push(val);
      }
    }
  }
  if (candidates.length === 0) return null;
  // 割引額（例：-¥25,000）ではなく本体価格を取得するため、2つ以上ある場合は適切な範囲を採用
  return candidates[0];
}

/**
 * Refurb Tracker RSS の XML 文字列をパースして軽量アイテム配列を返す
 */
export function parseRefurbTrackerRssXml(xmlText, defaultCategory = 'Mac') {
  if (!xmlText || typeof xmlText !== 'string') return [];
  const items = [];
  const itemMatches = xmlText.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi);

  for (const match of itemMatches) {
    const block = match[1];
    const rawTitle = decodeXmlEntities(block.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '');
    const rawLink = decodeXmlEntities(block.match(/<link[^>]*>([\s\S]*?)<\/link>/i)?.[1] ?? '').trim();
    const rawDesc = decodeXmlEntities(block.match(/<description[^>]*>([\s\S]*?)<\/description>/i)?.[1] ?? '');
    const rawPubDate = decodeXmlEntities(block.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i)?.[1] ?? '').trim();

    const cleanTitle = stripHtmlTags(rawTitle);
    const cleanDesc = stripHtmlTags(rawDesc);
    if (!cleanTitle) continue;

    // 売り切れ・在庫切れ通知は除外
    if (/売り切れ|在庫切れ|Out of stock|Sold out/i.test(cleanTitle)) continue;

    const price = extractYenPriceFromText(cleanTitle) ?? extractYenPriceFromText(cleanDesc);
    if (!price) continue;

    // description 内に Apple 公式 URL が含まれていれば優先
    const appleUrlMatch = rawDesc.match(/https?:\/\/www\.apple\.com\/jp\/shop\/(?:product|refurbished)[^\s"'<>]+/i);
    const url = appleUrlMatch
      ? appleUrlMatch[0]
      : rawLink || APPLE_REFURB_CATEGORY_URLS[defaultCategory] || 'https://www.apple.com/jp/shop/refurbished';

    // タイトルに description のメモリ/SSD補足があれば結合して名寄せ精度を高める
    const combinedTitle =
      cleanDesc && !cleanTitle.includes(cleanDesc.slice(0, 20))
        ? `${cleanTitle} ${cleanDesc}`.slice(0, 260)
        : cleanTitle;

    items.push({
      title: combinedTitle,
      displayTitle: cleanTitle.replace(/\s*[-–—:：]?\s*(?:¥|￥)?[0-9,]+\s*円?(?:（税込）|\(税込\))?\s*$/, '').trim(),
      refurbishedPrice: price,
      url,
      category: defaultCategory,
      stockStatus: 'Live',
      source: 'refurb_tracker_rss',
      publishedAt: rawPubDate || new Date().toISOString(),
    });
  }

  return items;
}

/**
 * Apple公式整備済製品ページのHTML（REFURB_GRID_BOOTSTRAP JSON または HTMLタイル）をパースする
 */
export function parseAppleRefurbishedHtml(htmlText, defaultCategory = 'Mac') {
  if (!htmlText || typeof htmlText !== 'string') return [];
  const items = [];

  // 1) window.REFURB_GRID_BOOTSTRAP JSON データの抽出を試行
  const bootstrapMatch = htmlText.match(/REFURB_GRID_BOOTSTRAP\s*=\s*(\{[\s\S]*?\});\s*(?:window\.|<\/script>)/i);
  if (bootstrapMatch) {
    try {
      const json = JSON.parse(bootstrapMatch[1]);
      const tiles = Array.isArray(json?.tiles) ? json.tiles : [];
      for (const tile of tiles) {
        const title = String(tile?.title ?? '').trim();
        if (!title) continue;
        const rawAmount =
          tile?.price?.currentPrice?.raw_amount ??
          tile?.price?.currentPrice?.amount ??
          tile?.price?.currentPrice ??
          '';
        const price =
          typeof rawAmount === 'number'
            ? rawAmount
            : Number(String(rawAmount).replace(/[^0-9.]/g, '')) || extractYenPriceFromText(String(rawAmount));
        if (!price || price < 10000) continue;

        const relUrl = String(tile?.productDetailsUrl ?? tile?.omnitureModel?.pageUrl ?? '').trim();
        const url = relUrl.startsWith('http')
          ? relUrl
          : relUrl.startsWith('/')
            ? `https://www.apple.com${relUrl}`
            : APPLE_REFURB_CATEGORY_URLS[defaultCategory];

        // フィルタ次元（メモリ・ストレージ等）があれば名寄せヒントとして結合
        const dims = tile?.filters?.dimensions ?? {};
        const memHint = dims.dimensionMemorySize ? String(dims.dimensionMemorySize).toUpperCase() : '';
        const capHint = dims.dimensionCapacity ? String(dims.dimensionCapacity).toUpperCase() : '';
        const yearHint = dims.dimensionRelYear ? String(dims.dimensionRelYear) : '';
        const fullTitle = [title, memHint, capHint, yearHint].filter(Boolean).join(' ');

        items.push({
          title: fullTitle,
          displayTitle: title,
          refurbishedPrice: Math.round(price),
          url,
          category: defaultCategory,
          stockStatus: 'Live',
          source: 'apple_official_web',
          publishedAt: new Date().toISOString(),
        });
      }
    } catch {
      /* fallback to HTML regex parsing below */
    }
  }

  if (items.length > 0) return items;

  // 2) HTML タイル構造 (<div class="rf-refurb-producttile"> または <li>) からの抽出
  const tileRegex =
    /<a[^>]+href="(\/jp\/shop\/product\/[^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]{0,600}?(?:(?:¥|￥)\s*([0-9]{1,3}(?:,[0-9]{3})+)|([0-9]{1,3}(?:,[0-9]{3})+)\s*円)/gi;
  for (const m of htmlText.matchAll(tileRegex)) {
    const href = m[1];
    const title = stripHtmlTags(decodeXmlEntities(m[2]));
    const priceStr = m[3] || m[4];
    const price = Number(String(priceStr).replace(/,/g, ''));
    if (!title || !Number.isFinite(price) || price < 10000) continue;
    if (!/Mac|iPad|iPhone|Watch|AirPods|整備済/i.test(title)) continue;

    items.push({
      title,
      displayTitle: title,
      refurbishedPrice: price,
      url: `https://www.apple.com${href}`,
      category: defaultCategory,
      stockStatus: 'Live',
      source: 'apple_official_web',
      publishedAt: new Date().toISOString(),
    });
  }

  return items;
}

async function fetchTextWithTimeout(url, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
        Accept: 'application/rss+xml, application/xml, text/xml, text/html, */*;q=0.8',
        'Accept-Language': 'ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7',
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * マルチソース（Refurb Tracker RSS + Apple公式ページ）から現在出品中の実在庫を取得する
 */
export async function fetchLiveRefurbishedItems() {
  const liveItems = [];
  let rssSuccess = false;
  let appleWebSuccess = false;

  // 1) Refurb Tracker RSS フィード
  await Promise.all(
    REFURB_TRACKER_FEEDS.map(async ({ category, url }) => {
      try {
        const xml = await fetchTextWithTimeout(url);
        const parsed = parseRefurbTrackerRssXml(xml, category);
        if (parsed.length > 0) {
          rssSuccess = true;
          liveItems.push(...parsed);
        }
      } catch (err) {
        console.log(`[info] Refurb Tracker RSS (${category}) スキップ/フォールバック: ${err.message}`);
      }
    }),
  );

  // 2) Apple公式 認定整備済製品ページ
  await Promise.all(
    APPLE_REFURBISHED_PAGES.map(async ({ category, url }) => {
      try {
        const html = await fetchTextWithTimeout(url);
        const parsed = parseAppleRefurbishedHtml(html, category);
        if (parsed.length > 0) {
          appleWebSuccess = true;
          liveItems.push(...parsed);
        }
      } catch (err) {
        console.log(`[info] Apple公式整備済ページ (${category}) スキップ/フォールバック: ${err.message}`);
      }
    }),
  );

  return {
    liveItems,
    rssStatus: rssSuccess ? 'live' : 'fallback',
    appleWebStatus: appleWebSuccess ? 'live' : 'fallback',
  };
}

/* ============================================================================
 * 4. 3ステップ自動名寄せ（マッチング）＆データ注入（Enrich）エンジン
 * ============================================================================ */

/**
 * タイトル文字列を NFKC 正規化し、比較用の標準形式に変換する
 */
export function normalizeRefurbTitle(rawTitle) {
  return String(rawTitle ?? '')
    .normalize('NFKC')
    .replace(/\[整備済製品\]|（整備済製品）|\(整備済製品\)|Apple認定整備済製品|整備済製品/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * タイトルからカテゴリ・モデル特徴・チップ（SoC）・画面サイズ・世代を抽出する（ステップA用）
 */
export function extractTitleFeaturesStepA(rawTitle, categoryHint = '') {
  const norm = normalizeRefurbTitle(rawTitle);
  const upper = norm.toUpperCase();

  // 1) カテゴリ判定
  let category = categoryHint;
  if (/MACBOOK|IMAC|MAC\s*MINI|MAC\s*STUDIO|MAC\s*PRO/i.test(norm)) category = 'Mac';
  else if (/\bIPAD\b/i.test(norm)) category = 'iPad';
  else if (/\bIPHONE\b/i.test(norm)) category = 'iPhone';
  else if (/APPLE\s*WATCH|\bWATCH\s*(?:SERIES|SE|ULTRA)\b/i.test(norm)) category = 'Apple Watch';
  else if (/\bAIRPODS\b/i.test(norm)) category = 'AirPods';

  // 2) チップ名（SoC）の抽出: M1〜M6 (Pro/Max/Ultra), A12〜A20 (Pro/Bionic), S5〜S11, H1/H2
  let chip = null;
  const mChip = norm.match(/\b(M[1-6](?:\s*(?:Ultra|Max|Pro))?)\b/i);
  const aChip = norm.match(/\b(A(?:1[2-9]|20)(?:\s*(?:Pro|Bionic|Z|X))?)\b/i);
  const sChip = norm.match(/\b(S(?:[5-9]|1[0-2]))(?:\s*SiP|\b)/i);
  const hChip = norm.match(/\b(H[12])\b/i);
  if (mChip) chip = mChip[1].replace(/\s+/g, ' ').trim();
  else if (aChip) chip = aChip[1].replace(/\s*Bionic/i, '').replace(/\s+/g, ' ').trim();
  else if (sChip) chip = sChip[1].toUpperCase();
  else if (hChip) chip = hChip[1].toUpperCase();

  // 3) 画面サイズ（インチ）の抽出 (13.6インチ -> 13, 15.3インチ -> 15, 14.2インチ -> 14, 16.2インチ -> 16, 12.9インチ -> 12.9)
  let screenInches = null;
  const inchMatch = norm.match(/(\d{2}(?:\.\d)?)\s*(?:インチ|-inch|inch|型)/i);
  if (inchMatch) {
    const rawStr = inchMatch[1];
    const rawInch = parseFloat(rawStr);
    if (rawStr === '12.9') screenInches = '12.9';
    else if (rawInch >= 13 && rawInch < 13.9) screenInches = '13';
    else if (rawInch >= 14 && rawInch < 14.9) screenInches = '14';
    else if (rawInch >= 15 && rawInch < 15.9) screenInches = '15';
    else if (rawInch >= 16 && rawInch < 16.9) screenInches = '16';
    else if (rawInch >= 10.5 && rawInch <= 11.5) screenInches = '11';
    else if (rawInch >= 23.5 && rawInch <= 24.5) screenInches = '24';
    else if (rawInch >= 26.5 && rawInch <= 27.5) screenInches = '27';
    else screenInches = String(Math.round(rawInch));
  }

  // 4) 世代番号 (第N世代 / Nth generation)
  let genNumber = null;
  const genMatch = norm.match(/(?:第\s*(\d+)\s*世代|(\d+)\s*(?:st|nd|rd|th)\s*generation)/i);
  if (genMatch) {
    genNumber = parseInt(genMatch[1] || genMatch[2], 10);
  }

  // 5) 発売年ヒント
  const yearMatch = norm.match(/\b(202[0-6])\b/);
  const releaseYear = yearMatch ? parseInt(yearMatch[1], 10) : null;

  return {
    norm,
    upper,
    category,
    chip,
    screenInches,
    genNumber,
    releaseYear,
  };
}

/**
 * 【ステップA】モデル名（iPhone 15 Pro, iPad Air 11インチ (M2), MacBook Air 13インチ (M3) 等）と
 * チップ名（M1/M2/M3/M4, A15/A16/A17/A18 等）で既存の products.json から該当 Product を特定する
 */
export function matchProductStepA(rawTitle, products, categoryHint = '', explicitProductId = '') {
  if (explicitProductId) {
    const direct = products.find((p) => p.id === explicitProductId);
    if (direct) return direct;
  }

  const feat = extractTitleFeaturesStepA(rawTitle, categoryHint);
  const candidates = products.filter(
    (p) =>
      (!feat.category || p.category === feat.category) &&
      Array.isArray(p.skus) &&
      p.skus.some((s) => (s.carriers?.apple?.currentPrice ?? s.priceHistory?.at(-1)?.appleStorePrice ?? 0) > 0),
  );

  if (candidates.length === 0) return null;

  let bestProduct = null;
  let bestScore = -Infinity;

  for (const p of candidates) {
    let score = 0;
    const pName = String(p.name ?? '').normalize('NFKC');
    const pId = String(p.id ?? '').toLowerCase();
    const pSoc = String(p.specs?.soc ?? '').normalize('NFKC');
    const pYear = parseInt(String(p.releaseDate ?? '').slice(0, 4), 10) || 0;

    // --- カテゴリ別のモデルファミリー厳密判定 ---
    if (p.category === 'Mac') {
      const families = [
        { re: /MacBook\s*Air/i, match: /MacBook\s*Air/i.test(feat.norm) },
        { re: /MacBook\s*Pro/i, match: /MacBook\s*Pro/i.test(feat.norm) },
        { re: /MacBook\s*Neo/i, match: /MacBook\s*Neo/i.test(feat.norm) },
        { re: /Mac\s*mini/i, match: /Mac\s*mini/i.test(feat.norm) },
        { re: /Mac\s*Studio/i, match: /Mac\s*Studio/i.test(feat.norm) },
        { re: /Mac\s*Pro/i, match: /Mac\s*Pro/i.test(feat.norm) },
        { re: /\biMac\b/i, match: /\biMac\b/i.test(feat.norm) },
      ];
      let familyMatched = false;
      let familyMismatch = false;
      for (const f of families) {
        const pHas = f.re.test(pName);
        if (f.match && pHas) familyMatched = true;
        else if (f.match !== pHas && (f.match || pHas)) familyMismatch = true;
      }
      if (familyMismatch && !familyMatched) continue;
      if (familyMatched) score += 100;

      // 画面サイズ (13 / 14 / 15 / 16 / 24)
      if (feat.screenInches) {
        const pInchMatch = pName.match(/(\d{2}(?:\.\d)?)\s*(?:インチ|-inch)/i);
        const pInch = pInchMatch ? String(Math.round(parseFloat(pInchMatch[1]))) : null;
        if (pInch === feat.screenInches) score += 60;
        else if (pInch && pInch !== feat.screenInches) score -= 80;
      }

      // iMac の 2ポート / 4ポート判定
      if (/\biMac\b/i.test(pName)) {
        const wantFour = /4\s*ポート|Four\s*Ports|ギガビットEthernet|10コアGPU/i.test(feat.norm);
        const wantTwo = /2\s*ポート|Two\s*Ports|7コアGPU|8コアGPU/i.test(feat.norm);
        const pIsFour = /Four\s*Ports|4ポート/i.test(pName) || /four-ports/i.test(pId);
        const pIsTwo = /Two\s*Ports|2ポート/i.test(pName) || /two-ports/i.test(pId);
        if (wantFour && pIsFour) score += 25;
        if (wantTwo && pIsTwo) score += 25;
        if (!wantFour && pIsTwo) score += 10;
      }

      // PROLED XDR の区別
      const wantProled = /PROLED/i.test(feat.norm);
      const pIsProled = /PROLED/i.test(pName);
      if (wantProled !== pIsProled) score -= 50;
    } else if (p.category === 'iPad') {
      const isProTitle = /iPad\s*Pro/i.test(feat.norm);
      const isAirTitle = /iPad\s*Air/i.test(feat.norm);
      const isMiniTitle = /iPad\s*mini/i.test(feat.norm);
      const isProProd = /iPad\s*Pro/i.test(pName);
      const isAirProd = /iPad\s*Air/i.test(pName);
      const isMiniProd = /iPad\s*mini/i.test(pName);

      if (isProTitle !== isProProd || isAirTitle !== isAirProd || isMiniTitle !== isMiniProd) {
        continue;
      }
      score += 100;

      // 画面サイズ (11 / 12.9 / 13)
      if (feat.screenInches) {
        if (pName.includes(`${feat.screenInches}-inch`) || pName.includes(`${feat.screenInches}インチ`)) {
          score += 60;
        } else if (/(11|12\.9|13)\s*(?:インチ|-inch)/i.test(pName)) {
          score -= 80;
        }
      }
    } else if (p.category === 'iPhone') {
      const mTitle = feat.norm.match(/iPhone\s*(SE|Duo|Air|\d{1,2}e?)(?:\s*(Pro\s*Max|Pro|Plus|mini))?/i);
      const mProd = pName.match(/iPhone\s*(SE|Duo|Air|\d{1,2}e?)(?:\s*(Pro\s*Max|Pro|Plus|mini))?/i);
      if (!mTitle || !mProd) continue;
      const baseTitle = mTitle[1].toUpperCase();
      const baseProd = mProd[1].toUpperCase();
      const subTitle = (mTitle[2] || '').replace(/\s+/g, ' ').toUpperCase();
      const subProd = (mProd[2] || '').replace(/\s+/g, ' ').toUpperCase();
      if (baseTitle !== baseProd || subTitle !== subProd) continue;
      score += 140;
    } else if (p.category === 'Apple Watch') {
      const isUltraTitle = /Ultra/i.test(feat.norm);
      const isSeTitle = /\bSE\b/i.test(feat.norm);
      const isUltraProd = /Ultra/i.test(pName);
      const isSeProd = /\bSE\b/i.test(pName);
      if (isUltraTitle !== isUltraProd || isSeTitle !== isSeProd) continue;

      if (isUltraTitle) {
        const uNumTitle = feat.norm.match(/Ultra\s*(\d+)/i)?.[1] ?? '1';
        const uNumProd = pName.match(/Ultra\s*(\d+)/i)?.[1] ?? '1';
        if (uNumTitle !== uNumProd) continue;
        score += 140;
      } else if (isSeTitle) {
        const seNumTitle =
          feat.genNumber ??
          (feat.norm.match(/SE\s*(\d+)/i)?.[1] ? parseInt(feat.norm.match(/SE\s*(\d+)/i)[1], 10) : 2);
        const seNumProd =
          pName.match(/(\d+)(?:st|nd|rd|th)/i)?.[1]
            ? parseInt(pName.match(/(\d+)(?:st|nd|rd|th)/i)[1], 10)
            : pName.match(/SE\s*(\d+)/i)?.[1]
              ? parseInt(pName.match(/SE\s*(\d+)/i)[1], 10)
              : 1;
        if (seNumTitle === seNumProd) score += 140;
        else continue;
      } else {
        const serTitle = feat.norm.match(/Series\s*(\d+)/i)?.[1];
        const serProd = pName.match(/Series\s*(\d+)/i)?.[1];
        if (serTitle && serProd && serTitle === serProd) score += 140;
        else continue;
      }
    } else if (p.category === 'AirPods') {
      const isMaxTitle = /\bMax\b/i.test(feat.norm);
      const isProTitle = /\bPro\b/i.test(feat.norm);
      const isMaxProd = /\bMax\b/i.test(pName);
      const isProProd = /\bPro\b/i.test(pName);
      if (isMaxTitle !== isMaxProd || isProTitle !== isProProd) continue;

      if (isMaxTitle) {
        const wantMax2 = /Max\s*2/i.test(feat.norm);
        const wantUsbC = /USB-C/i.test(feat.norm);
        if (wantMax2 && /Max\s*2/i.test(pName)) score += 140;
        else if (wantUsbC && /USB-C/i.test(pName)) score += 140;
        else if (!wantMax2 && !wantUsbC && pName === 'AirPods Max') score += 120;
        else score += 40;
      } else if (isProTitle) {
        const wantPro3 = /Pro\s*3|第3世代|3rd/i.test(feat.norm);
        if (wantPro3 && /Pro\s*3/i.test(pName)) score += 140;
        else if (!wantPro3 && /2nd|第2世代/i.test(pName)) score += 140;
      } else {
        const numTitle = feat.norm.match(/AirPods\s*([345])/i)?.[1] ?? (feat.genNumber ? String(feat.genNumber) : '');
        const wantAnc = /ノイズキャンセリング|Active\s*Noise\s*Cancellation|ANC/i.test(feat.norm);
        const pHasAnc = /Active\s*Noise\s*Cancellation/i.test(pName);
        if (numTitle && pName.includes(numTitle)) score += 100;
        if (wantAnc === pHasAnc) score += 40;
        else score -= 40;
      }
    }

    // --- チップ名（M1/M2/M3/M4/M5/M6, A14〜A20 等）の一致判定 ---
    if (feat.chip) {
      const escapedChip = feat.chip.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const chipRegex = new RegExp(`\\b${escapedChip}(?!\\s*(?:Pro|Max|Ultra))\\b`, 'i');
      if (chipRegex.test(pName) || chipRegex.test(pSoc)) {
        score += 90;
      } else {
        score -= 70;
      }
    }

    // --- 世代番号の一致判定 ---
    if (feat.genNumber != null) {
      const genPatterns = [
        new RegExp(`第\\s*${feat.genNumber}\\s*世代`, 'i'),
        new RegExp(`\\b${feat.genNumber}(?:st|nd|rd|th)\\s*generation\\b`, 'i'),
      ];
      if (genPatterns.some((re) => re.test(pName) || re.test(String(p.generation ?? '')))) {
        score += 75;
      }
    }

    // --- 発売年の一致・近似ボーナス ---
    if (feat.releaseYear && pYear === feat.releaseYear) {
      score += 35;
    } else if (pYear >= 2022 && pYear <= 2026) {
      score += (pYear - 2020) * 2;
    }

    if (score > bestScore) {
      bestScore = score;
      bestProduct = p;
    }
  }

  return bestScore >= 60 ? bestProduct : null;
}

/**
 * 【ステップB】容量（128GB / 256GB / 512GB / 1TB）やメモリ構成（8GB/256GB, 16GB/512GB）、
 * 通信方式（Wi-Fi / Cellular / GPS）で該当 SKU を特定する
 */
export function matchSkuStepB(rawTitle, product, refurbishedPrice = 0, explicitSkuId = '') {
  if (!product || !Array.isArray(product.skus) || product.skus.length === 0) return null;

  if (explicitSkuId) {
    const direct = product.skus.find((s) => s.id === explicitSkuId);
    if (direct) return direct;
  }

  const norm = normalizeRefurbTitle(rawTitle);

  // 1) 通信方式の判定
  const hasCellular = /Cellular|セルラー/i.test(norm);
  let targetRamGb = null;
  let targetStorageToken = null;
  let targetMm = null;

  if (product.category === 'Mac') {
    // パターン1: "16GB/512GB" や "8GB / 256GB"
    const slashMatch = norm.match(/\b(\d{1,3})\s*GB\s*[/／]\s*(\d{1,4})\s*(GB|TB)\b/i);
    if (slashMatch) {
      targetRamGb = parseInt(slashMatch[1], 10);
      targetStorageToken = `${slashMatch[2]}${slashMatch[3].toUpperCase()}`;
    } else {
      // パターン2: "16GBユニファイドメモリ ... 512GB SSD" または連続する容量トークン
      const allCapTokens = [...norm.matchAll(/\b(\d{1,4})\s*(GB|TB)\b/gi)].map((m) => ({
        num: parseInt(m[1], 10),
        unit: m[2].toUpperCase(),
        raw: `${m[1]}${m[2].toUpperCase()}`,
      }));
      const ramCandidates = allCapTokens.filter(
        (t) => t.unit === 'GB' && [8, 16, 18, 24, 32, 36, 48, 64, 96, 128, 192].includes(t.num),
      );
      const ssdCandidates = allCapTokens.filter(
        (t) => t.unit === 'TB' || (t.unit === 'GB' && [128, 256, 512, 1024].includes(t.num)),
      );
      if (ramCandidates.length > 0) targetRamGb = ramCandidates[0].num;
      if (ssdCandidates.length > 0) targetStorageToken = ssdCandidates.at(-1).raw;
    }
  } else if (product.category === 'Apple Watch') {
    const mmMatch = norm.match(/\b(38|40|41|42|44|45|46|49)\s*mm\b/i);
    if (mmMatch) targetMm = `${mmMatch[1]}mm`;
  } else {
    // iPhone / iPad
    const storMatches = [...norm.matchAll(/\b(32|64|128|256|512)\s*GB\b|\b([12])\s*TB\b/gi)];
    if (storMatches.length > 0) {
      const last = storMatches.at(-1);
      targetStorageToken = last[1] ? `${last[1]}GB` : `${last[2]}TB`;
    }
  }

  let bestSku = product.skus[0];
  let bestScore = -Infinity;

  for (const sku of product.skus) {
    let score = 0;
    const skuLabel = `${sku.label || ''} ${sku.storage || ''}`.normalize('NFKC');
    const skuConn = String(sku.connectivity || '-').normalize('NFKC');
    const skuApplePrice =
      sku.carriers?.apple?.currentPrice ?? sku.priceHistory?.at(-1)?.appleStorePrice ?? 0;

    if (skuApplePrice <= 0) continue;

    // 通信方式の比較 (iPad / Apple Watch)
    if (product.category === 'iPad' || product.category === 'Apple Watch') {
      const skuIsCell = /Cellular/i.test(skuConn) || /Cellular/i.test(skuLabel);
      if (hasCellular === skuIsCell) score += 60;
      else score -= 60;
    }

    // Mac の RAM / SSD 比較
    if (product.category === 'Mac') {
      const skuSlash = skuLabel.match(/\b(\d{1,3})\s*GB\s*[/／]\s*(\d{1,4})\s*(GB|TB)\b/i);
      const skuRam = skuSlash
        ? parseInt(skuSlash[1], 10)
        : parseInt(String(product.specs?.ram ?? '').match(/(\d+)/)?.[1] ?? '0', 10);
      const skuStor = skuSlash
        ? `${skuSlash[2]}${skuSlash[3].toUpperCase()}`
        : skuLabel.match(/\b(128GB|256GB|512GB|1TB|2TB|4TB|8TB)\b/i)?.[1]?.toUpperCase() ?? '';

      if (targetRamGb && skuRam === targetRamGb) score += 50;
      else if (targetRamGb && skuRam && skuRam !== targetRamGb) score -= 35;

      if (targetStorageToken && skuStor === targetStorageToken) score += 60;
      else if (targetStorageToken && skuStor && skuStor !== targetStorageToken) score -= 45;
    } else if (product.category === 'Apple Watch') {
      if (targetMm && skuLabel.toLowerCase().includes(targetMm.toLowerCase())) {
        score += 70;
      }
    } else if (targetStorageToken) {
      const storRegex = new RegExp(`\\b${targetStorageToken}\\b`, 'i');
      if (storRegex.test(skuLabel)) score += 75;
      else score -= 50;
    }

    // 価格の近似度ボーナス（整備済価格が新品価格の約75〜92%に収まるか）
    if (refurbishedPrice > 0 && skuApplePrice > 0) {
      const expectedRefurb = skuApplePrice * 0.85;
      const diffRatio = Math.abs(refurbishedPrice - expectedRefurb) / skuApplePrice;
      score += Math.max(0, 25 - Math.round(diffRatio * 100));
    }

    if (score > bestScore) {
      bestScore = score;
      bestSku = sku;
    }
  }

  return bestSku;
}

/**
 * 【ステップC】紐付いた既存 Product & SKU から詳細データを注入（Enrich）する
 */
export function enrichRefurbishedItemStepC(rawItem, product, sku) {
  const dbNewPrice =
    sku.carriers?.apple?.currentPrice ??
    sku.priceHistory?.at(-1)?.appleStorePrice ??
    sku.carriers?.apple?.launchPrice ??
    0;
  const dbLaunchPrice =
    sku.priceHistory?.[0]?.appleStorePrice ?? sku.carriers?.apple?.launchPrice ?? dbNewPrice;

  const refurbishedPrice =
    rawItem.refurbishedPrice && rawItem.refurbishedPrice > 0
      ? rawItem.refurbishedPrice
      : calcStandardRefurbishedPrice(dbNewPrice);

  // 万一整備済価格が現行価格以上の場合は発売時価格または逆算新品定価を基準にする
  const originalNewPrice =
    dbNewPrice > refurbishedPrice
      ? dbNewPrice
      : dbLaunchPrice > refurbishedPrice
        ? dbLaunchPrice
        : Math.round((refurbishedPrice / 0.85) / 100) * 100;

  const discountAmount = Math.max(0, originalNewPrice - refurbishedPrice);
  const discountPercent =
    originalNewPrice > 0 ? Math.round((discountAmount / originalNewPrice) * 1000) / 10 : 0;

  // 中古最安値・ショップ情報の抽出 (usedPricing)
  const up = sku.usedPricing ?? null;
  const isYahooLowest = up?.lowestPlatform === 'yahoo';
  const primaryOffer = isYahooLowest ? (up?.yahoo ?? up?.rakuten) : (up?.rakuten ?? up?.yahoo);
  const usedLowestPrice =
    typeof up?.lowestPrice === 'number' && up.lowestPrice > 0
      ? up.lowestPrice
      : typeof primaryOffer?.price === 'number' && primaryOffer.price > 0
        ? primaryOffer.price
        : null;

  const usedIsEstimated = Boolean(up?.isEstimated ?? !primaryOffer?.shopName);
  const usedPlatform = up?.lowestPlatform === 'yahoo' ? 'yahoo' : 'rakuten';
  const usedShopName =
    primaryOffer?.shopName && primaryOffer.shopName.trim().length > 0
      ? primaryOffer.shopName.trim()
      : usedPlatform === 'yahoo'
        ? 'Yahoo!ショッピング（じゃんぱら・イオシス・ソフマップ等）最安相場'
        : '楽天市場（イオシス・じゃんぱら・ゲオ等）最安相場';

  const usedUrl =
    primaryOffer?.url ||
    up?.yahoo?.url ||
    up?.rakuten?.url ||
    `https://search.rakuten.co.jp/search/mall/${encodeURIComponent(`${product.name} ${sku.storage || sku.label} 中古`)}/`;

  const priceGapVsUsed =
    usedLowestPrice != null && usedLowestPrice > 0 ? refurbishedPrice - usedLowestPrice : null;

  const releaseYear = parseInt(String(product.releaseDate ?? '').slice(0, 4), 10) || 2024;
  const skuRamMatch = `${sku.label} ${sku.storage}`.match(/\b(\d{1,3}GB)\s*[/／]/i);
  const ram = skuRamMatch ? skuRamMatch[1].toUpperCase() : product.specs?.ram || undefined;

  const stockStatus = rawItem.stockStatus === 'Live' ? 'Live' : 'Reference';
  const stockLabel = stockStatus === 'Live' ? '実在庫（Live）' : '参考整備済相場（Reference）';

  return {
    id: `refurb-${product.id}-${sku.id}`.toLowerCase().replace(/[^a-z0-9-]+/g, '-'),
    title: rawItem.displayTitle || rawItem.title,
    category: product.category,
    productId: product.id,
    productName: product.name,
    skuId: sku.id,
    skuLabel: sku.label || sku.storage || '標準',
    storage: sku.storage || sku.label || '',
    connectivity: sku.connectivity || '-',
    refurbishedPrice,
    originalNewPrice,
    isOriginalDiscontinued: Boolean(sku.isDiscontinued || product.isDiscontinued),
    discountAmount,
    discountPercent,
    usedLowestPrice,
    usedShopName,
    usedUrl,
    usedPlatform,
    usedIsEstimated,
    rakutenUsedPrice: up?.rakuten?.price ?? null,
    rakutenUsedUrl: up?.rakuten?.url ?? undefined,
    yahooUsedPrice: up?.yahoo?.price ?? null,
    yahooUsedUrl: up?.yahoo?.url ?? undefined,
    priceGapVsUsed,
    url: rawItem.url || APPLE_REFURB_CATEGORY_URLS[product.category] || 'https://www.apple.com/jp/shop/refurbished',
    stockStatus,
    stockLabel,
    source: rawItem.source || (stockStatus === 'Live' ? 'apple_official_web' : 'catalog_reference'),
    publishedAt: rawItem.publishedAt || new Date().toISOString(),
    specs: {
      soc: product.specs?.soc || undefined,
      ram,
      weight: product.specs?.weight || undefined,
      releaseYear,
      releaseDate: product.releaseDate || undefined,
      display: product.specs?.display || undefined,
      battery: product.specs?.battery || undefined,
      ports: product.specs?.ports || undefined,
      os: product.specs?.os || undefined,
    },
  };
}

/**
 * 1件の軽量整備済データ（title, refurbishedPrice, url）をステップA→B→Cで名寄せ・Enrichする
 */
export function matchAndEnrichRefurbishedItem(rawItem, products) {
  const product = matchProductStepA(
    rawItem.title,
    products,
    rawItem.category,
    rawItem.productId,
  );
  if (!product) return null;

  const sku = matchSkuStepB(
    rawItem.title,
    product,
    rawItem.refurbishedPrice,
    rawItem.skuId,
  );
  if (!sku) return null;

  return enrichRefurbishedItemStepC(rawItem, product, sku);
}

/* ============================================================================
 * 5. セカンダリ（フォールバック）: カタログ主要モデルからの整備済相場シード生成
 * ============================================================================ */

/**
 * 外部フィードが通信エラーや在庫切れの場合でも、全カテゴリ（Mac / iPad / iPhone / Apple Watch / AirPods）で
 * 完全な比較ができるよう、Apple認定整備済製品の主要ラインナップ（タイトル・整備済実勢価格・URL）を生成する。
 * 生成されたシードもライブ取得時と全く同じ3ステップ名寄せパイプライン（Step A -> B -> C）を通過する。
 */
export const REFERENCE_CATALOG_SEEDS = [
  // ======================== Mac ========================
  {
    category: 'Mac',
    title: 'Mac mini [整備済製品] 10コアCPUと10コアGPUを搭載したApple M6チップ 16GB/256GB',
    refurbishedPrice: 120800,
    url: 'https://www.apple.com/jp/shop/refurbished/mac/mac-mini',
  },
  {
    category: 'Mac',
    title: '13インチMacBook Air [整備済製品] 10コアCPUと8コアGPUを搭載したApple M4チップ 16GB/256GB - スカイブルー',
    refurbishedPrice: 139800,
    url: 'https://www.apple.com/jp/shop/refurbished/mac/macbook-air',
  },
  {
    category: 'Mac',
    title: '13インチMacBook Air [整備済製品] 10コアCPUと10コアGPUを搭載したApple M4チップ 16GB/512GB - ミッドナイト',
    refurbishedPrice: 164800,
    url: 'https://www.apple.com/jp/shop/refurbished/mac/macbook-air',
  },
  {
    category: 'Mac',
    title: '15インチMacBook Air [整備済製品] 10コアCPUと10コアGPUを搭載したApple M4チップ 16GB/256GB - スターライト',
    refurbishedPrice: 168800,
    url: 'https://www.apple.com/jp/shop/refurbished/mac/macbook-air',
  },
  {
    category: 'Mac',
    title: '13インチMacBook Air [整備済製品] 8コアCPUと8コアGPUを搭載したApple M3チップ 16GB/256GB - スペースグレイ (2024)',
    refurbishedPrice: 134800,
    url: 'https://www.apple.com/jp/shop/refurbished/mac/macbook-air',
  },
  {
    category: 'Mac',
    title: '13インチMacBook Air [整備済製品] 8コアCPUと10コアGPUを搭載したApple M3チップ 16GB/512GB - ミッドナイト (2024)',
    refurbishedPrice: 159800,
    url: 'https://www.apple.com/jp/shop/refurbished/mac/macbook-air',
  },
  {
    category: 'Mac',
    title: '13インチMacBook Air [整備済製品] 8コアCPUと8コアGPUを搭載したApple M2チップ 8GB/256GB - ミッドナイト',
    refurbishedPrice: 119800,
    url: 'https://www.apple.com/jp/shop/refurbished/mac/macbook-air',
  },
  {
    category: 'Mac',
    title: '14インチMacBook Pro [整備済製品] 10コアCPUと10コアGPUを搭載したApple M4チップ 16GB/512GB - スペースブラック (2024)',
    refurbishedPrice: 210800,
    url: 'https://www.apple.com/jp/shop/refurbished/mac/macbook-pro',
  },
  {
    category: 'Mac',
    title: '14インチMacBook Pro [整備済製品] 12コアCPUと16コアGPUを搭載したApple M4 Proチップ 24GB/512GB - スペースブラック (2024)',
    refurbishedPrice: 278800,
    url: 'https://www.apple.com/jp/shop/refurbished/mac/macbook-pro',
  },
  {
    category: 'Mac',
    title: '16インチMacBook Pro [整備済製品] 14コアCPUと20コアGPUを搭載したApple M4 Proチップ 24GB/512GB - スペースブラック (2024)',
    refurbishedPrice: 338800,
    url: 'https://www.apple.com/jp/shop/refurbished/mac/macbook-pro',
  },
  {
    category: 'Mac',
    title: 'Mac mini [整備済製品] 10コアCPUと10コアGPUを搭載したApple M4チップ 16GB/256GB (2024)',
    refurbishedPrice: 114800,
    url: 'https://www.apple.com/jp/shop/refurbished/mac/mac-mini',
  },
  {
    category: 'Mac',
    title: 'Mac mini [整備済製品] 8コアCPUと10コアGPUを搭載したApple M2チップ 8GB/256GB (2023)',
    refurbishedPrice: 71800,
    url: 'https://www.apple.com/jp/shop/refurbished/mac/mac-mini',
  },
  {
    category: 'Mac',
    title: '24インチiMac [整備済製品] 8コアCPUと8コアGPUを搭載したApple M4チップ 16GB/256GB (2ポート, 2024)',
    refurbishedPrice: 211800,
    url: 'https://www.apple.com/jp/shop/refurbished/mac/imac',
  },
  {
    category: 'Mac',
    title: 'Mac Studio [整備済製品] 14コアCPUと32コアGPUを搭載したApple M4 Maxチップ 36GB/512GB (2025)',
    refurbishedPrice: 356800,
    url: 'https://www.apple.com/jp/shop/refurbished/mac/mac-studio',
  },

  // ======================== iPad ========================
  {
    category: 'iPad',
    title: 'iPad mini Wi-Fi 128GB - スペースグレイ（A20 Pro）[整備済製品]',
    refurbishedPrice: 101800,
    url: 'https://www.apple.com/jp/shop/refurbished/ipad/ipad-mini',
  },
  {
    category: 'iPad',
    title: 'iPad mini Wi-Fi 256GB - スターライト（A20 Pro）[整備済製品]',
    refurbishedPrice: 115800,
    url: 'https://www.apple.com/jp/shop/refurbished/ipad/ipad-mini',
  },
  {
    category: 'iPad',
    title: 'iPad Wi-Fi 64GB - ブルー（第10世代）[整備済製品]',
    refurbishedPrice: 49800,
    url: 'https://www.apple.com/jp/shop/refurbished/ipad/ipad',
  },
  {
    category: 'iPad',
    title: 'iPad Wi-Fi 128GB - シルバー（A16）[整備済製品]',
    refurbishedPrice: 63400,
    url: 'https://www.apple.com/jp/shop/refurbished/ipad/ipad',
  },
  {
    category: 'iPad',
    title: '11インチiPad Air Wi-Fi 128GB - スペースグレイ（M3）[整備済製品]',
    refurbishedPrice: 83800,
    url: 'https://www.apple.com/jp/shop/refurbished/ipad/ipad-air',
  },
  {
    category: 'iPad',
    title: '11インチiPad Air Wi-Fi 128GB - スターライト（M2）[整備済製品]',
    refurbishedPrice: 83800,
    url: 'https://www.apple.com/jp/shop/refurbished/ipad/ipad-air',
  },
  {
    category: 'iPad',
    title: '13インチiPad Air Wi-Fi 128GB - スペースグレイ（M2）[整備済製品]',
    refurbishedPrice: 108800,
    url: 'https://www.apple.com/jp/shop/refurbished/ipad/ipad-air',
  },
  {
    category: 'iPad',
    title: 'iPad mini Wi-Fi 128GB - パープル（A17 Pro）[整備済製品]',
    refurbishedPrice: 84800,
    url: 'https://www.apple.com/jp/shop/refurbished/ipad/ipad-mini',
  },
  {
    category: 'iPad',
    title: '11インチiPad Pro Wi-Fi 256GB - スペースブラック（M4）[整備済製品]',
    refurbishedPrice: 142800,
    url: 'https://www.apple.com/jp/shop/refurbished/ipad/ipad-pro',
  },
  {
    category: 'iPad',
    title: '13インチiPad Pro Wi-Fi 256GB - スペースブラック（M4）[整備済製品]',
    refurbishedPrice: 185800,
    url: 'https://www.apple.com/jp/shop/refurbished/ipad/ipad-pro',
  },
  {
    category: 'iPad',
    title: '11インチiPad Pro Wi-Fi 128GB - スペースグレイ（第4世代 M2）[整備済製品]',
    refurbishedPrice: 105800,
    url: 'https://www.apple.com/jp/shop/refurbished/ipad/ipad-pro',
  },

  // ======================== iPhone ========================
  {
    category: 'iPhone',
    title: 'iPhone 16 256GB ウルトラマリン（SIMフリー）[整備済製品]',
    refurbishedPrice: 118800,
    url: 'https://www.apple.com/jp/shop/refurbished/iphone/iphone-16',
  },
  {
    category: 'iPhone',
    title: 'iPhone 16 Plus 128GB ブラック（SIMフリー）[整備済製品]',
    refurbishedPrice: 122800,
    url: 'https://www.apple.com/jp/shop/refurbished/iphone/iphone-16-plus',
  },
  {
    category: 'iPhone',
    title: 'iPhone 15 128GB ブラック（SIMフリー）[整備済製品]',
    refurbishedPrice: 95800,
    url: 'https://www.apple.com/jp/shop/refurbished/iphone/iphone-15',
  },
  {
    category: 'iPhone',
    title: 'iPhone 15 Plus 256GB ブルー（SIMフリー）[整備済製品]',
    refurbishedPrice: 118800,
    url: 'https://www.apple.com/jp/shop/refurbished/iphone/iphone-15-plus',
  },
  {
    category: 'iPhone',
    title: 'iPhone SE（第3世代）256GB ミッドナイト（SIMフリー）[整備済製品]',
    refurbishedPrice: 71800,
    url: 'https://www.apple.com/jp/shop/refurbished/iphone',
  },
  {
    category: 'iPhone',
    title: 'iPhone 16 128GB ブラック（SIMフリー）[整備済製品]',
    refurbishedPrice: 118800,
    url: 'https://www.apple.com/jp/shop/refurbished/iphone/iphone-16',
  },
  {
    category: 'iPhone',
    title: 'iPhone 16e 128GB ホワイト（SIMフリー）[整備済製品]',
    refurbishedPrice: 84800,
    url: 'https://www.apple.com/jp/shop/refurbished/iphone',
  },
  {
    category: 'iPhone',
    title: 'iPhone 16 Pro 128GB デザートチタニウム（SIMフリー）[整備済製品]',
    refurbishedPrice: 135800,
    url: 'https://www.apple.com/jp/shop/refurbished/iphone/iphone-16-pro',
  },
  {
    category: 'iPhone',
    title: 'iPhone 15 Pro 128GB ナチュラルチタニウム（SIMフリー）[整備済製品]',
    refurbishedPrice: 135800,
    url: 'https://www.apple.com/jp/shop/refurbished/iphone/iphone-15-pro',
  },
  {
    category: 'iPhone',
    title: 'iPhone 15 Pro 256GB ブラックチタニウム（SIMフリー）[整備済製品]',
    refurbishedPrice: 148800,
    url: 'https://www.apple.com/jp/shop/refurbished/iphone/iphone-15-pro',
  },
  {
    category: 'iPhone',
    title: 'iPhone 15 Pro Max 256GB ナチュラルチタニウム（SIMフリー）[整備済製品]',
    refurbishedPrice: 160800,
    url: 'https://www.apple.com/jp/shop/refurbished/iphone/iphone-15-pro',
  },
  {
    category: 'iPhone',
    title: 'iPhone 14 128GB ミッドナイト（SIMフリー）[整備済製品]',
    refurbishedPrice: 81400,
    url: 'https://www.apple.com/jp/shop/refurbished/iphone/iphone-14',
  },
  {
    category: 'iPhone',
    title: 'iPhone 14 Pro 128GB スペースブラック（SIMフリー）[整備済製品]',
    refurbishedPrice: 126800,
    url: 'https://www.apple.com/jp/shop/refurbished/iphone/iphone-14-pro',
  },

  // ======================== Apple Watch ========================
  {
    category: 'Apple Watch',
    title: 'Apple Watch SE 3（GPSモデル）- 40mmミッドナイトアルミニウムケース [整備済製品]',
    refurbishedPrice: 35400,
    url: 'https://www.apple.com/jp/shop/refurbished/watch/apple-watch-se',
  },
  {
    category: 'Apple Watch',
    title: 'Apple Watch Series 12（GPSモデル）- 42mmジェットブラックアルミニウムケース [整備済製品]',
    refurbishedPrice: 60800,
    url: 'https://www.apple.com/jp/shop/refurbished/watch',
  },
  {
    category: 'Apple Watch',
    title: 'Apple Watch Series 10（GPSモデル）- 42mmジェットブラックアルミニウムケース [整備済製品]',
    refurbishedPrice: 50800,
    url: 'https://www.apple.com/jp/shop/refurbished/watch/apple-watch-series-10',
  },
  {
    category: 'Apple Watch',
    title: 'Apple Watch Series 10（GPS + Cellularモデル）- 46mmナチュラルチタニウムケース [整備済製品]',
    refurbishedPrice: 68400,
    url: 'https://www.apple.com/jp/shop/refurbished/watch/apple-watch-series-10',
  },
  {
    category: 'Apple Watch',
    title: 'Apple Watch Series 11（GPSモデル）- 42mmシルバーアルミニウムケース [整備済製品]',
    refurbishedPrice: 60800,
    url: 'https://www.apple.com/jp/shop/refurbished/watch',
  },
  {
    category: 'Apple Watch',
    title: 'Apple Watch SE（第2世代）（GPSモデル）- 40mmスターライトアルミニウムケース [整備済製品]',
    refurbishedPrice: 29400,
    url: 'https://www.apple.com/jp/shop/refurbished/watch/apple-watch-se',
  },
  {
    category: 'Apple Watch',
    title: 'Apple Watch Series 9（GPSモデル）- 41mmミッドナイトアルミニウムケース [整備済製品]',
    refurbishedPrice: 50800,
    url: 'https://www.apple.com/jp/shop/refurbished/watch/apple-watch-series-9',
  },
  {
    category: 'Apple Watch',
    title: 'Apple Watch Ultra 2（GPS + Cellularモデル）- 49mmナチュラルチタニウムケース [整備済製品]',
    refurbishedPrice: 108800,
    url: 'https://www.apple.com/jp/shop/refurbished/watch/apple-watch-ultra',
  },

  // ======================== AirPods ========================
  {
    category: 'AirPods',
    title: 'AirPods 4 [整備済製品]',
    refurbishedPrice: 19800,
    url: 'https://www.apple.com/jp/shop/refurbished/airpods',
  },
  {
    category: 'AirPods',
    title: 'AirPods 4 アクティブノイズキャンセリング搭載 [整備済製品]',
    refurbishedPrice: 27800,
    url: 'https://www.apple.com/jp/shop/refurbished/airpods',
  },
  {
    category: 'AirPods',
    title: 'AirPods Pro 3 [整備済製品]',
    refurbishedPrice: 35800,
    url: 'https://www.apple.com/jp/shop/refurbished/airpods',
  },
  {
    category: 'AirPods',
    title: 'AirPods Pro（第2世代）MagSafe充電ケース（USB-C）[整備済製品]',
    refurbishedPrice: 33600,
    url: 'https://www.apple.com/jp/shop/refurbished/airpods',
  },
  {
    category: 'AirPods',
    title: 'AirPods Max（USB-C）- ミッドナイト [整備済製品]',
    refurbishedPrice: 71800,
    url: 'https://www.apple.com/jp/shop/refurbished/airpods',
  },
];

/* ============================================================================
 * 6. メイン実行関数 (`runFetchRefurbished`)
 * ============================================================================ */

export async function runFetchRefurbished() {
  console.log('🔄 Apple認定整備済製品データの取得＆既存DB（products.json）とのスマート名寄せを開始します...');
  const products = loadExistingProductsDatabase();
  if (products.length === 0) {
    throw new Error('既存製品データベース (public/products.json / data/catalog/) が見つかりません。');
  }

  // 1) プライマリ取得: Refurb Tracker RSS & Apple公式整備済ページ
  const { liveItems, rssStatus, appleWebStatus } = await fetchLiveRefurbishedItems();

  const enrichedMap = new Map();
  let liveMatchedCount = 0;
  let referenceMatchedCount = 0;

  // 実在庫アイテムを3ステップ名寄せパイプラインで処理
  for (const raw of liveItems) {
    const enriched = matchAndEnrichRefurbishedItem(
      { ...raw, stockStatus: 'Live' },
      products,
    );
    if (!enriched) continue;
    const dedupeKey = `${enriched.productId}:${enriched.skuId}`;
    const prev = enrichedMap.get(dedupeKey);
    if (!prev || enriched.refurbishedPrice < prev.refurbishedPrice) {
      enrichedMap.set(dedupeKey, enriched);
      if (!prev) liveMatchedCount++;
    }
  }

  // 2) セカンダリ（フォールバック）: 外部フィードがエラーまたは在庫切れのカテゴリ・主要モデルを補完
  for (const seed of REFERENCE_CATALOG_SEEDS) {
    const enriched = matchAndEnrichRefurbishedItem(
      {
        ...seed,
        stockStatus: 'Reference',
        source: 'catalog_reference',
      },
      products,
    );
    if (!enriched) {
      console.warn(`[warn] シードの名寄せ未一致: ${seed.title}`);
      continue;
    }
    const dedupeKey = `${enriched.productId}:${enriched.skuId}`;
    // すでに実在庫 (Live) として取得済みのSKUは Live を優先維持
    if (!enrichedMap.has(dedupeKey)) {
      enrichedMap.set(dedupeKey, enriched);
      referenceMatchedCount++;
    }
  }

  const items = Array.from(enrichedMap.values());

  const dataset = {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    sources: {
      refurbTrackerRss: rssStatus,
      appleOfficialWeb: appleWebStatus,
      liveCount: liveMatchedCount,
      referenceCount: referenceMatchedCount,
      totalCount: items.length,
    },
    items,
  };

  mkdirSync('public', { recursive: true });
  writeFileSync(OUTPUT_PATH, JSON.stringify(dataset, null, 2));

  console.log(`✅ ${OUTPUT_PATH} を生成しました。`);
  console.log(
    `   合計: ${items.length}件 (実在庫 Live: ${liveMatchedCount}件 / 参考整備済相場 Reference: ${referenceMatchedCount}件)`,
  );
  return dataset;
}

if (typeof process !== 'undefined' && process.argv?.[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runFetchRefurbished().catch((err) => {
    console.error('[error] scripts/fetch-refurbished.mjs failed:', err);
    process.exitCode = 1;
  });
}
