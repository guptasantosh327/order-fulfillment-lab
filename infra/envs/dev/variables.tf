variable "region" {
  description = "AWS region for all resources (single region for this repo)."
  type        = string
  default     = "ap-south-1"
}

variable "aws_profile" {
  description = "Local AWS CLI profile Terraform authenticates as (the dedicated, non-root deployer user)."
  type        = string
  default     = "terraform-deployer"
}
