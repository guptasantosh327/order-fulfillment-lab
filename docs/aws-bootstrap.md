# AWS bootstrap (Stage 4, step 9)

One-time manual setup that must exist **before** any Terraform or billable
resource. It cannot be done by Terraform itself — this is the chicken-and-egg
identity Terraform will later authenticate as.

**The rule:** the budget alert goes in **first**, before the IAM user, before
anything that can cost money.

Run these from your machine with the AWS CLI already configured (you're on
`user/santosh-stg` in account `851942366136`). Account-changing steps require
that user to have Budgets + IAM permissions; if a command is denied, do that
step from the AWS Console while signed in with sufficient privileges.

We use **`ap-south-1`** (Mumbai) as the single region for this whole repo —
closest to you. Keep it consistent everywhere; everything here is
single-region / single-AZ.

---

## Managing multiple AWS accounts (profiles)

You have several AWS accounts (personal, office, this sandbox). The CLI keeps
them apart with **named profiles**, stored in two files under `~/.aws/`:

- `~/.aws/credentials` — access keys, one block per profile.
- `~/.aws/config` — region / output / SSO settings, one block per profile.

> ⚠️ **Before every billable or destructive command in this repo, confirm the
> account.** This sandbox is account `851942366136`. Running Terraform or these
> bootstrap commands against your office account would be bad.
>
> ```bash
> aws sts get-caller-identity --query Account --output text   # must print 851942366136
> ```

### The commands you actually need

```bash
# Who am I right now? (default profile, then a specific one)
aws sts get-caller-identity
aws sts get-caller-identity --profile office

# List every profile you've configured
aws configure list-profiles

# Add a new account, or change an existing one (key-based).
# Re-running the same command overwrites that profile's settings.
aws configure --profile sandbox      # prompts: key, secret, region, output
```

### Switching which account a command uses — two ways

1. **Per command** — append `--profile NAME` to any `aws` call:

   ```bash
   aws s3 ls --profile office
   ```

2. **For the whole shell session** — set the `AWS_PROFILE` env var. Your shell
   is **fish**, so use `set -x` (not `export`):

   ```fish
   set -x AWS_PROFILE sandbox       # fish (this machine)
   aws sts get-caller-identity      # now everything uses 'sandbox'
   set -e AWS_PROFILE               # unset it again
   ```

   For reference, in bash/zsh the same is `export AWS_PROFILE=sandbox`.

### Office accounts usually use SSO (IAM Identity Center), not static keys

If your office uses AWS SSO, set it up once and log in when the session expires —
no long-lived keys to manage:

```bash
aws configure sso --profile office   # one-time interactive setup
aws sso login --profile office       # refresh when the login expires
```

### Inspect or hand-edit the files

```bash
cat ~/.aws/config
cat ~/.aws/credentials
```

A profile block in `~/.aws/config` looks like `[profile office]`; in
`~/.aws/credentials` it's just `[office]`. The special name `[default]` is what's
used when no `--profile` / `AWS_PROFILE` is given.

> For this project, the simplest habit: `set -x AWS_PROFILE terraform-deployer`
> once per session (after step 3 below), and always run the account-confirm
> command above before anything that costs money.

---

## Step 1 — Cost budget FIRST ($20/month, alerts at 50 / 80 / 100%)

AWS Budgets is a global service (free for the first two budgets). This creates a
monthly cost budget that emails you at $10, $16, and $20.

```bash
cat > /tmp/ofl-budget.json <<'JSON'
{
  "BudgetName": "order-fulfillment-lab-monthly",
  "BudgetType": "COST",
  "TimeUnit": "MONTHLY",
  "BudgetLimit": { "Amount": "20", "Unit": "USD" }
}
JSON

cat > /tmp/ofl-budget-notifications.json <<'JSON'
[
  {
    "Notification": { "NotificationType": "ACTUAL", "ComparisonOperator": "GREATER_THAN", "Threshold": 50, "ThresholdType": "PERCENTAGE" },
    "Subscribers": [ { "SubscriptionType": "EMAIL", "Address": "guptasantosh327@gmail.com" } ]
  },
  {
    "Notification": { "NotificationType": "ACTUAL", "ComparisonOperator": "GREATER_THAN", "Threshold": 80, "ThresholdType": "PERCENTAGE" },
    "Subscribers": [ { "SubscriptionType": "EMAIL", "Address": "guptasantosh327@gmail.com" } ]
  },
  {
    "Notification": { "NotificationType": "ACTUAL", "ComparisonOperator": "GREATER_THAN", "Threshold": 100, "ThresholdType": "PERCENTAGE" },
    "Subscribers": [ { "SubscriptionType": "EMAIL", "Address": "guptasantosh327@gmail.com" } ]
  }
]
JSON

aws budgets create-budget \
  --account-id 851942366136 \
  --budget file:///tmp/ofl-budget.json \
  --notifications-with-subscribers file:///tmp/ofl-budget-notifications.json
```

