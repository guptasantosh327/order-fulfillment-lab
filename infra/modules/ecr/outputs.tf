output "repository_url" {
  description = "Full repository URL used for docker tag/push (account.dkr.ecr.region.amazonaws.com/name)."
  value       = aws_ecr_repository.this.repository_url
}

output "repository_arn" {
  description = "ARN of the repository (used later for IAM pull/push permissions)."
  value       = aws_ecr_repository.this.arn
}

output "repository_name" {
  description = "Name of the repository."
  value       = aws_ecr_repository.this.name
}
