# User guide

The app has five screens, numbered in the order you set things up.

| # | Screen | What it does |
|---|---|---|
| 1 | **LLM** | Provider (Anthropic API, Amazon Bedrock, OpenAI), model, effort, and the embedding model used for the vector store. |
| 2 | **Data sources** | Tabs for **Database**, **Vector store**, **Graph** and **Ontop**, each with a test button. |
| 3 | **Catalog** | Choose tables and describe them in business terms. |
| 4 | **Knowledge graph** | Generate, review, edit and deploy the ontology and mapping. |
| 5 | **Ask** | Ask questions and see the answer, the SPARQL and the SQL. |

## 1 · LLM

- **Provider and model.** For Anthropic and OpenAI, enter the key, then click **Load models** to pick from what your key can use. For Bedrock, type the model ID, e.g. `anthropic.claude-opus-5-5`.
- **Effort.** Controls how hard the model thinks when writing SPARQL. `medium` is a good default; raise it for complex questions. The insights step always uses at least `high`.
- **Embeddings.** Only used if you turn on a vector store. Changing the embedding model or dimension needs a new vector index name.
- **Save & test** sends a one-word request to check the connection.

Details: [Configuration → LLM providers](configuration.md#llm-providers).

## 2 · Data sources

| Tab | What to set |
|---|---|
| **Database** | Engine (Amazon Redshift or PostgreSQL), host, port, database, user, password, SSL. Switching engine also switches the default port (5439 or 5432). |
| **Vector store** | Optional. Provider (pgvector or S3 Vectors), its connection, index name and Top K. **Index catalog descriptions** embeds the catalog. **Use for questions** turns retrieval on. |
| **Graph** | Optional. Neo4j or Amazon Neptune. **Publish ontology** writes the current catalog's ontology there. |
| **Ontop** | The SPARQL endpoint URL and the namespaces used for ontology terms and instance IRIs. |

Saved passwords and keys show as `********`. Leaving the field as is keeps the saved value.

## 3 · Catalog

1. Pick a **database**. The list on the left shows its tables and views.
2. Tick tables and click **Add to catalog**. Declared primary keys and foreign keys are read automatically.
3. For each table (tabs along the top):
   - **Ontology class**: the business name, e.g. `Order`.
   - **Table description**: what one row represents.
   - **Columns**: tick **Use** to include a column, **Key** for primary key columns, and set a property name and description. **Every table needs at least one key column.**
   - **Relationships**: link to other catalog tables (from column → target table and column). Each one becomes a relationship like `hasCustomer`.
4. Click **Save**.

Buttons:
- **Suggest with AI** reads 10 sample rows and drafts the class name, descriptions and property names. It only fills empty fields, so your own text is never overwritten. Review the result, then **Save**.
- **Preview data** shows sample rows.
- **Remove** takes the table out of the catalog.

**Tip:** descriptions are what the model reads. Mention units ("in USD"), code values ("DELIVERED, SHIPPED, RETURNED") and formulas ("line revenue = quantity × price × (1 − discount %)"). These details make the biggest difference to answer quality.

## 4 · Knowledge graph

- **Generate from catalog** builds `ontology.ttl` and `mapping.obda`, and lists warnings, for example a table without keys.
- **Graph** shows the classes and their relationships. Tick **show data properties** to also see each class's properties.
- The **Ontology (.ttl)** and **Mapping (.obda)** tabs are editable. **Save edits** keeps your changes, but regenerating overwrites them.
- **Deploy to Ontop** writes the files for Ontop. The status line shows whether Ontop is running.
- **restart Ontop** also restarts the Ontop container. Only a database connection change needs this; see [Configuration](configuration.md#restarting-ontop).

## 5 · Ask

- Type a question and click **Ask**, or press Ctrl+Enter.
- The pipeline steps light up as they finish: NL → SPARQL, SPARQL → SQL, Run, Insights.
- **Insights** show a summary, key findings, a chart (when one makes sense) and follow-up questions you can click.
- The **Results**, **SPARQL** and **SQL** tabs show the rows, the query the model wrote, and the SQL Ontop ran.
- **Draft SPARQL only** writes the query without running it. You can edit it in the SPARQL tab, then click **Run SPARQL**.
- **History** keeps the last 50 questions. Click one to reopen it.

When something fails, the reason is shown under the pipeline. If the SPARQL was rejected, the last attempt is in the SPARQL tab so you can fix it by hand.

---

**Related:** [Getting started](getting-started.md) · [How it works](how-it-works.md) · [Troubleshooting](troubleshooting.md)
