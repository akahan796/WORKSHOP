// Picks the backend: Supabase when config.js has keys, otherwise the in-browser demo.
// Adding ?demo to the URL forces demo mode (practice runs, testing without an AI key).
import { createDemoBackend } from './demo.js';

const cfg = window.WAI_CONFIG || {};
const forceDemo = new URLSearchParams(location.search).has('demo');

export const backend = cfg.supabaseUrl && cfg.supabaseAnonKey && !forceDemo
  ? (await import('./supabase.js')).createSupabaseBackend(cfg)
  : createDemoBackend();
