import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** True when .env has a Supabase project. Without it the app can only run in dev demo mode. */
export const supabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

/** Dev-only demo login (VITE_DEMO_AUTH=1): seeded people, no network. Ignored in production builds. */
export const demoAuth = import.meta.env.DEV && import.meta.env.VITE_DEMO_AUTH === '1';

export const supabase = createClient(supabaseUrl || 'http://127.0.0.1:54321', supabaseAnonKey || 'missing-anon-key', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});
