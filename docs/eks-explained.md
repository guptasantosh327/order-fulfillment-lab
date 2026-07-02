# EKS, explained (this repo's `infra/modules/eks`)

What the EKS Terraform module creates, block by block, and — more importantly —
**why each choice was made**. Written to be readable if you've never set up
Kubernetes on AWS before.

> Scope: Stage 6, step 12 — a minimum-viable cluster you stand up, run
> `kubectl get nodes` against, and **tear down in the same session**. Region
> `ap-south-1`, cluster name `ofl-dev`.

---

## 1. What EKS actually is (mental model)

**Kubernetes** is an orchestrator: you hand it containers and it schedules them
onto machines, restarts them when they die, networks them, scales them.

A Kubernetes cluster has **two halves**:

- **Control plane** — the "brain": the API server (what `kubectl` talks to),
  `etcd` (the cluster database), the scheduler, controllers. **EKS runs this for
  you**, across multiple AZs, and charges a flat **~$0.10/hour** for it.
- **Data plane** — the "muscle": the **worker nodes** (EC2 instances) that
  actually run your pods. **You provide these.** You pay normal EC2 prices.

So EKS = "AWS manages the control plane; you bring the nodes." This module
creates the cluster (control plane) **and** a **managed node group** (EKS
provisions and registers the EC2 nodes for you, rather than you wiring up EC2 by
hand).

---

## 2. What this module creates (the inventory)

```
                    ┌───────────────────────────────┐
   assumes          │        EKS CONTROL PLANE       │
 eks.amazonaws.com  │   (managed by AWS, 2 AZs)      │
        ▲           │   ~$0.10/hr flat               │
        │           └───────────────┬───────────────┘
 ┌──────┴────────┐                  │ registers / schedules
 │ cluster IAM    │                 ▼
 │ role           │        ┌─────────────────────────┐
 │ +EKSClusterPol │        │   MANAGED NODE GROUP     │
 └────────────────┘        │   spot t3.small, 1 AZ    │
                           │   (EC2 worker nodes)     │
 ┌────────────────┐        └─────────────┬───────────┘
 │ node IAM role  │  assumes             │
 │ +Worker        │◄─ ec2.amazonaws.com ─┘
 │ +CNI           │
 │ +ECR ReadOnly  │
 └────────────────┘
```

Five things, in `infra/modules/eks/main.tf`:

1. A **cluster IAM role** + one policy attachment.
2. The **EKS cluster** (control plane).
3. A **node IAM role** + three policy attachments.
4. A **managed node group** (the worker EC2s).

Plus `variables.tf` (inputs) and `outputs.tf` (results).

---

## 3. Why there are TWO IAM roles

This trips up newcomers. AWS needs to know "who is allowed to act as what," and
there are two different actors here:

- **The EKS service itself** needs permission to create AWS resources on your
  behalf (network interfaces, etc.). → the **cluster role**.
- **The EC2 worker nodes** need permission to join the cluster, wire up pod
  networking, and pull images. → the **node role**.

Each role has two parts:

- A **trust policy** (`assume_role_policy`): _who_ is allowed to assume this
  role. For the cluster role it's the `eks.amazonaws.com` service; for the node
  role it's the `ec2.amazonaws.com` service.
- **Permission policies** (the attachments): _what_ the role can do once assumed.

---

## 4. The code, block by block

### Cluster IAM role

```hcl
resource "aws_iam_role" "cluster" {
  name = "${var.cluster_name}-cluster"
  assume_role_policy = jsonencode({          # <- the TRUST policy
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "eks.amazonaws.com" }   # only EKS may assume it
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "cluster_eks" {
  role       = aws_iam_role.cluster.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKSClusterPolicy"   # what it can do
}
```

We write the trust policy as literal JSON (via `jsonencode`) rather than hiding
it behind a helper — so you can see exactly who's trusted. `AmazonEKSClusterPolicy`
is the AWS-managed policy that grants the control plane what it needs.

### The cluster (control plane)

