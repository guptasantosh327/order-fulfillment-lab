# Order Fulfillment Lab — CLAUDE.md

## Purpose

This is a **learning project**, not a product. The order-fulfillment domain is intentionally boring and simple — it exists only to give real shape to the things actually being learned:

- Docker, ECR, and EKS as real infrastructure, not toy examples
- ACID guarantees and transaction isolation levels, observed directly against Postgres
- The transactional outbox pattern, because a DB write and a message publish are never atomic across two systems
- SNS → SQS fan-out, filtering, DLQs, and idempotent consumers — against real AWS, not LocalStack
- Redis distributed locking, including how naive locks fail under real concurrent load on one hot item
- SAGA orchestration (and choreography, for contrast) across services that can independently fail and get rescheduled by Kubernetes mid-workflow
- General production best practices: IRSA over static keys, graceful shutdown, resource limits, structured logging, cost discipline on a metered cloud account

## The one rule that matters most

**Build exactly one phase at a time. Nothing more.**

- Implement only the phase currently in focus. Don't pre-build scaffolding for a future phase "to save a step," even if it seems obvious or trivial — that's still skipping the part where Santosh decides whether he's understood the current phase before moving on.
- After building a phase: run lint + format check + tests, then explain in plain terms what was built, *why* it's built that way (the design decision, not just the code), and what it demonstrates. Then stop.
- Do not start the next phase until explicitly told to proceed. "That looks good" is not the same as "move on" — wait for an actual go-ahead.
- If a phase's "deliberately trigger and test" failure mode isn't included, the phase isn't done, regardless of whether the happy path works.
- If asked to skip ahead or batch several phases, push back once and ask for confirmation before doing it — the whole point of this repo is each phase being absorbed individually, not arriving at a finished result quickly.

## Tech stack

