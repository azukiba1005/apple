import React, { useCallback, useEffect, useState } from 'react';
import { Cookie, X } from 'lucide-react';

/** Cookie 同意の保存キー（バージョンを上げると全ユーザーに再同意を求める） */
export const LS_COOKIE_CONSENT = 'apple-price-atlas:cookie-consent:v1';
/** フッター等から設定画面を再表示するためのイベント名 */
export const OPEN_COOKIE_SETTINGS_EVENT = 'apple-price-atlas:open-cookie-settings';
/** 同意内容が変わったときに発火するイベント名（detail: CookieConsentState） */
export const COOKIE_CONSENT_CHANGE_EVENT = 'apple-price-atlas:cookie-consent-change';

export type CookieConsentState = {
  necessary: true;
  analytics: boolean;
  marketing: boolean;
  updatedAt: string;
};

export function getCookieConsent(): CookieConsentState | null {
  try {
    const raw = localStorage.getItem(LS_COOKIE_CONSENT);
    if (!raw) return null;
    const v = JSON.parse(raw);
    if (!v || typeof v !== 'object') return null;
    return { necessary: true, analytics: !!v.analytics, marketing: !!v.marketing, updatedAt: String(v.updatedAt ?? '') };
  } catch {
    return null;
  }
}

export function openCookieSettings() {
  window.dispatchEvent(new Event(OPEN_COOKIE_SETTINGS_EVENT));
}

function saveConsent(analytics: boolean, marketing: boolean): CookieConsentState {
  const state: CookieConsentState = { necessary: true, analytics, marketing, updatedAt: new Date().toISOString() };
  try { localStorage.setItem(LS_COOKIE_CONSENT, JSON.stringify(state)); } catch { /* noop */ }
  window.dispatchEvent(new CustomEvent(COOKIE_CONSENT_CHANGE_EVENT, { detail: state }));
  return state;
}

type Category = { key: 'necessary' | 'analytics' | 'marketing'; title: string; desc: string; locked?: boolean };

const CATEGORIES: Category[] = [
  {
    key: 'necessary',
    title: '必須',
    desc: 'テーマ設定・比較表示設定・製品データのキャッシュなど、サイトの基本機能に必要なローカルストレージです。無効にすることはできません。',
    locked: true,
  },
  {
    key: 'analytics',
    title: '分析',
    desc: 'アクセス状況を匿名で集計し、サイト改善に役立てるための計測（Cloudflare Web Analytics・Google Analytics）を許可します。',
  },
  {
    key: 'marketing',
    title: '広告・アフィリエイト',
    desc: '楽天市場・Yahoo!ショッピング等のアフィリエイトリンク経由で、遷移先事業者が成果計測用の Cookie を利用することを許可します。',
  },
];