```hcl
resource "aws_eks_cluster" "this" {
  name     = var.cluster_name
  version  = var.kubernetes_version              # null => EKS default (latest)
  role_arn = aws_iam_role.cluster.arn            # the role above

  vpc_config {
    subnet_ids              = var.control_plane_subnet_ids   # >= 2 AZs (required)
    endpoint_public_access  = true                            # reach API from laptop
    endpoint_private_access = false
  }

  access_config {
    authentication_mode                         = "API_AND_CONFIG_MAP"
    bootstrap_cluster_creator_admin_permissions = true        # creator = admin
  }

  depends_on = [aws_iam_role_policy_attachment.cluster_eks]
}
```

- `role_arn` links the cluster to the role it assumes.
- `vpc_config.subnet_ids` — the control plane places elastic network interfaces
  in these subnets. **EKS requires at least two AZs here.**
- `endpoint_public_access = true` — the Kubernetes API is reachable from the
  internet, so `kubectl` works from your laptop without a bastion/VPN. (A
  production cluster would usually make this private.)
- `access_config` — `bootstrap_cluster_creator_admin_permissions = true` means
  the IAM identity that runs `terraform apply` (`terraform-deployer`) is granted
  cluster-admin automatically. That's why `kubectl` "just works" right after
  apply — no editing the legacy `aws-auth` ConfigMap.
- `depends_on` — force the policy attachment to exist _before_ the cluster is
  created, so EKS has its permissions from the start.

### Worker-node IAM role + the three standard policies

```hcl
resource "aws_iam_role" "node" {
  name = "${var.cluster_name}-node"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }   # EC2 nodes assume this
      Action    = "sts:AssumeRole"
    }]
  })
}

# 1. join the cluster, describe resources
resource "aws_iam_role_policy_attachment" "node_worker" {
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKSWorkerNodePolicy"
  role       = aws_iam_role.node.name
}
# 2. VPC CNI: give pods real VPC IPs by managing ENIs
resource "aws_iam_role_policy_attachment" "node_cni" {
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKS_CNI_Policy"
  role       = aws_iam_role.node.name
}
# 3. pull container images from ECR
resource "aws_iam_role_policy_attachment" "node_ecr" {
  policy_arn = "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly"
  role       = aws_iam_role.node.name
}
```

Those three managed policies are the **standard EKS node set**:

| Policy                               | What it lets a node do                                | If missing…                                                  |
| ------------------------------------ | ----------------------------------------------------- | ------------------------------------------------------------ |
| `AmazonEKSWorkerNodePolicy`          | Register with the cluster, describe EC2/EKS resources | node never joins → not `Ready`                               |
| `AmazonEKS_CNI_Policy`               | The VPC CNI plugin attaches ENIs / assigns pod IPs    | pods stuck `ContainerCreating`, no IPs                       |
| `AmazonEC2ContainerRegistryReadOnly` | Pull images from ECR                                  | pods fail with an ECR auth error (this is the step-13 "aha") |

### The managed node group (the actual EC2 workers)

```hcl
resource "aws_eks_node_group" "this" {
  cluster_name    = aws_eks_cluster.this.name
  node_group_name = "${var.cluster_name}-ng"
  node_role_arn   = aws_iam_role.node.arn      # the node role above
  subnet_ids      = var.node_subnet_ids        # single AZ (cost)

  capacity_type  = var.node_capacity_type      # SPOT
  instance_types = var.node_instance_types     # ["t3.small","t3.medium"]

  scaling_config {
    desired_size = var.node_desired_size        # 2
    min_size     = var.node_min_size            # 1
    max_size     = var.node_max_size            # 2
  }

  depends_on = [               # nodes must have permissions before they boot
    aws_iam_role_policy_attachment.node_worker,
    aws_iam_role_policy_attachment.node_cni,
    aws_iam_role_policy_attachment.node_ecr,
  ]
}
```

`node_role_arn` attaches the node role to every EC2 instance the group launches;
that's how a node "becomes" its IAM identity. `depends_on` guarantees the three
permissions exist before nodes try to register (otherwise they'd fail to join).

---

## 5. The design decisions (the "why chosen")

### Hand-rolled, not the community `terraform-aws-modules/eks`

The popular module works, but it hides the IAM roles, trust policies, and node
permissions behind hundreds of options. Those relationships are exactly what
this project exists to _see_ — especially since IRSA (Stage 8) builds directly
on this IAM foundation. Writing ~4 resources by hand is worth the clarity.

### Control plane in 2 AZs, nodes in 1 AZ

EKS **requires** control-plane subnets in ≥2 AZs — and that's **free** (the
control plane is a flat fee). The single-AZ rule in this repo is a **cost** rule:
it targets paid compute (EC2) and cross-AZ data-transfer charges. So we satisfy
both: `control_plane_subnet_ids` = both subnets, `node_subnet_ids` = just the
first. All paid nodes live in one AZ; the control plane spans two at no cost.

