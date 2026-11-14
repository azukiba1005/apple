import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { configureRuntimeEnv, searchRakutenUsedPrice } from './scripts/fetch-live-prices.mjs';
import { MOSHIMO_DEFAULT_AIDS } from './scripts/lib/moshimo.mjs';

/**
 * 開発/プレビューサーバー用 `/api/used-price` ミドルウェア
 * （本番は Cloudflare Pages Functions: functions/api/used-price.js）
 * 楽天市場は APIキー不要の公開検索ページ抽出、Yahoo!は YAHOO_CLIENT_ID で取得。
 */
function usedPriceProxy(envConfig: { yahooClientId: string; rakutenProxyUrl: string }): Plugin {
  const attachMiddleware = (middlewares: any) => {
    middlewares.use('/api/used-price', async (req: any, res: any) => {
      try {
        const url = new URL(req.url ?? '', 'http://localhost');
        const productName = url.searchParams.get('productName') || 'iPhone 15';
        const storage = url.searchParams.get('storage') || '128GB';
        const category = url.searchParams.get('category') || 'iPhone';
        const launchPrice = Number(url.searchParams.get('launchPrice') || 0) || 98800;
        const releaseDate = url.searchParams.get('releaseDate') || '2023-09-22';

        const result = await searchRakutenUsedPrice({
          productName,
          storage,
          category,
          launchPrice,
          releaseDate,
          yahooAppId: envConfig.yahooClientId,
          proxyUrl: envConfig.rakutenProxyUrl,
        });

        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify(result));
      } catch (err: any) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ error: err?.message ?? 'Internal Error' }));
      }
    });
  };

  return {
    name: 'used-price-proxy',
    configureServer(server) {
      attachMiddleware(server.middlewares);
    },
    configurePreviewServer(server) {
      attachMiddleware(server.middlewares);
    },
  };
}

// base './' = GitHub Pages / Cloudflare Pages どちらでも動く相対パス
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const pick = (...keys: string[]) =>
    keys.map((k) => String(process.env[k] || env[k] || '').trim()).find(Boolean) ?? '';

  const yahooClientId = pick('YAHOO_CLIENT_ID', 'YAHOO_APP_ID', 'VITE_YAHOO_CLIENT_ID', 'VITE_YAHOO_APP_ID');
  const rakutenProxyUrl = pick('RAKUTEN_PROXY_URL');
  // もしもアフィリエイト a_id（MOSHIMO_* / VITE_MOSHIMO_* どちらでも可・リンクに含まれる公開値）
  // 未設定時は既定の提携ID（楽天市場: 5900939 / Yahoo!: 5900940 / Amazon: 未提携のため空）
  const moshimoRakutenAid = pick('VITE_MOSHIMO_RAKUTEN_AID', 'MOSHIMO_RAKUTEN_AID') || MOSHIMO_DEFAULT_AIDS.rakutenAid;
  const moshimoYahooAid = pick('VITE_MOSHIMO_YAHOO_AID', 'MOSHIMO_YAHOO_AID') || MOSHIMO_DEFAULT_AIDS.yahooAid;
  const moshimoAmazonAid = pick('VITE_MOSHIMO_AMAZON_AID', 'MOSHIMO_AMAZON_AID') || MOSHIMO_DEFAULT_AIDS.amazonAid;

  // dev サーバー内（Node 側）の共通ユーティリティにも同じ値を注入
  configureRuntimeEnv({
    YAHOO_CLIENT_ID: yahooClientId,
    RAKUTEN_PROXY_URL: rakutenProxyUrl,
    MOSHIMO_RAKUTEN_AID: moshimoRakutenAid,
    MOSHIMO_YAHOO_AID: moshimoYahooAid,
    MOSHIMO_AMAZON_AID: moshimoAmazonAid,
  });

  return {
    base: './',
    envPrefix: ['VITE_', 'YAHOO_', 'MOSHIMO_'],
    define: {
      'import.meta.env.YAHOO_APP_ID': JSON.stringify(yahooClientId),
      'import.meta.env.YAHOO_CLIENT_ID': JSON.stringify(yahooClientId),
      'import.meta.env.VITE_MOSHIMO_RAKUTEN_AID': JSON.stringify(moshimoRakutenAid),
      'import.meta.env.VITE_MOSHIMO_YAHOO_AID': JSON.stringify(moshimoYahooAid),
      'import.meta.env.VITE_MOSHIMO_AMAZON_AID': JSON.stringify(moshimoAmazonAid),
      'import.meta.env.MOSHIMO_RAKUTEN_AID': JSON.stringify(moshimoRakutenAid),
      'import.meta.env.MOSHIMO_YAHOO_AID': JSON.stringify(moshimoYahooAid),
      'import.meta.env.MOSHIMO_AMAZON_AID': JSON.stringify(moshimoAmazonAid),
    },
    plugins: [react(), usedPriceProxy({ yahooClientId, rakutenProxyUrl })],
    build: {
      rollupOptions: {
        input: {
          main: 'index.html',
          privacy: 'privacy/index.html',
          terms: 'terms/index.html',
        },
      },
    },
  };
});
