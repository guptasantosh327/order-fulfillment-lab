import express, { type ErrorRequestHandler, type Express } from 'express';
import type { Pool } from 'pg';
import { createOrdersRouter } from './orders/routes.js';

/**
 * Builds the Express app without binding to a port. Keeping `listen` out of
 * here is what lets tests exercise the routes in-process (no real socket),
 * and later lets the same app be wrapped for graceful shutdown in Stage 12.
 *
 * The pool is injected so the app is decoupled from how the connection is made.
 */
export function createApp(pool: Pool): Express {
  const app = express();

  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  app.use('/orders', createOrdersRouter(pool));

  // Single error-handling seam: any rejection from an async handler (Express 5
  // forwards these automatically) lands here instead of per-route try/catch.
  const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
    console.error('unhandled error:', err);
    res.status(500).json({ error: 'internal server error' });
  };
  app.use(errorHandler);

  return app;
}
