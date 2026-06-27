import express, { type Express } from 'express';

/**
 * Builds the Express app without binding to a port. Keeping `listen` out of
 * here is what lets tests exercise the routes in-process (no real socket),
 * and later lets the same app be wrapped for graceful shutdown in Stage 12.
 */
export function createApp(): Express {
  const app = express();

  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  return app;
}
