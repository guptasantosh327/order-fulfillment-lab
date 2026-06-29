-- Up Migration
-- Optional client-supplied idempotency key. The UNIQUE constraint is what makes
-- "create this order" safe to retry: a second insert with the same key is
-- rejected by the DB rather than creating a duplicate. The column is nullable,
-- and Postgres treats NULLs as distinct in a unique index, so orders created
-- without a key are unaffected.
ALTER TABLE orders ADD COLUMN idempotency_key TEXT;

ALTER TABLE orders ADD CONSTRAINT orders_idempotency_key_key UNIQUE (idempotency_key);

-- Down Migration
ALTER TABLE orders DROP CONSTRAINT orders_idempotency_key_key;
ALTER TABLE orders DROP COLUMN idempotency_key;
