// Shapes mirror backend/src/types.ts.
export interface LlmConfig {
  provider: 'anthropic' | 'bedrock' | 'openai'
  model: string
  apiKey?: string
  openaiApiKey?: string
  openaiBaseUrl?: string
  region?: string
  effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  embeddingProvider: 'bedrock' | 'openai'
  embeddingModel: string
  embeddingDimension: number
}
export interface RedshiftConfig { engine: 'redshift' | 'postgres'; host: string; port: number; database: string; user: string; password: string; ssl: boolean }
export interface GraphConfig {
  provider: 'neptune' | 'neo4j'
  endpoint: string; port: number; region: string; iamAuth: boolean; namedGraph: string
  neo4jUri: string; neo4jUser: string; password: string; neo4jDatabase: string
}
export interface VectorStoreConfig {
  enabled: boolean; provider: 's3vectors' | 'pgvector'; indexName: string; topK: number
  region: string; bucket: string
  pgHost: string; pgPort: number; pgDatabase: string; pgUser: string; pgSsl: boolean; password: string
}
export interface OntopConfig { endpointUrl: string; baseIri: string; dataIri: string }
export interface Config { llm: LlmConfig; redshift: RedshiftConfig; graph: GraphConfig; vectorStore: VectorStoreConfig; ontop: OntopConfig }

export interface ColumnModel { name: string; dataType: string; nullable: boolean; include: boolean; description: string; propertyName: string }
export interface RelationModel { name: string; fromColumns: string[]; toSchema: string; toTable: string; toColumns: string[] }
export interface TableModel {
  schema: string; name: string; className: string; description: string
  primaryKey: string[]; columns: ColumnModel[]; relations: RelationModel[]
}
export interface Catalog { database: string; tables: TableModel[] }

export interface Insights {
  summary: string
  keyFindings: string[]
  chart: { type: 'bar' | 'line' | 'none'; x: string; y: string }
  followUps: string[]
}
export interface QueryRun {
  id: string; at: string; question: string; sparql: string; sql: string
  columns: string[]; rows: Record<string, string>[]; insights: Insights | null; error?: string
}
export interface PipelineStep { step: string; ok: boolean; detail: string }

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error ?? `${res.status} ${res.statusText}`)
  return data as T
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body: unknown = {}) => request<T>('POST', url, body),
  put: <T>(url: string, body: unknown) => request<T>('PUT', url, body),
  del: <T>(url: string) => request<T>('DELETE', url),
}

export const tablePath = (t: { schema: string; name: string }) =>
  `/api/catalog/tables/${encodeURIComponent(t.schema)}/${encodeURIComponent(t.name)}`
