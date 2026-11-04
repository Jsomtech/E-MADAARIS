import { createClient } from '@supabase/supabase-js';
import { env } from './env.js';

let admin = null;
let anon = null;

/** Unprivileged anon client (PKCE code exchange, password reset requests). */
export function dbAnon() {
  if (!anon) {
    if (!env.supabaseUrl || !env.supabaseAnonKey) return null;
    anon = createClient(env.supabaseUrl, env.supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return anon;
}

/** Privileged client — backend only. Never expose this or its key to the frontend. */
export function db() {
  if (!admin) {
    if (!env.supabaseUrl || !env.supabaseServiceRoleKey) return null;
    admin = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { 'x-application-name': 'e-madaaris-server' } },
    });
  }
  return admin;
}

/** Client bound to the caller's JWT — used where RLS must apply (privileged ops never use this). */
export function dbAs(accessToken) {
  if (!env.supabaseUrl || !env.supabaseAnonKey) return null;
  return createClient(env.supabaseUrl, env.supabaseAnonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

export function requireDb() {
  const c = db();
  if (!c) {
    const err = new Error('Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env');
    err.status = 503;
    throw err;
  }
  return c;
}
