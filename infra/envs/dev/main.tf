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

module "ecr_order" {
  source = "../../modules/ecr"

  name = "ofl/order"
}

module "eks" {
  source = "../../modules/eks"

  cluster_name = "ofl-dev"

  # Control plane needs >= 2 AZs (free); nodes pinned to the first subnet only,
  # keeping all paid compute in a single AZ per the cost rule.
  control_plane_subnet_ids = module.vpc.public_subnet_ids
  node_subnet_ids          = [module.vpc.public_subnet_ids[0]]
}
