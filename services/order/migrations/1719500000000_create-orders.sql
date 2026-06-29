-- Up Migration
-- gen_random_uuid() is built into Postgres core (13+), so no pgcrypto extension
-- is needed. quantity is CHECK-guarded > 0; status defaults to PENDING. No
-- transaction/locking concerns here yet — that arrives in Stage 3.
CREATE TABLE orders (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id TEXT        NOT NULL,
  item_sku    TEXT        NOT NULL,
  quantity    INTEGER     NOT NULL CHECK (quantity > 0),
  status      TEXT        NOT NULL DEFAULT 'PENDING',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Down Migration
DROP TABLE orders;
