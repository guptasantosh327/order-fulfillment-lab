output "vpc_id" {
  description = "ID of the dev VPC."
  value       = module.vpc.vpc_id
}

output "public_subnet_ids" {
  description = "IDs of the dev public subnets."
  value       = module.vpc.public_subnet_ids
}

output "ecr_order_repository_url" {
  description = "ECR repository URL for the order service (docker tag/push target)."
  value       = module.ecr_order.repository_url
}

output "eks_cluster_name" {
  description = "EKS cluster name for `aws eks update-kubeconfig`."
  value       = module.eks.cluster_name
}
