import pg from "pg";
import type { RedshiftConfig } from "../types.js";

// Redshift speaks the PostgreSQL wire protocol, so node-postgres works for metadata and previews.
async function withClient<T>(cfg: RedshiftConfig, database: string | undefined, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({
    host: cfg.host,
    port: cfg.port,
    database: database || cfg.database,
    user: cfg.user,
    password: cfg.password,
    ssl: cfg.ssl ? { rejectUnauthorized: false } : false,
    connectionTimeoutMillis: 15000,
    query_timeout: 60000,
  });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end().catch(() => {});
  }
}

export async function testConnection(cfg: RedshiftConfig): Promise<string> {
  return withClient(cfg, undefined, async (c) => (await c.query("select version() as v")).rows[0].v as string);
}

export async function listDatabases(cfg: RedshiftConfig): Promise<string[]> {
  return withClient(cfg, undefined, async (c) => {
    const r = await c.query("select database_name from svv_redshift_databases order by 1").catch(() =>
      c.query("select datname as database_name from pg_database where datistemplate = false order by 1"),
    );
    return r.rows.map((x) => x.database_name as string);
  });
}

export interface TableInfo {
  schema: string;
  name: string;
  type: string;
}

export async function listTables(cfg: RedshiftConfig, database: string): Promise<TableInfo[]> {
  return withClient(cfg, database, async (c) => {
    // svv_tables (Redshift) also lists Spectrum and datashare tables; plain Postgres only has information_schema.
    const r = await c.query(
      `select table_schema, table_name, table_type
         from ${cfg.engine === "postgres" ? "information_schema.tables" : "svv_tables"}
        where table_catalog = $1
          and table_schema not in ('pg_catalog','information_schema','pg_internal','pg_auto_copy')
          and table_schema not like 'pg_temp%'
        order by 1, 2`,
      [database],
    );
    return r.rows.map((x) => ({ schema: x.table_schema, name: x.table_name, type: x.table_type }));
  });
}

export interface ColumnInfo {
  name: string;
  dataType: string;
  nullable: boolean;
  remarks: string;
}

export interface TableDetail {
  columns: ColumnInfo[];
  primaryKey: string[];
  foreignKeys: { columns: string[]; toSchema: string; toTable: string; toColumns: string[] }[];
  tableRemarks: string;
}

export async function describeTable(cfg: RedshiftConfig, database: string, schema: string, table: string): Promise<TableDetail> {
  return withClient(cfg, database, async (c) => {
    const pgEngine = cfg.engine === "postgres";
    const cols = await c.query(
      pgEngine
        ? `select column_name, data_type, is_nullable,
                  col_description(format('%I.%I', table_schema, table_name)::regclass, ordinal_position) as remarks
             from information_schema.columns
            where table_catalog = $1 and table_schema = $2 and table_name = $3
            order by ordinal_position`
        : `select column_name, data_type, is_nullable, remarks
             from svv_columns
            where table_catalog = $1 and table_schema = $2 and table_name = $3
            order by ordinal_position`,
      [database, schema, table],
    );
    const remarks = await c
      .query(
        pgEngine
          ? `select obj_description(format('%I.%I', $2::text, $3::text)::regclass, 'pg_class') as remarks where $1::text is not null`
          : `select remarks from svv_tables where table_catalog=$1 and table_schema=$2 and table_name=$3`,
        [database, schema, table],
      )
      .catch(() => ({ rows: [] as { remarks: string }[] }));

    // Redshift keeps PK/FK constraints as informational metadata; read them when declared.
    const pk: string[] = [];
    const fks: TableDetail["foreignKeys"] = [];
    try {
      const pkr = await c.query(
        `select kcu.column_name
           from information_schema.table_constraints tc
           join information_schema.key_column_usage kcu
             on tc.constraint_name = kcu.constraint_name and tc.table_schema = kcu.table_schema
          where tc.constraint_type = 'PRIMARY KEY' and tc.table_schema = $1 and tc.table_name = $2
          order by kcu.ordinal_position`,
        [schema, table],
      );
      pk.push(...pkr.rows.map((x) => x.column_name as string));
      const fkr = await c.query(
        `select tc.constraint_name, kcu.column_name, ccu.table_schema as to_schema,
                ccu.table_name as to_table, ccu.column_name as to_column
           from information_schema.table_constraints tc
           join information_schema.key_column_usage kcu
             on tc.constraint_name = kcu.constraint_name and tc.table_schema = kcu.table_schema
           join information_schema.constraint_column_usage ccu
             on tc.constraint_name = ccu.constraint_name
          where tc.constraint_type = 'FOREIGN KEY' and tc.table_schema = $1 and tc.table_name = $2`,
        [schema, table],
      );
      const byName = new Map<string, TableDetail["foreignKeys"][number]>();
      for (const row of fkr.rows) {
        const fk = byName.get(row.constraint_name) ?? { columns: [] as string[], toSchema: row.to_schema as string, toTable: row.to_table as string, toColumns: [] as string[] };
        fk.columns.push(row.column_name);
        fk.toColumns.push(row.to_column);
        byName.set(row.constraint_name, fk);
      }
      fks.push(...byName.values());
    } catch {
      // constraint metadata unavailable (e.g. external/Spectrum tables) - user sets keys in the UI
    }

    return {
      columns: cols.rows.map((x) => ({
        name: x.column_name,
        dataType: x.data_type,
        nullable: x.is_nullable === "YES",
        remarks: x.remarks ?? "",
      })),
      primaryKey: pk,
      foreignKeys: fks,
      tableRemarks: remarks.rows[0]?.remarks ?? "",
    };
  });
}

const quoteIdent = (s: string) => `"${s.replace(/"/g, '""')}"`;

export async function previewRows(cfg: RedshiftConfig, database: string, schema: string, table: string, limit = 10) {
  return withClient(cfg, database, async (c) => {
    const r = await c.query(`select * from ${quoteIdent(schema)}.${quoteIdent(table)} limit ${Math.min(limit, 100)}`);
    return { columns: r.fields.map((f) => f.name), rows: r.rows };
  });
}
