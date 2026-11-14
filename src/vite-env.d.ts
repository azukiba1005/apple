/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CF_BEACON_TOKEN?: string;
  readonly VITE_GA_MEASUREMENT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
