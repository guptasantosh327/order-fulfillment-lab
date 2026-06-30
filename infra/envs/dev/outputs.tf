output "vpc_id" {
  description = "ID of the dev VPC."
  value       = module.vpc.vpc_id
}

output "public_subnet_ids" {
  description = "IDs of the dev public subnets."
  value       = module.vpc.public_subnet_ids
}
