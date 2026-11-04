import { createApp } from './app.js';
import { env, assertConfig } from './config/env.js';
import { logger } from './middleware/error.js';
import { startBackupScheduler, hydrateAutoBackupState } from './services/backups.js';

assertConfig();

const app = createApp();
app.listen(env.port, () => {
  logger.info(
    `E-MADAARIS API listening on http://localhost:${env.port} (${env.nodeEnv})${env.configured ? '' : ' — Supabase not configured, protected routes return 503'}`
  );
  startBackupScheduler();
  hydrateAutoBackupState().then((auto) => {
    logger.info(`Backup scheduler armed (every ${auto.intervalMs}ms; automatic backups ${auto.enabled ? 'enabled' : 'waiting for the super admin'})`);
  });
});