### Spot instances, small types

`capacity_type = "SPOT"` uses spare AWS capacity at a deep discount (a spot
`t3.small` is well under $0.01/hr). Spot nodes _can_ be reclaimed with 2 minutes'
notice — irrelevant for a learning sandbox. Listing **two** instance types
(`t3.small`, `t3.medium`) improves the odds AWS has spot capacity to give us.

### Public subnets, no NAT gateway

Nodes launch in **public** subnets with public IPs (the VPC module set
`map_public_ip_on_launch = true`). That lets them reach the EKS API and pull
images directly through the internet gateway — so we **avoid a NAT gateway**
(~$32/mo + data charges). Production would put nodes in private subnets behind
NAT; for a cost-conscious sandbox, public nodes are the right trade-off.

### `bootstrap_cluster_creator_admin_permissions = true`

Grants the creating identity cluster-admin automatically, so `kubectl` works
immediately. The alternative — hand-editing the `aws-auth` ConfigMap — is the
classic "why can't I access my own cluster?" beginner trap. We skip it.

### `kubernetes_version = null`

Pinning a specific version that AWS has since deprecated makes `apply` fail. Left
`null`, EKS uses its current default (latest supported), which always works. You
can pin a version later when you care about upgrade control.

---

## 6. Variables & outputs

**Inputs** (`variables.tf`): `cluster_name`, `kubernetes_version` (default
`null`), `control_plane_subnet_ids`, `node_subnet_ids`, `node_instance_types`
(default `["t3.small","t3.medium"]`), `node_capacity_type` (default `SPOT`),
`node_desired_size`/`min`/`max` (2/1/2).

**Outputs** (`outputs.tf`): `cluster_name`, `cluster_endpoint`,
`cluster_version`, `node_role_arn`, `node_group_name`.

**How it's wired** in `infra/envs/dev/main.tf`:

```hcl
module "eks" {
  source                   = "../../modules/eks"
  cluster_name             = "ofl-dev"
  control_plane_subnet_ids = module.vpc.public_subnet_ids        # both AZs
  node_subnet_ids          = [module.vpc.public_subnet_ids[0]]   # first AZ only
}
```

Note the module **consumes the VPC module's output** (`module.vpc.public_subnet_ids`)
— that reference is what makes Terraform build the VPC before the cluster.

---

## 7. Cost discipline (read this every time)

The control plane bills **~$0.10/hr from the moment `apply` finishes until you
`destroy`**, running or not. This cluster is **ephemeral**: stand it up for a
session, tear it down when done.

```bash
set -x AWS_PROFILE terraform-deployer
aws sts get-caller-identity --query Account --output text   # expect 851942366136

terraform -chdir=infra/envs/dev apply                        # ~15 min
aws eks update-kubeconfig --name ofl-dev --region ap-south-1 --profile terraform-deployer
kubectl get nodes                                            # the lesson
kubectl get pods -A

terraform -chdir=infra/envs/dev destroy                      # DO NOT SKIP
```

A ~1-hour session costs ~$0.10–0.20. The real risk is **forgetting to destroy**
and leaking $2.40/day. `destroy` here removes the whole dev stack (VPC + ECR +
EKS); the VPC/ECR are free, so that's fine — use `-target=module.eks` if you want
to keep the ECR image and only kill the cluster.

---

## 8. What's deliberately NOT here yet

Kept out to respect "one phase at a time":

- **OIDC provider / IRSA** — pod-level AWS permissions. Arrives in Stage 8, and
  builds on the IAM roles above.
- **Cluster autoscaler / Karpenter, HPA** — Stage 12 hardening.
- **Private subnets + NAT, private API endpoint** — production hardening we skip
  for cost.
- **Subnet tags for load-balancer auto-discovery** — added in step 14 when we
  expose the service externally.
