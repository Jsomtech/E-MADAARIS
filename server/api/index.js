import { createApp } from '../src/app.js';

/**
 * Vercel entrypoint.
 *
 * `src/server.js` owns the persistent deployment: it opens a port and arms the interval schedulers.
 * Serverless has no process to keep alive and no port to open, so this file hands the platform the
 * Express app itself and nothing else. The schedulers are reached through /api/v1/jobs/* instead, which
 * Vercel's own cron calls.
 */
export default createApp();
