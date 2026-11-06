import express from "express";
import cors from "cors";
import path from "node:path";
import fs from "node:fs";
import { getState, update, masked, mergeSecrets } from "./store.js";
import type { AppState, TableModel } from "./types.js";
import { complete, listModels } from "./services/llm.js";
import * as redshift from "./services/redshift.js";
import * as graph from "./services/graphstore.js";
import * as vectors from "./services/vectorstore.js";
import * as ontop from "./services/ontop.js";
import * as vkg from "./services/vkg.js";
import * as pipeline from "./services/pipeline.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

const CONFIG_SECTIONS = ["llm", "redshift", "graph", "vectorStore", "ontop"] as const;
type Section = (typeof CONFIG_SECTIONS)[number];

// ---------- configuration (screens 1 & 2) ----------

app.get("/api/config", (_req, res) => {
  const s = getState();
  res.json(Object.fromEntries(CONFIG_SECTIONS.map((k) => [k, masked(s[k])])));
});

app.put("/api/config/:section", (req, res) => {
  const section = req.params.section as Section;
  if (!CONFIG_SECTIONS.includes(section)) return void res.status(404).json({ error: "Unknown section" });
  const s = update((st) => {
    (st as unknown as Record<Section, object>)[section] = mergeSecrets(st[section], req.body);
  });
  res.json(masked(s[section]));
});

app.post("/api/llm/test", async (_req, res) => {
  const reply = await complete(getState().llm, "You are a connectivity check.", "Reply with the single word OK.");
  res.json({ message: `Model replied: ${reply.slice(0, 100)}` });
});

app.get("/api/llm/models", async (_req, res) => {
  res.json(await listModels(getState().llm));
});

app.post("/api/redshift/test", async (_req, res) => {
  res.json({ message: await redshift.testConnection(getState().redshift) });
});
app.post("/api/graph/test", async (_req, res) => {
  res.json({ message: await graph.testConnection(getState().graph) });
});
app.post("/api/vectorstore/test", async (_req, res) => {
  res.json({ message: await vectors.testConnection(getState().vectorStore) });
});
app.post("/api/vectorstore/sync", async (_req, res) => {
  const s = getState();
  res.json({ message: await vectors.syncSchema(s.vectorStore, s.llm, s.catalog.tables) });
});
app.post("/api/graph/publish", async (_req, res) => {
  const s = getState();
  if (!s.catalog.tables.length) return void res.status(400).json({ error: "The catalog is empty; add tables first." });
  res.json({ message: await graph.publishOntology(s.graph, s) });
});

// ---------- catalog (screen 3) ----------

app.get("/api/redshift/databases", async (_req, res) => {
  res.json(await redshift.listDatabases(getState().redshift));
});

app.get("/api/redshift/tables", async (req, res) => {
  res.json(await redshift.listTables(getState().redshift, String(req.query.database ?? "")));
});

app.get("/api/redshift/preview", async (req, res) => {
  const { database, schema, table } = req.query as Record<string, string>;
  res.json(await redshift.previewRows(getState().redshift, database, schema, table));
});

app.get("/api/catalog", (_req, res) => {
  res.json(getState().catalog);
});

/** Add tables to the catalog, reading columns and declared keys from Redshift. Existing models are kept. */
app.post("/api/catalog/tables", async (req, res) => {
  const { database, tables } = req.body as { database: string; tables: { schema: string; name: string }[] };
  const s = getState();
  if (s.catalog.database && s.catalog.database !== database && s.catalog.tables.length) {
    return void res.status(400).json({ error: `Catalog already uses database "${s.catalog.database}". Remove its tables first.` });
  }
  const added: TableModel[] = [];
  for (const t of tables) {
    if (s.catalog.tables.some((x) => x.schema === t.schema && x.name === t.name)) continue;
    const d = await redshift.describeTable(s.redshift, database, t.schema, t.name);
    added.push({
      schema: t.schema,
      name: t.name,
      className: vkg.classNameFor(t.name),
      description: d.tableRemarks,
      primaryKey: d.primaryKey,
      columns: d.columns.map((c) => ({
        name: c.name,
        dataType: c.dataType,
        nullable: c.nullable,
        include: true,
        description: c.remarks,
        propertyName: vkg.camel(c.name),
      })),
      relations: d.foreignKeys.map((fk) => ({ name: `has${vkg.classNameFor(fk.toTable)}`, fromColumns: fk.columns, toSchema: fk.toSchema, toTable: fk.toTable, toColumns: fk.toColumns })),
    });
  }
  const st = update((x) => {
    x.catalog.database = database;
    x.catalog.tables.push(...added);
  });
  res.json(st.catalog);
});

