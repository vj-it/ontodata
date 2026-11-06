import fs from "node:fs";
import path from "node:path";
import type { AppState } from "./types.js";

// Local JSON store. Phase 1 keeps secrets here for simplicity; move them to
// AWS Secrets Manager before running this anywhere shared.
const DATA_DIR = path.resolve(process.env.DATA_DIR ?? "./data");
const STATE_FILE = path.join(DATA_DIR, "state.json");

// Set by the Docker Compose setups (pgvector or S3 Vectors). When set, they win over saved settings on every start.
const vectorEnv: Partial<AppState["vectorStore"]> = Object.fromEntries(
  Object.entries({
    provider: process.env.VECTOR_STORE_PROVIDER,
    indexName: process.env.VECTOR_INDEX_NAME,
    bucket: process.env.S3VECTORS_BUCKET,
    region: process.env.S3VECTORS_REGION,
  }).filter(([, v]) => v),
);

const defaults: AppState = {
  llm: {
    provider: "anthropic",
    model: "claude-opus-5-5",
    effort: "medium",
    region: "us-east-1",
    embeddingProvider: "bedrock",
    embeddingModel: "amazon.titan-embed-text-v2:0",
    embeddingDimension: 1024,
  },
  redshift: { engine: "redshift", host: "", port: 5439, database: "dev", user: "", password: "", ssl: true },
  graph: {
    provider: "neo4j",
    endpoint: "",
    port: 8182,
    region: "us-east-1",
    iamAuth: true,
    namedGraph: "urn:ontodata:ontology",
    neo4jUri: process.env.NEO4J_URI ?? "bolt://localhost:7687",
    neo4jUser: "neo4j",
    password: "",
    neo4jDatabase: "neo4j",
  },
  vectorStore: {
    enabled: false,
    provider: "pgvector",
    indexName: "ontodata_schema",
    topK: 8,
    region: "us-east-1",
    bucket: "",
    pgHost: process.env.PGVECTOR_HOST ?? "localhost",
    pgPort: Number(process.env.PGVECTOR_PORT ?? 5433),
    pgDatabase: "vectors",
    pgUser: "ontodata",
    pgSsl: false,
    password: process.env.PGVECTOR_PASSWORD ?? "",
    ...vectorEnv,
  },
  ontop: {
    endpointUrl: process.env.ONTOP_URL ?? "http://localhost:8080",
    baseIri: "http://ontodata.local/ontology#",
    dataIri: "http://ontodata.local/data/",
  },
  catalog: { database: "", tables: [] },
  vkg: null,
  history: [],
};

let state: AppState = load();

function load(): AppState {
  if (!fs.existsSync(STATE_FILE)) return structuredClone(defaults);
  const { s3vectors: legacyS3, neptune: legacyNeptune, ...saved } = JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) as Partial<AppState> & {
    s3vectors?: { enabled: boolean; region: string; bucket: string; indexName: string; topK: number };
    neptune?: { enabled: boolean; endpoint: string; port: number; region: string; iamAuth: boolean; namedGraph: string };
  };
  // Older state files had separate "s3vectors" and "neptune" sections; carry them into vectorStore and graph.
  const migrated = !saved.vectorStore && legacyS3?.bucket ? { ...legacyS3, provider: "s3vectors" as const } : {};
  const migratedGraph = !saved.graph && legacyNeptune?.endpoint ? { ...legacyNeptune, provider: "neptune" as const } : {};
  // FAISS was removed: a saved FAISS setup falls back to pgvector, with retrieval off until it's indexed again.
  const { faissUrl: _faissUrl, ...savedVectors } = (saved.vectorStore ?? {}) as Partial<AppState["vectorStore"]> & { faissUrl?: string };
  if ((savedVectors.provider as string) === "faiss") Object.assign(savedVectors, { provider: "pgvector", enabled: false });
  return {
    ...structuredClone(defaults),
    ...saved,
    llm: { ...defaults.llm, ...saved.llm },
    redshift: { ...defaults.redshift, ...saved.redshift },
    graph: { ...defaults.graph, ...migratedGraph, ...saved.graph },
    vectorStore: { ...defaults.vectorStore, ...migrated, ...savedVectors, ...vectorEnv },
    ontop: { ...defaults.ontop, ...saved.ontop },
  };
}

export function getState(): AppState {
  return state;
}

export function update(mutator: (s: AppState) => void): AppState {
  mutator(state);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  return state;
}

const SECRET_KEYS = new Set(["apiKey", "openaiApiKey", "password"]);
export const MASK = "********";

/** Copy of a config section with secrets masked, for sending to the UI. */
export function masked<T extends object>(obj: T): T {
  const out = { ...obj } as Record<string, unknown>;
  for (const k of Object.keys(out)) if (SECRET_KEYS.has(k) && out[k]) out[k] = MASK;
  return out as T;
}

/** Merge an update from the UI, keeping existing secrets when the UI sends the mask back. */
export function mergeSecrets<T extends object>(current: T, incoming: Partial<T>): T {
  const out: Record<string, unknown> = { ...current, ...incoming };
  for (const k of Object.keys(incoming)) {
    if (SECRET_KEYS.has(k) && (incoming as Record<string, unknown>)[k] === MASK) {
      out[k] = (current as Record<string, unknown>)[k];
    }
  }
  return out as T;
}
