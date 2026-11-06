data "aws_caller_identity" "current" {}

locals {
  use_pgvector  = var.vector_store == "pgvector"
  use_s3vectors = var.vector_store == "s3vectors"
}

resource "random_password" "redshift_admin" {
  length      = 24
  special     = false
  min_upper   = 2
  min_lower   = 2
  min_numeric = 2
}

resource "random_password" "redshift_app" {
  length      = 24
  special     = false
  min_upper   = 2
  min_lower   = 2
  min_numeric = 2
}

resource "random_password" "rds" {
  length  = 24
  special = false
}

# ---------- Redshift Serverless ----------

resource "aws_redshiftserverless_namespace" "main" {
  namespace_name      = "ontodata"
  db_name             = "dev"
  admin_username      = "ontodata_admin"
  admin_user_password = random_password.redshift_admin.result
}

resource "aws_redshiftserverless_workgroup" "main" {
  workgroup_name      = "ontodata"
  namespace_name      = aws_redshiftserverless_namespace.main.namespace_name
  base_capacity       = 8
  subnet_ids          = slice(sort(data.aws_subnets.default.ids), 0, 3)
  security_group_ids  = [aws_security_group.services.id]
  publicly_accessible = false
}

# ---------- RDS PostgreSQL for pgvector ----------

resource "aws_db_subnet_group" "main" {
  name       = "ontodata"
  subnet_ids = data.aws_subnets.default.ids
}

resource "aws_db_instance" "pgvector" {
  count = local.use_pgvector ? 1 : 0

  identifier                 = "ontodata-pgvector"
  engine                     = "postgres"
  engine_version             = "16"
  instance_class             = "db.t4g.micro"
  allocated_storage          = 20
  storage_type               = "gp3"
  storage_encrypted          = true
  db_name                    = "vectors"
  username                   = "ontodata"
  password                   = random_password.rds.result
  db_subnet_group_name       = aws_db_subnet_group.main.name
  vpc_security_group_ids     = [aws_security_group.services.id]
  publicly_accessible        = false
  multi_az                   = false
  backup_retention_period    = 0
  skip_final_snapshot        = true
  delete_automated_backups   = true
  auto_minor_version_upgrade = true
  apply_immediately          = true
}

# ---------- S3 Vectors ----------

resource "aws_s3vectors_vector_bucket" "main" {
  count = local.use_s3vectors ? 1 : 0

  vector_bucket_name = "ontodata-vectors-${data.aws_caller_identity.current.account_id}"
  force_destroy      = true
}

# ---------- Neptune ----------

resource "aws_neptune_subnet_group" "main" {
  count = var.enable_neptune ? 1 : 0

  name       = "ontodata-neptune"
  subnet_ids = data.aws_subnets.default.ids
}

resource "aws_neptune_cluster" "main" {
  count = var.enable_neptune ? 1 : 0

  cluster_identifier                  = "ontodata-neptune"
  engine                              = "neptune"
  iam_database_authentication_enabled = true
  storage_encrypted                   = true
  neptune_subnet_group_name           = aws_neptune_subnet_group.main[0].name
  vpc_security_group_ids              = [aws_security_group.services.id]
  skip_final_snapshot                 = true
  backup_retention_period             = 1
  apply_immediately                   = true
}

resource "aws_neptune_cluster_instance" "main" {
  count = var.enable_neptune ? 1 : 0

  identifier         = "ontodata-neptune-1"
  cluster_identifier = aws_neptune_cluster.main[0].id
  engine             = "neptune"
  instance_class     = "db.t4g.medium"
  apply_immediately  = true
}
