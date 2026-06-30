# Terraform, explained from scratch (this repo's `infra/`)

A beginner-friendly walkthrough of the Terraform code under `infra/` — what each
file does, what it creates, how the pieces connect, and how variables and
outputs flow. Written for someone seeing Terraform for the first time.

> Scope: Stage 4, step 10 — a VPC-only module (subnets, route table, internet
> gateway). Region `ap-south-1`, single region / single-AZ for paid resources.

---

## 1. What Terraform is (60-second mental model)

Terraform is **declarative infrastructure-as-code**. You don't issue
step-by-step commands ("create a VPC, then a subnet"). You _describe the end
state you want_, and Terraform works out what to create, change, or delete to
make reality match.

Three moving parts:

1. **Providers** — plugins that talk to an API. We use `aws`, which turns config
   into AWS API calls.
2. **State** — a file (`terraform.tfstate`) recording what Terraform actually
   created, so next run it can diff "what exists" vs "what you asked for".
3. **HCL** — the language these `.tf` files are written in. Everything is a
   **block**:

   ```hcl
   block_type "label1" "label2" {
     argument = value
   }
   ```

   e.g. `resource "aws_vpc" "this" { ... }` → block type `resource`, resource
   type `aws_vpc`, your local name `this`.

**Beginner gotcha:** Terraform reads **all `.tf` files in a directory as one
config**. `main.tf` / `variables.tf` / `outputs.tf` are _conventions_, not
requirements — you could put it all in one file. We split for readability.

---

## 2. Big picture: two directories, two roles

```
infra/
├── modules/vpc/      <- a REUSABLE "function" that builds a VPC
│   ├── variables.tf  (its inputs/parameters)
│   ├── main.tf       (the resources it creates)
│   └── outputs.tf    (the values it returns)
└── envs/dev/         <- the ROOT module: where you actually run terraform
    ├── versions.tf   (which terraform + provider versions)
    ├── providers.tf  (how to authenticate to AWS)
    ├── variables.tf  (this env's inputs)
    ├── main.tf       (CALLS the vpc module with real values)
    └── outputs.tf    (re-exposes the module's results)
```

The key idea: **a module is like a function.** Two kinds:

- **Root module** = `infra/envs/dev/` — the directory you `cd` into and run
  `terraform` from. The entry point.
- **Child module** = `infra/modules/vpc/` — a reusable unit the root _calls_,
  like calling a function.

So `envs/dev` is the **caller**, `modules/vpc` is the **function**. Inputs go in
(variables), outputs come back. That analogy carries through everything below.

---

## 3. The child module (`modules/vpc/`)

### `variables.tf` — the function's parameters

```hcl
variable "name"           { type = string }          # name prefix, e.g. ofl-dev
variable "cidr_block"     { type = string }          # the VPC's IP range
variable "public_subnets" { type = map(string) }     # AZ name => subnet CIDR
```

A `variable` block declares an **input** — like a function parameter.

- `type` constrains the value. `string` is text; `map(string)` is a key→value
  dictionary, e.g. `{ "ap-south-1a" = "10.0.0.0/24" }`.
- **No `default` means the variable is required** — the caller must supply it.

Inside the module these are referenced as `var.name`, `var.cidr_block`,
`var.public_subnets`.

### `main.tf` — the resources it creates

**1. The VPC** (your private network in AWS):

```hcl
resource "aws_vpc" "this" {
  cidr_block           = var.cidr_block
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags = { Name = var.name }
}
```

- Address is `aws_vpc.this` (`<type>.<your name>`). Other blocks refer to it by
  this address.
- After creation, its real attributes are available, e.g. `aws_vpc.this.id`.

**2. The Internet Gateway** (the door between the VPC and the public internet):

```hcl
resource "aws_internet_gateway" "this" {
  vpc_id = aws_vpc.this.id
  tags   = { Name = "${var.name}-igw" }
}
```

- `vpc_id = aws_vpc.this.id` is the **connection mechanism**: referencing the
  VPC's id both _attaches_ the gateway to it and tells Terraform "the VPC must
  exist first" (an implicit dependency — see §5).
- `"${var.name}-igw"` is **string interpolation**: `${...}` injects a value.
  With `name = "ofl-dev"` this is `"ofl-dev-igw"`.

**3. The public subnets** (smaller IP ranges, one per Availability Zone):

