// Exports the local sample warehouse (docker compose --profile local) as a Redshift load script,
// so Redshift gets exactly the same rows and the eval answers match.
//   node scripts/make-redshift-sample.mjs            -> deploy/aws/redshift-retail.sql
// Run the result against Redshift with psql or the Redshift query editor v2.
import fs from "node:fs";
import { createRequire } from "node:module";

const pg = createRequire(new URL("../backend/package.json", import.meta.url))("pg");
const OUT = new URL("../deploy/aws/redshift-retail.sql", import.meta.url);
const BATCH = 500;

// Same tables as sample-data/01_retail.sql. Redshift doesn't enforce keys, but Ontodata reads them as metadata.
const DDL = `drop schema if exists sales cascade;
create schema sales;

create table sales.regions (
  region_id    int primary key,
  region_name  varchar(50) not null,
  country      varchar(50) not null
);
comment on table sales.regions is 'Geographic sales region used for territory reporting.';

create table sales.stores (
  store_id    int primary key,
  store_name  varchar(100) not null,
  region_id   int not null references sales.regions (region_id),
  store_type  varchar(20) not null,
  opened_on   date not null
);
comment on table sales.stores is 'Physical store or fulfilment location.';
comment on column sales.stores.store_type is 'Format of the store: FLAGSHIP, MALL, OUTLET or ONLINE_HUB.';

create table sales.customers (
  customer_id  int primary key,
  first_name   varchar(50) not null,
  last_name    varchar(50) not null,
  email        varchar(120) not null,
  segment      varchar(20) not null,
  region_id    int not null references sales.regions (region_id),
  signup_date  date not null
);
comment on table sales.customers is 'A person or business that has bought from us.';
comment on column sales.customers.segment is 'Customer segment: CONSUMER, SMALL_BUSINESS or ENTERPRISE.';

create table sales.product_categories (
  category_id    int primary key,
  category_name  varchar(50) not null,
  department     varchar(50) not null
);

create table sales.products (
  product_id    int primary key,
  sku           varchar(20) not null,
  product_name  varchar(120) not null,
  category_id   int not null references sales.product_categories (category_id),
  unit_price    numeric(10,2) not null,
  unit_cost     numeric(10,2) not null
);
comment on table sales.products is 'Sellable product (SKU).';
comment on column sales.products.unit_price is 'Current list price in USD.';
comment on column sales.products.unit_cost is 'Current landed cost in USD.';

create table sales.orders (
  order_id     int primary key,
  customer_id  int not null references sales.customers (customer_id),
  store_id     int not null references sales.stores (store_id),
  order_date   date not null,
  channel      varchar(10) not null,
  status       varchar(12) not null
);
comment on table sales.orders is 'A customer order (header).';

create table sales.order_items (
  order_id      int not null references sales.orders (order_id),
  line_number   int not null,
  product_id    int not null references sales.products (product_id),
  quantity      int not null,
  unit_price    numeric(10,2) not null,
  discount_pct  numeric(5,2) not null,
  primary key (order_id, line_number)
);
`;

const TABLES = ["regions", "stores", "customers", "product_categories", "products", "orders", "order_items"];

const NUMERIC = 1700;

function literal(v, typeId) {
  if (v === null) return "null";
  if (typeId === NUMERIC) return String(v);
  if (v instanceof Date) return `'${v.toISOString().slice(0, 10)}'`;
  if (typeof v === "number") return String(v);
  return `'${String(v).replace(/'/g, "''")}'`;
}

const client = new pg.Client({ host: "localhost", port: 5432, database: "retail", user: "ontodata", password: "ontodata" });
// Read dates as plain strings so no time zone shifts them.
client.setTypeParser(1082, (v) => v);
await client.connect();
const parts = [DDL];
const counts = {};
for (const t of TABLES) {
  const { rows, fields } = await client.query(`select * from sales.${t} order by 1, 2`);
  counts[t] = rows.length;
  const cols = fields.map((f) => f.name).join(", ");
  for (let i = 0; i < rows.length; i += BATCH) {
    const values = rows.slice(i, i + BATCH).map((r) => `(${fields.map((f) => literal(r[f.name], f.dataTypeID)).join(", ")})`);
    parts.push(`insert into sales.${t} (${cols}) values\n${values.join(",\n")};`);
  }
}
await client.end();
parts.push("analyze;", `-- expected row counts: ${JSON.stringify(counts)}`);
fs.mkdirSync(new URL(".", OUT), { recursive: true });
fs.writeFileSync(OUT, parts.join("\n\n") + "\n");
console.log(`Wrote ${OUT.pathname} (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB)`, counts);
