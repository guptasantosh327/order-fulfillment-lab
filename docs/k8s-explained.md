# Kubernetes manifests, explained (this repo's `k8s/order/`)

What the Deployment and Service YAML do, field by field, and **why each choice
was made** — written for someone new to Kubernetes.

> Scope: Stage 6, step 13 — deploy the ECR image as a Deployment + ClusterIP
> Service and reach `/health` via `kubectl port-forward`. External exposure is
> step 14; Postgres in-cluster is Stage 7.

---

## 1. Mental model: desired state + labels

Two ideas unlock all of Kubernetes:

1. **Declarative / reconciliation.** You don't run "start 2 containers." You
   declare "I want 2 replicas of this," and a controller continuously works to
   make reality match. Kill a pod and it's recreated; the desired state is the
   source of truth.
2. **Everything is glued by labels.** Objects don't reference each other by ID.
   A pod carries labels (`app: order`); other objects find it with a **selector**
   (`selector: app: order`). That loose coupling is how a Deployment owns its
   pods and how a Service finds them.

The object hierarchy for a running web app:

```
Deployment            (you declare desired state: image, replicas, probes)
   └─ ReplicaSet       (auto-managed; keeps N pods alive, handles rollouts)
        └─ Pod × N     (one running instance = your container)

Service                (stable virtual IP + DNS name in front of the pods)
   └─ selects pods by label → load-balances across them
```

You write the **Deployment** and the **Service**; Kubernetes creates the
ReplicaSet and Pods for you.

---

## 2. The Deployment (`k8s/order/deployment.yaml`)

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: order
  labels:
    app: order
spec:
  replicas: 2
  selector:
    matchLabels:
      app: order
  template:
    metadata:
      labels:
        app: order
    spec:
      containers:
        - name: order
          image: 851942366136.dkr.ecr.ap-south-1.amazonaws.com/ofl/order:v1
          imagePullPolicy: Always
          ports:
            - name: http
              containerPort: 3000
          env:
            - name: NODE_ENV
              value: 'production'
            - name: PORT
              value: '3000'
          livenessProbe:
            httpGet: { path: /health, port: http }
            initialDelaySeconds: 5
            periodSeconds: 10
          readinessProbe:
            httpGet: { path: /health, port: http }
            initialDelaySeconds: 3
            periodSeconds: 10
```

### Top-level fields

- **`apiVersion: apps/v1`** — which API group/version defines this object.
  Deployments live in `apps/v1`. (Services are core `v1`.)
- **`kind: Deployment`** — the object type.
- **`metadata.name: order`** — the object's name in the cluster.
- **`metadata.labels`** — labels on the Deployment object itself (organization).

### `spec` — the desired state

- **`replicas: 2`** — keep two pods running at all times.
- **`selector.matchLabels: { app: order }`** — _which pods this Deployment
  owns_. It manages every pod carrying `app: order`.
- **`template`** — the **pod blueprint**. Everything under here describes the
  pods to stamp out. Crucially, `template.metadata.labels` (`app: order`) **must
  match the selector** — that's the link between the Deployment and its pods.

### The container

- **`image`** — the ECR image to run. Account/region-specific; must be built for
  the node's CPU arch (our t3 nodes are x86, so `linux/amd64`).
- **`imagePullPolicy: Always`** — re-pull from ECR on every pod start, so a
  re-pushed `:v1` is actually picked up (and the ECR-pull permission is
  re-exercised each time). The default for a non-`:latest` tag would be
  `IfNotPresent`, which caches and can serve a stale image.
- **`ports.containerPort: 3000`**, named `http` — the port the app listens on.
  Naming it lets other fields refer to `http` instead of repeating `3000`.
- **`env`** — environment variables injected into the container (`NODE_ENV`,
  `PORT`), read by the app just like in Docker Compose. No `DATABASE_URL` yet —
  the app starts without a DB (Stage 7 adds it).

### The probes (how Kubernetes checks health)

Two probes, both hitting `GET /health`:

- **`livenessProbe`** — "is the process alive?" If it fails repeatedly,
  Kubernetes **restarts the container**. Guards against a hung process.
- **`readinessProbe`** — "should this pod receive traffic?" If it fails, the pod
  is **removed from the Service's rotation** (but not restarted). Guards against
  sending requests to a pod that isn't ready.

`initialDelaySeconds` gives the app a moment to boot before probing;
`periodSeconds` is how often to check. Both point at `port: http` (the named
3000). Right now both use `/health`; a DB-aware readiness probe (only "ready" if
Postgres is reachable) is a natural Stage 7/12 addition.

---

## 3. The Service (`k8s/order/service.yaml`)

```yaml
apiVersion: v1
kind: Service
metadata:
  name: order
  labels:
    app: order
