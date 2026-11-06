# ---------- Project bundle: zipped here, pulled by the instance ----------

locals {
  project_root  = abspath("${path.module}/../../..")
  deploy_bucket = "ontodata-deploy-${data.aws_caller_identity.current.account_id}"
}

data "archive_file" "bundle" {
  type        = "zip"
  source_dir  = local.project_root
  output_path = "${path.module}/.build/ontodata.zip"
  excludes = [
    ".claude",
    ".env",
    "backend/node_modules",
    "backend/dist",
    "backend/data",
    "frontend/node_modules",
    "frontend/dist",
    "ontop/input",
    "ontop/jdbc",
    "deploy/aws/terraform",
  ]
}

resource "aws_s3_bucket" "deploy" {
  bucket        = local.deploy_bucket
  force_destroy = true
}

resource "aws_s3_bucket_public_access_block" "deploy" {
  bucket                  = aws_s3_bucket.deploy.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_object" "bundle" {
  bucket = aws_s3_bucket.deploy.id
  key    = "ontodata.zip"
  source = data.archive_file.bundle.output_path
  etag   = data.archive_file.bundle.output_md5
}

# ---------- Instance role ----------

resource "aws_iam_role" "app" {
  name = "ontodata-ec2"
  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Principal = { Service = "ec2.amazonaws.com" }, Action = "sts:AssumeRole" }]
  })
}

resource "aws_iam_role_policy_attachment" "ssm" {
  role       = aws_iam_role.app.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_role_policy" "app" {
  name = "ontodata-app"
  role = aws_iam_role.app.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = concat(
      [
        {
          Sid      = "ReadBundle"
          Effect   = "Allow"
          Action   = "s3:GetObject"
          Resource = "${aws_s3_bucket.deploy.arn}/*"
        },
      ],
      local.use_s3vectors ? [
        {
          Sid    = "S3Vectors"
          Effect = "Allow"
          Action = ["s3vectors:GetIndex", "s3vectors:CreateIndex", "s3vectors:PutVectors", "s3vectors:QueryVectors", "s3vectors:GetVectors"]
          Resource = [
            aws_s3vectors_vector_bucket.main[0].vector_bucket_arn,
            "${aws_s3vectors_vector_bucket.main[0].vector_bucket_arn}/index/*",
          ]
        },
      ] : [],
      var.enable_neptune ? [
        {
          Sid      = "NeptunePublish"
          Effect   = "Allow"
          Action   = ["neptune-db:connect", "neptune-db:ReadDataViaQuery", "neptune-db:WriteDataViaQuery", "neptune-db:DeleteDataViaQuery"]
          Resource = "arn:aws:neptune-db:${var.region}:${data.aws_caller_identity.current.account_id}:${aws_neptune_cluster.main[0].cluster_resource_id}/*"
        },
      ] : [],
    )
  })
}

resource "aws_iam_instance_profile" "app" {
  name = "ontodata-ec2"
  role = aws_iam_role.app.name
}

# ---------- EC2 instance ----------

data "aws_ssm_parameter" "ubuntu" {
  name = "/aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id"
}

resource "aws_instance" "app" {
  ami                    = nonsensitive(data.aws_ssm_parameter.ubuntu.value)
  instance_type          = var.instance_type
  subnet_id              = data.aws_subnet.app.id
  vpc_security_group_ids = [aws_security_group.app.id]
  iam_instance_profile   = aws_iam_instance_profile.app.name

  associate_public_ip_address = true

  # Hop limit 2 lets the containers reach the instance role.
  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 2
  }

  root_block_device {
    volume_size = 30
    volume_type = "gp3"
  }

  user_data = <<-EOF
    #!/bin/bash
    set -eux
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -y
    apt-get install -y unzip curl
    curl -fsSL https://get.docker.com | sh
    usermod -aG docker ubuntu
    snap install aws-cli --classic
  EOF

  tags = { Name = "ontodata-app" }

  # A newer Ubuntu image shouldn't replace a running test instance.
  lifecycle {
    ignore_changes = [ami]
  }
}

# ---------- Deploy: runs on the instance whenever the bundle or an endpoint changes ----------

resource "aws_ssm_association" "deploy" {
  name             = "AWS-RunShellScript"
  association_name = "ontodata-deploy"

  targets {
    key    = "InstanceIds"
    values = [aws_instance.app.id]
  }

  parameters = {
    executionTimeout = "3600"
    commands = templatefile("${path.module}/deploy.sh.tftpl", {
      bundle_md5        = data.archive_file.bundle.output_md5
      bucket            = aws_s3_bucket.deploy.id
      key               = aws_s3_object.bundle.key
      region            = var.region
      redshift_host     = aws_redshiftserverless_workgroup.main.endpoint[0].address
      redshift_admin    = aws_redshiftserverless_namespace.main.admin_username
      redshift_admin_pw = random_password.redshift_admin.result
      redshift_app_pw   = random_password.redshift_app.result
      rds_host          = local.use_pgvector ? aws_db_instance.pgvector[0].address : ""
      rds_pw            = random_password.rds.result
      vector_bucket     = local.use_s3vectors ? aws_s3vectors_vector_bucket.main[0].vector_bucket_name : ""
      neptune_host      = var.enable_neptune ? aws_neptune_cluster.main[0].endpoint : ""
    })
  }

  wait_for_success_timeout_seconds = 2400

  depends_on = [aws_iam_role_policy.app, aws_iam_role_policy_attachment.ssm]
}