const findTable = (s: AppState, schema: string, name: string) => s.catalog.tables.findIndex((t) => t.schema === schema && t.name === name);

app.put("/api/catalog/tables/:schema/:name", (req, res) => {
  const { schema, name } = req.params;
  const idx = findTable(getState(), schema, name);
  if (idx < 0) return void res.status(404).json({ error: "Table not in catalog" });
  const st = update((x) => {
    x.catalog.tables[idx] = { ...(req.body as TableModel), schema, name };
  });
  res.json(st.catalog.tables[idx]);
});

app.delete("/api/catalog/tables/:schema/:name", (req, res) => {
  const { schema, name } = req.params;
  const st = update((x) => {
    x.catalog.tables = x.catalog.tables.filter((t) => !(t.schema === schema && t.name === name));
    if (!x.catalog.tables.length) x.catalog.database = "";
  });
  res.json(st.catalog);
});

app.post("/api/catalog/tables/:schema/:name/suggest", async (req, res) => {
  const { schema, name } = req.params;
  const s = getState();
  const table = s.catalog.tables[findTable(s, schema, name)];
  if (!table) return void res.status(404).json({ error: "Table not in catalog" });
  const preview = await redshift.previewRows(s.redshift, s.catalog.database, schema, name, 10).catch(() => ({ rows: [] }));
  res.json(await pipeline.suggestDescriptions(s, table, preview.rows));
});

// ---------- VKG (screen 4) ----------

app.get("/api/vkg", async (_req, res) => {
  const s = getState();
  res.json({ vkg: s.vkg, status: await ontop.status(s.ontop) });
});

app.post("/api/vkg/generate", (_req, res) => {
  const result = vkg.generate(getState());
  update((x) => {
    x.vkg = { generatedAt: new Date().toISOString(), ontologyTtl: result.ontologyTtl, mappingObda: result.mappingObda };
  });
  res.json(result);
});

app.put("/api/vkg", (req, res) => {
  const { ontologyTtl, mappingObda } = req.body as { ontologyTtl: string; mappingObda: string };
  const st = update((x) => {
    x.vkg = { ...(x.vkg ?? { generatedAt: new Date().toISOString() }), ontologyTtl, mappingObda };
  });
  res.json(st.vkg);
});

app.post("/api/vkg/deploy", async (req, res) => {
  const s = getState();
  if (!s.vkg) return void res.status(400).json({ error: "Generate the VKG first." });
  const dir = vkg.writeOntopFiles(s, s.vkg.ontologyTtl, s.vkg.mappingObda);
  let restart = "";
  if (req.body?.restart) restart = await vkg.restartOntop().then(() => " Ontop restarted.", (e: Error) => ` Restart failed: ${e.message}`);
  update((x) => {
    if (x.vkg) x.vkg.deployedAt = new Date().toISOString();
  });
  res.json({ message: `Wrote ontology.ttl, mapping.obda, redshift.properties to ${dir}.${restart}` });
});

// ---------- query (screen 5) ----------

app.post("/api/query/sparql", async (req, res) => {
  const steps: pipeline.PipelineStep[] = [];
  const sparql = await pipeline.generateSparql(getState(), String(req.body.question ?? ""), steps);
  res.json({ sparql, steps });
});

app.post("/api/query/run", async (req, res) => {
  const { question, sparql } = req.body as { question: string; sparql?: string };
  const result = await pipeline.runQuestion(getState(), question, sparql);
  update((x) => {
    x.history = [result.run, ...x.history].slice(0, 50);
  });
  res.json(result);
});

app.get("/api/query/history", (_req, res) => {
  res.json(getState().history.map(({ rows, ...h }) => ({ ...h, rowCount: rows.length })));
});

app.get("/api/query/history/:id", (req, res) => {
  const run = getState().history.find((h) => h.id === req.params.id);
  if (!run) return void res.status(404).json({ error: "Not found" });
  res.json(run);
});

// ---------- static UI + errors ----------

const uiDir = path.resolve(process.env.UI_DIR ?? "../frontend/dist");
if (fs.existsSync(uiDir)) {
  app.use(express.static(uiDir));
  app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(uiDir, "index.html")));
}

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => console.log(`ontodata API on http://localhost:${port}`));
