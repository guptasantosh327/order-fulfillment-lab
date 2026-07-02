output "cluster_name" {
  description = "Name of the EKS cluster (used by `aws eks update-kubeconfig`)."
  value       = aws_eks_cluster.this.name
}

output "cluster_endpoint" {
  description = "Kubernetes API server endpoint."
  value       = aws_eks_cluster.this.endpoint
}

output "cluster_version" {
  description = "Kubernetes version EKS actually provisioned."
  value       = aws_eks_cluster.this.version
}

output "node_role_arn" {
  description = "IAM role ARN the worker nodes assume."
  value       = aws_iam_role.node.arn
}

output "node_group_name" {
  description = "Name of the managed node group."
  value       = aws_eks_node_group.this.node_group_name
}
