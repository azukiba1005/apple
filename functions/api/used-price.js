// Cloudflare Pages Function: /api/used-price
// 環境変数 RAKUTEN_APP_ID が設定されている場合は楽天市場 商品検索API (IchibaItem/Search/20220601) を呼び出し、
// 未設定の場合は推定相場（フォールバック）を返します。
import { searchRakutenUsedPrice } from '../../data/fetch-used-prices.mjs';

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const productName = url.searchParams.get('productName') || 'iPhone 15';
  const storage = url.searchParams.get('storage') || '128GB';
  const category = url.searchParams.get('category') || 'iPhone';
  const launchPrice = Number(url.searchParams.get('launchPrice') || 0) || 98800;
  const releaseDate = url.searchParams.get('releaseDate') || '2023-09-22';
  const appId = context.env?.RAKUTEN_APP_ID || '';
  const affiliateId = context.env?.RAKUTEN_AFFILIATE_ID || '';
  const accessKey = context.env?.RAKUTEN_ACCESS_KEY || '';

  const data = await searchRakutenUsedPrice({
    productName,
    storage,
    category,
    launchPrice,
    releaseDate,
    appId,
    affiliateId,
    accessKey,
  });

  return new Response(JSON.stringify(data), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=1800',
    },
  });
}

