/**
 * Each fixture is a complete, independent PostgreSQL script. Run one fixture
 * against a fresh database before grading an answer.
 */
export const BASE_SEED_SQL = `
CREATE TABLE customers (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  city TEXT NOT NULL,
  email TEXT NULL,
  signup_date DATE NOT NULL DEFAULT DATE '2025-01-01',
  referred_by INTEGER NULL REFERENCES customers(id)
);

CREATE TABLE categories (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  parent_id INTEGER NULL REFERENCES categories(id)
);

CREATE TABLE products (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  price NUMERIC(10, 2) NOT NULL,
  category_id INTEGER NOT NULL DEFAULT 1 REFERENCES categories(id)
);

CREATE TABLE orders (
  id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  order_date DATE NOT NULL,
  status TEXT NOT NULL,
  shipped_at TIMESTAMP NULL,
  discount_code TEXT NULL
);

CREATE TABLE order_items (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  quantity INTEGER NOT NULL
);

CREATE TABLE payments (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  amount NUMERIC(10, 2) NOT NULL,
  paid_at TIMESTAMP NOT NULL,
  method TEXT NOT NULL
);

CREATE TABLE reviews (
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id),
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  rating INTEGER NULL,
  created_at TIMESTAMP NOT NULL
);

INSERT INTO categories (id, name, parent_id) VALUES
  (1, 'Shop', NULL),
  (2, 'Office', 1),
  (3, 'Stationery', 2),
  (4, 'Home', 1),
  (5, 'Gear', 1);

INSERT INTO customers (id, name, city) VALUES
  (1, 'Ava Chen', 'Boston'),
  (2, 'Ben Ortiz', 'Austin'),
  (3, 'Cara Singh', 'Boston'),
  (4, 'Diego Ruiz', 'Seattle'),
  (5, 'Elif Park', 'Denver'),
  (6, 'Finn Moore', 'Austin');

INSERT INTO products (id, name, category, price) VALUES
  (1, 'Notebook', 'Stationery', 8.00),
  (2, 'Pen', 'Stationery', 2.00),
  (3, 'Mug', 'Home', 9.00),
  (4, 'Lamp', 'Home', 35.00),
  (5, 'Backpack', 'Gear', 45.00),
  (6, 'Bottle', 'Gear', 18.00),
  (7, 'Sticker', 'Stationery', 1.50),
  (8, 'Tote', 'Gear', 22.00);

INSERT INTO orders (id, customer_id, order_date, status) VALUES
  (4, 3, '2026-01-12', 'shipped'),
  (1, 1, '2026-01-04', 'shipped'),
  (6, 5, '2026-01-20', 'shipped'),
  (2, 2, '2026-01-06', 'pending'),
  (5, 4, '2026-01-17', 'cancelled'),
  (3, 1, '2026-01-11', 'shipped'),
  (7, 6, '2026-01-23', 'pending');

INSERT INTO order_items (id, order_id, product_id, quantity) VALUES
  (1, 1, 1, 2),
  (2, 1, 2, 3),
  (3, 2, 3, 1),
  (4, 2, 4, 1),
  (5, 3, 5, 1),
  (6, 3, 7, 4),
  (7, 4, 6, 2),
  (8, 4, 2, 5),
  (9, 5, 4, 1),
  (10, 6, 8, 2),
  (11, 6, 3, 1),
  (12, 7, 1, 1);

UPDATE customers SET
  email = lower(replace(name, ' ', '.')) || '@example.test',
  signup_date = DATE '2025-03-01' + (id * 12),
  referred_by = CASE WHEN id IN (2, 3) THEN 1 WHEN id = 5 THEN 2 ELSE NULL END;
UPDATE customers SET email = NULL WHERE id = 6;
UPDATE products SET category_id = CASE category
  WHEN 'Stationery' THEN 3 WHEN 'Home' THEN 4 ELSE 5 END;
UPDATE orders SET shipped_at = order_date::timestamp + INTERVAL '2 days'
  WHERE status = 'shipped';
UPDATE orders SET shipped_at = '2026-01-31 15:00:00' WHERE id = 6;
UPDATE orders SET discount_code = 'WELCOME10' WHERE id = 1;

-- Same-name buyers, a customer with no orders, unsold stock, price ties,
-- and dates well beyond the first January sample make joins meaningful.
INSERT INTO customers (id, name, city, email, signup_date, referred_by) VALUES
  (9, 'Ava Chen', 'Boston', 'ava.second@example.test', '2024-07-15', 1),
  (10, 'Iris Vale', 'Miami', NULL, '2025-11-10', NULL);
INSERT INTO products (id, name, category, price, category_id) VALUES
  (11, 'Calendar', 'Home', 8.00, 4),
  (12, 'Shelf', 'Home', 12.00, 4);
INSERT INTO orders (id, customer_id, order_date, status, shipped_at, discount_code) VALUES
  (13, 9, '2026-03-02', 'shipped', '2026-03-04 12:00:00', NULL),
  (11, 9, '2024-08-01', 'shipped', '2024-08-03 10:00:00', NULL),
  (12, 1, '2025-04-15', 'cancelled', NULL, 'SPRING5');
INSERT INTO order_items (id, order_id, product_id, quantity) VALUES
  (20, 11, 1, 2), (21, 12, 4, 1), (22, 13, 2, 2);
INSERT INTO payments (id, order_id, amount, paid_at, method) VALUES
  (1, 1, 10.00, '2026-01-04 09:00:00', 'card'),
  (2, 1, 12.00, '2026-01-05 09:00:00', 'gift card'),
  (3, 3, 20.00, '2026-01-11 10:00:00', 'card'),
  (4, 12, 5.00, '2025-04-15 14:00:00', 'card'),
  (5, 13, 4.00, '2026-03-02 13:00:00', 'cash');
INSERT INTO reviews (id, product_id, customer_id, rating, created_at) VALUES
  (1, 1, 1, 5, '2026-01-09 08:00:00'),
  (2, 3, 2, NULL, '2026-01-10 09:00:00'),
  (3, 11, 9, 4, '2026-03-05 12:00:00');
`;

