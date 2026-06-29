# order-fulfillment-lab

A hands-on learning project for Docker, ECR, EKS, Postgres ACID/isolation, the
transactional outbox, SNS/SQS, Redis locking, and SAGA orchestration. The
order-fulfillment domain is intentionally simple — it only exists to give these
infrastructure and distributed-systems topics something real to act on.

See [CLAUDE.md](./CLAUDE.md) for the full design, tech-stack rationale, and the
phased build plan. **This README covers only how to run what exists today.**

## Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) running
- Node.js 22+ and npm (only needed for the tests and lint/format/typecheck)

## Run the stack

Everything runs locally via Docker Compose — Postgres, a one-shot migration
step, and the `order` service:

```bash
docker compose up --build          # foreground (Ctrl-C to stop)
# or
docker compose up -d --build       # detached (background)
```

Startup order (you'll see it in the logs): **postgres** becomes healthy →
**migrate** applies the SQL migrations and exits → **order** connects and starts
serving on port 3000.

> After changing code, always pass `--build` — otherwise Compose reuses the old
> image.

Manage and tear down:

```bash
docker compose ps                  # status + health
docker compose logs -f order       # tail the order service logs
docker compose down                # stop + remove containers (keeps DB data)
docker compose down -v             # also wipe the Postgres data volume
```

## API

Base URL: `http://localhost:3000`

| Method | Path          | Description                                  |
| ------ | ------------- | -------------------------------------------- |
| GET    | `/health`     | Liveness check → `{ "status": "ok" }`        |
| POST   | `/orders`     | Create an order                              |
| GET    | `/orders`     | List all orders                              |
| GET    | `/orders/:id` | Get one order by its numeric id              |
| PATCH  | `/orders/:id` | Update an order's `status` and/or `quantity` |
| DELETE | `/orders/:id` | Delete an order                              |

Example:

```bash
# create
curl -s -X POST http://localhost:3000/orders \
  -H 'content-type: application/json' \
  -d '{"customerId":"cust-1","itemSku":"SKU-1","quantity":2}'
# -> { "id": 1001, "customerId": "cust-1", ..., "status": "PENDING" }

curl -s http://localhost:3000/orders/1001     # get
curl -s -X PATCH http://localhost:3000/orders/1001 \
  -H 'content-type: application/json' -d '{"status":"CONFIRMED"}'
curl -s -X DELETE http://localhost:3000/orders/1001
```

Order `id` is a database-assigned sequential number starting at 1001.

### Bruno collection

The [`bruno/`](./bruno) folder is a runnable [Bruno](https://www.usebruno.com/)
collection covering every endpoint. Open it in the Bruno app, select the
**local** environment, and run the requests under `order/` — `Create Order`
saves the new id so the get/update/delete requests reuse it.

## Connect to Postgres

While the stack is up, Postgres is published on `localhost:5432`:

| Field    | Value       |
| -------- | ----------- |
| Host     | `localhost` |
| Port     | `5432`      |
| Database | `orderdb`   |
| User     | `order`     |
| Password | `orderpw`   |

```bash
# via psql on the host
psql "postgres://order:orderpw@localhost:5432/orderdb"

# or inside the container (no host psql needed)
docker compose exec postgres psql -U order -d orderdb -c '\dt'
```

## Develop

```bash
npm install                # install workspace dependencies

npm test                   # unit + Testcontainers integration tests (needs Docker)
npm run lint               # Biome
npm run format:check       # Prettier
npm run typecheck          # tsc --build
```

The integration tests spin up a throwaway Postgres container via Testcontainers,
so Docker must be running — but you do **not** need the Compose stack up for them.
