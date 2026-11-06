# AWS test plan

Ontodata isn't tied to AWS. Everything has been verified locally with PostgreSQL, pgvector and Neo4j. This page covers the AWS services that haven't been tested yet. Test one service at a time, in this order, so a failure points at a single thing.

| # | Service | What it replaces locally | Required? |
|---|---|---|---|
| 1 | [Amazon Redshift](#1-amazon-redshift) | PostgreSQL | Yes, it's the main test |
| 2 | [Amazon Bedrock](#2-amazon-bedrock) | Anthropic or OpenAI API | Only if you'll use Bedrock |
| 3 | [pgvector on RDS](#3-pgvector-on-rds) | Local pgvector container | Optional |
| 4 | [S3 Vectors](#4-s3-vectors) | pgvector | Optional |
| 5 | [Neptune](#5-neptune) | Neo4j | Optional |

## Where to run it

Run the app and Ontop as containers on an EC2 instance in the same VPC as the services. [Deploy on EC2](deploy-ec2.md) covers the network, the AWS resources, the IAM role and the Docker setup step by step.

**AWS credentials.** Bedrock, S3 Vectors and Neptune IAM auth use the instance role, through the AWS default credential chain. The containers can only reach it with an IMDS hop limit of 2. Redshift and RDS use a database user and password, because IAM auth isn't built yet.

**IAM permissions for the instance role**, per service you test:

| Service | Actions |
|---|---|
| Bedrock | `bedrock:InvokeModel` on the Claude model and on `amazon.titan-embed-text-v2:0` |
| S3 Vectors | `s3vectors:GetIndex`, `CreateIndex`, `PutVectors`, `QueryVectors`, `GetVectors` on the vector bucket and its indexes |
| Neptune (IAM auth on) | `neptune-db:connect`, `ReadDataViaQuery`, `WriteDataViaQuery`, `DeleteDataViaQuery` |

[`deploy/aws/iam-policy.json`](../deploy/aws/iam-policy.json) has the S3 Vectors and Neptune permissions ready to fill in.

## 1. Amazon Redshift

**Setup:** on the Database tab, set the engine to Amazon Redshift, enter the endpoint, port 5439, database, a read-only user and password, and turn SSL on. Click **Save & test**.

| Step | Check | Pass |
|---|---|---|
| Connection | **Save & test** | Shows the server version |
| Metadata | Screen 3: pick a database, load the table list | Schemas and tables appear, including Spectrum or datashare tables if you have them |
| Keys | Add 3–5 related tables | Primary keys and relationships are filled in (see the note below) |
| Descriptions | **Suggest with AI** on one table | The preview reads sample rows, and the suggestions make sense |
| Deploy | Screen 4: **Generate**, then **Deploy to Ontop**, then `docker restart ontodata-ontop` | Screen 4 shows "Ontop is running", and `docker logs ontodata-ontop` shows no JDBC errors |
| Question | Screen 5: one count, one join, one ranking question | The SQL tab shows Redshift SQL, and the rows match the same SQL run in the Redshift query editor |
| Eval | Write 10–30 questions with known answers for your schema, in the style of `scripts/eval-retail.mjs` | ≥ 85% correct, which is the Phase 1 goal |

**Keys are the most likely problem.** Redshift doesn't enforce primary and foreign keys, and many warehouses don't declare them. Tables without a key are left out of the mapping, and tables without declared relationships can't be joined. If they're missing:
- Tick the key columns on screen 3, and use **+ Add relationship** for the joins.
- Or declare them in Redshift, which is informational only and has no load cost:
  ```sql
  ALTER TABLE sales.orders ADD PRIMARY KEY (order_id);
  ALTER TABLE sales.orders ADD FOREIGN KEY (customer_id) REFERENCES sales.customers (customer_id);
  ```

**Also watch for:**
- **Late-binding views and Spectrum tables:** column metadata can be incomplete, so check that their columns appear on screen 3.
- **Types:** `SUPER`, `GEOMETRY` and `VARBYTE` columns are mapped as plain strings, which Ontop may not handle. Untick them on screen 3 unless you need them.
- **Ontop's Redshift SQL:** if a question fails with a SQL error, not a SPARQL one, save the SPARQL and SQL from the Ask screen. It's an Ontop dialect issue rather than a model issue.

## 2. Amazon Bedrock

**Setup:** on screen 1, set the provider to Amazon Bedrock, choose the region, and type the model ID, because the model list isn't loaded for Bedrock. Set the embedding provider to Bedrock (Titan v2, 1024 dimensions) if you'll use a vector store.

| Check | Pass |
|---|---|
| **Save & test** | Returns a reply |
| **Suggest with AI** on screen 3, and one question on screen 5 | Both work |
| **Index** on the Vector store tab, with Bedrock embeddings | Indexes all tables (checked in steps 3 and 4) |

If it fails with an access error, request access to the model in the Bedrock console for that region, and check that the instance role has `bedrock:InvokeModel`.

## 3. pgvector on RDS

**Setup:** an RDS for PostgreSQL instance (16 or later) with `CREATE EXTENSION vector;` run once in a `vectors` database by the master user. On the Vector store tab, choose pgvector, then enter the RDS endpoint, port 5432, database `vectors`, user and password, and set **SSL → Required**.

| Check | Pass |
|---|---|
| **Save & test** | "Connected. pgvector 0.x; table … will be created on first sync" |
| **Index catalog descriptions** | Reports the number of descriptions indexed |
| A question with **Use for questions** on | The retrieve step lists sensible tables and the answer is still correct |

If the test fails with `no pg_hba.conf entry … no encryption`, SSL is off. A timeout means the RDS security group doesn't allow port 5432 from the instance.

## 4. S3 Vectors

**Setup:** create a **vector bucket** in the S3 console. The app creates the index on the first sync, but not the bucket. On the Vector store tab, choose S3 Vectors, then enter the region, bucket name and an index name.

| Check | Pass |
|---|---|
| **Save & test** | "Bucket reachable; index … will be created on first sync" |
| **Index catalog descriptions** | Reports the number of descriptions indexed |
| A question with **Use for questions** on | The retrieve step lists sensible tables and the answer is still correct |

The index dimension is fixed when it's created. If you change the embedding model, use a new index name.

## 5. Neptune

**Setup:** on the Graph tab, choose Neptune, then enter the cluster endpoint, port 8182 and the region. Turn IAM auth on if the cluster requires it. Optionally set a named graph.

| Check | Pass |
|---|---|
| **Save & test** | "Connected to Neptune. N triples in the cluster." |
| **Publish ontology** | "Ontology published to Neptune graph <…>." |
| Query in a Neptune notebook: `SELECT (COUNT(*) AS ?n) WHERE { GRAPH <your-named-graph> { ?s ?p ?o } }` | A non-zero count that stays the same when you publish again, because publishing replaces the graph |

Neptune isn't used to answer questions (see [How it works](how-it-works.md)), so this test only checks publishing.

## Reporting results

For each failure, note the step, the error shown in the UI, and the last 50 lines of `docker logs ontodata-app` or `docker logs ontodata-ontop`. For a wrong answer, save the question, the SPARQL, the SQL and the expected result. Update the checklist in the [Roadmap](roadmap.md) as each service passes.

---

**Related:** [Deployment](deployment.md) · [Configuration](configuration.md) · [Troubleshooting](troubleshooting.md)
