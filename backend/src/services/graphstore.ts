import { SignatureV4 } from "@smithy/signature-v4";
import { HttpRequest } from "@smithy/protocol-http";
import { Sha256 } from "@aws-crypto/sha256-js";
import { defaultProvider } from "@aws-sdk/credential-provider-node";
import neo4j from "neo4j-driver";
import type { AppState, GraphConfig } from "../types.js";
import { xsdType } from "./vkg.js";

// ---------- Amazon Neptune (SPARQL) ----------

/** POST to Neptune's SPARQL endpoint, SigV4-signed when IAM auth is on. */
async function sparqlPost(cfg: GraphConfig, body: Record<string, string>, accept: string): Promise<string> {
  const encoded = new URLSearchParams(body).toString();
  const headers: Record<string, string> = {
    host: `${cfg.endpoint}:${cfg.port}`,
    "content-type": "application/x-www-form-urlencoded",
    accept,
  };
  if (cfg.iamAuth) {
    const signer = new SignatureV4({ credentials: defaultProvider(), region: cfg.region, service: "neptune-db", sha256: Sha256 });
    const signed = await signer.sign(
      new HttpRequest({ method: "POST", protocol: "https:", hostname: cfg.endpoint, port: cfg.port, path: "/sparql", headers, body: encoded }),
    );
    Object.assign(headers, signed.headers);
  }
  const res = await fetch(`https://${cfg.endpoint}:${cfg.port}/sparql`, { method: "POST", headers, body: encoded });
  const text = await res.text();
  if (!res.ok) throw new Error(`Neptune ${res.status}: ${text.slice(0, 500)}`);
  return text;
}

async function testNeptune(cfg: GraphConfig): Promise<string> {
  const out = await sparqlPost(cfg, { query: "SELECT (COUNT(*) AS ?n) WHERE { ?s ?p ?o }" }, "application/sparql-results+json");
  const n = JSON.parse(out).results.bindings[0]?.n?.value ?? "0";
  return `Connected to Neptune. ${n} triples in the cluster.`;
}

/** Publish the ontology (TBox) to a named graph, replacing what was there. */
async function publishNeptune(cfg: GraphConfig, ontologyTtl: string): Promise<string> {
  const prefixes = [...ontologyTtl.matchAll(/^@prefix\s+(\S*:)\s+<([^>]+)>\s*\.\s*$/gm)].map((m) => `PREFIX ${m[1]} <${m[2]}>`);
  const triples = ontologyTtl.replace(/^@prefix.*$/gm, "").trim();
  const update = `${prefixes.join("\n")}
DROP SILENT GRAPH <${cfg.namedGraph}> ;
INSERT DATA { GRAPH <${cfg.namedGraph}> {
${triples}
} }`;
  await sparqlPost(cfg, { update }, "application/json");
  return `Ontology published to Neptune graph <${cfg.namedGraph}>.`;
}

// ---------- Neo4j (Bolt / Cypher) ----------

// Every node Ontodata writes carries this label, so a republish replaces only our nodes.
const NEO4J_LABEL = "OntodataOntology";

async function withNeo4j<T>(cfg: GraphConfig, fn: (driver: ReturnType<typeof neo4j.driver>) => Promise<T>): Promise<T> {
  const driver = neo4j.driver(cfg.neo4jUri, neo4j.auth.basic(cfg.neo4jUser, cfg.password));
  try {
    return await fn(driver);
  } finally {
    await driver.close();
  }
}

const testNeo4j = (cfg: GraphConfig) =>
  withNeo4j(cfg, async (driver) => {
    const info = await driver.getServerInfo();
    const { records } = await driver.executeQuery(`MATCH (n:${NEO4J_LABEL}) RETURN count(n) AS n`, {}, { database: cfg.neo4jDatabase });
    return `Connected to Neo4j ${info.agent ?? ""} at ${info.address}. ${records[0].get("n")} ontology nodes published.`;
  });

/**
 * Publish the ontology as a property graph:
 * (:Class)-[:HAS_PROPERTY]->(:Property) for data properties, and (:Class)-[:RELATION {name}]->(:Class) for object properties.
 */
const publishNeo4j = (cfg: GraphConfig, state: AppState) =>
  withNeo4j(cfg, async (driver) => {
    const base = state.ontop.baseIri;
    const classes = state.catalog.tables.map((t) => ({
      iri: base + t.className,
      name: t.className,
      comment: t.description,
      table: `${t.schema}.${t.name}`,
      properties: t.columns
        .filter((c) => c.include)
        .map((c) => ({
          iri: base + c.propertyName,
          name: c.propertyName,
          range: xsdType(c.dataType),
          comment: c.description,
          column: c.name,
          key: t.primaryKey.includes(c.name),
        })),
    }));
    const relations = state.catalog.tables.flatMap((t) =>
      t.relations.flatMap((r) => {
        const to = state.catalog.tables.find((x) => x.schema === r.toSchema && x.name === r.toTable);
        return to ? [{ from: base + t.className, to: base + to.className, name: r.name, iri: base + r.name }] : [];
      }),
    );
    const db = { database: cfg.neo4jDatabase };
    await driver.executeQuery(`MATCH (n:${NEO4J_LABEL}) DETACH DELETE n`, {}, db);
    await driver.executeQuery(
      `UNWIND $classes AS c
       CREATE (cls:${NEO4J_LABEL}:Class {iri: c.iri, name: c.name, comment: c.comment, table: c.table})
       WITH cls, c
       UNWIND c.properties AS p
       CREATE (cls)-[:HAS_PROPERTY]->(:${NEO4J_LABEL}:Property {iri: p.iri, name: p.name, range: p.range, comment: p.comment, column: p.column, key: p.key})`,
      { classes },
      db,
    );
    await driver.executeQuery(
      `UNWIND $relations AS r
       MATCH (a:${NEO4J_LABEL}:Class {iri: r.from}), (b:${NEO4J_LABEL}:Class {iri: r.to})
       CREATE (a)-[:RELATION {name: r.name, iri: r.iri}]->(b)`,
      { relations },
      db,
    );
    const props = classes.reduce((n, c) => n + c.properties.length, 0);
    return `Ontology published to Neo4j: ${classes.length} classes, ${props} properties, ${relations.length} relationships.`;
  });

// ---------- public API ----------

export const testConnection = (cfg: GraphConfig) => (cfg.provider === "neo4j" ? testNeo4j(cfg) : testNeptune(cfg));

export async function publishOntology(cfg: GraphConfig, state: AppState): Promise<string> {
  if (cfg.provider === "neo4j") return publishNeo4j(cfg, state);
  if (!state.vkg) throw new Error("Generate the knowledge graph first.");
  return publishNeptune(cfg, state.vkg.ontologyTtl);
}
