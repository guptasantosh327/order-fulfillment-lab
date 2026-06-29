import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { runner } from 'node-pg-migrate';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { deleteOrder, getOrderById, insertOrder, listOrders, updateOrder } from './repository.js';

let container: StartedPostgreSqlContainer;
let pool: Pool;

const MISSING_ID = 999_999;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  const databaseUrl = container.getConnectionUri();

  // Apply the real migration via node-pg-migrate so the test exercises the same
  // schema the app runs against — not a hand-written copy.
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

beforeEach(async () => {
  await pool.query('TRUNCATE orders');
});

describe('orders repository', () => {
  it('creates an order with a DB-assigned sequential id and reads it back', async () => {
    const created = await insertOrder(pool, { customerId: 'c1', itemSku: 'SKU-1', quantity: 3 });

    // id is a DB-assigned sequential bigint, surfaced as a JS number.
    expect(typeof created.id).toBe('number');
    expect(created.id).toBeGreaterThanOrEqual(1001);
    expect(created.status).toBe('PENDING');
    expect(created.quantity).toBe(3);

    const fetched = await getOrderById(pool, created.id);
    expect(fetched).toEqual(created);
  });

  it('assigns ids sequentially', async () => {
    const first = await insertOrder(pool, { customerId: 'c1', itemSku: 'A', quantity: 1 });
    const second = await insertOrder(pool, { customerId: 'c1', itemSku: 'B', quantity: 1 });

    expect(second.id).toBeGreaterThan(first.id);
  });

  it('returns null for a missing order', async () => {
    expect(await getOrderById(pool, MISSING_ID)).toBeNull();
  });

  it('lists all orders', async () => {
    const a = await insertOrder(pool, { customerId: 'c1', itemSku: 'A', quantity: 1 });
    const b = await insertOrder(pool, { customerId: 'c1', itemSku: 'B', quantity: 1 });

    const all = await listOrders(pool);
    expect(all).toHaveLength(2);
    expect(all.map((o) => o.id).sort()).toEqual([a.id, b.id].sort());
  });

  it('applies a partial update, leaving omitted fields untouched', async () => {
    const created = await insertOrder(pool, { customerId: 'c1', itemSku: 'SKU-1', quantity: 3 });

    const updated = await updateOrder(pool, created.id, { status: 'CONFIRMED' });
    expect(updated?.status).toBe('CONFIRMED');
    expect(updated?.quantity).toBe(3);
  });

  it('returns null when updating a missing order', async () => {
    expect(await updateOrder(pool, MISSING_ID, { status: 'CONFIRMED' })).toBeNull();
  });

  it('deletes an order and reports the second delete as a no-op', async () => {
    const created = await insertOrder(pool, { customerId: 'c1', itemSku: 'SKU-1', quantity: 3 });

    expect(await deleteOrder(pool, created.id)).toBe(true);
    expect(await deleteOrder(pool, created.id)).toBe(false);
    expect(await getOrderById(pool, created.id)).toBeNull();
  });
});
