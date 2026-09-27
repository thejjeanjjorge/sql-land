import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('./ruleMatcher.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: 'ruleMatcher.ts',
});
const { findRelatedRule } = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
);

// Rules as written in level 1 (earlier level) and level 2 (current level).
const level1 = [
  { title: 'Ask for columns', body: 'SELECT names the columns you want. FROM names the table they come from.', example: 'SELECT name, price FROM products;' },
  { title: 'Use * to explore', body: 'An asterisk returns every column. It is handy when you first inspect a table.', example: 'SELECT * FROM customers;' },
  { title: 'Build one clause at a time', body: 'Start with SELECT, add FROM, then end the statement with a semicolon.', example: 'SELECT id, status FROM orders;' },
];
const level5 = [
  { title: 'Keep unique values', body: 'DISTINCT removes repeated result rows.', example: 'SELECT DISTINCT city FROM customers;' },
  { title: 'Calculate as you read', body: 'Expressions can turn stored values into new columns. Give each calculation a clear name.', example: 'SELECT quantity * 2 AS double_quantity FROM order_items;' },
];
const level2 = [
  { title: 'Filter with WHERE', body: 'WHERE keeps only rows that meet a condition. Text values go in single quotes.', example: "SELECT name FROM customers WHERE city = 'Boston';" },
  { title: 'Combine conditions', body: 'AND requires both conditions to be true. Comparisons such as >= work with numbers and dates.', example: "SELECT id FROM orders WHERE status = 'shipped' AND order_date >= '2026-01-10';" },
  { title: 'Sort with ORDER BY', body: 'ASC sorts low to high; DESC sorts high to low. ORDER BY comes after WHERE.', example: 'SELECT name, price FROM products ORDER BY price DESC;' },
];
const level3 = [
  { title: 'Count and add', body: 'COUNT(*) counts rows. SUM adds the values in a numeric column.', example: 'SELECT COUNT(*) AS order_count FROM orders;' },
  { title: 'Make groups', body: 'GROUP BY creates one result per distinct group. Select the grouped column alongside the total.', example: 'SELECT status, COUNT(*) AS order_count FROM orders GROUP BY status;' },
  { title: 'Filter groups with HAVING', body: 'WHERE filters individual rows; HAVING filters finished groups.', example: 'SELECT customer_id FROM orders GROUP BY customer_id HAVING COUNT(*) > 1;' },
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

test('no candidates or no reference means no rule', () => {
  assert.equal(findRelatedRule([], 'SELECT 1', 'SELECT 1'), null);
  assert.equal(findRelatedRule(level2Candidates, 'SELECT 1', ''), null);
});
