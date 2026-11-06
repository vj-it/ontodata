import { randomUUID } from "node:crypto";
import type { AppState, Insights, LlmConfig, QueryRun, TableModel } from "../types.js";
import { complete, extractJson, extractSparql } from "./llm.js";
import * as ontop from "./ontop.js";
import * as vectors from "./vectorstore.js";
import { ontologySummary } from "./vkg.js";

const SPARQL_SYSTEM = `You translate business questions into SPARQL 1.1 SELECT queries over a virtual knowledge graph served by Ontop on top of a SQL database.
Use only the classes and properties in the ontology you are given, with the ':' prefix as declared. Declare every prefix you use.
Datatype properties link an instance to a literal; object properties (shown with ->) link two instances.
Prefer aggregates (COUNT, SUM, AVG with GROUP BY) when the question asks for totals or rankings, and add ORDER BY and LIMIT 100 unless the question asks for everything.
Ontop translates SPARQL to SQL and cannot translate everything:
- When a SELECT expression combines two or more aggregates, wrap it once in xsd:decimal(...), e.g. (xsd:decimal((SUM(?revenue) - SUM(?cost)) / SUM(?revenue) * 100) AS ?marginPct). Without it Ontop fails when the query orders by that column. Do not wrap a single aggregate.
- Cast xsd:integer variables with xsd:decimal(?x) when multiplying or dividing them with decimals.
- Never cast literals: write 100 or 100.0, not xsd:decimal(100).
- Avoid subqueries; compute ratios directly from aggregates in the grouped SELECT.
Return only the query in a \`\`\`sparql code block.`;

const INSIGHT_SYSTEM = `You are a data analyst. Given a business question and the query result rows, explain what the data says.
Reply with only a JSON object: {"summary": string, "keyFindings": string[], "chart": {"type": "bar"|"line"|"none", "x": column name, "y": numeric column name}, "followUps": string[] (3 short follow-up questions)}.
Base every statement on the rows provided; if the result is empty or inconclusive, say so.
Before stating a ranking or comparison, check it against the numbers for every group it covers; if a pattern holds for only some groups, say which.
Choose a chart x column whose value is different on every row; if no such column exists, use "none".`;

const MAX_SPARQL_REPAIRS = 2;

// Similarity search finds the tables a question mentions, not the tables needed to join them
// (e.g. "orders per country" needs Order -> Store -> Region). Add relation neighbours up to this many hops.
const JOIN_HOPS = 2;

/**
 * Deterministic fixes for SPARQL that is valid but that Ontop cannot translate to SQL.
 * Casting a numeric literal, e.g. xsd:decimal(100), makes Ontop's SQL serializer fail; use the plain literal.
 */
export function normalizeSparql(sparql: string): string {
  return sparql.replace(/xsd:(decimal|double|float|integer)\(\s*(-?\d+(?:\.\d+)?)\s*\)/g, (_m, type: string, n: string) =>
    type === "integer" || n.includes(".") ? n : `${n}.0`,
  );
}

function withJoinNeighbours(state: AppState, tables: string[], hops: number): string[] {
  const key = (schema: string, name: string) => `${schema}.${name}`;
  const edges = new Map<string, Set<string>>();
  const link = (a: string, b: string) => edges.set(a, (edges.get(a) ?? new Set()).add(b));
  for (const t of state.catalog.tables) {
    for (const r of t.relations) {
      link(key(t.schema, t.name), key(r.toSchema, r.toTable));
      link(key(r.toSchema, r.toTable), key(t.schema, t.name));
    }
  }
  const result = new Set(tables);
  let frontier = [...tables];
  for (let i = 0; i < hops; i++) {
    frontier = frontier.flatMap((t) => [...(edges.get(t) ?? [])]).filter((t) => !result.has(t));
    frontier.forEach((t) => result.add(t));
  }
  return [...result];
}

export interface PipelineStep {
  step: "retrieve" | "sparql" | "sql" | "execute" | "insights";
  ok: boolean;
  detail: string;
}

