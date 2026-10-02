import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('./ruleMatcher.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: 'ruleMatcher.ts',
});
const { findRelatedRule, conceptsTaughtBy, conceptsUsedBy } = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
);

// Rules as written in level 1 (earlier level) and level 2 (current level).
const level1 = [
  { title: 'Ask for columns', body: 'SELECT names the columns you want, separated by commas. FROM names the table they come from.', example: 'SELECT name, price FROM products;' },
  { title: 'Use * to explore', body: 'An asterisk returns every column. It is handy when you first inspect a table.', example: 'SELECT * FROM customers;' },
  { title: 'Build one clause at a time', body: 'Start with SELECT, add FROM, then end the statement with a semicolon. Later you will add WHERE after FROM to keep only the rows you want.', example: 'SELECT id, status FROM orders WHERE id = 1;' },
];
const level5 = [
  { title: 'Keep unique values', body: 'DISTINCT removes repeated result rows. COUNT(DISTINCT column) counts each value once.', example: 'SELECT DISTINCT city FROM customers;' },
  { title: 'Calculate as you read', body: 'Expressions can turn stored values into new columns. Give each calculation a clear name with AS.', example: 'SELECT quantity * 2 AS double_quantity FROM order_items;' },
  { title: 'Choose the right size', body: 'LIMIT keeps the first few sorted rows. ROUND controls decimal places. A cast changes a value’s type: x::numeric or CAST(x AS numeric). Dividing two integers drops the fraction (7 / 2 is 3), so cast one side or use a decimal such as 7.0.', example: 'SELECT name, ROUND(price * 0.9, 2) FROM products ORDER BY price DESC LIMIT 3;\nSELECT quantity / 2 AS whole, quantity::numeric / 2 AS exact FROM order_items;' },
];
const level2 = [
  { title: 'Filter with WHERE', body: 'WHERE keeps only rows that meet a condition. Text values go in single quotes.', example: "SELECT name FROM customers WHERE city = 'Boston';" },
  { title: 'Combine conditions', body: 'AND requires both conditions to be true. Comparisons work with numbers and dates: <, <=, >, >= and <> (not equal).', example: "SELECT id FROM orders WHERE status = 'shipped' AND order_date >= '2026-01-10';" },
  { title: 'Sort with ORDER BY', body: 'ASC sorts low to high; DESC sorts high to low. Add more columns after commas to break ties. ORDER BY comes after WHERE.', example: 'SELECT name, price FROM products ORDER BY price DESC, name ASC;' },
];
const level3 = [
  { title: 'Summarize many rows', body: 'COUNT(*) counts rows; COUNT(column) counts rows where that column has a value. SUM adds a numeric column and AVG averages it. MIN and MAX find the smallest and largest value. Use AS to name each result.', example: 'SELECT COUNT(*) AS payment_count,\n       SUM(amount) AS total_paid,\n       AVG(amount) AS avg_paid,\n       MIN(amount) AS smallest,\n       MAX(amount) AS largest\nFROM payments;' },
  { title: 'Make groups', body: 'Without GROUP BY, an aggregate summarizes the whole table into one row. GROUP BY creates one result per distinct group. Any plain column you select beside an aggregate belongs in GROUP BY. Different rows can share a name, so include the unique ID when each one needs its own result.', example: 'SELECT status, COUNT(*) AS order_count FROM orders GROUP BY status;' },
  { title: 'Filter groups with HAVING', body: 'WHERE filters individual rows; HAVING filters finished groups.', example: 'SELECT customer_id FROM orders GROUP BY customer_id HAVING COUNT(*) > 1;' },
];
const level4 = [
  { title: 'Match related keys', body: 'JOIN connects rows from two tables. ON states the match: a foreign key equals its matching primary key.', example: 'SELECT o.id, c.name FROM orders AS o JOIN customers AS c ON o.customer_id = c.id;' },
  { title: 'Keep using earlier skills', body: 'A joined result can still use WHERE, GROUP BY, and ORDER BY.', example: "SELECT c.name FROM orders AS o JOIN customers AS c ON o.customer_id = c.id WHERE o.status = 'shipped';" },
];
const level7 = [
  { title: 'Count carefully', body: 'COUNT(*) counts rows; COUNT(column) skips NULLs. This matters most after joins.', example: 'SELECT COUNT(*) AS all_rows, COUNT(rating) AS rated FROM reviews;' },
  { title: 'Keep rows with no match', body: 'LEFT JOIN keeps every row from the left table, even when nothing matches on the right. Those right-side columns are NULL, so COUNT(column) counts zero for them and IS NULL finds them. Level 9 goes deeper.', example: 'SELECT p.name, COUNT(r.id) AS review_count FROM products p LEFT JOIN reviews r ON r.product_id = p.id GROUP BY p.id, p.name;' },
];
const level9 = [
  { title: 'Keep the left side', body: 'LEFT JOIN retains rows even when there is no match on the right. Put a condition on the right table in ON; in WHERE it removes the unmatched rows again.', example: "SELECT c.id, o.id\nFROM customers c\nLEFT JOIN orders o ON o.customer_id = c.id AND o.status = 'shipped';" },
  { title: 'Avoid multiplying amounts', body: 'Two one-to-many joins can multiply each other. Summarize each child table first: put that summary in parentheses (a subquery), give it an alias, and join to it like a table.', example: 'SELECT order_id, units FROM (SELECT order_id, SUM(quantity) AS units FROM order_items GROUP BY order_id) AS i;' },
];
const level12 = [
  { title: 'Choose a period', body: 'date_trunc groups timestamps or dates into a month, week, or day. It returns a timestamp; add ::date to show just the date.', example: "SELECT date_trunc('month', order_date)::date AS month FROM orders;" },
  { title: 'Read a date part', body: 'EXTRACT gets the year, month, or another part of a date.', example: 'SELECT EXTRACT(YEAR FROM order_date) FROM orders;' },
  { title: 'Count the days between dates', body: 'Subtracting one date from another gives the number of days between them. Cast a timestamp to a date first with ::date.', example: "SELECT id, paid_at::date - DATE '2026-01-01' AS days_in FROM payments;" },
];
const level15 = [
  { title: 'Combine sets', body: 'UNION removes duplicates across matching result shapes; UNION ALL retains them.', example: 'SELECT city AS label FROM customers UNION SELECT category FROM products;' },
  { title: 'Find overlap or difference', body: 'INTERSECT keeps shared rows. EXCEPT keeps rows from the first set that are absent from the second.', example: 'SELECT product_id FROM reviews INTERSECT SELECT product_id FROM order_items;\nSELECT id FROM customers EXCEPT SELECT customer_id FROM orders;' },
];

