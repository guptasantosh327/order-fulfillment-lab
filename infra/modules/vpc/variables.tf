variable "name" {
  description = "Name prefix applied to all VPC resources (e.g. ofl-dev)."
  type        = string
}

variable "cidr_block" {
  description = "CIDR block for the VPC."
  type        = string
}

variable "public_subnets" {
  description = <<-EOT
    Map of availability-zone name => public subnet CIDR. One public subnet is
    created per entry. Subnets/route-tables/IGW are free, so spanning two AZs
    here carries no cost — the single-AZ cost rule targets NAT gateways, EC2
    nodes, and cross-AZ data transfer, none of which exist in this module.
  EOT
  type        = map(string)
}
