import type { Pool } from 'pg';
import { withSerializableRetry, withTransaction } from '../db.js';

/**
 * Three ways to do the same "read the quantity, add a delta, write it back"
 * operation. The point of this module is the contrast between them, so each is
 * written out in full rather than sharing a helper — read them top to bottom.
 *
 * They are demonstrations exercised by adjust-quantity.test.ts; only the safe
 * variants would ever be wired to a real endpoint.
 */

interface QuantityRow {
  quantity: number;
}

/**
 * BUGGY — do not use. Plain read-modify-write at the default READ COMMITTED
 * isolation. The SELECT takes no lock, so two concurrent callers can both read
 * the same quantity and both write `read + delta`, and one update is silently
 * lost. This is the anomaly the other two variants fix.
 */
export async function adjustQuantityNaive(pool: Pool, id: number, delta: number): Promise<void> {
  await withTransaction(pool, async (client) => {
    const { rows } = await client.query<QuantityRow>('SELECT quantity FROM orders WHERE id = $1', [
      id,
    ]);
    const current = rows[0];
    if (!current) {
      return;
    }
    await client.query('UPDATE orders SET quantity = $2, updated_at = now() WHERE id = $1', [
      id,
      current.quantity + delta,
    ]);
  });
}

/**
 * FIX 1 — pessimistic locking. `SELECT ... FOR UPDATE` takes a row lock, so a
 * second transaction blocks at the SELECT until the first commits, then reads
 * the already-updated value. Concurrent callers are serialized on the row; no
 * update is lost, no retry needed.
 */
export async function adjustQuantityForUpdate(
  pool: Pool,
  id: number,
  delta: number,
): Promise<void> {
  await withTransaction(pool, async (client) => {
    const { rows } = await client.query<QuantityRow>(
      'SELECT quantity FROM orders WHERE id = $1 FOR UPDATE',
      [id],
    );
    const current = rows[0];
    if (!current) {
      return;
    }
    await client.query('UPDATE orders SET quantity = $2, updated_at = now() WHERE id = $1', [
      id,
      current.quantity + delta,
    ]);
  });
}

/**
 * FIX 2 — optimistic concurrency. At SERIALIZABLE, Postgres takes no extra lock
 * up front but aborts a transaction (SQLSTATE 40001) if committing it would
 * violate serializability. Correctness then depends on retrying the aborted
 * transaction, which withSerializableRetry does.
 */
export async function adjustQuantitySerializable(
  pool: Pool,
  id: number,
  delta: number,
): Promise<void> {
  await withSerializableRetry(() =>
    withTransaction(
      pool,
      async (client) => {
        const { rows } = await client.query<QuantityRow>(
          'SELECT quantity FROM orders WHERE id = $1',
          [id],
        );
        const current = rows[0];
        if (!current) {
          return;
        }
        await client.query('UPDATE orders SET quantity = $2, updated_at = now() WHERE id = $1', [
          id,
          current.quantity + delta,
        ]);
      },
      { isolationLevel: 'SERIALIZABLE' },
    ),
  );
}
