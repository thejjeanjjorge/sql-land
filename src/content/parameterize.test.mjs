import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('./parameterize.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: 'parameterize.ts',
});
const {
  resolveTemplate,
  cartesianCombinations,
  pickRandomParamValues,
  instantiateExercise,
  instantiateIfParameterized,
} = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
);

test('resolveTemplate substitutes curly brace placeholders', () => {
  const result = resolveTemplate('SELECT * FROM products WHERE category = \'{category}\' AND price < {max};', {
    category: 'Stationery',
    max: 15,
  });
  assert.equal(result, "SELECT * FROM products WHERE category = 'Stationery' AND price < 15;");
});

test('cartesianCombinations computes all combinations', () => {
  const combos = cartesianCombinations({
    category: ['Stationery', 'Home'],
    max: [10, 20, 30],
  });
  assert.equal(combos.length, 6);
  assert.deepEqual(combos[0], { category: 'Stationery', max: 10 });
  assert.deepEqual(combos[5], { category: 'Home', max: 30 });
});

test('pickRandomParamValues picks values deterministically when seed is provided', () => {
  const params = {
    category: { pick: ['Stationery', 'Home', 'Gear'] },
    max: { pick: [10, 15, 20] },
  };
  const pickA = pickRandomParamValues(params, 42);
  const pickB = pickRandomParamValues(params, 42);
  assert.deepEqual(pickA, pickB);
  assert.ok(['Stationery', 'Home', 'Gear'].includes(pickA.category));
  assert.ok([10, 15, 20].includes(pickA.max));
});

test('instantiateExercise resolves all fields in exercise', () => {
  const exercise = {
    id: 'test-p1',
    kind: 'write',
    skill: 'filter',
    title: 'Products in {category} under ${max}',
    prompt: 'Show name and price of {category} products costing less than ${max}.',
    hint: 'Filter by category = \'{category}\'',
    explanation: 'Filtered by category {category} and price < {max}.',
    solutionSql: 'SELECT name, price FROM products WHERE category = \'{category}\' AND price < {max};',
  };

  const instantiated = instantiateExercise(exercise, { category: 'Home', max: 20 });
  assert.equal(instantiated.title, 'Products in Home under $20');
  assert.equal(instantiated.prompt, 'Show name and price of Home products costing less than $20.');
  assert.equal(instantiated.solutionSql, "SELECT name, price FROM products WHERE category = 'Home' AND price < 20;");
  assert.equal(instantiated.resolvedValues.category, 'Home');
  assert.equal(instantiated.resolvedValues.max, 20);
});

test('instantiateIfParameterized leaves non-parameterized exercises intact', () => {
  const plain = {
    id: 'plain',
    title: 'Plain question',
  };
  assert.equal(instantiateIfParameterized(plain), plain);
});

test('instantiateExercise resolves template placeholders in clauses', () => {
  const exercise = {
    id: 'test-order',
    kind: 'order',
    skill: 'filter',
    title: 'Order clauses',
    prompt: 'Order the clauses',
    hint: 'Put WHERE after FROM',
    explanation: 'Clauses ordered',
    clauses: [
      'SELECT name, price',
      'FROM products',
      'WHERE category = \'{category}\'',
      'ORDER BY price ASC;',
    ],
    solutionSql: "SELECT name, price\nFROM products\nWHERE category = '{category}'\nORDER BY price ASC;",
  };
  const resolved = instantiateExercise(exercise, { category: 'Stationery' });
  assert.deepEqual(resolved.clauses, [
    'SELECT name, price',
    'FROM products',
    "WHERE category = 'Stationery'",
    'ORDER BY price ASC;',
  ]);
});

