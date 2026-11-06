# Troubleshooting

## Common problems

### Ontop keeps restarting, or screen 4 says "Ontop not reachable"

Ontop needs the three generated files before it can start. Deploy once from screen 4 (**Generate**, then **Deploy to Ontop**), then restart it:

```bash
docker restart ontodata-ontop
```

If it still doesn't start, check its log:

```bash
docker logs --tail 50 ontodata-ontop
```

Common causes are a missing JDBC driver (run `sh ontop/get-jdbc-drivers.sh`) and a database host Ontop can't reach (see the next item).

### Ontop can't connect to the database after I changed the connection

Ontop reads the connection only when it starts. Run `docker restart ontodata-ontop` after changing the Database tab and deploying. Also check that the host makes sense from inside Docker:

| App runs | Database on the same machine | Use as host |
|---|---|---|
| In Docker (Option A) | Compose `postgres` service | `postgres` |
| On the host (Option B) | Compose `postgres` service | `localhost` (rewritten to `host.docker.internal` for Ontop) |
| Either | Redshift | The Redshift endpoint |

### A question returns 0 rows

- Open the **SPARQL** tab. A property that doesn't exist in the ontology, such as `:country` on Store, usually means the model was missing context.
- If a vector store is on, the retrieve step lists the tables it picked. If a needed table is missing, raise **Top K** or turn retrieval off for small schemas.
- Improve the descriptions on screen 3. Code values and formulas help most.
- Fix the SPARQL by hand and click **Run SPARQL**.

### Ontop rejects a query

Ontop translates most SPARQL 1.1 to SQL, but not all of it. The app already handles the cases found in testing:

| Pattern | Problem | Handled by |
|---|---|---|
| Casting a literal, e.g. `xsd:decimal(100)` | SQL serializer error | Automatic rewrite to `100.0` |
| Ordering by a calculation that combines aggregates, e.g. `((SUM(?a) - SUM(?b)) / SUM(?a) * 100)` | `Only DBFunctionSymbols must be provided to a SQLTermSerializer` | Prompt rule: wrap it in `xsd:decimal(...)` |
| Subqueries with calculations in the outer query | Same serializer error | Prompt rule: keep queries flat |

Anything else gets up to 2 repair attempts, and the model sees each error. If all attempts fail, the last query is kept in the SPARQL tab.

### "Restart failed: this server can't control Docker"

The app container doesn't control Docker by default. Ontop still reloads the ontology and mapping. Restart it yourself only after a database connection change. See [Restarting Ontop](configuration.md#restarting-ontop).

### Port 4000 is already in use

The Docker app (Option A) and `npm start` (Option B) both use port 4000. Stop one of them, for example:

```bash
docker stop ontodata-app
```

### "Insights failed" but rows are shown

The query worked and only the summary step failed, usually because of an LLM key, quota or timeout problem. Check **Save & test** on screen 1.

### Vector store: "stores N-dimension vectors but the embedding model produces M"

The embedding model changed after the index was created. Use a new index name on the Vector store tab and index again.

## Limits and known issues

- **Every table needs key columns.** Tables without them are left out of the mapping, and screen 4 warns about it.
- **No authentication or multi-user support yet.** Settings are global to the server.
- **Result limits.** The UI shows at most 1,000 rows, and 100 rows are sent to the LLM for insights.
- **Small schemas don't need a vector store.** With fewer than about 20 tables, the full ontology fits in the prompt and retrieval adds little.
- **Editing the ontology or mapping by hand:** **Regenerate from catalog** overwrites your edits.
- **Untested against real AWS:** Redshift itself, Bedrock, S3 Vectors and Neptune. See the [AWS test plan](aws-testing.md). Everything else has been verified locally against PostgreSQL, pgvector and Neo4j.

---

**Related:** [Configuration](configuration.md) · [How it works](how-it-works.md)