```hcl
resource "aws_subnet" "public" {
  for_each = var.public_subnets

  vpc_id                  = aws_vpc.this.id
  availability_zone       = each.key
  cidr_block              = each.value
  map_public_ip_on_launch = true
  tags = { Name = "${var.name}-public-${each.key}" }
}
```

- **`for_each`** creates one instance **per map entry**. Given two entries, you
  get two subnets.
- `each.key` = the map key (AZ name, `"ap-south-1a"`); `each.value` = the map
  value (CIDR, `"10.0.0.0/24"`).
- Each instance is addressed as `aws_subnet.public["ap-south-1a"]`.
- `map_public_ip_on_launch = true` gives launched resources a public IP — part
  of what makes the subnet "public".

**4. The route table** (a container of traffic rules for subnets):

```hcl
resource "aws_route_table" "public" {
  vpc_id = aws_vpc.this.id
  tags   = { Name = "${var.name}-public-rt" }
}
```

**5. The route** (the rule: "to reach the internet, go via the gateway"):

```hcl
resource "aws_route" "public_internet" {
  route_table_id         = aws_route_table.public.id
  destination_cidr_block = "0.0.0.0/0"          # all destinations = the internet
  gateway_id             = aws_internet_gateway.this.id
}
```

**6. The associations** (glue each subnet to the route table):

```hcl
resource "aws_route_table_association" "public" {
  for_each       = aws_subnet.public   # iterate over the subnets we made
  subnet_id      = each.value.id        # each.value is a whole subnet object
  route_table_id = aws_route_table.public.id
}
```

- Here `for_each` iterates over **another resource** (the subnets), so
  `each.value` is a subnet object and `each.value.id` is its id.
- This attaches each public subnet to the route table that has the
  "→ internet via gateway" rule — the final piece that makes them truly public.

### `outputs.tf` — the function's return values

```hcl
output "vpc_id"            { value = aws_vpc.this.id }
output "public_subnet_ids" { value = [for s in aws_subnet.public : s.id] }
output "internet_gateway_id" { value = aws_internet_gateway.this.id }
```

`output` blocks are the module's **return values** — the only way the caller can
read what the module built (internals are otherwise private).

- `public_subnet_ids` uses a **`for` expression**:
  `[for s in aws_subnet.public : s.id]` loops over all subnet instances and
  collects their ids into a list, e.g. `["subnet-aaa", "subnet-bbb"]`. Needed
  because `for_each` made `aws_subnet.public` a collection.

The caller reads these as `module.vpc.vpc_id`, etc.

---

## 4. The root module / env (`envs/dev/`)

### `versions.tf` — pin Terraform & the provider

```hcl
terraform {
  required_version = ">= 1.5.0"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.0" }
  }
}
```

- `required_version` — refuse to run on older Terraform.
- `~> 5.0` is the "pessimistic" operator: **`>= 5.0.0` and `< 6.0.0`** — any 5.x,
  never an automatic jump to 6.0. `terraform init` used this to pick + download
  the provider, locking the exact version in `.terraform.lock.hcl`.

### `providers.tf` — authenticate to AWS

```hcl
provider "aws" {
  region  = var.region          # ap-south-1
  profile = var.aws_profile     # terraform-deployer (from ~/.aws/credentials)
  default_tags {
    tags = { Project = "order-fulfillment-lab", Env = "dev", ManagedBy = "terraform" }
  }
}
```

- `profile` makes Terraform authenticate as the dedicated **`terraform-deployer`**
  CLI profile — not your personal creds, no static keys in the repo.
- `default_tags` are stamped onto every taggable resource, so everything this
  stack creates is greppable (and easy to clean up) in the console.

### `variables.tf` — this env's inputs (with defaults)

```hcl
variable "region"      { type = string, default = "ap-south-1" }
variable "aws_profile" { type = string, default = "terraform-deployer" }
```

Same `variable` concept as the module, but **with defaults**, so you don't pass
them every run (you still can override: `terraform apply -var="region=..."`).

### `main.tf` — call the module (the "function call")

```hcl
module "vpc" {
  source = "../../modules/vpc"

  name       = "ofl-dev"
  cidr_block = "10.0.0.0/16"
  public_subnets = {
    "ap-south-1a" = "10.0.0.0/24"
    "ap-south-1b" = "10.0.1.0/24"
  }
}
```

- `source` — where the module's code lives (a relative path here; could be a Git
  URL or registry address).
