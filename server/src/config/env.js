import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';

// Load repo-root .env first, then allow server/.env to override.
dotenv.config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) });
dotenv.config();

const required = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 4000),
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
  corsOrigins: (process.env.CORS_ORIGINS || process.env.FRONTEND_URL || 'http://localhost:5173')
    .split(',').map((s) => s.trim()).filter(Boolean),
  supabaseUrl: process.env.SUPABASE_URL || '',
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  credentialsKey: process.env.CREDENTIALS_KEY || '',
  emailProvider: process.env.EMAIL_PROVIDER || '',
  emailFrom: process.env.EMAIL_FROM || 'no-reply@e-madaaris.com',
  paymentProvider: process.env.PAYMENT_PROVIDER || '',
  appBaseUrl: process.env.APP_BASE_URL || process.env.FRONTEND_URL || 'http://localhost:5173',
  backupIntervalMs: Number(process.env.BACKUP_INTERVAL_MS || 10000),
  get configured() {
    return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
  },
};

export function assertConfig() {
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    console.warn(
      `[config] Missing environment variables: ${missing.join(', ')}. ` +
      'Copy .env.example to .env and set your Supabase credentials before using the API.'
    );
    return false;
  }
  return true;
}