const candidates = (earlier, current) => [
  ...earlier.map((rule) => ({ rule, levelNumber: 1, isCurrentLevel: false })),
  ...current.map((rule) => ({ rule, levelNumber: 2, isCurrentLevel: true })),
];
const level2Candidates = candidates(level1, level2);
const titleFor = (learner, reference, list = level2Candidates) => findRelatedRule(list, learner, reference)?.rule.title;

test('wrong sort direction points to the ORDER BY rule', () => {
  assert.equal(titleFor(
    'SELECT name, price FROM products ORDER BY price DESC, name ASC;',
    'SELECT name, price FROM products ORDER BY price ASC, name ASC;',
  ), 'Sort with ORDER BY');
});

test('a missing ORDER BY points to the ORDER BY rule', () => {
  assert.equal(titleFor(
    "SELECT id, order_date FROM orders WHERE status = 'shipped' AND order_date >= '2026-01-10';",
    "SELECT id, order_date FROM orders WHERE status = 'shipped' AND order_date >= '2026-01-10' ORDER BY order_date ASC;",
  ), 'Sort with ORDER BY');
});

test('OR instead of AND points to the rule about combining conditions', () => {
  assert.equal(titleFor(
    "SELECT name FROM products WHERE category = 'Stationery' OR price < 10;",
    "SELECT name FROM products WHERE category = 'Stationery' AND price < 10;",
  ), 'Combine conditions');
});

