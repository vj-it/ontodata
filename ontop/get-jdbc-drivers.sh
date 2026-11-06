#!/usr/bin/env sh
# Downloads the JDBC drivers Ontop needs into ./ontop/jdbc:
# Amazon Redshift (production) and PostgreSQL (local testing).
set -e
REDSHIFT_VERSION="${REDSHIFT_JDBC_VERSION:-2.1.0.30}"
POSTGRES_VERSION="${POSTGRES_JDBC_VERSION:-42.7.4}"
DIR="$(dirname "$0")/jdbc"
mkdir -p "$DIR"
curl -fL -o "$DIR/redshift-jdbc42-$REDSHIFT_VERSION.jar" \
  "https://repo1.maven.org/maven2/com/amazon/redshift/redshift-jdbc42/$REDSHIFT_VERSION/redshift-jdbc42-$REDSHIFT_VERSION.jar"
curl -fL -o "$DIR/postgresql-$POSTGRES_VERSION.jar" \
  "https://repo1.maven.org/maven2/org/postgresql/postgresql/$POSTGRES_VERSION/postgresql-$POSTGRES_VERSION.jar"
ls -1 "$DIR"