export async function generateSparql(state: AppState, question: string, steps: PipelineStep[]): Promise<string> {
  let scope: string[] | undefined;
  if (state.vectorStore.enabled) {
    try {
      const hits = await vectors.relevantTables(state.vectorStore, state.llm, question);
      scope = hits.length ? withJoinNeighbours(state, hits, JOIN_HOPS) : undefined;
      const added = scope?.filter((t) => !hits.includes(t)) ?? [];
      steps.push({
        step: "retrieve",
        ok: true,
        detail: hits.length
          ? `Vector store picked: ${hits.join(", ")}${added.length ? `; added for joins: ${added.join(", ")}` : ""}`
          : "Vector store returned nothing; using full ontology",
      });
    } catch (e) {
      steps.push({ step: "retrieve", ok: false, detail: `Vector store lookup failed, using full ontology: ${(e as Error).message}` });
    }
  }
  const ontology = ontologySummary(state, scope);
  let sparql = extractSparql(await complete(state.llm, SPARQL_SYSTEM, `Ontology:\n${ontology}\nQuestion: ${question}`));

  // Validate against Ontop; on failure let the model repair the query, showing it every rejected attempt.
  const rejected: string[] = [];
  for (let attempt = 1; ; attempt++) {
    sparql = normalizeSparql(sparql);
    try {
      await ontop.reformulate(state.ontop, sparql);
      break;
    } catch (e) {
      const err = (e as Error).message;
      // Keep the last attempt on the error so the UI can show it for hand-editing.
      if (attempt > MAX_SPARQL_REPAIRS) throw Object.assign(e as Error, { sparql });
      steps.push({ step: "sparql", ok: false, detail: `Attempt ${attempt} rejected by Ontop, retrying: ${err.slice(0, 300)}` });
      rejected.push(`Query:\n${sparql}\nOntop error:\n${err}`);
      sparql = extractSparql(
        await complete(
          state.llm,
          SPARQL_SYSTEM,
          `Ontology:\n${ontology}\nQuestion: ${question}\n\nThese attempts were rejected by Ontop:\n\n${rejected.join("\n\n")}\n\nWrite a simpler, flat query that avoids what failed.`,
        ),
      );
    }
  }
  steps.push({ step: "sparql", ok: true, detail: "SPARQL generated" });
  return sparql;
}

export async function runQuestion(state: AppState, question: string, sparqlOverride?: string) {
  const steps: PipelineStep[] = [];
  const run: QueryRun = { id: randomUUID(), at: new Date().toISOString(), question, sparql: "", sql: "", columns: [], rows: [], insights: null };
  try {
    run.sparql = sparqlOverride?.trim() ? normalizeSparql(sparqlOverride.trim()) : await generateSparql(state, question, steps);

    run.sql = await ontop.reformulate(state.ontop, run.sparql);
    steps.push({ step: "sql", ok: true, detail: "Ontop rewrote SPARQL to SQL" });

    const result = await ontop.runSparql(state.ontop, run.sparql);
    run.columns = result.columns;
    run.rows = result.rows.slice(0, 1000);
    steps.push({ step: "execute", ok: true, detail: `${result.rows.length} rows` });

    // The rows are still useful when the insight call fails, so record it as a failed step, not a failed run.
    try {
      run.insights = await insights(state, question, run);
      steps.push({ step: "insights", ok: true, detail: "Insights generated" });
    } catch (e) {
      steps.push({ step: "insights", ok: false, detail: `Insights failed: ${(e as Error).message}` });
    }
  } catch (e) {
    run.error = (e as Error).message;
    run.sparql ||= (e as { sparql?: string }).sparql ?? "";
  }
  return { run, steps };
}

async function insights(state: AppState, question: string, run: QueryRun): Promise<Insights> {
  const sample = run.rows.slice(0, 100);
  const prompt = `Question: ${question}\nColumns: ${run.columns.join(", ")}\nTotal rows: ${run.rows.length}\nRows (JSON, first ${sample.length}):\n${JSON.stringify(sample)}`;
  // Comparisons across grouped rows go wrong at low/medium effort, so insights use at least "high".
  const effort = INSIGHT_MIN_EFFORT.includes(state.llm.effort) ? state.llm.effort : "high";
  return extractJson<Insights>(await complete({ ...state.llm, effort }, INSIGHT_SYSTEM, prompt));
}

const INSIGHT_MIN_EFFORT: LlmConfig["effort"][] = ["high", "xhigh", "max"];

// ---------- catalog assistance ----------

const DESCRIBE_SYSTEM = `You document data warehouse tables for a business ontology.
Given a table's columns and sample rows, reply with only a JSON object:
{"className": PascalCase singular business concept, "description": one or two sentences on what a row represents,
 "columns": {"<column name>": {"propertyName": camelCase business name, "description": one short sentence}}}.
Use business language; mention units, codes and allowed values when the samples reveal them.`;

export async function suggestDescriptions(state: AppState, table: TableModel, sampleRows: Record<string, unknown>[]) {
  const prompt = `Table ${table.schema}.${table.name}
Existing description: ${table.description || "(none)"}
Columns:
${table.columns.map((c) => `- ${c.name} ${c.dataType}${c.description ? ` - ${c.description}` : ""}`).join("\n")}
Sample rows:
${JSON.stringify(sampleRows.slice(0, 10))}`;
  return extractJson<{
    className: string;
    description: string;
    columns: Record<string, { propertyName: string; description: string }>;
  }>(await complete(state.llm, DESCRIBE_SYSTEM, prompt));
}
