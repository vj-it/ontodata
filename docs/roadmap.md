# Roadmap

Each phase lists what it adds and what "done" means. Phase 1 is in progress, and the rest are planned.

## Phase 1: NL → SPARQL → SQL → insights *(in progress)*

**Done**
- Five screens: LLM, Data sources, Catalog, Knowledge graph, Ask.
- LLM providers: Anthropic, Bedrock, OpenAI.
- Ontology and mapping generated from keys, foreign keys and descriptions, with AI-drafted descriptions.
- Ontop deployment, SPARQL validation with up to 2 repairs, automatic SPARQL fixes, insights with a chart and history.
- Vector stores (pgvector, S3 Vectors) with join-path expansion. Graph stores (Neo4j, Neptune).
- Container image and a Docker Compose stack.
- 6-question eval (`npm run eval`): 6/6 on the sample data.

**Left to close Phase 1**
1. Run against a real Redshift cluster or Serverless workgroup: Ontop's Redshift driver, `svv_*` metadata, Spectrum and late-binding views. Follow the [AWS test plan](aws-testing.md).
2. Test Bedrock, S3 Vectors and Neptune against real AWS resources.
3. Move secrets to Secrets Manager and use Redshift IAM auth.
4. Unit tests (mapping generator, pipeline with mocked LLM and Ontop) and CI.
5. Grow the eval to about 30 questions on a real schema.

**Done when:** the eval passes at ≥ 85% on a real Redshift schema, and no secrets are on disk.

## Phase 2: ontology quality and business semantics

The goal is an ontology that reads like the business, not like the tables.

- **AI ontology design:** the model proposes class hierarchies (e.g. `EnterpriseCustomer ⊑ Customer`), synonyms and better names. You accept or reject each one.
- **Business glossary:** synonyms ("client" = Customer), units, code lists, exported as `skos:altLabel` and definitions.
- **Named metrics:** define "Revenue" or "Gross margin %" once, and every question uses the same formula.
- **Validation:** check the mapping against the live database, detect key mismatches, add SHACL constraints.
- **Versioning:** draft → review → publish, with diffs and rollback.
- **Standard vocabularies:** optionally align with schema.org, FIBO or industry models.

**Done when:** a business user can review the ontology without SQL knowledge, and named metrics give identical numbers across differently worded questions.

## Phase 3: accuracy, conversation and guardrails

The goal is answers people can trust and use repeatedly.

- **Verified example library:** approved question → SPARQL pairs stored in the vector store and pulled into the prompt as examples.
- **Conversation:** follow-up questions that keep context ("now only Canada", "compare with 2024").
- **Clarifying questions:** ask instead of guessing when a question is ambiguous ("revenue": gross or net?).
- **Guardrails:** row and time limits, cost checks before running, Redshift workload management queues.
- **Explainability:** show which classes, properties and metric formulas were used.
- **Caching and feedback:** cache identical queries, add thumbs up/down, and promote good answers to the example library.

**Done when:** the eval is at ≥ 95%, wrong answers are caught by clarifying questions or guardrails, and median latency is under 10 seconds.

## Phase 4: knowledge graph enrichment

The goal is to combine warehouse data with graph and document knowledge.

- **Hybrid graph:** keep facts virtual through Ontop, and materialize slow-changing parts (customer hierarchy, product taxonomy) into Neo4j or Neptune.
- **Graph analytics:** paths, communities and influence, e.g. referral networks and supplier dependencies.
- **Document linking (GraphRAG):** pull entities from documents (contracts, tickets, reviews), link them to ontology instances, and index them in the vector store.
- **Federated questions:** one question spanning the warehouse, the graph and documents.

**Done when:** a question like "Which enterprise customers with open support complaints had revenue drop this quarter?" is answered from all three.

## Phase 5: production and enterprise rollout

- **AWS deployment:** see the target design in [Deployment](deployment.md#option-2-aws-target-architecture), as infrastructure-as-code (CDK or Terraform).
- **Identity:** SSO, roles (admin, modeler, analyst, viewer), row- and column-level security passed through to Redshift.
- **Multi-tenancy:** several databases or ontologies per team.
- **Operations:** metrics and tracing for each pipeline step, an audit log of every question and its SQL, CI/CD and backups.
- **Access channels:** saved answers and dashboards, scheduled reports, a Slack or Teams bot, and an API/MCP server so other agents can query the semantic layer.

**Done when:** the security review passes, a pilot team uses it daily, and every answer can be traced back to its SQL.

## Order

Close Phase 1 first, especially the real Redshift run and a larger eval, because every later phase is measured against the eval. Phases 2 and 3 can overlap. Phase 4 should wait until the semantic layer is trusted. Phase 5 can start alongside Phase 3 if a pilot team is waiting.
