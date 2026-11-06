import { Router } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.js';
import { requireDb } from '../config/supabase.js';
import { ApiError } from '../middleware/error.js';
import { catchUpNotifications } from '../services/notificationScheduler.js';
import { reconcileClosedElections } from '../services/electionScheduler.js';
import { hydrateAutoBackupState, runAutoBackupRound } from '../services/backups.js';

/**
 * The schedulers, driven from outside.
 *
 * `startNotificationScheduler`, `startElectionScheduler` and `startBackupScheduler` are `setInterval`
 * loops inside a long-lived process. A serverless function returns a response and then stops existing,
 * so a timer started there never fires a second time; the work has to be asked for by something that
 * does keep time. That is the platform's cron, which calls these paths on a schedule and proves itself
 * with the shared CRON_SECRET. GET and POST are both accepted because the two schedulers on Vercel use
 * different verbs.
 *
 * Nothing here takes a session: a cron request has no user. The bearer secret is the only credential,
 * and it is compared without leaking timing. Without it configured, the job refuses to run rather than
 * running unauthenticated — a silent schedule is recoverable, a scheduled endpoint anyone can poke is
 * not.
 */
export const jobsRouter = Router();

const secretsMatch = (given) => {
  const expected = Buffer.from(env.cronSecret);
  const actual = Buffer.from(given);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
};

function requireCron(req, _res, next) {
  if (!env.cronSecret) {
    throw new ApiError(503, 'Scheduled jobs are not enabled: set CRON_SECRET on the API.');
  }
  const [scheme, value = ''] = String(req.get('authorization') || '').split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !secretsMatch(value)) {
    throw new ApiError(401, 'The scheduled job credential is not valid.');
  }
  next();
}

/** One failed leg must not hide the results of the others. */
async function runLeg(name, work) {
  try {
    return { name, ok: true, result: await work() };
  } catch (err) {
    return { name, ok: false, error: err.message };
  }
}

jobsRouter.use(requireCron);

/** Queue, reminders, licence warnings and past-close elections. Cheap enough to run often. */
async function tick(_req, res, next) {
  try {
    requireDb();
    const [notifications, elections] = await Promise.all([
      runLeg('notifications', catchUpNotifications),
      runLeg('elections', () => reconcileClosedElections({ limit: 20 })),
    ]);
    res.json({ ran: 'tick', notifications, elections });
  } catch (err) { next(err); }
}

/**
 * Automatic backups. The persistent process looked for changed data every ten seconds; on a serverless
 * host the same intent costs a cold start, so this runs on its own slower schedule and restores the
 * super admin's on/off choice from the audit trail first — module state does not survive between
 * invocations.
 */
async function backups(_req, res, next) {
  try {
    requireDb();
    await hydrateAutoBackupState();
    res.json({ ran: 'backups', backups: await runLeg('backups', () => runAutoBackupRound()) });
  } catch (err) { next(err); }
}

jobsRouter.get('/tick', tick).post('/tick', tick);
jobsRouter.get('/backups', backups).post('/backups', backups);