spec:
  type: ClusterIP
  selector:
    app: order
  ports:
    - name: http
      port: 80
      targetPort: http
      protocol: TCP
```

**Why a Service exists:** pods are ephemeral — they get new IPs when recreated,
and there are N of them. A Service is a **stable front door**: one unchanging
virtual IP + DNS name that load-balances across whatever pods currently match
its selector.

- **`type: ClusterIP`** — the default. Reachable **only inside the cluster**.
  Other pods reach it at `http://order` (the Service name becomes a DNS entry).
  Not exposed to the internet — that's step 14 (`LoadBalancer`/Ingress). For now
  we tunnel in with `kubectl port-forward`.
- **`selector: { app: order }`** — the Service sends traffic to every pod with
  this label. This is the _same_ label the Deployment stamps on its pods, so the
  Service automatically tracks them as pods come and go.
- **`ports`:**
  - **`port: 80`** — the port the Service listens on.
  - **`targetPort: http`** — the container port to forward to (the named `http`
    = 3000). So `Service:80 → pod:3000`.

---

## 4. How the two connect

```
   Deployment (selector app=order)
        │ creates + labels
        ▼
   Pod[app=order]:3000   Pod[app=order]:3000
        ▲                       ▲
        └───────── selector app=order ─────────┘
                    │
              Service "order"  (ClusterIP :80 -> targetPort 3000)
                    │
              DNS: http://order    (in-cluster)
                    │
              kubectl port-forward svc/order 8080:80
                    │
              curl localhost:8080/health   (from your laptop)
```

The **label `app: order` is the linchpin**: the Deployment uses it to own pods,
the pods carry it, and the Service uses it to find them. Change it in one place
without the others and traffic silently goes nowhere — the classic k8s "my
Service has no endpoints" bug.

---

## 5. Design decisions (the "why")

- **`replicas: 2`** — enough to see load-balancing and rolling updates across the
  two-node group; still tiny.
- **`imagePullPolicy: Always`** — learning setup: guarantees the latest push is
  used and re-tests the ECR-pull IAM permission each start.
- **Probes on `/health`, but no resource requests/limits.** Probes are core to a
  functioning Deployment and use the exact route this step is about. Resource
  requests/limits + HPA are explicitly **Stage 12**, so they're deliberately
  omitted here (one phase at a time).
- **`ClusterIP`, not `LoadBalancer`.** Internal-only avoids provisioning an AWS
  load balancer (hourly cost). External exposure is step 14, right before we'd
  tear the cluster down.
- **No `DATABASE_URL`.** The app was made to start without a DB (liveness is
  DB-independent), so it runs here before Postgres exists in-cluster. DB config
  arrives as a ConfigMap/Secret in Stage 7.
- **Hardcoded ECR image URL.** Raw manifests (Helm/Kustomize are reserved future
  slots), single sandbox account — simplest. It's one line to change.

---

## 6. Deploy, verify, clean up

```bash
kubectl apply -f k8s/order/          # create/update both objects
kubectl get pods -w                  # ContainerCreating -> Running
kubectl get deploy,rs,pods,svc       # see the whole hierarchy
kubectl port-forward svc/order 8080:80
curl http://localhost:8080/health    # {"status":"ok"}
kubectl logs deploy/order            # startup logs
kubectl delete -f k8s/order/         # remove app objects (or destroy the cluster)
```

Useful debugging when a pod misbehaves:

- `kubectl describe pod <name>` — events (image pull errors, scheduling, probe
  failures) are at the bottom.
- `ImagePullBackOff` → ECR permission or a bad image ref.
- `CrashLoopBackOff` + "exec format error" → wrong CPU arch (arm64 image on x86
  nodes) — rebuild `--platform linux/amd64`.
- `Service has no endpoints` → the Service selector doesn't match any pod labels.

---

## 7. What's deliberately NOT here yet

Kept out to respect "one phase at a time":

- **Resource requests/limits, HPA** — Stage 12 hardening.
- **External exposure (LoadBalancer / Ingress)** — step 14.
- **ConfigMap / Secret for `DATABASE_URL`** — Stage 7, when Postgres joins.
- **A dedicated Namespace** — everything lands in `default` for now.
- **Graceful-shutdown wiring / `rollout restart` verification** — Stage 12.
