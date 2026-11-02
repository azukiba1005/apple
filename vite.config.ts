import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { searchRakutenUsedPrice } from './data/fetch-used-prices.mjs';

function rakutenUsedPriceProxy(envConfig: { appId: string; affiliateId: string; accessKey: string }): Plugin {
  const attachMiddleware = (middlewares: any) => {
    middlewares.use('/api/used-price', async (req: any, res: any) => {
      try {
        const url = new URL(req.url ?? '', 'http://localhost');
        const productName = url.searchParams.get('productName') || 'iPhone 15';
        const storage = url.searchParams.get('storage') || '128GB';
        const category = url.searchParams.get('category') || 'iPhone';
        const launchPrice = Number(url.searchParams.get('launchPrice') || 0) || 98800;
        const releaseDate = url.searchParams.get('releaseDate') || '2023-09-22';
        const appId = process.env.RAKUTEN_APP_ID || envConfig.appId || '';
        const affiliateId = process.env.RAKUTEN_AFFILIATE_ID || envConfig.affiliateId || '';
        const accessKey = process.env.RAKUTEN_ACCESS_KEY || envConfig.accessKey || '';

        const result = await searchRakutenUsedPrice({
          productName,
          storage,
          category,
          launchPrice,
          releaseDate,
          appId,
          affiliateId,
          accessKey,
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
    name: 'rakuten-used-price-proxy',
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
  const rakutenAppId = process.env.RAKUTEN_APP_ID || env.RAKUTEN_APP_ID || env.VITE_RAKUTEN_APP_ID || '';
  const rakutenAffiliateId = process.env.RAKUTEN_AFFILIATE_ID || env.RAKUTEN_AFFILIATE_ID || '';
  const rakutenAccessKey = process.env.RAKUTEN_ACCESS_KEY || env.RAKUTEN_ACCESS_KEY || '';

  return {
    base: './',
    envPrefix: ['VITE_', 'RAKUTEN_'],
    define: {
      'import.meta.env.RAKUTEN_APP_ID': JSON.stringify(rakutenAppId),
      'import.meta.env.RAKUTEN_AFFILIATE_ID': JSON.stringify(rakutenAffiliateId),
      'import.meta.env.RAKUTEN_ACCESS_KEY': JSON.stringify(rakutenAccessKey),
    },
    plugins: [
      react(),
      rakutenUsedPriceProxy({
        appId: rakutenAppId,
        affiliateId: rakutenAffiliateId,
        accessKey: rakutenAccessKey,
      }),
    ],
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