/** Adds rows that catch answers hard-coded to the first sample. */
export const CHALLENGE_SEED_SQL = `${BASE_SEED_SQL}
INSERT INTO customers (id, name, city) VALUES
  (7, 'Gina Wells', 'Boston'),
  (8, 'Hugo Kim', 'Portland');

INSERT INTO products (id, name, category, price) VALUES
  (9, 'Desk Mat', 'Home', 20.00),
  (10, 'Pencil Case', 'Stationery', 11.00);
UPDATE products SET category_id = CASE category
  WHEN 'Stationery' THEN 3 WHEN 'Home' THEN 4 ELSE 5 END WHERE id IN (9, 10);

INSERT INTO orders (id, customer_id, order_date, status) VALUES
  (10, 2, '2026-02-09', 'shipped'),
  (8, 3, '2026-02-02', 'pending'),
  (9, 7, '2026-02-05', 'shipped');

INSERT INTO order_items (id, order_id, product_id, quantity) VALUES
  (13, 8, 9, 3),
  (14, 8, 2, 1),
  (15, 9, 10, 2),
  (16, 9, 6, 1),
  (17, 10, 5, 2);

UPDATE customers SET email = 'gina@example.test', signup_date = '2025-09-01', referred_by = 3 WHERE id = 7;
UPDATE customers SET signup_date = '2025-10-01' WHERE id = 8;
UPDATE orders SET shipped_at = order_date::timestamp + INTERVAL '2 days' WHERE id IN (9, 10);
INSERT INTO payments (id, order_id, amount, paid_at, method) VALUES
  (6, 9, 15.00, '2026-02-05 11:00:00', 'card'),
  (7, 10, 45.00, '2026-02-09 10:00:00', 'card');
INSERT INTO reviews (id, product_id, customer_id, rating, created_at) VALUES
  (4, 9, 7, 3, '2026-02-08 12:00:00');

-- Boundary rows: each sits exactly on a threshold used by a question, so < and <=
-- (or > and >=) give different results and an off-by-one comparison is marked wrong.
--   prices 10.00 and 30.00: price < 10, price >= 10, price < 30
--   Planner at 17.00 with Lunch Box at 23.50 makes AVG(price) exactly 17.00
--   orders on 2026-01-01, 2026-01-10 and 2026-04-01; shipments at midnight on
--   2026-01-01 and 2026-02-01: date ranges and "include the last day" questions
--   a single 'returned' order: HAVING COUNT(*) > 1 per status
--   18 orders over 9 customers averages exactly 2 orders per customer, and
--   54 units over 18 orders averages exactly 3 units per order
INSERT INTO customers (id, name, city, email, signup_date, referred_by) VALUES
  (11, 'Jude Park', 'Denver', 'jude@example.test', '2025-12-01', NULL);
INSERT INTO products (id, name, category, price, category_id) VALUES
  (13, 'Coaster Set', 'Home', 10.00, 4),
  (14, 'Camp Stove', 'Gear', 30.00, 5),
  (15, 'Planner', 'Stationery', 17.00, 3),
  (16, 'Lunch Box', 'Home', 23.50, 4);
INSERT INTO orders (id, customer_id, order_date, status, shipped_at, discount_code) VALUES
  (16, 5, '2026-01-30', 'shipped', '2026-02-01 00:00:00', NULL),
  (14, 6, '2026-01-10', 'shipped', '2026-01-12 10:00:00', NULL),
  (18, 11, '2026-02-20', 'returned', '2026-02-22 09:00:00', NULL),
  (15, 3, '2026-01-01', 'shipped', '2026-01-01 00:00:00', NULL),
  (17, 4, '2026-04-01', 'pending', NULL, NULL);
INSERT INTO order_items (id, order_id, product_id, quantity) VALUES
  (30, 14, 13, 3),
  (31, 15, 15, 2), (32, 15, 2, 1),
  (33, 16, 14, 1), (34, 16, 6, 2),
  (35, 17, 16, 4),
  (36, 18, 8, 3);
`;



/**
 * Generates a session variation script from a numeric session seed.
 * Adds session rows so result tables vary between sessions while keeping
 * existing questions valid and graded against the hidden challenge fixture.
 */
export function generateSessionVariationSql(seed: number): string {
  const safe = Math.abs(Math.floor(seed)) || 1;
  const daysOffset = (safe % 15) + 1;
  const orderId = 400 + (safe % 80);
  return `
-- Session variation (seed ${safe})
INSERT INTO orders (id, customer_id, order_date, status, shipped_at, discount_code) VALUES
  (${orderId}, 2, DATE '2026-02-15' + ${daysOffset}, 'shipped', ('2026-02-15'::date + ${daysOffset + 2})::timestamp, 'SES${safe % 99}');
INSERT INTO order_items (id, order_id, product_id, quantity) VALUES
  (${orderId}, ${orderId}, 4, 1);
INSERT INTO payments (id, order_id, amount, paid_at, method) VALUES
  (${orderId}, ${orderId}, 35.00, ('2026-02-15'::date + ${daysOffset})::timestamp + INTERVAL '1 hour', 'card');
`;
}

