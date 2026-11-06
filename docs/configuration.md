# Configuration

Most settings are made in the app on screens 1 and 2 and saved by the API. Environment variables only set initial defaults and keys.

## LLM providers

| Provider | Credentials | Notes |
|---|---|---|
| Anthropic API | Key on screen 1, or `ANTHROPIC_API_KEY` | Default model `claude-opus-5-5`. Uses server-side refusal fallback. |
| Amazon Bedrock | AWS credential chain | Model IDs take an `anthropic.` prefix. |
| OpenAI | Key on screen 1, or `OPENAI_API_KEY` | **Load models** lists what your key can use. Base URL can point to Azure OpenAI or another compatible endpoint. Effort is sent as `reasoning_effort` and dropped for models that don't support it. |

Embeddings, used only by the vector store, come from Bedrock (`amazon.titan-embed-text-v2:0`, 1024 dimensions) or OpenAI (`text-embedding-3-small`, 1536 dimensions).

## Database

| Engine | Use | Notes |
|---|---|---|
| Amazon Redshift | Cluster or Serverless | Default port 5439. Metadata comes from `svv_tables` and `svv_columns`, which include Spectrum and datashare tables. Ontop uses the Redshift JDBC driver. |
| PostgreSQL | Any PostgreSQL, including the local sample, RDS and Aurora | Default port 5432. Metadata comes from `information_schema`, with comments read as descriptions. Ontop uses the PostgreSQL JDBC driver. |

Use a read-only database user. Ontodata only reads metadata, sample rows, and the results of the SQL that Ontop generates.

## Local services

All of these are in `docker-compose.yml`. The app container reaches them by container name, and an app running on the host reaches them on `localhost`.

| Service | Compose profile | From the app container | From the host | Credentials |
|---|---|---|---|---|
| Ontodata app | `app` | – | http://localhost:4000 | – |
| Ontop | always | http://ontop:8080 | http://localhost:8080 | – |
| PostgreSQL sample warehouse | `local` | `postgres:5432` | `localhost:5432` | database `retail`, user and password `ontodata` |
| pgvector | `vectors` | `pgvector:5432` | `localhost:5433` | database `vectors`, user and password `ontodata` |
| Neo4j | `graph` | `bolt://neo4j:7687` | `bolt://localhost:7687`, browser UI at http://localhost:7474 | user `neo4j`, password `ontodata-local` |

The app container's defaults (`ONTOP_URL`, `NEO4J_URI`, `PGVECTOR_HOST`/`PGVECTOR_PORT`) already point at the container names. When the app runs on the host, a database on `localhost` is written to Ontop's config as `host.docker.internal` automatically.

### Restarting Ontop

Ontop reloads the ontology and mapping by itself. After a database connection change, restart it:

```bash
docker restart ontodata-ontop
```

When the app runs on the host, the **restart Ontop** checkbox on screen 4 does this for you. The app container can do it only if you opt in to mounting the Docker socket (commented out in `docker-compose.yml`). That's off by default because it gives the app control of Docker on the host.

## Vector store

Optional. It helps when a schema is too large to send in full with every question (roughly 20 or more tables).

| Provider | Setup | Index |
|---|---|---|
| pgvector | `npm run vectors:up`, or any PostgreSQL with the `vector` extension, including RDS and Aurora (set **SSL → Required**) | A table named after the index name, created on first index and sized to the embedding model. Cosine distance. |
| Amazon S3 Vectors | A vector bucket in your account | Created on first index. Cosine distance. |

To use one, pick a provider on the Vector store tab, click **Index catalog descriptions**, then set **Use for questions** to Yes. Re-index after editing the catalog. Each table and each included column becomes one document.

## Graph store

Optional. It publishes the ontology so it can be browsed and reused. Instance data is not copied.

| Provider | What gets written |
|---|---|
| Neo4j | Classes become `:Class` nodes, columns become `:Property` nodes linked by `HAS_PROPERTY`, and relationships become `RELATION` edges between classes. Every node is labelled `OntodataOntology`, and republishing replaces only those nodes. To browse them, run `MATCH (n:OntodataOntology) RETURN n`. |
| Amazon Neptune | The generated `ontology.ttl`, written to a named graph over SPARQL with SigV4 signing when IAM auth is on. Republishing replaces the graph. |

## Credentials and secrets

- **AWS** (Bedrock, S3 Vectors, Neptune IAM auth): the standard credential chain, i.e. `AWS_PROFILE`, environment variables, SSO or an instance/task role.
- Settings, including passwords and API keys, are stored in `state.json` (`backend/data/` on the host, the `appdata` volume in Docker). The warehouse password is also written to `ontop/input/redshift.properties`. Both are git-ignored.
- The UI never receives secrets back; they show as `********`.
- Before running anywhere shared, pass keys as environment variables or move them to AWS Secrets Manager. See [Deployment](deployment.md).

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `4000` | API and UI port |
| `DATA_DIR` | `./data` (`/data` in the image) | Where `state.json` lives |
| `UI_DIR` | `../frontend/dist` | Built UI served as static files |
| `ONTOP_URL` | `http://localhost:8080` | Initial Ontop endpoint |
| `ONTOP_INPUT_DIR` | `../ontop/input` (`/ontop-input` in the image) | Where **Deploy** writes the Ontop files |
| `ONTOP_CONTAINER` | `ontodata-ontop` | Container restarted by **Deploy** |
| `NEO4J_URI` | `bolt://localhost:7687` | Initial Neo4j URI |
| `PGVECTOR_HOST`, `PGVECTOR_PORT`, `PGVECTOR_PASSWORD` | `localhost`, `5433`, empty | Initial pgvector connection |
| `VECTOR_STORE_PROVIDER`, `VECTOR_INDEX_NAME` | not set | `pgvector` or `s3vectors`, and the index name. When set, they replace the saved settings on every start; the Docker setups set them. |
| `S3VECTORS_BUCKET`, `S3VECTORS_REGION` | not set | S3 Vectors bucket and region, also applied on every start when set |
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` | – | Used when no key is set on screen 1 |

"Initial" means the value is used until you change the setting in the app. After that, the saved setting wins.

---

**Related:** [Getting started](getting-started.md) · [Deployment](deployment.md)