test('a wrong filter value points to the plainest matching rule', () => {
  assert.equal(titleFor(
    "SELECT name FROM customers WHERE city = 'Austin';",
    "SELECT name FROM customers WHERE city = 'Boston';",
  ), 'Filter with WHERE');
});

test('an empty exploration query still finds the rule the answer needs', () => {
  assert.equal(titleFor('', 'SELECT status FROM orders WHERE id = 7;'), 'Filter with WHERE');
});

test('keywords inside quoted values and BETWEEN ranges are ignored', () => {
  assert.equal(titleFor(
    "SELECT name FROM products WHERE name = 'ORDER BY';",
    "SELECT name FROM products WHERE price BETWEEN 5 AND 10;",
  ), 'Filter with WHERE');
});

test('a missing HAVING in a later level points to the HAVING rule', () => {
  const list = candidates(level2, level3);
  assert.equal(titleFor(
    'SELECT customer_id, COUNT(*) AS order_count FROM orders GROUP BY customer_id;',
    'SELECT customer_id, COUNT(*) AS order_count FROM orders GROUP BY customer_id HAVING COUNT(*) > 1;',
    list,
  ), 'Filter groups with HAVING');
});

test('a wrong aggregate points to the rule that names it', () => {
  const list = candidates(level2, level3);
  assert.equal(titleFor(
    'SELECT MAX(price) AS cheapest_price FROM products;',
    'SELECT MIN(price) AS cheapest_price FROM products;',
    list,
  ), 'Summarize many rows');
  assert.equal(titleFor(
    'SELECT SUM(price) AS avg_price FROM products;',
    'SELECT AVG(price) AS avg_price FROM products;',
    list,
  ), 'Summarize many rows');
});

test('a concept only taught earlier falls back to the earlier level', () => {
  const list = candidates(level2, level3);
  const match = findRelatedRule(
    list,
    'SELECT status, COUNT(*) AS order_count FROM orders GROUP BY status;',
    'SELECT status, COUNT(*) AS order_count FROM orders GROUP BY status ORDER BY order_count DESC;',
  );
  assert.equal(match?.rule.title, 'Sort with ORDER BY');
  assert.equal(match?.isCurrentLevel, false);
});

test('plain column questions in level 1 point to the column rule', () => {
  const list = candidates([], level1);
  assert.equal(titleFor('SELECT id FROM customers;', 'SELECT id, name FROM customers;', list), 'Ask for columns');
  assert.equal(titleFor('SELECT name FROM customers;', 'SELECT * FROM customers;', list), 'Use * to explore');
});

test('a calculation points to the expression rule, not SELECT *', () => {
  const list = candidates(level1, level5);
  assert.equal(titleFor(
    'SELECT id, quantity FROM order_items;',
    'SELECT id, quantity * 2 AS doubled_quantity FROM order_items;',
    list,
  ), 'Calculate as you read');
});

test('a rule teaches the functions its text or example names', () => {
  const [summarize, groups] = level3;
  for (const concept of ['countStar', 'countColumn', 'sum', 'avg', 'min', 'max']) {
    assert.ok(conceptsTaughtBy(summarize).has(concept), `${concept} should be taught`);
  }
  assert.ok(!conceptsTaughtBy(groups).has('avg'));
  // The old wording named SUM but never AVG, MIN or MAX.
  const oldRule = { title: 'Count and add', body: 'COUNT(*) counts rows. SUM adds the values in a numeric column.', example: 'SELECT COUNT(*) AS order_count FROM orders;' };
  assert.ok(conceptsTaughtBy(oldRule).has('sum'));
  assert.ok(!conceptsTaughtBy(oldRule).has('avg'));
});

