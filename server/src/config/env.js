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
  // Both names are accepted: EMAIL_API_KEY is this project's, RESEND_API_KEY is what Resend's own
  // dashboard docs call it.
  emailApiKey: process.env.EMAIL_API_KEY || process.env.RESEND_API_KEY || '',
  emailFrom: process.env.EMAIL_FROM || 'no-reply@e-madaaris.com',
  // Seconds. A confirmation link is a credential-bearing URL, so the window is clamped to
  // 15 minutes .. 30 days however it is configured; unset means seven days.
  emailVerificationExpiryMs: (() => {
    const raw = Number(process.env.EMAIL_VERIFICATION_EXPIRY || 0) * 1000;
    if (!Number.isFinite(raw) || raw <= 0) return 7 * 86400000;
    return Math.min(Math.max(raw, 15 * 60000), 30 * 86400000);
  })(),
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
