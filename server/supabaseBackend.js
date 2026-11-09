import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

const DATA_DIR = path.join(process.cwd(), 'data');
const SUPABASE_CONFIG_FILE = path.join(DATA_DIR, 'supabase_config.json');

export function getBackendSupabaseConfig() {
  // 1. Env variables
  const envUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const envKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (envUrl && envKey && envUrl.startsWith('http')) {
    return { url: envUrl.trim(), key: envKey.trim(), source: 'env' };
  }

  // 2. data/supabase_config.json
  try {
    if (fs.existsSync(SUPABASE_CONFIG_FILE)) {
      const raw = fs.readFileSync(SUPABASE_CONFIG_FILE, 'utf-8');
      const cfg = JSON.parse(raw);
      if (cfg.url && cfg.anonKey && cfg.url.startsWith('http')) {
        return { url: cfg.url.trim(), key: cfg.anonKey.trim(), source: 'file' };
      }
    }
  } catch (e) {
    console.error('[Supabase Backend] Error reading config file:', e.message);
  }

  return { url: '', key: '', source: 'none' };
}

let backendSupabase = null;

export function getSupabaseBackendClient() {
  if (backendSupabase) return backendSupabase;

  const { url, key, source } = getBackendSupabaseConfig();
  if (url && key) {
    try {
      backendSupabase = createClient(url, key, {
        auth: { persistSession: false }
      });
      console.log(`[Supabase Backend] Muvaffaqiyatli ulandi (${source} orqali).`);
      return backendSupabase;
    } catch (e) {
      console.error('[Supabase Backend] Init error:', e.message);
    }
  }
  return null;
}

export function saveSupabaseConfig(url, anonKey) {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(SUPABASE_CONFIG_FILE, JSON.stringify({ url, anonKey }, null, 2), 'utf-8');
    backendSupabase = null; // reset client so it reconnects with new keys
    return true;
  } catch (e) {
    console.error('[Supabase Backend] Config save error:', e.message);
    return false;
  }
}
