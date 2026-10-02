/** Run with `node src/content/validate.mjs` after installing dependencies. */
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { PGlite } from '@electric-sql/pglite';

const contentDir = dirname(fileURLToPath(import.meta.url));

async function loadTypeScript(file) {
  const source = await readFile(join(contentDir, file), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: file,
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

async function query(db, sql) {
  const result = await db.query(sql, [], { rowMode: 'array' });
  return {
    columns: result.fields.map(({ name }) => name),
    rows: result.rows,
  };
}

function comparisonOptions(exercise) {
  return {
    orderMatters: exercise.orderMatters ?? false,
    checkColumnNames: exercise.checkColumnNames ?? true,
  };
}

function withoutOrderBy(sql) {
  return sql.replace(/\s+ORDER\s+BY\s+.*?(?=\s+LIMIT\b|\s+OFFSET\b|;\s*$|$)/i, '');
}

const FLIPPED_BOUNDARY = { '<': '<=', '<=': '<', '>': '>=', '>=': '>' };

/**
 * One variant of the SQL per comparison operator, with that operator's boundary
 * flipped (< and <=, > and >=). Quoted text and comments are left alone.
 */
function boundaryMutations(sql) {
  const mutations = [];
  let index = 0;
  while (index < sql.length) {
    if (sql[index] === "'") {
      index++;
      while (index < sql.length && !(sql[index] === "'" && sql[index + 1] !== "'")) {
        index += sql[index] === "'" ? 2 : 1;
      }
      index++;
      continue;
    }
    if (sql.startsWith('--', index)) {
      const end = sql.indexOf('\n', index);
      index = end < 0 ? sql.length : end;
      continue;
    }
    const pair = sql.slice(index, index + 2);
    if (pair === '<>' || pair === '->' || pair === '<<' || pair === '>>') {
      index += 2;
      continue;
    }
    if (sql[index] === '<' || sql[index] === '>') {
      const operator = pair === '<=' || pair === '>=' ? pair : sql[index];
      mutations.push({
        operator,
        sql: sql.slice(0, index) + FLIPPED_BOUNDARY[operator] + sql.slice(index + operator.length),
      });
      index += operator.length;
      continue;
    }
    index++;
  }
  return mutations;
}

/**
 * Learners type their own comparisons in these formats, so an off-by-one operator
 * must change the result. Match questions are excluded: the target output is the spec.
 */
const BOUNDARY_CHECKED_KINDS = new Set(['write', 'fix', 'bug', 'refactor']);

function orderKeyNames(sql) {
  const clause = /\bORDER\s+BY\s+(.+?)(?=\s+LIMIT\b|\s+OFFSET\b|;\s*$|$)/i.exec(sql)?.[1];
  expect(Boolean(clause), 'ordered question has no ORDER BY clause');
  return clause.split(',').map((key) => {
    const simple = /^\s*(?:[a-z_]\w*\.)?([a-z_]\w*)(?:\s+(?:ASC|DESC))?\s*$/i.exec(key);
    expect(Boolean(simple), `ORDER BY key needs an output column for tie validation: ${key}`);
    return simple[1];
  });
}

async function assertUntiedOrder(db, exercise) {
  const keys = orderKeyNames(exercise.solutionSql);
  const source = exercise.solutionSql.replace(/;\s*$/, '');
  const names = keys.map((key) => `"${key}"`).join(', ');
  const ties = await query(db,
    `SELECT ${names}, COUNT(*) FROM (${source}) AS ordered_rows GROUP BY ${names} HAVING COUNT(*) > 1 LIMIT 1`);
  expect(ties.rows.length === 0, `${exercise.id}: ORDER BY keys have ties`);
}

async function scalar(db, sql) {
  return (await query(db, sql)).rows[0]?.[0];
}

async function assertRichFixture(db, fixtureIndex) {
  const label = `fixture ${fixtureIndex + 1}`;
  expect(Number(await scalar(db, 'SELECT COUNT(*) FROM customers c LEFT JOIN orders o ON o.customer_id = c.id WHERE o.id IS NULL')) > 0,
    `${label}: expected a customer with no orders`);
  expect(Number(await scalar(db, 'SELECT COUNT(*) FROM products p LEFT JOIN order_items oi ON oi.product_id = p.id WHERE oi.id IS NULL')) > 0,
    `${label}: expected an unsold product`);
  expect(Number(await scalar(db, 'SELECT COUNT(*) FROM (SELECT price FROM products GROUP BY price HAVING COUNT(*) > 1) ties')) > 0,
    `${label}: expected a product price tie`);
  expect(Number(await scalar(db, 'SELECT COUNT(*) FROM (SELECT name FROM customers GROUP BY name HAVING COUNT(*) > 1) names')) > 0,
    `${label}: expected customers with the same name`);
  expect(Number(await scalar(db, "SELECT (MAX(order_date) - MIN(order_date)) FROM orders")) >= 548,
    `${label}: orders must span at least eighteen months`);
  for (const [table, column] of [
    ['customers', 'email'], ['customers', 'referred_by'],
    ['categories', 'parent_id'], ['orders', 'shipped_at'],
    ['orders', 'discount_code'], ['reviews', 'rating'],
  ]) {
    expect(Number(await scalar(db, `SELECT COUNT(*) FROM ${table} WHERE ${column} IS NULL`)) > 0,
      `${label}: expected NULL in ${table}.${column}`);
  }
  expect(Number(await scalar(db, 'SELECT COUNT(*) FROM orders o JOIN payments p ON p.order_id = o.id WHERE o.status = \'cancelled\'')) > 0,
    `${label}: expected a paid cancelled order`);
  expect(Number(await scalar(db, 'SELECT COUNT(*) FROM (SELECT order_id FROM payments GROUP BY order_id HAVING COUNT(*) > 1) p')) > 0,
    `${label}: expected an order with multiple payments`);
  expect(Number(await scalar(db, `SELECT COUNT(*) FROM (
    SELECT p.order_id FROM payments p JOIN order_items oi ON oi.order_id = p.order_id
    JOIN products pr ON pr.id = oi.product_id
    GROUP BY p.order_id HAVING SUM(DISTINCT p.amount) < SUM(oi.quantity * pr.price)
  ) partial`)) > 0, `${label}: expected a partial payment`);
  expect(Number(await scalar(db, `WITH RECURSIVE tree(id, depth) AS (
    SELECT id, 1 FROM categories WHERE parent_id IS NULL
    UNION ALL SELECT c.id, t.depth + 1 FROM categories c JOIN tree t ON c.parent_id = t.id
  ) SELECT MAX(depth) FROM tree`)) >= 3, `${label}: category tree is too shallow`);
}

const [
  { LEVELS: FOUNDATION_LEVELS },
  { ADVANCED_LEVELS },
  { BASE_SEED_SQL, CHALLENGE_SEED_SQL },
  { compareResults, scalarAnswerEqual },
  { constraintError },
  { cartesianCombinations, instantiateExercise },
  { conceptsTaughtBy, conceptsUsedBy },
] = await Promise.all([
  loadTypeScript('levels.ts'),
  loadTypeScript('advancedLevels.ts'),
  loadTypeScript('fixtures.ts'),
  loadTypeScript('../engine/compare.ts'),
  loadTypeScript('../engine/sqlConstraints.ts'),
  loadTypeScript('parameterize.ts'),
  loadTypeScript('ruleMatcher.ts'),
]);

const LEVELS = [...FOUNDATION_LEVELS, ...ADVANCED_LEVELS];

/** Words that can sit before a parenthesis without being a function call. */
const NOT_FUNCTIONS = new Set(['IN', 'EXISTS', 'VALUES', 'OVER', 'FILTER', 'AS', 'ON', 'USING', 'AND', 'OR', 'NOT', 'WHERE',
  'FROM', 'SELECT', 'WITH', 'JOIN', 'UNION', 'INTERSECT', 'EXCEPT', 'HAVING', 'BY', 'LIMIT', 'BETWEEN', 'ANY', 'ALL', 'SOME',
  'LATERAL', 'RECURSIVE', 'WHEN', 'THEN', 'ELSE', 'CASE', 'END', 'IS', 'NULL', 'DISTINCT', 'LIKE', 'ILIKE', 'ROWS', 'RANGE',
  'PARTITION', 'ORDER', 'GROUP', 'SET']);

/** Function names a query calls. Names the query defines itself, such as n(x) in a CTE, are not calls. */
function functionCalls(sql) {
  const text = sql.replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/'(?:[^']|'')*'/g, "''").toUpperCase();
  const own = new Set();
  for (const match of text.matchAll(/\bWITH\s+(?:RECURSIVE\s+)?(\w+)/g)) own.add(match[1]);
  for (const match of text.matchAll(/\)\s*,\s*(\w+)\s*(?:\([^)]*\))?\s+AS\s*\(/g)) own.add(match[1]);
  for (const match of text.matchAll(/\)\s+(?:AS\s+)?(\w+)\s*\(/g)) own.add(match[1]);
  return [...text.matchAll(/\b([A-Z_][A-Z0-9_]*)\s*\(/g)]
    .map((match) => match[1])
    .filter((name) => !NOT_FUNCTIONS.has(name) && !own.has(name));
}

