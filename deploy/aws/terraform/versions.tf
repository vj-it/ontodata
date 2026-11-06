terraform {
  required_version = ">= 1.6"

  required_providers {
    aws     = { source = "hashicorp/aws", version = "~> 6.0" }
    random  = { source = "hashicorp/random", version = "~> 3.6" }
    archive = { source = "hashicorp/archive", version = "~> 2.7" }
    http    = { source = "hashicorp/http", version = "~> 3.4" }
  }
}

provider "aws" {
  region  = var.region
  profile = var.profile

  default_tags {
    tags = { Project = "ontodata" }
  }
}
