provider "aws" {
  region  = var.region
  profile = var.aws_profile

  # Stamped on every resource that supports tags, so anything created by this
  # stack is easy to find (and clean up) in the console.
  default_tags {
    tags = {
      Project   = "order-fulfillment-lab"
      Env       = "dev"
      ManagedBy = "terraform"
    }
  }
}