/** Operators and keywords whose card states what they mean in words, so an example would add nothing. */
const SELF_EXPLAINING = new Set(['lt', 'lte', 'gt', 'gte', 'ne', 'not', 'countColumn']);

/**
 * Teach before you test. A learner may be asked to write or read only SQL that a rule
 * card has already named, in the question's own level or an earlier one:
 * - every concept must be named by a card (title, body or example);
 * - every concept must also be shown in a card's example, so the syntax is not left to
 *   guesswork (comparison operators and the like are exempt: the card spells them out);
 * - every function must be written out in call form, such as NULLIF(a, b) or left(text, n),
 *   because a card that only says "NULLIF turns equal values into NULL" never shows the arguments.
 * Hints and explanations do not count as teaching: the exam shows neither.
 */
function untaughtProblems() {
  const named = new Set();
  const shown = new Set();
  const calls = new Set();
  const problems = [];
  for (const level of LEVELS) {
    for (const rule of level.rules) {
      for (const id of conceptsTaughtBy(rule)) named.add(id);
      if (rule.example) for (const id of conceptsUsedBy(rule.example)) shown.add(id);
      const text = `${rule.title} ${rule.body} ${rule.example ?? ''}`;
      for (const match of text.matchAll(/\b([A-Za-z_]\w*)\s*\(/g)) calls.add(match[1].toUpperCase());
    }
    for (const exercise of [...level.exercises, ...level.exam]) {
      const sqls = [exercise.solutionSql, exercise.starterSql].filter(Boolean);
      for (const id of new Set(sqls.flatMap((sql) => [...conceptsUsedBy(sql)]))) {
        if (!named.has(id)) problems.push(`${exercise.id} uses "${id}", which no rule card names yet`);
        else if (!shown.has(id) && !SELF_EXPLAINING.has(id)) problems.push(`${exercise.id} uses "${id}", which no rule example shows yet`);
      }
      for (const name of new Set(sqls.flatMap(functionCalls))) {
        if (!calls.has(name)) problems.push(`${exercise.id} calls ${name}(), which no rule card writes out in call form yet`);
      }
    }
  }
  return problems;
}

const untaught = untaughtProblems();
expect(untaught.length === 0,
  `Questions use SQL that the rule cards through their level have not taught. Name it in a card's title, body or example, show it in an example, or rewrite the question. Concept ids are listed in ruleMatcher.ts:\n  ${untaught.join('\n  ')}`);

const fixtures = [BASE_SEED_SQL, CHALLENGE_SEED_SQL];
const seenIds = new Set();
const verifiedOrderSensitivity = new Map();
const verifiedFixes = new Map();
const verifiedMistakes = new Map();
const verifiedBoundaries = new Map();
let questionCount = 0;

/** Record whether flipping each comparison boundary changes this result in this fixture. */
async function checkBoundaries(db, exercise, concrete, expected) {
  if (!BOUNDARY_CHECKED_KINDS.has(exercise.kind)) return;
  for (const [index, mutation] of boundaryMutations(concrete.solutionSql).entries()) {
    let differs = true;
    try {
      differs = Boolean(compareResults(await query(db, mutation.sql), expected, comparisonOptions(concrete)));
    } catch {
      // A variant that does not run is certainly distinguishable.
    }
    const key = `${exercise.id}:${index}`;
    const seen = verifiedBoundaries.get(key);
    verifiedBoundaries.set(key, { ...mutation, differs: Boolean(seen?.differs) || differs });
  }
}

for (const level of LEVELS) {
  expect(level.exercises.length >= 6, `${level.id}: expected at least six practice questions`);
  expect(level.exam.length >= 8 && level.exam.length <= 10,
    `${level.id}: expected an exam pool of eight to ten questions`);
  const drawCount = level.examDrawCount ?? 4;
  expect(Number.isInteger(drawCount) && drawCount >= 3 && drawCount <= level.exam.length,
    `${level.id}: invalid examDrawCount`);
  expect(level.passCount > 0 && level.passCount <= drawCount, `${level.id}: invalid passCount`);
  expect(level.exam.some(({ kind }) => kind === 'write'), `${level.id}: exam pool needs a write question`);
  expect(new Set(level.exam.map(({ kind }) => kind)).size >= 3,
    `${level.id}: exam pool needs varied question formats`);
  expect(level.rules.length > 0, `${level.id}: missing rule cards`);
  const practiceKinds = new Set(level.exercises.map(({ kind }) => kind));
  expect(practiceKinds.size >= 5,
    `${level.id}: practice needs at least five formats`);

  for (const exercise of [...level.exercises, ...level.exam]) {
    expect(!seenIds.has(exercise.id), `${exercise.id}: duplicate ID`);
    seenIds.add(exercise.id);
    expect(level.skills.includes(exercise.skill), `${exercise.id}: skill is not in its level`);
    expect(Boolean(exercise.solutionSql), `${exercise.id}: missing solution SQL`);
    if (exercise.orderMatters) {
      const stripped = withoutOrderBy(exercise.solutionSql);
      expect(stripped !== exercise.solutionSql,
        `${exercise.id}: orderMatters requires ORDER BY in solutionSql`);
      verifiedOrderSensitivity.set(exercise.id, false);
    }
    if (exercise.kind === 'complete') {
      expect(exercise.templateParts?.length === exercise.blankLabels?.length + 1,
        `${exercise.id}: template parts and blanks do not match`);
      expect(exercise.blankAnswers?.length === exercise.blankLabels.length,
        `${exercise.id}: blankAnswers must match the blanks`);
    }
    if (exercise.kind === 'fix' || exercise.kind === 'bug') {
      expect(Boolean(exercise.starterSql), `${exercise.id}: missing starter SQL`);
      verifiedFixes.set(exercise.id, false);
    }
    if (exercise.kind === 'predict') {
      expect(Boolean(exercise.starterSql), `${exercise.id}: missing displayed query`);
      expect(exercise.answerOptions?.length >= 3 && exercise.answerOptions?.length <= 4,
        `${exercise.id}: predict needs three or four answers`);
      expect(exercise.answerOptions?.some(({ id }) => id === exercise.correctAnswerId),
        `${exercise.id}: correct prediction is missing`);
      expect(new Set(exercise.answerOptions.map(({ id }) => id)).size === exercise.answerOptions.length,
        `${exercise.id}: duplicate prediction option ID`);
    }
    if (exercise.kind === 'order') {
      expect(Array.isArray(exercise.clauses) && exercise.clauses.length >= 3,
        `${exercise.id}: order question must have at least three clauses`);
      expect(Boolean(exercise.solutionSql), `${exercise.id}: order question needs solutionSql`);
    }
    if (exercise.kind === 'explain') {
      expect(Boolean(exercise.starterSql), `${exercise.id}: explain question needs starterSql`);
      expect(exercise.answerOptions?.length >= 3 && exercise.answerOptions?.length <= 4,
        `${exercise.id}: explain question needs three or four explanation options`);
      expect(exercise.answerOptions?.some(({ id }) => id === (exercise.correctAnswerId ?? exercise.correctOptionId)),
        `${exercise.id}: correct explanation option is missing`);
      expect(new Set(exercise.answerOptions.map(({ id }) => id)).size === exercise.answerOptions.length,
        `${exercise.id}: duplicate explanation option ID`);
    }
    if (exercise.kind === 'refactor') {
      expect(Boolean(exercise.starterSql), `${exercise.id}: refactor question needs starterSql`);
      expect(Boolean(exercise.solutionSql), `${exercise.id}: refactor question needs solutionSql`);
      expect(exercise.requiredPatterns?.length > 0, `${exercise.id}: refactor question needs requiredPatterns`);
      expect(Boolean(constraintError(exercise.starterSql, exercise.requiredPatterns, exercise.forbiddenPatterns)),
        `${exercise.id}: starterSql already satisfies refactor constraints`);
    }
    if (exercise.requiredPatterns?.length || exercise.forbiddenPatterns?.length) {
      expect(exercise.kind === 'write' || exercise.kind === 'refactor',
        `${exercise.id}: constraints belong on write or refactor questions`);
      expect(!constraintError(exercise.solutionSql,
        exercise.requiredPatterns, exercise.forbiddenPatterns),
      `${exercise.id}: solution violates its own SQL constraint`);
    }
    for (const [index, mistake] of (exercise.commonMistakes ?? []).entries()) {
      expect(Boolean(mistake.sql?.trim() && mistake.feedback?.trim()),
        `${exercise.id}: common mistake ${index + 1} needs SQL and feedback`);
      verifiedMistakes.set(`${exercise.id}:${index}`, false);
    }
    if (exercise.kind === 'choose') {
      expect(exercise.options?.length === 4, `${exercise.id}: expected four choices`);
      expect(exercise.options.some(({ id }) => id === exercise.correctOptionId),
        `${exercise.id}: correct option is missing`);
    }
    questionCount += 1;
  }
}

async function resolveParamOptions(db, params) {
  const result = {};
  for (const [key, def] of Object.entries(params)) {
    if (def.fromSql) {
      const q = await query(db, def.fromSql);
      const values = q.rows.map((r) => r[0]).filter((v) => v !== null);
      if (def.pick && def.pick.length > 0) {
        result[key] = def.pick.filter((p) => values.includes(p));
        if (result[key].length === 0) result[key] = values;
      } else {
        result[key] = values;
      }
    } else if (def.pick && def.pick.length > 0) {
      result[key] = def.pick;
    }
  }
  return result;
}

for (const [fixtureIndex, seed] of fixtures.entries()) {
  const db = new PGlite();
  try {
    await db.exec(seed);
    await assertRichFixture(db, fixtureIndex);
    for (const level of LEVELS) {
      for (const exercise of [...level.exercises, ...level.exam]) {
        if (exercise.params && Object.keys(exercise.params).length > 0) {
          const paramOptions = await resolveParamOptions(db, exercise.params);
          const combinations = cartesianCombinations(paramOptions);
          expect(combinations.length >= 2, `${exercise.id}: parameterized question needs at least 2 combinations`);
          for (const combo of combinations) {
            const concrete = instantiateExercise(exercise, combo);
            expect(!/\{[a-zA-Z0-9_]+\}/.test(concrete.solutionSql), `${concrete.id}: unresolved parameter in solutionSql`);
            expect(!/\{[a-zA-Z0-9_]+\}/.test(concrete.prompt), `${concrete.id}: unresolved parameter in prompt`);
            const expected = await query(db, concrete.solutionSql);
            expect(expected.rows.length > 0, `${concrete.id}: combination ${JSON.stringify(combo)} returned 0 rows in fixture ${fixtureIndex + 1}`);
            const options = comparisonOptions(concrete);
            await checkBoundaries(db, exercise, concrete, expected);
            if (concrete.orderMatters) {
              await assertUntiedOrder(db, concrete);
              const unsorted = await query(db, withoutOrderBy(concrete.solutionSql));
              const differs = Boolean(compareResults(unsorted, expected, options));
              verifiedOrderSensitivity.set(exercise.id, verifiedOrderSensitivity.get(exercise.id) || differs);
            }
          }
          continue;
        }
        const expected = await query(db, exercise.solutionSql);
        const options = comparisonOptions(exercise);
        await checkBoundaries(db, exercise, exercise, expected);
        if (exercise.kind === 'answer' || exercise.kind === 'predict') {
          expect(expected.rows.length === 1 && expected.columns.length === 1,
            `${exercise.id}: answer query must return exactly one cell`);
        }
        if (exercise.kind === 'predict') {
          const displayed = await query(db, exercise.starterSql);
          expect(!compareResults(displayed, expected, { checkColumnNames: false }),
            `${exercise.id}: displayed query differs from its answer`);
          const matches = exercise.answerOptions.filter(({ value }) =>
            scalarAnswerEqual(value, expected.rows[0][0]));
          expect(matches.length === 1 && matches[0].id === exercise.correctAnswerId,
            `${exercise.id}: predictions are ambiguous in fixture ${fixtureIndex + 1}`);
        }
        if (exercise.kind === 'match') {
          // Only the sample fixture's result is displayed as the target table.
          expect(expected.rows.length > 0 && (fixtureIndex > 0 || expected.rows.length <= 12),
            `${exercise.id}: target output must show 1–12 rows`);
        }
        if (exercise.orderMatters) {
          await assertUntiedOrder(db, exercise);
          const unsorted = await query(db, withoutOrderBy(exercise.solutionSql));
          const differs = Boolean(compareResults(unsorted, expected, options));
          verifiedOrderSensitivity.set(exercise.id,
            verifiedOrderSensitivity.get(exercise.id) || differs);
        }
        if (exercise.kind === 'fix' || exercise.kind === 'bug') {
          let differs = false;
          try {
            const starter = await query(db, exercise.starterSql);
            differs = Boolean(compareResults(starter, expected, options));
          } catch {
            expect(exercise.kind !== 'bug', `${exercise.id}: bug starterSql must run without errors`);
            differs = true;
          }
          verifiedFixes.set(exercise.id, verifiedFixes.get(exercise.id) || differs);
        }
        if (exercise.kind === 'complete') {
          const composed = exercise.templateParts.reduce(
            (text, part, index) => text + part + (exercise.blankAnswers[index] ?? ''), '');
          const actual = await query(db, composed);
          expect(!compareResults(actual, expected, options),
            `${exercise.id}: blankAnswers do not reproduce the solution in fixture ${fixtureIndex + 1}`);
        }
        if (exercise.kind === 'order') {
          const assembled = exercise.clauses.join('\n');
          const actual = await query(db, assembled);
          expect(!compareResults(actual, expected, options),
            `${exercise.id}: joined clauses do not match solutionSql in fixture ${fixtureIndex + 1}`);
        }
        if (exercise.kind === 'explain') {
          await query(db, exercise.starterSql);
        }
        if (exercise.kind === 'refactor') {
          const starter = await query(db, exercise.starterSql);
          expect(!compareResults(starter, expected, options),
            `${exercise.id}: starterSql does not return the same result as solutionSql in fixture ${fixtureIndex + 1}`);
        }
        for (const [index, mistake] of (exercise.commonMistakes ?? []).entries()) {
          const actual = await query(db, mistake.sql);
          const differs = Boolean(compareResults(actual, expected, options));
          const key = `${exercise.id}:${index}`;
          verifiedMistakes.set(key, verifiedMistakes.get(key) || differs);
        }
        if (exercise.kind !== 'choose') continue;
        for (const option of exercise.options) {
          const actual = await query(db, option.sql);
          const matches = !compareResults(actual, expected, options);
          expect(matches === (option.id === exercise.correctOptionId),
            `${exercise.id}: option ${option.id} has an ambiguous result in fixture ${fixtureIndex + 1}`);
        }
      }
    }
  } finally {
    await db.close();
  }
}

for (const [id, differs] of verifiedOrderSensitivity) {
  expect(differs, `${id}: removing ORDER BY still produces the expected order in both fixtures`);
}
for (const [id, differs] of verifiedFixes) {
  expect(differs, `${id}: starterSql already returns the solution`);
}
for (const [id, differs] of verifiedMistakes) {
  expect(differs, `${id}: commonMistakes SQL returns the solution`);
}
for (const [key, { operator, differs }] of verifiedBoundaries) {
  const [id] = key.split(':');
  expect(differs, `${id}: using ${FLIPPED_BOUNDARY[operator]} instead of ${operator} gives the same result `
    + 'in both fixtures, so an off-by-one answer would pass. Add a row exactly on that boundary to the challenge fixture.');
}

console.log(`Validated ${questionCount} questions across ${LEVELS.length} levels and two grading fixtures.`);
