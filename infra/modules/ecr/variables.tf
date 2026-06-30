variable "name" {
  description = "ECR repository name. May be namespaced with slashes (e.g. ofl/order)."
  type        = string
}

variable "image_tag_mutability" {
  description = <<-EOT
    MUTABLE lets you re-push the same tag (handy while iterating on :dev in this
    sandbox). IMMUTABLE is the production-safe choice — a tag, once pushed, can
    never be overwritten.
  EOT
  type        = string
  default     = "MUTABLE"
}

variable "scan_on_push" {
  description = "Run ECR's free basic vulnerability scan automatically on each push."
  type        = bool
  default     = true
}

variable "force_delete" {
  description = "Allow `terraform destroy` to delete the repo even if it still holds images (sandbox convenience)."
  type        = bool
  default     = true
}
