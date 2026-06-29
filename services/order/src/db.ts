import { Pool, type PoolClient } from 'pg';

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

export type IsolationLevel = 'READ COMMITTED' | 'REPEATABLE READ' | 'SERIALIZABLE';

export interface TransactionOptions {
  isolationLevel?: IsolationLevel;
}

/**
 * Runs `fn` inside a single transaction on one dedicated client: BEGIN →
 * fn(client) → COMMIT, with ROLLBACK on any failure and the client always
 * released. Passing the client into repository functions (which accept a
 * Queryable) is what lets the same SQL run transactionally.
 *
 * The isolationLevel is interpolated into the BEGIN, but it comes from a fixed
 * union type — never user input — so there is no injection surface.
 *
 * (Lives in the order service for now; this is exactly the helper that moves to
 * the shared packages/db once a second service needs it.)
 */
export async function withTransaction<T>(
  pool: Pool,
  fn: (client: PoolClient) => Promise<T>,
  options: TransactionOptions = {},
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query(
      options.isolationLevel ? `BEGIN ISOLATION LEVEL ${options.isolationLevel}` : 'BEGIN',
    );
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    // Best-effort rollback: the original error matters more than a rollback that
    // fails because the server already aborted the transaction.
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** Postgres raises this SQLSTATE when it cannot serialize a transaction. */
const SERIALIZATION_FAILURE = '40001';

function isSerializationFailure(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: string }).code === SERIALIZATION_FAILURE
  );
}

/**
 * Retries `fn` when Postgres aborts it with a serialization failure (40001) —
 * the required companion to SERIALIZABLE, which guarantees correctness by
 * *rejecting* conflicting transactions and expecting the app to retry. A small
 * randomized backoff stops concurrent retriers from colliding in lockstep on a
 * hot row.
 */
export async function withSerializableRetry<T>(fn: () => Promise<T>, maxRetries = 50): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      if (!isSerializationFailure(err) || attempt >= maxRetries) {
        throw err;
      }
      attempt += 1;
      await new Promise((resolve) => setTimeout(resolve, Math.random() * 5));
    }
  }
}
