import { createApp } from './app.js';
import { pool, verifyDbConnection } from './db.js';

const port = Number(process.env.PORT ?? 3000);

async function main(): Promise<void> {
  // DB connectivity is checked but NOT required to boot. /health is a liveness
  // signal — "is the process up?" — which must not depend on the database, so
  // the service can deploy to EKS before Postgres exists in-cluster (Stage 7).
  // DB-backed routes (/orders) will fail until a database is reachable; a proper
  // readiness probe that gates traffic on the DB comes with that stage.
  try {
    const version = await verifyDbConnection();
    console.log(`connected to postgres: ${version}`);
  } catch (err) {
    console.warn(
      'starting WITHOUT a database connection:',
      err instanceof Error ? err.message : err,
    );
  }

  const app = createApp(pool);
  app.listen(port, () => {
    console.log(`order service listening on port ${port}`);
  });
}

main().catch((err) => {
  console.error('failed to start order service:', err);
  process.exit(1);
});
