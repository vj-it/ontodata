-- Sample retail warehouse for testing Ontodata locally (PostgreSQL).
-- Seven related tables in schema "sales". Some tables and columns have COMMENTs,
-- others are left blank on purpose so the "Suggest with AI" button has work to do.

create schema sales;
select setseed(0.42);

create table sales.regions (
  region_id    int primary key,
  region_name  varchar(50) not null,
  country      varchar(50) not null
);
comment on table sales.regions is 'Geographic sales region used for territory reporting.';

create table sales.stores (
  store_id    int primary key,
  store_name  varchar(100) not null,
  region_id   int not null references sales.regions,
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
  region_id    int not null references sales.regions,
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
  category_id   int not null references sales.product_categories,
  unit_price    numeric(10,2) not null,
  unit_cost     numeric(10,2) not null
);
comment on table sales.products is 'Sellable product (SKU).';
comment on column sales.products.unit_price is 'Current list price in USD.';
comment on column sales.products.unit_cost is 'Current landed cost in USD.';

create table sales.orders (
  order_id     int primary key,
  customer_id  int not null references sales.customers,
  store_id     int not null references sales.stores,
  order_date   date not null,
  channel      varchar(10) not null,
  status       varchar(12) not null
);
comment on table sales.orders is 'A customer order (header).';

create table sales.order_items (
  order_id      int not null references sales.orders,
  line_number   int not null,
  product_id    int not null references sales.products,
  quantity      int not null,
  unit_price    numeric(10,2) not null,
  discount_pct  numeric(5,2) not null,
  primary key (order_id, line_number)
);

-- ---------- data ----------

insert into sales.regions values
  (1, 'Northeast', 'USA'), (2, 'Southeast', 'USA'), (3, 'Midwest', 'USA'),
  (4, 'West', 'USA'), (5, 'Ontario', 'Canada'), (6, 'British Columbia', 'Canada');

insert into sales.stores
select s,
       (array['Harbor','Summit','Riverside','Maple','Cedar','Lakeside','Union','Pioneer','Granite','Willow'])[1 + (s % 10)]
         || ' ' || (array['Plaza','Center','Market','Commons'])[1 + (s % 4)],
       1 + (s % 6),
       (array['FLAGSHIP','MALL','MALL','OUTLET','ONLINE_HUB'])[1 + (s % 5)],
       date '2015-01-01' + (s * 137 % 3000)
from generate_series(1, 20) s;

insert into sales.customers
select c,
       (array['Ava','Liam','Mia','Noah','Zoe','Ethan','Isla','Lucas','Aria','Mason','Leah','Owen'])[1 + floor(random()*12)::int],
       (array['Patel','Nguyen','Smith','Garcia','Kim','Brown','Singh','Martin','Lopez','Chen','Wilson','Khan'])[1 + floor(random()*12)::int],
       'customer' || c || '@example.com',
       (array['CONSUMER','CONSUMER','CONSUMER','SMALL_BUSINESS','ENTERPRISE'])[1 + floor(random()*5)::int],
       1 + floor(random()*6)::int,
       date '2021-01-01' + floor(random()*1400)::int
from generate_series(1, 500) c;

insert into sales.product_categories values
  (1, 'Laptops', 'Electronics'), (2, 'Phones', 'Electronics'), (3, 'Audio', 'Electronics'),
  (4, 'Furniture', 'Home'), (5, 'Kitchen', 'Home'), (6, 'Bedding', 'Home'),
  (7, 'Running', 'Sports'), (8, 'Camping', 'Sports');

insert into sales.products
select p,
       'SKU-' || lpad(p::text, 5, '0'),
       (array['Pro','Lite','Max','Classic','Eco','Ultra'])[1 + (p % 6)] || ' ' ||
       (array['Notebook','Smartphone','Headphones','Desk Chair','Blender','Duvet','Trail Shoe','Tent'])[1 + ((p - 1) % 8)] || ' ' || p,
       1 + ((p - 1) % 8),
       round((20 + random() * 1480)::numeric, 2),
       0
from generate_series(1, 60) p;
update sales.products set unit_cost = round(unit_price * (0.45 + random() * 0.3)::numeric, 2);

insert into sales.orders
select o,
       1 + floor(random()*500)::int,
       1 + floor(random()*20)::int,
       date '2024-01-01' + floor(random()*730)::int,
       (array['STORE','STORE','WEB','MOBILE'])[1 + floor(random()*4)::int],
       (array['DELIVERED','DELIVERED','DELIVERED','DELIVERED','SHIPPED','RETURNED','CANCELLED'])[1 + floor(random()*7)::int]
from generate_series(1, 5000) o;

-- 1-4 lines per order. random() sits in the CTE's select list so it is evaluated per line.
with lines as (
  select o.order_id,
         l as line_number,
         1 + floor(random()*60)::int as product_id,
         1 + floor(random()*3)::int as quantity,
         (array[0,0,0,5,10,15])[1 + floor(random()*6)::int]::numeric as discount_pct
  from sales.orders o
  cross join generate_series(1, 4) l
  where l <= 1 + abs(hashint4(o.order_id)) % 4
)
insert into sales.order_items
select li.order_id, li.line_number, p.product_id, li.quantity, p.unit_price, li.discount_pct
from lines li
join sales.products p on p.product_id = li.product_id;

analyze;
