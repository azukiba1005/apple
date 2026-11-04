// Cloudflare Pages Function: /api/used-price
// 環境変数 RAKUTEN_APP_ID / YAHOO_APP_ID が設定されている場合は
// 楽天市場APIおよびYahoo!ショッピングAPI (v3) を呼び出し、横断比較データを返します。
import { searchRakutenUsedPrice } from '../../scripts/fetch-live-prices.mjs';

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const productName = url.searchParams.get('productName') || 'iPhone 15';
  const storage = url.searchParams.get('storage') || '128GB';
  const category = url.searchParams.get('category') || 'iPhone';
  const launchPrice = Number(url.searchParams.get('launchPrice') || 0) || 98800;
  const releaseDate = url.searchParams.get('releaseDate') || '2023-09-22';
  const appId = String(context.env?.RAKUTEN_APP_ID ?? '').trim();
  const affiliateId = String(context.env?.RAKUTEN_AFFILIATE_ID ?? '').trim();
  const accessKey = String(context.env?.RAKUTEN_ACCESS_KEY ?? '').trim();
  const yahooAppId = String(context.env?.YAHOO_APP_ID ?? '').trim();

  const data = await searchRakutenUsedPrice({
    productName,
    storage,
    category,
    launchPrice,
    releaseDate,
    appId,
    affiliateId,
    accessKey,
    yahooAppId,
  });

  return new Response(JSON.stringify(data), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=1800',
    },
  });
}