function Toggle({ checked, disabled, onChange, label }: { checked: boolean; disabled?: boolean; onChange?: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange?.(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 ${
        checked ? 'bg-emerald-600 dark:bg-emerald-500' : 'bg-zinc-300 dark:bg-zinc-700'
      } ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
    >
      <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-[22px]' : 'translate-x-0.5'}`} />
    </button>
  );
}

export default function CookieConsent() {
  const [bannerOpen, setBannerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [analytics, setAnalytics] = useState(false);
  const [marketing, setMarketing] = useState(false);

  useEffect(() => {
    const cur = getCookieConsent();
    if (!cur) setBannerOpen(true);
    else { setAnalytics(cur.analytics); setMarketing(cur.marketing); }

    const open = () => {
      const c = getCookieConsent();
      setAnalytics(c?.analytics ?? false);
      setMarketing(c?.marketing ?? false);
      setSettingsOpen(true);
    };
    window.addEventListener(OPEN_COOKIE_SETTINGS_EVENT, open);
    return () => window.removeEventListener(OPEN_COOKIE_SETTINGS_EVENT, open);
  }, []);

  useEffect(() => {
    if (!settingsOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSettingsOpen(false); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [settingsOpen]);

  const finish = useCallback((a: boolean, m: boolean) => {
    saveConsent(a, m);
    setAnalytics(a);
    setMarketing(m);
    setBannerOpen(false);
    setSettingsOpen(false);
  }, []);

  const values: Record<Category['key'], boolean> = { necessary: true, analytics, marketing };
  const setters: Partial<Record<Category['key'], (v: boolean) => void>> = { analytics: setAnalytics, marketing: setMarketing };

  return (
    <>
      {bannerOpen && !settingsOpen && (
        <div
          role="region"
          aria-label="Cookieの利用について"
          className="fixed inset-x-0 bottom-0 z-[60] p-3 sm:p-4"
          style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
        >
          <div className="mx-auto flex max-w-5xl flex-col gap-4 rounded-2xl border border-zinc-200 bg-white/95 p-4 shadow-[0_8px_40px_rgba(0,0,0,0.12)] backdrop-blur-md dark:border-zinc-800 dark:bg-[#1f2126]/95 sm:flex-row sm:items-center sm:gap-6 sm:p-5">
            <div className="flex min-w-0 flex-1 gap-3">
              <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300">
                <Cookie className="h-5 w-5" />
              </div>
              <div className="min-w-0 space-y-1">
                <p className="text-sm font-bold text-zinc-900 dark:text-zinc-100">Cookie の利用について</p>
                <p className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
                  当サイトでは、サイトの基本機能の提供、アクセス解析、アフィリエイトの成果計測のために Cookie およびローカルストレージを利用します。
                  「すべて同意」を選択すると、これらの利用に同意したものとみなされます。詳しくは
                  <a href="./privacy/" className="mx-0.5 font-medium text-zinc-900 underline underline-offset-2 hover:text-zinc-600 dark:text-zinc-200 dark:hover:text-zinc-400">プライバシーポリシー</a>
                  をご確認ください。
                </p>
              </div>
            </div>
            <div className="flex shrink-0 flex-col-reverse gap-2 sm:flex-row sm:items-center">
              <button
                type="button"
                onClick={() => setSettingsOpen(true)}
                className="rounded-full px-4 py-2 text-xs font-medium text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
              >
                設定
              </button>
              <button
                type="button"
                onClick={() => finish(false, false)}
                className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-xs font-semibold text-zinc-800 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
              >
                必須のみ
              </button>
              <button
                type="button"
                onClick={() => finish(true, true)}
                className="rounded-full bg-zinc-900 px-5 py-2 text-xs font-semibold text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
              >
                すべて同意
              </button>
            </div>
          </div>
        </div>
      )}

      {settingsOpen && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 p-0 backdrop-blur-sm sm:items-center sm:p-4" onClick={() => setSettingsOpen(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="cookie-settings-title"
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl dark:bg-[#1f2126] sm:rounded-2xl"
          >
            <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
              <div className="flex items-center gap-2">
                <Cookie className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                <h2 id="cookie-settings-title" className="text-base font-bold text-zinc-900 dark:text-zinc-100">Cookie 設定</h2>
              </div>
              <button type="button" aria-label="閉じる" onClick={() => setSettingsOpen(false)} className="rounded-full p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
              <p className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
                利用目的ごとに Cookie 等の利用可否を選択できます。設定はいつでもフッターの「Cookie 設定」から変更できます。
              </p>
              {CATEGORIES.map((c) => (
                <div key={c.key} className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{c.title}</span>
                      {c.locked && <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">常に有効</span>}
                    </div>
                    <Toggle label={c.title} checked={values[c.key]} disabled={c.locked} onChange={setters[c.key]} />
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">{c.desc}</p>
                </div>
              ))}
            </div>

            <div className="flex flex-col-reverse gap-2 border-t border-zinc-200 px-5 py-4 dark:border-zinc-800 sm:flex-row sm:justify-end" style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
              <button type="button" onClick={() => finish(false, false)} className="rounded-full border border-zinc-300 px-4 py-2 text-xs font-semibold text-zinc-800 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-800">
                すべて拒否
              </button>
              <button type="button" onClick={() => finish(analytics, marketing)} className="rounded-full border border-zinc-300 px-4 py-2 text-xs font-semibold text-zinc-800 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-800">
                選択内容を保存
              </button>
              <button type="button" onClick={() => finish(true, true)} className="rounded-full bg-zinc-900 px-5 py-2 text-xs font-semibold text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white">
                すべて同意
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