- `name` / `cidr_block` / `public_subnets` are the **arguments**, mapping
  one-to-one onto the module's `variable` blocks. Caller passes `name` → module
  receives `var.name`.
- The instance is addressed as `module.vpc`; its outputs are `module.vpc.vpc_id`,
  etc.
- `region` / `aws_profile` are **not** passed in — they configure the provider,
  which the module inherits automatically. The module only needs networking
  inputs.

### `outputs.tf` — surface results at the top

```hcl
output "vpc_id"            { value = module.vpc.vpc_id }
output "public_subnet_ids" { value = module.vpc.public_subnet_ids }
```

A module's outputs are visible only to its caller, so the env **re-exports**
them via `module.vpc.*`. After `apply`, these root outputs print in the terminal
and are queryable with `terraform output vpc_id`.

---

## 5. How it all connects

### Data flow — inputs down, outputs up

```
   ~/.aws/credentials [terraform-deployer]
            | (auth)
            v
  +---------------------- envs/dev (ROOT) ----------------------+
  | variables.tf:  region, aws_profile                          |
  | providers.tf:  configure aws provider (region+profile+tags) |
  | main.tf:       module "vpc" {                               |
  |                  name, cidr_block, public_subnets   --+ inputs (DOWN)
  |                }                                       |     |
  +--------------------------------------------------------|-----+
                                                           v
  +--------------------- modules/vpc (CHILD) -------------------+
  | variables.tf: receives name, cidr_block, public_subnets     |
  | main.tf:      VPC -> IGW -> subnets -> route table ->        |
  |               route -> associations                         |
  | outputs.tf:   returns vpc_id, public_subnet_ids, igw_id  --+ outputs (UP)
  +------------------------------------------------------------|+
                                                               |
  envs/dev/outputs.tf: re-expose module.vpc.* -> printed to you
```

### Dependency graph — how Terraform decides order

You never write "create the VPC first." Terraform **infers order from
references**: whenever one resource mentions another's attribute, that's an edge
in a dependency graph.

```
aws_vpc.this
  ├─> aws_internet_gateway.this        (vpc_id = aws_vpc.this.id)
  │      └─> aws_route.public_internet (gateway_id = ...)
  ├─> aws_subnet.public[*]             (vpc_id = aws_vpc.this.id)
  │      └─> aws_route_table_association.public[*]
  └─> aws_route_table.public           (vpc_id = aws_vpc.this.id)
         ├─> aws_route.public_internet (route_table_id = ...)
         └─> aws_route_table_association.public[*] (route_table_id = ...)
```

VPC before gateway/subnets/route-table; route-table + gateway before the route;
subnets + route-table before the associations. Unconnected resources are created
**in parallel**. Destroy order is the reverse.

---

## 6. Workflow & state

Run from the **root** (`infra/envs/dev`):

1. `terraform init` — download the provider into `.terraform/`, write
   `.terraform.lock.hcl`. Once per dir (and after changing modules/providers).
   No AWS access needed.
2. `terraform validate` — offline check that config is valid.
3. `terraform plan` — connect to AWS, diff desired vs recorded vs real state,
   print `+ create` / `~ change` / `- destroy`. Changes nothing.
4. `terraform apply` — do what `plan` showed, after you type `yes`. Records
   results in `terraform.tfstate`.
5. `terraform destroy` — delete everything in state (the cost-cleanup button).

**State (`terraform.tfstate`)** maps your config (`aws_vpc.this`) to the real AWS
id (`vpc-0abc123`). It's how Terraform knows, next run, that something already
exists. It can hold sensitive values, so `.gitignore` excludes `*.tfstate` — but
keeps `.terraform.lock.hcl` (which _should_ be committed so everyone uses
identical provider versions).

---

## One-paragraph summary

`envs/dev` is the **root module** you run Terraform in: it authenticates to AWS
(`providers.tf`, via the `terraform-deployer` profile), pins versions
(`versions.tf`), defines its inputs (`variables.tf`), then **calls** the reusable
`modules/vpc` (`main.tf`) with a name, CIDR, and AZ→subnet map. The **child
module** receives those as `var.*`, declares the AWS resources (`main.tf`), wires
them by **referencing each other's ids** (which also sets creation order), and
**returns** ids via `outputs.tf`. The root reads them back as `module.vpc.*` and
re-exposes them in its own `outputs.tf`. Inputs flow down, outputs flow up, and
references define order — that's the whole pattern, and every future module (ECR,
EKS) plugs into this same structure.
