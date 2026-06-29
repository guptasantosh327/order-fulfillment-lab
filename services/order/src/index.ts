import { createApp } from './app.js';
import { pool, verifyDbConnection } from './db.js';

const port = Number(process.env.PORT ?? 3000);

async function main(): Promise<void> {
  // Prove DB connectivity BEFORE accepting traffic. If Postgres is unreachable
  // we want a loud crash on startup, not a service that's "up" but broken.
  const version = await verifyDbConnection();
  console.log(`connected to postgres: ${version}`);

  const app = createApp(pool);
  app.listen(port, () => {
    console.log(`order service listening on port ${port}`);
  });
}

main().catch((err) => {
  console.error('failed to start order service:', err);
  process.exit(1);
});
