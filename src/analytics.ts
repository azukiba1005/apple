/**
 * アクセス解析の読み込み（Cookie 同意の「分析」が許可されたときだけ読み込む）
 *
 * 環境変数（.env / Cloudflare Pages の環境変数で設定。未設定のものは読み込まない）:
 *   VITE_CF_BEACON_TOKEN    … Cloudflare Web Analytics のサイトトークン
 *   VITE_GA_MEASUREMENT_ID  … Google Analytics 4 の測定ID（G-XXXXXXXXXX）
 */
import { COOKIE_CONSENT_CHANGE_EVENT, getCookieConsent, type CookieConsentState } from './components/CookieConsent';

const CF_TOKEN = (import.meta.env.VITE_CF_BEACON_TOKEN ?? '').trim();
const GA_ID = (import.meta.env.VITE_GA_MEASUREMENT_ID ?? '').trim();

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

let cfLoaded = false;
let gaLoaded = false;

function loadCloudflare() {
  if (!CF_TOKEN || cfLoaded) return;
  cfLoaded = true;
  const s = document.createElement('script');
  s.defer = true;
  s.src = 'https://static.cloudflareinsights.com/beacon.min.js';
  s.setAttribute('data-cf-beacon', JSON.stringify({ token: CF_TOKEN, spa: true }));
  document.head.appendChild(s);
}

function ensureGtag() {
  if (window.gtag) return;
  window.dataLayer = window.dataLayer || [];
  // gtag は arguments オブジェクトをそのまま push する仕様
  window.gtag = function gtag() { window.dataLayer!.push(arguments); };
  // Consent Mode v2: 既定はすべて拒否
  window.gtag('consent', 'default', {
    analytics_storage: 'denied',
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
  });
}

function updateGaConsent(c: CookieConsentState) {
  if (!GA_ID) return;
  ensureGtag();
  window.gtag!('consent', 'update', {
    analytics_storage: c.analytics ? 'granted' : 'denied',
    ad_storage: c.marketing ? 'granted' : 'denied',
    ad_user_data: c.marketing ? 'granted' : 'denied',
    ad_personalization: c.marketing ? 'granted' : 'denied',
  });
  if (c.analytics && !gaLoaded) {
    gaLoaded = true;
    const s = document.createElement('script');
    s.async = true;
    s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA_ID)}`;
    document.head.appendChild(s);
    window.gtag!('js', new Date());
    window.gtag!('config', GA_ID, { anonymize_ip: true });
  }
}

/** 同意撤回時に GA の Cookie（_ga, _ga_XXXX）を削除 */
function clearGaCookies() {
  const host = location.hostname;
  const domains = ['', host, `.${host}`, `.${host.split('.').slice(-2).join('.')}`];
  document.cookie.split(';').map((c) => c.split('=')[0].trim()).filter((n) => n === '_ga' || n.startsWith('_ga_') || n === '_gid').forEach((name) => {
    domains.forEach((d) => {
      document.cookie = `${name}=; Max-Age=0; path=/${d ? `; domain=${d}` : ''}`;
    });
  });
}

function apply(c: CookieConsentState | null) {
  if (!c) return; // 未回答 → 何も読み込まない
  if (c.analytics) loadCloudflare();
  updateGaConsent(c);
  if (!c.analytics && gaLoaded) clearGaCookies();
}

export function initAnalytics() {
  if (!CF_TOKEN && !GA_ID) return;
  apply(getCookieConsent());
  window.addEventListener(COOKIE_CONSENT_CHANGE_EVENT, (e) => {
    const c = (e as CustomEvent<CookieConsentState>).detail;
    const revoked = (cfLoaded && !c.analytics);
    apply(c);
    // 読み込み済みの Cloudflare ビーコンは停止できないため、撤回時は再読み込みで確実に止める
    if (revoked) location.reload();
  });
}
