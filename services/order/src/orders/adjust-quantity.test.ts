import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { runner } from 'node-pg-migrate';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  adjustQuantityForUpdate,
  adjustQuantityNaive,
  adjustQuantitySerializable,
} from './adjust-quantity.js';
import { getOrderById, insertOrder } from './repository.js';

let container: StartedPostgreSqlContainer;
let pool: Pool;

// One hot row, this many concurrent +1 adjustments. Each correct strategy must
// land on START + CONCURRENCY; the naive one must not.
const CONCURRENCY = 10;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  const databaseUrl = container.getConnectionUri();
  await runner({
    databaseUrl,
    dir: 'services/order/migrations',
    direction: 'up',
    migrationsTable: 'pgmigrations',
    count: Number.POSITIVE_INFINITY,
    log: () => {},
  });
  pool = new Pool({ connectionString: databaseUrl });
}, 120_000);

afterAll(async () => {
  await pool?.end();
  await container?.stop();
});

async function runConcurrently(fn: () => Promise<void>, times: number): Promise<void> {
  await Promise.all(Array.from({ length: times }, () => fn()));
}

describe('lost-update anomaly and its fixes', () => {
  it('loses an update deterministically with interleaved READ COMMITTED txns', async () => {
    const order = await insertOrder(pool, { customerId: 'c1', itemSku: 'S', quantity: 1 });

    const a = await pool.connect();
    const b = await pool.connect();
    try {
      await a.query('BEGIN');
      await b.query('BEGIN');
      // Both transactions read the same starting quantity (1)...
      const ra = await a.query<{ quantity: number }>('SELECT quantity FROM orders WHERE id = $1', [
        order.id,
      ]);
      const rb = await b.query<{ quantity: number }>('SELECT quantity FROM orders WHERE id = $1', [
        order.id,
      ]);
      // ...and each writes back read + 1.
      await a.query('UPDATE orders SET quantity = $2 WHERE id = $1', [
        order.id,
        (ra.rows[0]?.quantity ?? 0) + 1,
      ]);
      await a.query('COMMIT');
      await b.query('UPDATE orders SET quantity = $2 WHERE id = $1', [
        order.id,
        (rb.rows[0]?.quantity ?? 0) + 1,
      ]);
      await b.query('COMMIT');
    } finally {
      a.release();
      b.release();
    }

    const final = await getOrderById(pool, order.id);
    // Two +1 increments were issued, but B overwrote A's commit: 2, not 3.
    expect(final?.quantity).toBe(2);
  });

  it('naive read-modify-write loses updates under concurrency (the bug)', async () => {
    const order = await insertOrder(pool, { customerId: 'c1', itemSku: 'S', quantity: 1 });

    await runConcurrently(() => adjustQuantityNaive(pool, order.id, 1), CONCURRENCY);

    const final = await getOrderById(pool, order.id);
    expect(final?.quantity).toBeLessThan(1 + CONCURRENCY);
  });

  it('SELECT ... FOR UPDATE prevents lost updates', async () => {
    const order = await insertOrder(pool, { customerId: 'c1', itemSku: 'S', quantity: 1 });

    await runConcurrently(() => adjustQuantityForUpdate(pool, order.id, 1), CONCURRENCY);

    const final = await getOrderById(pool, order.id);
    expect(final?.quantity).toBe(1 + CONCURRENCY);
  }, 20_000);

  it('SERIALIZABLE + retry prevents lost updates', async () => {
    const order = await insertOrder(pool, { customerId: 'c1', itemSku: 'S', quantity: 1 });

    await runConcurrently(() => adjustQuantitySerializable(pool, order.id, 1), CONCURRENCY);

    const final = await getOrderById(pool, order.id);
    expect(final?.quantity).toBe(1 + CONCURRENCY);
  }, 20_000);
});
