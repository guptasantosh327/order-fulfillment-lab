module "vpc" {
  source = "../../modules/vpc"

  name       = "ofl-dev"
  cidr_block = "10.0.0.0/16"

  # Two AZs of public subnets. Free (subnets/route-tables/IGW cost nothing), and
  # EKS later requires subnets in 2+ AZs — so this avoids rework without breaking
  # the single-AZ *cost* rule (which is about NAT/EC2/data-transfer).
  public_subnets = {
    "ap-south-1a" = "10.0.0.0/24"
    "ap-south-1b" = "10.0.1.0/24"
  }
}
