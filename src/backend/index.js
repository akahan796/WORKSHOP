// Picks the backend: Supabase when config.js has keys, otherwise the in-browser demo.
import { createDemoBackend } from './demo.js';

const cfg = window.WAI_CONFIG || {};

export const backend = cfg.supabaseUrl && cfg.supabaseAnonKey
  ? (await import('./supabase.js')).createSupabaseBackend(cfg)
  : createDemoBackend();
