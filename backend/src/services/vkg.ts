import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AppState, TableModel } from "../types.js";

const ONTOP_INPUT_DIR = path.resolve(process.env.ONTOP_INPUT_DIR ?? "../ontop/input");
const ONTOP_CONTAINER = process.env.ONTOP_CONTAINER ?? "ontodata-ontop";

// ---------- naming helpers ----------

const words = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, "$1 $2").split(/[^A-Za-z0-9]+/).filter(Boolean);

export const pascal = (s: string) =>
  words(s)
    .map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase())
    .join("") || "Thing";

export const camel = (s: string) => {
  const p = pascal(s);
  return p[0].toLowerCase() + p.slice(1);
};

/** Singularise a table name for a class name: "customers" -> "Customer". */
export const classNameFor = (table: string) => pascal(table.replace(/(ies)$/i, "y").replace(/(?<!s)s$/i, ""));

const sqlIdent = (s: string) => `"${s.replace(/"/g, '""')}"`;
const alias = (s: string) => s.toLowerCase().replace(/[^a-z0-9_]/g, "_");
const ttlString = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;

export function xsdType(redshiftType: string): string {
  const t = redshiftType.toLowerCase();
  if (/^(smallint|integer|bigint|int2|int4|int8)/.test(t)) return "xsd:integer";
  if (/^(numeric|decimal)/.test(t)) return "xsd:decimal";
  if (/^(real|double|float)/.test(t)) return "xsd:double";
  if (/^bool/.test(t)) return "xsd:boolean";
  if (t === "date") return "xsd:date";
  if (/^timestamp/.test(t)) return "xsd:dateTime";
  return "xsd:string";
}

const tableKey = (schema: string, name: string) => `${schema}.${name}`;
const iriTemplate = (t: TableModel, cols: string[]) => `data:${alias(t.schema)}/${alias(t.name)}/${cols.map((c) => `{${c}}`).join("/")}`;

// ---------- generation ----------

export interface GenerationResult {
  ontologyTtl: string;
  mappingObda: string;
  warnings: string[];
}

export function generate(state: AppState): GenerationResult {
  const { baseIri, dataIri } = state.ontop;
  const tables = state.catalog.tables;
  const byKey = new Map(tables.map((t) => [tableKey(t.schema, t.name), t]));
  const warnings: string[] = [];

  // A property name reused across classes gets no rdfs:domain (it would wrongly intersect the domains).
  const propUse = new Map<string, number>();
  for (const t of tables) for (const c of t.columns.filter((c) => c.include)) propUse.set(c.propertyName, (propUse.get(c.propertyName) ?? 0) + 1);
  const declared = new Set<string>();

  const ttl: string[] = [
    `@prefix : <${baseIri}> .`,
    `@prefix owl: <http://www.w3.org/2002/07/owl#> .`,
    `@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .`,
    `@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .`,
    `@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .`,
    ``,
    `<${baseIri.replace(/#$/, "")}> a owl:Ontology ; rdfs:label "Ontodata ontology" .`,
    ``,
  ];

  const obda: string[] = [
    `[PrefixDeclaration]`,
    `:\t\t${baseIri}`,
    `data:\t\t${dataIri}`,
    `owl:\t\thttp://www.w3.org/2002/07/owl#`,
    `rdf:\t\thttp://www.w3.org/1999/02/22-rdf-syntax-ns#`,
    `rdfs:\t\thttp://www.w3.org/2000/01/rdf-schema#`,
    `xsd:\t\thttp://www.w3.org/2001/XMLSchema#`,
    ``,
    `[MappingDeclaration] @collection [[`,
  ];

  for (const t of tables) {
    const cls = t.className;
    ttl.push(`:${cls} a owl:Class ;\n    rdfs:label ${ttlString(cls)}${t.description ? ` ;\n    rdfs:comment ${ttlString(t.description)}` : ""} .\n`);

    const cols = t.columns.filter((c) => c.include);
    for (const c of cols) {
      if (declared.has(c.propertyName)) continue;
      declared.add(c.propertyName);
      const parts = [`:${c.propertyName} a owl:DatatypeProperty`, `rdfs:label ${ttlString(c.propertyName)}`, `rdfs:range ${xsdType(c.dataType)}`];
      if ((propUse.get(c.propertyName) ?? 0) === 1) parts.push(`rdfs:domain :${cls}`);
      if (c.description) parts.push(`rdfs:comment ${ttlString(c.description)}`);
      ttl.push(parts.join(" ;\n    ") + " .\n");
    }

    if (!t.primaryKey.length) {
      warnings.push(`${tableKey(t.schema, t.name)} has no primary key; it was skipped in the mapping. Set key columns on the Catalog screen.`);
      continue;
    }

    // Instances + data properties: one mapping per table.
    const pkAliases = t.primaryKey.map(alias);
    const selectCols = [...new Set([...t.primaryKey, ...cols.map((c) => c.name)])];
    const target = [`${iriTemplate(t, pkAliases)} a :${cls}`];
    for (const c of cols) target.push(`:${c.propertyName} {${alias(c.name)}}^^${xsdType(c.dataType)}`);
    obda.push(
      `mappingId\t${alias(t.schema)}_${alias(t.name)}`,
      `target\t\t${target.join(" ; ")} .`,
      `source\t\tSELECT ${selectCols.map((c) => `${sqlIdent(c)} AS ${alias(c)}`).join(", ")} FROM ${sqlIdent(t.schema)}.${sqlIdent(t.name)}`,
      ``,
    );

    // Object properties: join to the target table so the object IRI uses the target's key template.
    for (const r of t.relations) {
      const to = byKey.get(tableKey(r.toSchema, r.toTable));
      if (!to) {
        warnings.push(`Relation ${r.name} on ${t.name} points to ${r.toSchema}.${r.toTable}, which is not in the catalog; skipped.`);
        continue;
      }
      if (!to.primaryKey.length) {
        warnings.push(`Relation ${r.name}: target ${to.name} has no primary key; skipped.`);
        continue;
      }
      ttl.push(`:${r.name} a owl:ObjectProperty ;\n    rdfs:label ${ttlString(r.name)} ;\n    rdfs:domain :${cls} ;\n    rdfs:range :${to.className} .\n`);
      const srcSel = t.primaryKey.map((c) => `a.${sqlIdent(c)} AS s_${alias(c)}`);
      const tgtSel = to.primaryKey.map((c) => `b.${sqlIdent(c)} AS o_${alias(c)}`);
      const on = r.fromColumns.map((fc, i) => `a.${sqlIdent(fc)} = b.${sqlIdent(r.toColumns[i])}`).join(" AND ");
      obda.push(
        `mappingId\t${alias(t.schema)}_${alias(t.name)}_${r.name}`,
        `target\t\t${iriTemplate(t, t.primaryKey.map((c) => `s_${alias(c)}`))} :${r.name} ${iriTemplate(to, to.primaryKey.map((c) => `o_${alias(c)}`))} .`,
        `source\t\tSELECT ${[...srcSel, ...tgtSel].join(", ")} FROM ${sqlIdent(t.schema)}.${sqlIdent(t.name)} a JOIN ${sqlIdent(to.schema)}.${sqlIdent(to.name)} b ON ${on}`,
        ``,
      );
    }
  }
  obda.push(`]]`);

  return { ontologyTtl: ttl.join("\n"), mappingObda: obda.join("\n"), warnings };
}

