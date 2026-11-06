import type { OntopConfig } from "../types.js";

export interface SparqlResult {
  columns: string[];
  rows: Record<string, string>[];
}

export async function status(cfg: OntopConfig): Promise<{ up: boolean; detail: string }> {
  try {
    const r = await runSparql(cfg, "ASK { ?s ?p ?o }");
    return { up: true, detail: `Ontop endpoint up (${r.rows.length ? "has data" : "reachable"})` };
  } catch (e) {
    return { up: false, detail: (e as Error).message };
  }
}

export async function runSparql(cfg: OntopConfig, query: string): Promise<SparqlResult> {
  const res = await fetch(`${cfg.endpointUrl}/sparql`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/sparql-results+json" },
    body: new URLSearchParams({ query }).toString(),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Ontop ${res.status}: ${text.slice(0, 1500)}`);
  const json = JSON.parse(text);
  if (typeof json.boolean === "boolean") return { columns: ["result"], rows: json.boolean ? [{ result: "true" }] : [] };
  const columns: string[] = json.head.vars;
  const rows = (json.results.bindings as Record<string, { value: string }>[]).map((b) =>
    Object.fromEntries(columns.map((c) => [c, b[c]?.value ?? ""])),
  );
  return { columns, rows };
}

/** Ask Ontop for the SQL it generates for a SPARQL query (Ontop's /ontop/reformulate endpoint). */
export async function reformulate(cfg: OntopConfig, query: string): Promise<string> {
  const res = await fetch(`${cfg.endpointUrl}/ontop/reformulate?${new URLSearchParams({ query })}`);
  const text = await res.text();
  if (!res.ok) {
    // /ontop/reformulate only returns a bare 500; /sparql reports the actual parser/rewriting error.
    // Invalid queries fail there before reaching the database.
    const detail = await runSparql(cfg, query).then(
      () => text.slice(0, 1500),
      (e: Error) => e.message,
    );
    throw new Error(`Ontop rejected the query: ${detail}`);
  }
  // The response is Ontop's query plan; the SQL sent to the database follows the "NATIVE [...]" line.
  const native = text.match(/^\s*NATIVE \[[^\]]*\]\s*\n([\s\S]*)$/m);
  return native ? native[1].trim() : text;
}
