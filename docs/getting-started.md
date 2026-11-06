# Getting started

Runs everything locally against a sample PostgreSQL warehouse, so no cloud account is needed. To test on AWS, see the [AWS test plan](aws-testing.md).

**You need:**
- **Docker Desktop**
- an **LLM API key** (Anthropic or OpenAI), or AWS credentials for Bedrock
- `sh` and `curl` to fetch the JDBC drivers (Git Bash on Windows works)

There are two ways to run it:

| | Option A: Docker | Option B: Node on the host |
|---|---|---|
| Best for | Trying it out, demos, a team pilot | Developing Ontodata itself |
| App runs in | A container | Node 20+ on your machine |
| Hot reload | No | Yes (`dev:api` + `dev:ui`) |

---

## Option A: Docker (recommended)

The whole stack runs in containers: the app, Ontop, and sample PostgreSQL with the data loaded automatically. Pick the vector store with the start command:

| Setup | Vector store | Start command | Needs |
|---|---|---|---|
| **pgvector** | pgvector container on this machine | `npm run stack:pgvector` | Nothing else |
| **S3 Vectors** | Amazon S3 Vectors in your AWS account | `npm run stack:s3vectors` | An S3 vector bucket and an AWS profile (see [S3 Vectors setup](#s3-vectors-setup)) |

The vector store is optional, and both setups work the same way without it. Each setup sets the vector store on the Vector store tab every time it starts, so switching is just stopping one and starting the other.

**1. Fetch the JDBC drivers Ontop needs**

```bash
sh ontop/get-jdbc-drivers.sh
```

**2. Build and start** with one of the two setups.

pgvector:

```bash
docker compose --profile app --profile local --profile vectors up -d --build
```

S3 Vectors, after the [S3 Vectors setup](#s3-vectors-setup):

```bash
docker compose -f docker-compose.yml -f docker-compose.s3vectors.yml --profile app --profile local up -d --build
```

With Node installed, `npm run stack:pgvector` and `npm run stack:s3vectors` run the same commands. Add `--profile graph` to either one to start Neo4j too.

Open http://localhost:4000. The first build takes a few minutes. Ontop keeps restarting until the first deploy in step 3 creates its files; that's expected.

**3. Work through the screens.** Inside Docker, services reach each other by container name, so the database host is `postgres`.

| Screen | Do this |
|---|---|
| 1 · LLM | Pick a provider, paste the key, click **Load models**, choose one, **Save & test**. |
| 2 · Data sources → Database | Engine **PostgreSQL**, host `postgres`, port `5432`, database `retail`, user and password `ontodata`, SSL **Off**. **Save & test**. |
| 3 · Catalog | Database `retail`, tick all `sales.*` tables, **Add to catalog**. Keys and relationships are detected from the database. Add descriptions, or use **Suggest with AI**. **Save** each table. |
| 4 · Knowledge graph | **Generate from catalog**, then **Deploy to Ontop**. |

See the [User guide](user-guide.md) for what each screen does in detail.

**4. Restart Ontop once** so it picks up the new database connection. Later deploys that only change the ontology or mapping reload automatically.

```bash
docker restart ontodata-ontop
```

**5. Optional: turn on the vector store.** On screen 2 → **Vector store**, click **Save & test**, then **Index catalog descriptions**, set **Use for questions** to **Yes** and save. The connection is already filled in by the setup you started.

**6. Ask a question** on screen 5, for example *"Which product category has the highest gross margin percentage on delivered orders?"*

**7. Optional: check answer quality.** This needs Node 20+ on the host and runs 6 questions with known answers through the full pipeline.

```bash
npm run eval
```

**To stop everything** (data is kept in Docker volumes), for either setup:

```bash
docker compose --profile app --profile local --profile vectors --profile graph down
```

With Node installed, `npm run stack:down` does the same.

### S3 Vectors setup

The S3 Vectors setup runs everything locally except the vector store, which is in your AWS account. Do this once:

1. **Create a vector bucket:** in the S3 console in us-east-1, open **Vector buckets → Create vector bucket**, and name it starting with `ontodata-`, for example `ontodata-vectors-<your account id>`. Don't create an index; the app creates it on the first index. If you've run the [Terraform setup](deploy-terraform.md) with `vector_store = "s3vectors"`, use the bucket it created.
2. **AWS credentials:** the app reads the `ontodata` profile from `C:\Users\<you>\.aws` (`~/.aws` on macOS and Linux), mounted read-only into the container. The `ontodata-deployer` user from the [Terraform setup](deploy-terraform.md#one-time-setup) can already use buckets named `ontodata-*`. Another profile needs `s3vectors:GetIndex`, `CreateIndex`, `PutVectors`, `QueryVectors` and `GetVectors` on the bucket.
3. **Create `.env`** in the project root (it's git-ignored):

   ```ini
   S3VECTORS_BUCKET=ontodata-vectors-123456789012
   # Optional, these are the defaults:
   S3VECTORS_REGION=us-east-1
   AWS_PROFILE=ontodata
   ```

Without `S3VECTORS_BUCKET`, the start command stops with "Set S3VECTORS_BUCKET in .env". Embeddings come from the provider on screen 1, so the LLM key is still the only other thing you need.

---

## Option B: Node on the host

The app runs with Node 20+, and the supporting services run in Docker.

```bash
npm run install:all
```

```bash
npm run ontop:drivers
```

```bash
npm run db:up
```

```bash
npm start
```

Open http://localhost:4000 and follow step 3 above, but use host **`localhost`** instead of `postgres` on the Database tab. After the first deploy, start Ontop:

```bash
npm run ontop:up
```

**Hot reload:** run `npm run dev:api` and `npm run dev:ui` in two terminals and open http://localhost:5173.

**Optional services:** `npm run vectors:up` starts pgvector, and `npm run graph:up` starts Neo4j. To use them, see [Configuration](configuration.md#vector-store).

Option A and Option B both use port 4000, so stop one before starting the other. For example, run `docker stop ontodata-app` before `npm start`.

---

## npm scripts

| Script | What it does |
|---|---|
| `install:all` | Installs backend and frontend dependencies |
| `ontop:drivers` | Downloads the Redshift and PostgreSQL JDBC drivers into `ontop/jdbc` |
| `start` | Builds and serves the app on port 4000 |
| `dev:api`, `dev:ui` | Development servers with hot reload (UI on port 5173) |
| `build` | Builds backend and frontend |
| `db:up` | Starts the sample PostgreSQL |
| `ontop:up` | Starts Ontop |
| `vectors:up` | Starts pgvector |
| `graph:up` | Starts Neo4j |
| `stack:pgvector` | Starts the Docker stack with pgvector |
| `stack:s3vectors` | Starts the Docker stack with S3 Vectors (needs `.env`, see [S3 Vectors setup](#s3-vectors-setup)) |
| `stack:up`, `stack:down` | Starts the whole Docker stack, pgvector and Neo4j included, or stops it |
| `eval` | Runs the 6-question answer check against http://localhost:4000 (override with `ONTODATA_URL`) |

---

**Next:** [User guide](user-guide.md) · [How it works](how-it-works.md) · [Troubleshooting](troubleshooting.md)
