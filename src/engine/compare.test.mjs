import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import { PGlite } from '@electric-sql/pglite';

const source = await readFile(new URL('./compare.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: 'compare.ts',
});
const { compareResults, scalarAnswerEqual } = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
);

const constraintSource = await readFile(new URL('./sqlConstraints.ts', import.meta.url), 'utf8');
const constraintModule = ts.transpileModule(constraintSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: 'sqlConstraints.ts',
});
const { constraintError } = await import(
  `data:text/javascript;base64,${Buffer.from(constraintModule.outputText).toString('base64')}`
);

const fixtureSource = await readFile(new URL('../content/fixtures.ts', import.meta.url), 'utf8');
const fixtureModule = ts.transpileModule(fixtureSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: 'fixtures.ts',
});
const { CHALLENGE_SEED_SQL } = await import(
  `data:text/javascript;base64,${Buffer.from(fixtureModule.outputText).toString('base64')}`
);

function result(columns, rows) {
  return { columns, rows };
}

test('single-value answers trim text, ignore case, and compare numeric values', () => {
  assert.equal(scalarAnswerEqual(' PENDING ', 'pending'), true);
  assert.equal(scalarAnswerEqual('8.0000001', '8.00'), true);
  assert.equal(scalarAnswerEqual('9', '8.00'), false);
});

test('SQL constraints ignore comments and quoted values', () => {
  const join = [{ pattern: '\\bJOIN\\b', label: 'a JOIN' }];
  assert.equal(constraintError("SELECT 'JOIN' AS hint FROM orders -- JOIN", join),
    'This challenge requires: a JOIN.');
  assert.equal(constraintError('SELECT * FROM orders JOIN customers ON true', join), null);
  assert.equal(constraintError("SELECT 'JOIN' FROM orders", [], join), null);
  assert.equal(constraintError('SELECT * FROM orders JOIN customers ON true', [], join),
    'This challenge does not allow: a JOIN.');
});

test('column aliases are checked case insensitively unless the question opts out', () => {
  const expected = result(['order_count'], [[5]]);
  assert.equal(
    compareResults(result(['count'], [[5]]), expected),
    'Rename column `count` to `order_count`.',
  );
  assert.equal(compareResults(result(['ORDER_COUNT'], [[5]]), expected), undefined);
  assert.equal(compareResults(result(['count'], [[5]]), expected, { checkColumnNames: false }), undefined);
});

test('columns in the wrong order get a specific message', () => {
  assert.equal(
    compareResults(result(['price', 'name'], [[12, 'Tea']]), result(['name', 'price'], [['Tea', 12]])),
    'Your columns are in a different order: expected name, price.',
  );
});

test('numeric strings and numbers compare with a small tolerance', () => {
  const expected = result(['average'], [[17.5625]]);
  assert.equal(compareResults(result(['average'], [['17.5625000000000000']]), expected), undefined);
  assert.equal(compareResults(result(['average'], [[17.5625005]]), expected), undefined);
  assert.equal(
    compareResults(result(['average'], [['17.57']]), expected),
    'Some values differ from the expected result.',
  );
});

test('PostgreSQL ROUND and COUNT cast results compare with equivalent references', async () => {
  const db = await PGlite.create();
  try {
    await db.exec(`
      CREATE TABLE products (price NUMERIC);
      INSERT INTO products VALUES (10.101), (12.202);
      CREATE TABLE orders (id INTEGER);
      INSERT INTO orders VALUES (1), (2);
    `);
    async function query(sql) {
      const output = await db.query(sql, [], { rowMode: 'array' });
      return result(output.fields.map((field) => field.name), output.rows);
    }
    const rounded = await query('SELECT ROUND(AVG(price), 2) AS average_price FROM products');
    const roundedNumber = await query('SELECT ROUND(AVG(price), 2)::float8 AS average_price FROM products');
    assert.equal(compareResults(rounded, roundedNumber), undefined);

    const count = await query('SELECT COUNT(*) AS product_count FROM products');
    const countInt = await query('SELECT COUNT(*)::int AS product_count FROM products');
    assert.equal(compareResults(countInt, count), undefined);

    const expectedOrders = await query('SELECT COUNT(*) AS order_count FROM orders');
    const missingAlias = await query('SELECT COUNT(*) FROM orders');
    assert.equal(
      compareResults(missingAlias, expectedOrders),
      'Rename column `count` to `order_count`.',
    );
    assert.equal(compareResults(expectedOrders, expectedOrders), undefined);
  } finally {
    await db.close();
  }
});

test('duplicate rows get DISTINCT feedback when the reference has no duplicates', () => {
  assert.equal(
    compareResults(result(['id'], [[1], [1]]), result(['id'], [[1], [2]])),
    'You have duplicate rows. Do you need DISTINCT?',
  );
});

test('missing and extra rows get separate counts', () => {
  const expected = result(['id'], [[1], [2], [3]]);
  assert.equal(compareResults(result(['id'], [[1]]), expected), 'You are missing 2 rows.');
  assert.equal(
    compareResults(result(['id'], [[1], [2], [3], [4]]), expected),
    'You returned 1 extra row.',
  );
});

test('row order matters only when requested', () => {
  const expected = result(['id'], [[1], [2], [3]]);
  const reversed = result(['id'], [[3], [2], [1]]);
  assert.equal(compareResults(reversed, expected), undefined);
  assert.equal(compareResults(reversed, expected, { orderMatters: true }), 'Right rows, wrong order.');
});

test('recent shipped orders without ORDER BY fail on the shuffled fixture', async () => {
  const db = await PGlite.create();
  try {
    await db.exec(CHALLENGE_SEED_SQL);
    async function query(sql) {
      const output = await db.query(sql, [], { rowMode: 'array' });
      return result(output.fields.map((field) => field.name), output.rows);
    }
    const unsorted = await query(
      "SELECT id, order_date FROM orders WHERE status='shipped' AND order_date >= '2026-01-10'",
    );
    const expected = await query(
      "SELECT id, order_date FROM orders WHERE status = 'shipped' AND order_date >= '2026-01-10' ORDER BY order_date ASC;",
    );
    assert.equal(compareResults(unsorted, expected, { orderMatters: true }), 'Right rows, wrong order.');
  } finally {
    await db.close();
  }
});
