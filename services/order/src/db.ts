import { Pool } from 'pg';

/**
 * One pooled connection to Postgres for the order service. Connection details
 * come entirely from DATABASE_URL (injected by compose / k8s later) — nothing
 * about the host or credentials is baked into the image.
 */
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

/**
 * Trivial startup probe. Its only job in this phase is to prove the order
 * container can actually reach and query the postgres container over the
 * compose network — it returns the server version string so startup can log
 * concrete evidence of the round-trip rather than a vague "connected".
 */
export async function verifyDbConnection(): Promise<string> {
  const result = await pool.query<{ version: string }>('SELECT version()');
  return result.rows[0]?.version ?? 'unknown';
}