> Optional but recommended: add a fourth notification with
> `"NotificationType": "FORECASTED", "Threshold": 100` so you're warned when AWS
> _projects_ you'll exceed the budget, not only after you already have.

**Verify:**

```bash
aws budgets describe-budgets --account-id 851942366136 \
  --query "Budgets[].{Name:BudgetName,Limit:BudgetLimit.Amount}" --output table
```

You should also get a confirmation email per address; budget emails only start
flowing once there's spend to report.

---

## Step 2 — Dedicated `terraform-deployer` IAM user

A separate identity used _only_ by Terraform, so its blast radius is distinct
from your personal `santosh-stg` user.

```bash
# Create the user
aws iam create-user --user-name terraform-deployer

# Permissions: AdministratorAccess is the pragmatic choice for a throwaway
# learning account that creates VPC + EKS + ECR + IAM across stages. See the
# note below on least privilege.
aws iam attach-user-policy \
  --user-name terraform-deployer \
  --policy-arn arn:aws:iam::aws:policy/AdministratorAccess

# Create an access key — the SecretAccessKey is shown ONCE. Copy it now.
aws iam create-access-key --user-name terraform-deployer
```

> **Least-privilege note:** AdministratorAccess is broad. The cleaner-but-fiddlier
> alternative is a scoped policy granting only EC2/VPC, EKS, ECR, IAM (for IRSA),
> SNS, SQS, and Budgets. For a sandbox user that lives only as long as this
> project, Admin is acceptable and avoids permission whack-a-mole each stage —
> but never reuse this user outside this learning account.

---

## Step 3 — Configure a CLI profile for Terraform

Keep Terraform's identity in a named profile, separate from your default.

```bash
aws configure --profile terraform-deployer
# AWS Access Key ID:     <from step 2>
# AWS Secret Access Key: <from step 2>
# Default region name:   ap-south-1
# Default output format:  json
```

**Verify it's the deployer user (not santosh-stg):**

```bash
aws sts get-caller-identity --profile terraform-deployer
# Arn should end in  :user/terraform-deployer
```

Terraform picks this up via the `profile = "terraform-deployer"` setting in the
dev env's `providers.tf` (step 10), or via `AWS_PROFILE=terraform-deployer`.

---

## Step 4 — Install Terraform (needed for step 10, not step 9)

Terraform is a single static binary, so the simplest install needs neither
Homebrew nor Xcode Command Line Tools. Apple Silicon (arm64):

```bash
VER=$(curl -fsSL https://checkpoint-api.hashicorp.com/v1/check/terraform \
  | grep -o '"current_version":"[^"]*"' | head -1 | cut -d'"' -f4)
curl -fsSL -o /tmp/terraform.zip \
  "https://releases.hashicorp.com/terraform/${VER}/terraform_${VER}_darwin_arm64.zip"
unzip -o /tmp/terraform.zip -d /tmp
mv -f /tmp/terraform /opt/homebrew/bin/terraform   # already on PATH, user-owned
terraform version
```

> **Why not `brew install hashicorp/tap/terraform`?** Homebrew needs Xcode
> Command Line Tools, which aren't installed here — that's the
> `No developer tools installed` error. If you want brew working long-term (it's
> generally useful), install the tools once with `xcode-select --install`
> (interactive GUI, a few minutes), then `brew install hashicorp/tap/terraform`.
> The direct binary above avoids that entirely.

---

## Security notes

- The access keys live in `~/.aws/credentials` (outside this repo) — **never**
  commit them. No static AWS keys belong in the repo or any image (IRSA replaces
  them entirely from Stage 8).
- This `terraform-deployer` user is for this sandbox account only.
- When you're truly done with the project, delete the access key and user:
  `aws iam delete-access-key` / `aws iam delete-user` (after detaching policies).

---

## Done when

- [ ] `aws budgets describe-budgets` shows `order-fulfillment-lab-monthly` at $20
- [ ] `aws sts get-caller-identity --profile terraform-deployer` shows `:user/terraform-deployer`
- [ ] `terraform version` works
- [ ] You received the budget confirmation email
