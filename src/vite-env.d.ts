/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_APP_URL?: string;
  readonly VITE_DEMO_AUTH?: string;
  /** 'cookiery': 8-person café demo for the marketing guide (dev only) */
  readonly VITE_DEMO_SEED?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