| Concern | Choice | Why |
|---|---|---|
| Language | TypeScript, strict mode | |
| Runtime | Node.js 22+ | |
| HTTP framework | Express 5 | Ubiquitous and minimal; gives routing/middleware/graceful-shutdown hooks without hiding the request lifecycle this project wants visible (not a full framework like Nest) |
| Repo structure | npm workspaces, one repo (`packages/*`, `services/*`) | Shared DB/messaging/lock code lives once; each service still builds and deploys independently |
| Database | PostgreSQL 16, self-hosted in-cluster (StatefulSet + PVC) once on EKS | Real ACID/isolation behavior; in-cluster (not RDS) purely for cost — flagged in repo as the less-realistic-but-cheaper choice |
| DB access | `pg`, raw SQL, `node-pg-migrate` | An ORM would hide the transaction-boundary and locking behavior this project exists to learn |
| Messaging | Real AWS SNS + SQS (not LocalStack) | The actual point of this project is hands-on AWS messaging |
| Locking | Redis (`ioredis`) self-hosted in-cluster | `SET NX PX` + Lua-script release, hand-rolled |
| Containers | Docker, multi-stage builds | |
| Registry | ECR | |
| Orchestration | EKS, single AZ, standard support tier | Multi-AZ/Provisioned Control Plane add nothing for a learning sandbox and cost real money |
| Infra-as-code | Terraform, local state for now | Repeatable, modular — new infra concepts later become new modules, not redone manual steps |
| Auth (pod → AWS) | IRSA (IAM Roles for Service Accounts) | No static AWS keys baked into images or env vars, ever |
| Lint | Biome | |
| Format | Prettier (Biome's formatter disabled) | One tool owns formatting |
| Test | Vitest — unit tests with mocks, integration tests via Testcontainers against real Postgres/Redis | |

## Repository layout

```
order-fulfillment-lab/
├── package.json              # workspaces: ["packages/*", "services/*"]
├── tsconfig.base.json
├── biome.json
├── .prettierrc
├── docker-compose.yml         # local dev only
├── CLAUDE.md
├── bruno/                     # Bruno API collection — one .bru per route, kept in sync with every API
├── infra/                     # Terraform — Stage 4 onward
│   ├── modules/{vpc,ecr,eks}/
│   └── envs/dev/
├── k8s/                       # raw manifests — Stage 6 onward
│   ├── order/ inventory/ payment/ shipping/
├── packages/                  # shared, internal-only, never published
│   ├── db/                    # pg pool + withTransaction helper
│   ├── messaging/             # SNS publish + SQS consumer wrappers
│   └── lock/                  # Redis distributed lock
└── services/                  # one folder per independently-deployable service
    ├── order/      (src/, Dockerfile, package.json, tsconfig.json)
    ├── inventory/
    ├── payment/
    └── shipping/
```

Docker builds run from the repo root (`docker build -f services/order/Dockerfile .`) so the build context includes the `packages/*` dependencies each service needs — this gets built out properly in Stage 1, not assumed.

## AWS cost discipline — non-negotiable

This account has a $100 credit and no automatic spending cutoff. The EKS control plane alone is ~$0.10/hour (~$72/month) *whether or not anything is running on it*, and it only stops billing when the cluster is deleted, not when nodes are scaled to zero.

- Set an AWS Budget alert (50/80/100%) before Stage 4 — before any billable resource exists.
- Treat the EKS cluster as ephemeral: stand it up for a session, `terraform destroy` it when the session ends. Don't leave it running between sessions.
- Single AZ for everything in this repo. No EKS Provisioned Control Plane, no EKS Capabilities (Argo CD/ACK/KRO) — standard control plane only.
- Spot instances for worker nodes once we're past the minimum-viable cluster phase.
- ECR, SNS, and SQS are not meaningful cost risks at this project's scale (SNS/SQS: 1M requests/month free, forever; ECR storage here is a few hundred MB). The entire budget risk lives in EKS + EC2 nodes + any load balancer or NAT gateway left running — watch those, not the messaging services.
- Never propose Multi-AZ, RDS, ElastiCache, or any "more production-realistic" upgrade to this stack without flagging the cost delta first and getting confirmation.

## Phases

Work through these strictly in order, one at a time, per the rule above.

### Stage 0 — Local skeleton, no Docker, no AWS
1. Repo scaffolding: npm workspaces, TypeScript config, Biome/Prettier/Vitest wiring, npm scripts, `order` service folder only. **Done when:** `npm run lint`, `npm run format:check`, `npm test` all run clean with zero real code yet.
2. Minimal Express server in `order`, one health-check route, no DB. **Done when:** the route responds; this only proves the tooling chain, nothing else.

### Stage 1 — Docker, single service
3. Dockerfile for `order` — multi-stage build, non-root user, small base image, root-context build to pull in workspace packages. **Done when:** image builds and runs standalone, hits the health route.
4. `docker-compose.yml` with just that one service.

### Stage 2 — Postgres, locally
5. Postgres added to compose; `order` connects on startup. **Done when:** a trivial startup query proves container-to-container networking.
6. First migration (`orders` table), plain CRUD endpoints — plumbing only, no transaction complexity yet.

### Stage 3 — ACID, still local
7. Lost-update demo at default `READ COMMITTED`, then fixed two ways: `SELECT ... FOR UPDATE` and `SERIALIZABLE` + retry-on-conflict. **Done when:** a test fails without the fix and passes with it.
8. Constraint violation mid-transaction rolling back cleanly; idempotent writes via a unique constraint.

### Stage 4 — AWS and Terraform foundations
9. AWS budget alert, dedicated non-root IAM user for Terraform, AWS CLI configured.
10. First Terraform module: VPC only (subnets, route tables, internet gateway). Nothing else yet.

### Stage 5 — ECR
11. Terraform module for one ECR repo. Push the Stage-1 image manually — see auth and tagging firsthand.

### Stage 6 — EKS, minimum viable cluster
12. Terraform module for the cluster — single AZ, standard support, 1–2 small spot nodes. `kubectl get nodes`, then tear down immediately to bank the lesson without leaving the meter running.
13. Stand it back up; deploy the Stage-11 image as a basic Deployment + ClusterIP Service; `kubectl port-forward` to the health route. Node IAM permissions for ECR pulls become visible here.
14. Expose externally (LoadBalancer or basic Ingress); hit it from outside. Note the ELB hourly cost as the reason to tear it down right after.

The full pipeline — code → Docker → ECR → EKS → reachable — exists end to end after this. Everything later redeploys into this same skeleton.

### Stage 7 — Postgres on EKS
15. StatefulSet + PVC + headless Service for Postgres in-cluster — StorageClass, PVC binding, pod identity.
16. Point the deployed `order` service at in-cluster Postgres instead of local.

### Stage 8 — Outbox and real SNS
17. Outbox table + poller, proven against local Postgres first — the dual-write problem and its fix, before any AWS messaging is involved.
18. Terraform: one real SNS topic + one SQS queue. Deploy the poller wired with IRSA (OIDC provider, IAM trust policy, service-account annotation) — no static keys.
19. Real fan-out: Terraform adds the remaining queues and filter policies. Stub consumers just log what they receive, to see routing work before real consumer logic exists.

### Stage 9 — Inventory, Payment, Shipping as real services
20. Inventory: own schema, own Dockerfile, deployed, consumes its queue with an idempotency dedup table.
21. Payment and Shipping, same pattern — by now it's repetition, not a new concept, so both in one phase.

### Stage 10 — Redis and the hot-key problem
22. Redis deployed in-cluster, single instance.
23. Basic distributed lock (`SET NX PX` + Lua release) protecting Inventory's stock reservation. **Done when:** the two-concurrent-requests-for-the-last-unit test reliably shows exactly one winner.
24. The real ask: load test hammering one SKU — naive per-request lock vs. a queue-per-item approach (one ordered stream keyed by item ID, single consumer, no contention to begin with) — with real throughput numbers from both, not just theory.

### Stage 11 — SAGA across real pods
25. Orchestrated saga (Order → Inventory → Payment → Shipping) with compensations; durable `saga_state` table so a coordinator pod restart mid-saga resumes correctly rather than losing state. Chaos test: `kubectl delete pod` on the coordinator mid-saga.
26. One step reimplemented as choreography instead, plus a written comparison of when each approach earns its keep.

### Stage 12 — Hardening pass
27. Structured logging with correlation IDs; graceful shutdown verified via `kubectl rollout restart`.
28. Resource requests/limits, HPA on one service, basic observability (Container Insights or a small Prometheus/Grafana setup).
29. A single teardown script plus a budget-alert sanity check — discipline, not a new technical concept.

### Open slots — reserved, not built yet
Remote Terraform state, Helm, CI/CD via GitHub Actions, service mesh, multi-region. Structure shouldn't need rework to add these later; flag if a phase's design would make one of these harder to bolt on.

## Working conventions for Claude Code in this repo

- One phase at a time — see "The one rule that matters most" above. This overrides any instinct to be maximally helpful by doing more.
- Write the failure-mode test before or alongside the fix, not after, for any phase that has one — the test is the point, more than the implementation.
- Don't reach for an ORM, a saga framework, or a managed lock library "to save time." Hand-rolling these once is the actual goal. Flag it if a phase feels like it's fighting the raw approach rather than teaching it.
- No static AWS credentials anywhere — IRSA only, from Stage 8 onward.
- Keep each service's Postgres access confined to its own folder/schema, even though it's one repo.
- Run `npm run lint && npm run format:check && npm test` before considering any phase done.
- **Keep a Bruno collection in sync with every HTTP API.** Whenever an endpoint is added, removed, or its method/path/body/headers/response change, create or update the matching `.bru` request in the repo's Bruno collection (`bruno/` at the repo root, organized per service) in the same change — never as a follow-up. The committed `.bru` files are the always-current, runnable record of every route; a phase that adds or alters an API isn't done until its Bruno request reflects the new shape.
- Treat any AWS cost-increasing decision (new resource type, multi-AZ, a managed service swap) as something to flag and confirm, not decide silently — see the cost-discipline section above.

## Open questions to flag, not decide silently

- Whether Payment and Shipping (Stage 9) simulate external APIs or attempt real sandbox integrations — default to simulated, since the learning target is the messaging/saga mechanics, not third-party integration.
- Whether Stage 12's load test needs formal RPS/latency targets — default to exploratory/observational unless given numbers to hit.
