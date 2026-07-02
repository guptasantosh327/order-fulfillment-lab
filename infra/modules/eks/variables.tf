variable "cluster_name" {
  description = "Name of the EKS cluster."
  type        = string
}

variable "kubernetes_version" {
  description = "Kubernetes version. null lets EKS use its current default (latest supported), avoiding apply failures on a pinned-but-unsupported version."
  type        = string
  default     = null
}

variable "control_plane_subnet_ids" {
  description = "Subnets for the EKS control-plane ENIs. EKS requires subnets in >= 2 AZs (this is free — control plane is a flat fee)."
  type        = list(string)
}

variable "node_subnet_ids" {
  description = "Subnets for worker nodes. Kept to a single AZ to honor the single-AZ COST rule (no cross-AZ data transfer, compute in one AZ)."
  type        = list(string)
}

variable "node_instance_types" {
  description = "Instance types for the spot node group. Listing a few improves the odds of getting spot capacity."
  type        = list(string)
  default     = ["t3.small", "t3.medium"]
}

variable "node_capacity_type" {
  description = "SPOT (cheap, can be reclaimed) or ON_DEMAND. Spot is fine for a learning sandbox."
  type        = string
  default     = "SPOT"
}

variable "node_desired_size" {
  description = "Desired number of worker nodes."
  type        = number
  default     = 2
}

variable "node_min_size" {
  description = "Minimum number of worker nodes."
  type        = number
  default     = 1
}

variable "node_max_size" {
  description = "Maximum number of worker nodes."
  type        = number
  default     = 2
}
