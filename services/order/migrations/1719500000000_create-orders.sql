-- Up Migration
-- id is a human-friendly sequential number assigned by the DB (GENERATED ALWAYS
-- means callers cannot set it), starting at 1001 so it reads like a real order
-- number rather than 1, 2, 3. quantity is CHECK-guarded > 0; status defaults to
-- PENDING. No transaction/locking concerns here yet — that arrives in Stage 3.
CREATE TABLE orders (
  id          BIGINT      GENERATED ALWAYS AS IDENTITY (START WITH 1001) PRIMARY KEY,
  customer_id TEXT        NOT NULL,
  item_sku    TEXT        NOT NULL,
  quantity    INTEGER     NOT NULL CHECK (quantity > 0),
  status      TEXT        NOT NULL DEFAULT 'PENDING',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Down Migration
DROP TABLE orders;
