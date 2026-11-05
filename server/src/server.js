import { createApp } from './app.js';
import { env, assertConfig } from './config/env.js';
import { logger } from './middleware/error.js';
import { startBackupScheduler, hydrateAutoBackupState } from './services/backups.js';
import { reconcileClosedElections, startElectionScheduler } from './services/electionScheduler.js';
import { catchUpNotifications, startNotificationScheduler } from './services/notificationScheduler.js';

assertConfig();

const app = createApp();
app.listen(env.port, () => {
  logger.info(
    `E-MADAARIS API listening on http://localhost:${env.port} (${env.nodeEnv})${env.configured ? '' : ' — Supabase not configured, protected routes return 503'}`
  );
  startBackupScheduler();
  startElectionScheduler();
  startNotificationScheduler();
  // The clock is authoritative even when the API was down during an election window, so any
  // election that is past its closing time is tallied again at boot.
  reconcileClosedElections().then((r) => {
    if (r.checked) logger.info(`elections scheduler: re-tallied ${r.checked} closed election(s)`);
  }).catch(() => {});
  // Same for the notification queue: a notice due over the weekend goes out when the API comes back,
  // not an hour later when the first interval lands.
  catchUpNotifications().then((r) => {
    if (r.queue || r.assignment_reminders || r.lesson_reminders || r.subscription_alerts) {
      logger.info(`notifications scheduler: ${r.queue || 0} scheduled notice(s), ${r.subscription_alerts || 0} licence warning(s)`);
    }
  }).catch(() => {});
  hydrateAutoBackupState().then((auto) => {
    logger.info(`Backup scheduler armed (every ${auto.intervalMs}ms; automatic backups ${auto.enabled ? 'enabled' : 'waiting for the super admin'})`);
  });
});
