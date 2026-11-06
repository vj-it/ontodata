export type LlmProvider = "anthropic" | "bedrock" | "openai";

export interface LlmConfig {
  provider: LlmProvider;
  model: string;
  apiKey?: string; // Anthropic API key
  openaiApiKey?: string;
  openaiBaseUrl?: string; // optional, for Azure OpenAI or other OpenAI-compatible endpoints
  region?: string;
  effort: "low" | "medium" | "high" | "xhigh" | "max";
  embeddingProvider: "bedrock" | "openai"; // embeddings used for S3 Vectors schema search
  embeddingModel: string;
  embeddingDimension: number;
}

export interface RedshiftConfig {
  engine: "redshift" | "postgres";
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl: boolean;
}

export type GraphProvider = "neptune" | "neo4j";

/** Graph database that receives the published ontology (instance data stays virtual behind Ontop). */
export interface GraphConfig {
  provider: GraphProvider;
  // Amazon Neptune (SPARQL)
  endpoint: string; // e.g. my-cluster.cluster-xxxx.us-east-1.neptune.amazonaws.com
  port: number;
  region: string;
  iamAuth: boolean;
  namedGraph: string;
  // Neo4j (Bolt)
  neo4jUri: string;
  neo4jUser: string;
  password: string;
  neo4jDatabase: string;
}

export type VectorProvider = "s3vectors" | "pgvector";

/** Where table/column description embeddings live, for picking the relevant schema per question. */
export interface VectorStoreConfig {
  enabled: boolean;
  provider: VectorProvider;
  indexName: string; // S3 Vectors index or pgvector table name
  topK: number;
  // S3 Vectors
  region: string;
  bucket: string;
  // pgvector
  pgHost: string;
  pgPort: number;
  pgDatabase: string;
  pgUser: string;
  pgSsl: boolean; // RDS and Aurora (PostgreSQL 15+) require SSL by default
  password: string;
}

export interface OntopConfig {
  endpointUrl: string; // Ontop SPARQL endpoint, e.g. http://localhost:8080
  baseIri: string; // ontology namespace
  dataIri: string; // instance IRI namespace
}

export interface ColumnModel {
  name: string;
  dataType: string;
  nullable: boolean;
  include: boolean;
  description: string;
  propertyName: string; // ontology property local name
}

export interface RelationModel {
  name: string; // object property local name
  fromColumns: string[];
  toSchema: string;
  toTable: string;
  toColumns: string[];
}

export interface TableModel {
  schema: string;
  name: string;
  className: string; // ontology class local name
  description: string;
  primaryKey: string[];
  columns: ColumnModel[];
  relations: RelationModel[];
}

export interface VkgArtifacts {
  generatedAt: string;
  ontologyTtl: string;
  mappingObda: string;
  deployedAt?: string;
}

export interface QueryRun {
  id: string;
  at: string;
  question: string;
  sparql: string;
  sql: string;
  columns: string[];
  rows: Record<string, string>[];
  insights: Insights | null;
  error?: string;
}

export interface Insights {
  summary: string;
  keyFindings: string[];
  chart: { type: "bar" | "line" | "none"; x: string; y: string };
  followUps: string[];
}

export interface AppState {
  llm: LlmConfig;
  redshift: RedshiftConfig;
  graph: GraphConfig;
  vectorStore: VectorStoreConfig;
  ontop: OntopConfig;
  catalog: { database: string; tables: TableModel[] };
  vkg: VkgArtifacts | null;
  history: QueryRun[];
}
