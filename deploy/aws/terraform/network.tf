# Everything goes in the region's default VPC. use1-az3 is skipped because several services don't support it.
data "aws_vpc" "default" {
  default = true
}

data "aws_availability_zones" "usable" {
  state            = "available"
  exclude_zone_ids = ["use1-az3"]
}

data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
  filter {
    name   = "default-for-az"
    values = ["true"]
  }
  filter {
    name   = "availability-zone"
    values = data.aws_availability_zones.usable.names
  }
}

data "aws_subnet" "app" {
  vpc_id            = data.aws_vpc.default.id
  default_for_az    = true
  availability_zone = sort(data.aws_availability_zones.usable.names)[0]
}

data "http" "my_ip" {
  url = "https://checkip.amazonaws.com"
}

locals {
  allowed_cidr = var.allowed_cidr != "" ? var.allowed_cidr : "${chomp(data.http.my_ip.response_body)}/32"
}

resource "aws_security_group" "app" {
  name        = "ontodata-ec2"
  description = "Ontodata app server"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    description = "Ontodata UI from your IP"
    from_port   = 4000
    to_port     = 4000
    protocol    = "tcp"
    cidr_blocks = [local.allowed_cidr]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group" "services" {
  name        = "ontodata-services"
  description = "Data services for Ontodata"
  vpc_id      = data.aws_vpc.default.id

  dynamic "ingress" {
    for_each = { redshift = 5439, rds = 5432, neptune = 8182 }
    content {
      description     = "${ingress.key} from the app server"
      from_port       = ingress.value
      to_port         = ingress.value
      protocol        = "tcp"
      security_groups = [aws_security_group.app.id]
    }
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}
