import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import pinoHttp from 'pino-http';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { env } from './config/env.js';
import { authenticate } from './middleware/auth.js';
import { notFound, errorHandler } from './middleware/error.js';
import { publicRouter, authRouter } from './api/auth.routes.js';
import { platformRouter } from './api/platform.routes.js';
import { schoolRouter } from './api/school.routes.js';
import { trashRouter } from './api/trash.routes.js';
import { mountResources } from './api/resources.js';
import { attendanceRouter } from './api/flows/attendance.js';
import { examRouter } from './api/flows/examinations.js';
import { financeRouter } from './api/flows/finance.js';
import {
  notificationsRouter, supportRouter, platformSupportRouter, certificateRouter,
  idCardRouter, publicVerifyRouter, reportRouter, documentRouter,
} from './api/flows/extras.js';
import { studentAdminRouter } from './api/flows/studentsAdmin.js';
import { classAdminRouter } from './api/flows/classesAdmin.js';
import { accountRouter } from './api/push.routes.js';

const V1 = '/api/v1';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cors({ origin: env.corsOrigins, credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  app.use(pinoHttp({ autoLogging: env.nodeEnv === 'production' }));

  // `/health` answers even when Supabase credentials are missing, so deployments can verify booting.
  app.get('/health', (req, res) => res.json({
    status: 'ok', service: 'e-madaaris-api', env: env.nodeEnv, configured: env.configured,
  }));

  const api = express.Router();

  const publicLimiter = rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false });
  // Strict limit only on credential-guessing surfaces — session reads must not lock out a shared school IP.
  const credentialLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 25, standardHeaders: true, legacyHeaders: false });
  const sessionLimiter = rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: true, legacyHeaders: false });

  api.use('/public', publicLimiter, publicRouter);
  api.use('/public', publicVerifyRouter);
  api.use('/auth', sessionLimiter);
  api.use(['/auth/login', '/auth/student-login'], credentialLimiter);
  api.use('/auth', authRouter);

  // Everything below needs a verified session; roles/school come from the database, never the client.
  const gated = express.Router();
  gated.use(authenticate);

  gated.use('/platform', platformRouter);
  gated.use('/platform', platformSupportRouter);
  gated.use('/account', accountRouter);
  gated.use('/school', schoolRouter);
  gated.use('/school/trash', trashRouter);
  gated.use('/school/students', studentAdminRouter);
  gated.use('/school/classes', classAdminRouter);
  gated.use('/school/notifications', notificationsRouter);
  gated.use('/school/support', supportRouter);
  gated.use('/school/certificates', certificateRouter);
  gated.use('/school/id-cards', idCardRouter);
  gated.use('/school/reports', reportRouter);
  gated.use('/school/documents', documentRouter);

  gated.use('/attendance', attendanceRouter);
  gated.use('/examinations', examRouter);
  gated.use('/finance', financeRouter);
  mountResources(gated);

  api.use(gated);
  app.use(V1, api);

  // Built SPA (production single-deploy): API and client from the same process.
  const clientDist = fileURLToPath(new URL('../../client/dist', import.meta.url));
  if (existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(`${clientDist}/index.html`));
  }

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