/** Compact, prompt-friendly description of the ontology, optionally restricted to some tables. */
export function ontologySummary(state: AppState, onlyTables?: string[]): string {
  const tables = state.catalog.tables.filter((t) => !onlyTables?.length || onlyTables.includes(tableKey(t.schema, t.name)));
  const lines = [`PREFIX : <${state.ontop.baseIri}>`, `PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>`, ``];
  for (const t of tables) {
    lines.push(`Class :${t.className}${t.description ? ` - ${t.description}` : ""}`);
    for (const c of t.columns.filter((c) => c.include)) {
      lines.push(`  :${c.propertyName} (${xsdType(c.dataType)})${c.description ? ` - ${c.description}` : ""}`);
    }
    for (const r of t.relations) {
      const to = state.catalog.tables.find((x) => x.schema === r.toSchema && x.name === r.toTable);
      if (to) lines.push(`  :${r.name} -> :${to.className}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

// ---------- deployment ----------

export function writeOntopFiles(state: AppState, ontologyTtl: string, mappingObda: string): string {
  const r = state.redshift;
  // Ontop runs in Docker, where "localhost" is the container itself; reach the host's database instead.
  const host = /^(localhost|127\.0\.0\.1)$/.test(r.host) ? "host.docker.internal" : r.host;
  const db = state.catalog.database || r.database;
  const [url, driver] =
    r.engine === "postgres"
      ? [`jdbc:postgresql://${host}:${r.port}/${db}`, "org.postgresql.Driver"]
      : [`jdbc:redshift://${host}:${r.port}/${db}`, "com.amazon.redshift.jdbc42.Driver"];
  fs.mkdirSync(ONTOP_INPUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(ONTOP_INPUT_DIR, "ontology.ttl"), ontologyTtl);
  fs.writeFileSync(path.join(ONTOP_INPUT_DIR, "mapping.obda"), mappingObda);
  fs.writeFileSync(
    path.join(ONTOP_INPUT_DIR, "redshift.properties"),
    [
      `jdbc.url=${url}`,
      `jdbc.user=${r.user}`,
      `jdbc.password=${r.password}`,
      `jdbc.driver=${driver}`,
      ``,
    ].join("\n"),
  );
  return ONTOP_INPUT_DIR;
}

/** Restart the Ontop container so it picks up new connection properties. */
export async function restartOntop(): Promise<string> {
  // In a container there is no docker CLI; use the Engine API on the mounted socket instead.
  if (fs.existsSync(DOCKER_SOCKET)) return restartViaSocket();
  try {
    const { stdout } = await promisify(execFile)("docker", ["restart", ONTOP_CONTAINER], { timeout: 60000 });
    return stdout.trim();
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    throw new Error(
      `this server can't control Docker. Ontop reloads the ontology and mapping by itself; after a database connection change run: docker restart ${ONTOP_CONTAINER}`,
    );
  }
}

const DOCKER_SOCKET = "/var/run/docker.sock";

function restartViaSocket(): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { socketPath: DOCKER_SOCKET, method: "POST", path: `/containers/${encodeURIComponent(ONTOP_CONTAINER)}/restart?t=10`, timeout: 60000 },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () =>
          res.statusCode === 204 ? resolve(ONTOP_CONTAINER) : reject(new Error(`Docker API ${res.statusCode}: ${body.slice(0, 200)}`)),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });
}
