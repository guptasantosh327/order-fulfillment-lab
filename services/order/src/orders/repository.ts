import type { Pool, PoolClient } from 'pg';

/**
 * Anything that can run a query — the connection pool today, or a single
 * PoolClient bound to an open transaction in Stage 3. Repository functions take
 * this so the SAME query can run standalone or inside a transaction without a
 * second code path.
 */
export type Queryable = Pool | PoolClient;

export const ORDER_STATUSES = ['PENDING', 'CONFIRMED', 'CANCELLED'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export interface Order {
  id: number;
  customerId: string;
  itemSku: string;
  quantity: number;
  status: OrderStatus;
  idempotencyKey: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewOrder {
  customerId: string;
  itemSku: string;
  quantity: number;
}

export interface OrderPatch {
  status?: OrderStatus;
  quantity?: number;
}

/** Shape of a raw row as Postgres returns it (snake_case columns). */
interface OrderRow {
  // pg returns BIGINT (int8) as a string to avoid precision loss; converted below.
  id: string;
  customer_id: string;
  item_sku: string;
  quantity: number;
  status: OrderStatus;
  idempotency_key: string | null;
  created_at: Date;
  updated_at: Date;
}

function mapRow(row: OrderRow): Order {
  return {
    id: Number(row.id),
    customerId: row.customer_id,
    itemSku: row.item_sku,
    quantity: row.quantity,
    status: row.status,
    idempotencyKey: row.idempotency_key,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function insertOrder(db: Queryable, input: NewOrder): Promise<Order> {
  const result = await db.query<OrderRow>(
    `INSERT INTO orders (customer_id, item_sku, quantity)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [input.customerId, input.itemSku, input.quantity],
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error('insert returned no row');
  }
  return mapRow(row);
}

export interface IdempotentInsertResult {
  order: Order;
  /** true if this call created the row; false if an existing row was returned. */
  created: boolean;
}

/**
 * Idempotent create keyed on idempotency_key. `ON CONFLICT DO NOTHING` lets the
 * DB's UNIQUE constraint absorb a duplicate without erroring: if our INSERT wins
 * we get the new row back (created); if a row with the key already exists we get
 * nothing back and fetch the existing one (not created).
 *
 * This is concurrency-safe: if a competing transaction is mid-insert with the
 * same key, ON CONFLICT blocks until it commits, so the follow-up SELECT is
 * guaranteed to see the winning row.
 */
export async function insertOrderIdempotent(
  db: Queryable,
  input: NewOrder,
  idempotencyKey: string,
): Promise<IdempotentInsertResult> {
  const inserted = await db.query<OrderRow>(
    `INSERT INTO orders (customer_id, item_sku, quantity, idempotency_key)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING *`,
    [input.customerId, input.itemSku, input.quantity, idempotencyKey],
  );
  const insertedRow = inserted.rows[0];
  if (insertedRow) {
    return { order: mapRow(insertedRow), created: true };
  }

  const existing = await db.query<OrderRow>('SELECT * FROM orders WHERE idempotency_key = $1', [
    idempotencyKey,
  ]);
  const existingRow = existing.rows[0];
  if (!existingRow) {
    throw new Error('idempotent insert conflicted but no existing row was found');
  }
  return { order: mapRow(existingRow), created: false };
}

export async function getOrderById(db: Queryable, id: number): Promise<Order | null> {
  const result = await db.query<OrderRow>('SELECT * FROM orders WHERE id = $1', [id]);
  const row = result.rows[0];
  return row ? mapRow(row) : null;
}

export async function listOrders(db: Queryable): Promise<Order[]> {
  const result = await db.query<OrderRow>('SELECT * FROM orders ORDER BY created_at DESC');
  return result.rows.map(mapRow);
}

/**
 * COALESCE($n, col) keeps the existing value when a field is omitted (passed as
 * null), so this one statement handles partial updates without building dynamic
 * SQL. Returns null when no row matched the id.
 */
export async function updateOrder(
  db: Queryable,
  id: number,
  patch: OrderPatch,
): Promise<Order | null> {
  const result = await db.query<OrderRow>(
    `UPDATE orders
        SET status     = COALESCE($2, status),
            quantity   = COALESCE($3, quantity),
            updated_at = now()
      WHERE id = $1
      RETURNING *`,
    [id, patch.status ?? null, patch.quantity ?? null],
  );
  const row = result.rows[0];
  return row ? mapRow(row) : null;
}

/** Returns true if a row was deleted, false if the id did not exist. */
export async function deleteOrder(db: Queryable, id: number): Promise<boolean> {
  const result = await db.query('DELETE FROM orders WHERE id = $1', [id]);
  return (result.rowCount ?? 0) > 0;
}
