import { ZodError } from 'zod';
import pino from 'pino';

export const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export function notFound(req, res) {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.originalUrl}` });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  if (err instanceof ZodError) {
    return res.status(422).json({
      error: 'Validation failed',
      details: err.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
    });
  }
  const status = err.status || err.statusCode || 500;
  if (status >= 500) logger.error({ err, url: req.originalUrl }, 'request failed');
  // Never leak internal error details to clients.
  const body = status >= 500 && process.env.NODE_ENV === 'production'
    ? { error: 'Internal server error' }
    : { error: err.message || 'Internal server error', details: err.details };
  res.status(status).json(body);
}
