// Regression check for the retail sample data (sample-data/01_retail.sql).
// Runs each question through the full pipeline and checks key values against known-correct answers.
// Usage: npm run eval   (app on http://localhost:4000, or set ONTODATA_URL)
const BASE = process.env.ONTODATA_URL ?? "http://localhost:4000";
const checks = [
  ["What is the total revenue by department?", (rows) => JSON.stringify(rows).includes("8403438.5")],
  ["Which 5 customers placed the most delivered orders?", (rows) => rows.length === 5 && JSON.stringify(rows).includes('"15"')],
  ["How many orders were placed through each channel in each country?", (rows) => JSON.stringify(rows).includes('"1800"') && JSON.stringify(rows).includes('"902"')],
  ["Which product category has the highest gross margin percentage on delivered orders?", (rows) => /Phones/.test(JSON.stringify(rows[0] ?? {})) && JSON.stringify(rows[0]).includes("44.00")],
  ["Show monthly revenue for 2025", (rows) => rows.length === 12 && JSON.stringify(rows).includes("905799.96")],
  ["Which store regions have the most customers in the ENTERPRISE segment?", (rows) => JSON.stringify(rows).includes("Ontario") && JSON.stringify(rows).includes('"29"')],
];
let pass = 0;
for (const [q, ok] of checks) {
  const t0 = Date.now();
  const r = await (await fetch(`${BASE}/api/query/run`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: q }) })).json();
  const good = !r.run.error && ok(r.run.rows);
  pass += good;
  const retrieve = r.steps.find((s) => s.step === "retrieve")?.detail ?? "";
  const repairs = r.steps.filter((s) => s.step === "sparql" && !s.ok).length;
  console.log(`${good ? "PASS" : "FAIL"}  ${((Date.now() - t0) / 1000).toFixed(0).padStart(3)}s  repairs=${repairs}  ${q}`);
  if (retrieve) console.log(`        ${retrieve}`);
  if (!good) console.log(`        rows=${r.run.rows.length} ${(r.run.error ?? "").slice(0, 160)}`);
}
console.log(`\n${pass}/${checks.length} passed`);
process.exitCode = pass === checks.length ? 0 : 1;
