variable "region" {
  type    = string
  default = "us-east-1"
}

variable "profile" {
  description = "AWS CLI profile in ~/.aws/credentials used to create everything."
  type        = string
  default     = "ontodata"
}

variable "allowed_cidr" {
  description = "Who may open the app on port 4000. Empty means your current public IP."
  type        = string
  default     = ""
}

variable "instance_type" {
  type    = string
  default = "t3.large"
}

variable "vector_store" {
  description = "The one vector store to create: pgvector (RDS PostgreSQL) or s3vectors. Switching deletes the other."
  type        = string
  default     = "pgvector"

  validation {
    condition     = contains(["pgvector", "s3vectors"], var.vector_store)
    error_message = "vector_store must be pgvector or s3vectors."
  }
}

variable "enable_neptune" {
  description = "Create the Neptune cluster. It costs the most while idle, so it's off until you need it."
  type        = bool
  default     = false
}
