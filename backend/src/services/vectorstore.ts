import pg from "pg";
import {
  S3VectorsClient,
  GetIndexCommand,
  CreateIndexCommand,
  PutVectorsCommand,
  QueryVectorsCommand,
} from "@aws-sdk/client-s3vectors";
import type { LlmConfig, TableModel, VectorStoreConfig } from "../types.js";
import { embed } from "./llm.js";

/** One embedded schema description; `table` is the fully-qualified table it belongs to. */
interface SchemaDoc {
  key: string;
  table: string;
  text: string;
}

interface VectorBackend {
  test(): Promise<string>;
  /** Create the index if needed (sized to `dimension`) and upsert the documents. */
  upsert(dimension: number, docs: (SchemaDoc & { vector: number[] })[]): Promise<void>;
  /** Table names of the nearest documents, best first. */
  query(vector: number[], topK: number): Promise<string[]>;
}

/** One document per table and per column, so retrieval can pick the slice of schema a question needs. */
function schemaDocs(tables: TableModel[]): SchemaDoc[] {
  const docs: SchemaDoc[] = [];
  for (const t of tables) {
    const fq = `${t.schema}.${t.name}`;
    docs.push({ key: `table:${fq}`, table: fq, text: `Table ${fq} (class ${t.className}). ${t.description}` });
    for (const c of t.columns.filter((c) => c.include)) {
      docs.push({
        key: `column:${fq}.${c.name}`,
        table: fq,
        text: `Column ${c.name} (${c.dataType}) of ${fq}, property ${c.propertyName}. ${c.description}`,
      });
    }
  }
  return docs;
}

// ---------- Amazon S3 Vectors ----------

function s3Backend(cfg: VectorStoreConfig): VectorBackend {
  const client = new S3VectorsClient({ region: cfg.region });
  const ids = { vectorBucketName: cfg.bucket, indexName: cfg.indexName };
  return {
    async test() {
      try {
        const r = await client.send(new GetIndexCommand(ids));
        return `S3 Vectors index "${cfg.indexName}" found (dimension ${r.index?.dimension}, ${r.index?.distanceMetric}).`;
      } catch (e) {
        if ((e as Error).name === "NotFoundException") return `Bucket reachable; index "${cfg.indexName}" will be created on first sync.`;
        throw e;
      }
    },
    async upsert(dimension, docs) {
      try {
        await client.send(new GetIndexCommand(ids));
      } catch (e) {
        if ((e as Error).name !== "NotFoundException") throw e;
        await client.send(new CreateIndexCommand({ ...ids, dataType: "float32", dimension, distanceMetric: "cosine" }));
      }
      for (let i = 0; i < docs.length; i += 500) {
        const vectors = docs.slice(i, i + 500).map((d) => ({
          key: d.key,
          data: { float32: d.vector },
          metadata: { table: d.table, text: d.text },
        }));
        await client.send(new PutVectorsCommand({ ...ids, vectors }));
      }
    },
    async query(vector, topK) {
      const r = await client.send(new QueryVectorsCommand({ ...ids, topK, queryVector: { float32: vector }, returnMetadata: true }));
      return (r.vectors ?? []).map((v) => (v.metadata as { table?: string } | undefined)?.table ?? "").filter(Boolean);
    },
  };
}

// ---------- pgvector (PostgreSQL extension) ----------

function pgvectorBackend(cfg: VectorStoreConfig): VectorBackend {
  const table = `"${cfg.indexName.replace(/[^A-Za-z0-9_]/g, "_")}"`;
  const literal = (v: number[]) => `[${v.join(",")}]`;
  async function withClient<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
    const client = new pg.Client({
      host: cfg.pgHost,
      port: cfg.pgPort,
      database: cfg.pgDatabase,
      user: cfg.pgUser,
      password: cfg.password,
      ssl: cfg.pgSsl ? { rejectUnauthorized: false } : false,
      connectionTimeoutMillis: 10000,
    });
    await client.connect();
    try {
      return await fn(client);
    } finally {
      await client.end().catch(() => {});
    }
  }
  return {
    test: () =>
      withClient(async (c) => {
        const ext = await c.query(`select extversion from pg_extension where extname = 'vector'`);
        const n = await c.query(`select count(*)::int as n from ${table}`).catch(() => null);
        const version = ext.rows[0]?.extversion ? `pgvector ${ext.rows[0].extversion}` : "pgvector not installed yet (created on first sync)";
        return `Connected. ${version}; ${n ? `table ${table} has ${n.rows[0].n} vectors` : `table ${table} will be created on first sync`}.`;
      }),
    upsert: (dimension, docs) =>
      withClient(async (c) => {
        await c.query("create extension if not exists vector");
        await c.query(`create table if not exists ${table} (key text primary key, table_name text not null, text text not null, embedding vector(${dimension}) not null)`);
        const dim = await c.query(
          `select atttypmod as dim from pg_attribute where attrelid = $1::regclass and attname = 'embedding'`,
          [table],
        );
        if (dim.rows[0]?.dim !== dimension) {
          throw new Error(`Table ${table} stores ${dim.rows[0]?.dim}-dimension vectors but the embedding model produces ${dimension}. Use a new index name.`);
        }
        await c.query("begin");
        for (const d of docs) {
          await c.query(
            `insert into ${table} (key, table_name, text, embedding) values ($1, $2, $3, $4)
             on conflict (key) do update set table_name = excluded.table_name, text = excluded.text, embedding = excluded.embedding`,
            [d.key, d.table, d.text, literal(d.vector)],
          );
        }
        await c.query("commit");
      }),
    query: (vector, topK) =>
      withClient(async (c) => {
        // <=> is cosine distance.
        const r = await c.query(`select table_name from ${table} order by embedding <=> $1 limit $2`, [literal(vector), topK]);
        return r.rows.map((x) => x.table_name as string);
      }),
  };
}

// ---------- public API ----------

function backend(cfg: VectorStoreConfig): VectorBackend {
  if (cfg.provider === "s3vectors") return s3Backend(cfg);
  return pgvectorBackend(cfg);
}

export const testConnection = (cfg: VectorStoreConfig) => backend(cfg).test();

export async function syncSchema(cfg: VectorStoreConfig, llm: LlmConfig, tables: TableModel[]): Promise<string> {
  const docs = schemaDocs(tables);
  if (!docs.length) throw new Error("The catalog is empty; add tables first.");
  const withVectors = [];
  for (let i = 0; i < docs.length; i += 16) {
    const batch = docs.slice(i, i + 16);
    withVectors.push(...(await Promise.all(batch.map(async (d) => ({ ...d, vector: await embed(llm, d.text) })))));
  }
  await backend(cfg).upsert(withVectors[0].vector.length, withVectors);
  return `Indexed ${docs.length} schema descriptions into ${cfg.provider} index "${cfg.indexName}".`;
}

/** Returns the fully-qualified table names most relevant to the question. */
export async function relevantTables(cfg: VectorStoreConfig, llm: LlmConfig, question: string): Promise<string[]> {
  const tables = await backend(cfg).query(await embed(llm, question), cfg.topK);
  return [...new Set(tables)];
}