test('a query needs every function and clause it uses, but not SELECT itself', () => {
  const used = conceptsUsedBy("SELECT category, AVG(price) FROM products WHERE name <> 'MAX(x)' GROUP BY category;");
  assert.deepEqual([...used].sort(), ['avg', 'groupBy', 'ne', 'where']);
});

test('comparison operators are taught by the level 2 rule that lists them', () => {
  const taught = conceptsTaughtBy(level2[1]);
  for (const concept of ['lt', 'lte', 'gt', 'gte', 'ne']) assert.ok(taught.has(concept), `${concept} should be taught`);
});

test('a wrong sort direction in a later lesson goes back to the card that names ASC and DESC', () => {
  // The level 4 card mentions ORDER BY, so it shares a family with the mistake without naming it.
  assert.equal(titleFor(
    'SELECT c.name FROM orders o JOIN customers c ON o.customer_id = c.id ORDER BY o.order_date DESC;',
    'SELECT c.name FROM orders o JOIN customers c ON o.customer_id = c.id ORDER BY o.order_date ASC;',
    candidates(level2, level4),
  ), 'Sort with ORDER BY');
});

test('COUNT(*) written for COUNT(column) goes back to the card that names COUNT(column)', () => {
  const list = candidates([...level3, ...level7], level9);
  const match = findRelatedRule(
    list,
    'SELECT c.id, COUNT(*) AS order_count FROM customers c LEFT JOIN orders o ON o.customer_id = c.id GROUP BY c.id;',
    'SELECT c.id, COUNT(o.id) AS order_count FROM customers c LEFT JOIN orders o ON o.customer_id = c.id GROUP BY c.id;',
  );
  // The level 9 card talks about SUM and GROUP BY, so it would win on family alone.
  assert.equal(match?.isCurrentLevel, false);
  assert.match(match?.rule.body ?? '', /COUNT\(column\)/);
});

test('a current-level card that names the mistake still beats an earlier one', () => {
  assert.equal(titleFor(
    "SELECT c.id, COUNT(o.id) FROM customers c LEFT JOIN orders o ON o.customer_id = c.id WHERE o.status = 'shipped' GROUP BY c.id;",
    "SELECT c.id, COUNT(o.id) FROM customers c LEFT JOIN orders o ON o.customer_id = c.id AND o.status = 'shipped' GROUP BY c.id;",
    candidates([...level2, ...level3, ...level7], level9),
  ), 'Keep the left side');
});

test('cards in one family: the one that names the function at issue wins', () => {
  const list = candidates([], level12);
  assert.equal(titleFor('', 'SELECT id, EXTRACT(YEAR FROM order_date) AS order_year FROM orders;', list), 'Read a date part');
  assert.equal(titleFor('', "SELECT date_trunc('month', order_date)::date AS month, COUNT(*) FROM orders GROUP BY 1;", list), 'Choose a period');
  assert.equal(titleFor('', "SELECT DATE '2026-03-01' - DATE '2026-02-28';", list), 'Count the days between dates');
  const sets = candidates([], level15);
  assert.equal(titleFor('', 'SELECT id FROM customers INTERSECT SELECT customer_id FROM orders;', sets), 'Find overlap or difference');
  assert.equal(titleFor('', 'SELECT city FROM customers UNION SELECT category FROM products;', sets), 'Combine sets');
});

test('dividing by a count points to the cast and division rule', () => {
  assert.equal(titleFor(
    'SELECT 7 / 2 AS ratio;',
    'SELECT 7::numeric / 2 AS ratio;',
    candidates(level2, level5),
  ), 'Choose the right size');
});

test('no candidates or no reference means no rule', () => {
  assert.equal(findRelatedRule([], 'SELECT 1', 'SELECT 1'), null);
  assert.equal(findRelatedRule(level2Candidates, 'SELECT 1', ''), null);
});
