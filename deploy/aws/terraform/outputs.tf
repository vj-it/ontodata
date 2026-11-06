output "app_url" {
  value = "http://${aws_instance.app.public_ip}:4000"
}

output "instance_id" {
  value = aws_instance.app.id
}

output "redshift_endpoint" {
  value = aws_redshiftserverless_workgroup.main.endpoint[0].address
}

output "rds_endpoint" {
  value = local.use_pgvector ? aws_db_instance.pgvector[0].address : null
}

output "vector_bucket" {
  value = local.use_s3vectors ? aws_s3vectors_vector_bucket.main[0].vector_bucket_name : null
}

output "neptune_endpoint" {
  value = var.enable_neptune ? aws_neptune_cluster.main[0].endpoint : null
}

output "passwords" {
  description = "terraform output -json passwords. The app is already configured with them."
  sensitive   = true
  value = {
    redshift_admin = random_password.redshift_admin.result
    redshift_app   = random_password.redshift_app.result
    rds            = random_password.rds.result
  }
}
