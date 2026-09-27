import { PGlite } from '@electric-sql/pglite';
import { BASE_SEED_SQL, CHALLENGE_SEED_SQL, generateSessionVariationSql } from '../content/fixtures';
import type { SqlPattern } from '../content/schema';
import { compareResults, scalarAnswerEqual } from './compare';
import { constraintError } from './sqlConstraints';
import type { GradeOutput, QueryResult, RunOutput } from './sqlEngine';

type WorkerRequest =
  | { id?: number; kind: 'init'; sessionSeed: number }
  | { id: number; kind: 'run'; sql: string }
  | {
      id: number;
      kind: 'grade';
      sql: string;
      solutionSql: string;
      orderMatters: boolean;
      checkColumnNames: boolean;
      commonMistakes: { sql: string; feedback: string }[];
      requiredPatterns: SqlPattern[];
      forbiddenPatterns: SqlPattern[];
    }
  | { id: number; kind: 'scalar'; answer: string; solutionSql: string };

type Databases = { sample: PGlite; challenge: PGlite };
let databasePromise: Promise<Databases> | undefined;
let activeSessionSeed = 42;

function databases(): Promise<Databases> {
  if (!databasePromise) {
    databasePromise = (async () => {
      const sample = await PGlite.create();
      await sample.exec(BASE_SEED_SQL + generateSessionVariationSql(activeSessionSeed));
      const challenge = await PGlite.create();
      await challenge.exec(CHALLENGE_SEED_SQL);
      return { sample, challenge };
    })();
    // A transient initialization failure should not poison all later attempts.
    void databasePromise.catch(() => {
      databasePromise = undefined;
    });
  }
  return databasePromise;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Ignore leading whitespace and PostgreSQL comments when finding the command. */
function firstKeyword(sql: string): string {
  let index = 0;
  while (index < sql.length) {
    if (/\s/.test(sql[index])) {
      index++;
      continue;
    }
    if (sql.startsWith('--', index)) {
      const end = sql.indexOf('\n', index + 2);
      index = end < 0 ? sql.length : end + 1;
      continue;
    }
    if (sql.startsWith('/*', index)) {
      let depth = 1;
      index += 2;
      while (index < sql.length && depth > 0) {
        if (sql.startsWith('/*', index)) {
          depth++;
          index += 2;
        } else if (sql.startsWith('*/', index)) {
          depth--;
          index += 2;
        } else {
          index++;
        }
      }
      continue;
    }
    break;
  }
  return /^[a-z_]+/i.exec(sql.slice(index))?.[0].toUpperCase() ?? '';
}

function assertReadOnlyQuery(sql: string): void {
  const keyword = firstKeyword(sql);
  if (keyword !== 'SELECT' && keyword !== 'WITH') {
    throw new Error('Write one SELECT or WITH query to run this exercise.');
  }
}

async function query(db: PGlite, sql: string): Promise<QueryResult> {
  assertReadOnlyQuery(sql);
  // Extended-protocol query() accepts only one statement. A read-only
  // transaction also rejects writes hidden inside WITH or SELECT INTO.
  return db.transaction(async (tx) => {
    await tx.exec('SET TRANSACTION READ ONLY');
    const output = await tx.query(sql, [], { rowMode: 'array' });
    return {
      columns: output.fields.map((field) => field.name),
      rows: output.rows as unknown as unknown[][],
    };
  });
}

async function run(sql: string): Promise<RunOutput> {
  const started = performance.now();
  try {
    assertReadOnlyQuery(sql);
    const { sample } = await databases();
    const result = await query(sample, sql);
    return { result, elapsedMs: performance.now() - started };
  } catch (error) {
    return { error: messageOf(error), elapsedMs: performance.now() - started };
  }
}

async function grade(
  sql: string,
  solutionSql: string,
  orderMatters: boolean,
  checkColumnNames: boolean,
  commonMistakes: { sql: string; feedback: string }[],
  requiredPatterns: SqlPattern[],
  forbiddenPatterns: SqlPattern[],
): Promise<GradeOutput> {
  try {
    assertReadOnlyQuery(sql);
    const violation = constraintError(sql, requiredPatterns, forbiddenPatterns);
    if (violation) return { correct: false, detail: violation };
    const { sample, challenge } = await databases();
    let result: QueryResult;
    try {
      result = await query(sample, sql);
    } catch (error) {
      const message = messageOf(error);
      return { correct: false, error: message, detail: message };
    }

    let expected: QueryResult;
    try {
      expected = await query(sample, solutionSql);
    } catch (error) {
      const message = `This exercise could not be checked: ${messageOf(error)}`;
      return { correct: false, result, error: message, detail: message };
    }

    const sampleDifference = compareResults(result, expected, { orderMatters, checkColumnNames });
    let expandedResult: QueryResult;
    let expandedExpected: QueryResult;
    try {
      expandedResult = await query(challenge, sql);
    } catch (error) {
      const message = messageOf(error);
      return { correct: false, result, expected, error: message, detail: message };
    }
    try {
      expandedExpected = await query(challenge, solutionSql);
    } catch (error) {
      const message = `This exercise could not be checked: ${messageOf(error)}`;
      return { correct: false, result, expected, error: message, detail: message };
    }
    const expandedDifference = compareResults(expandedResult, expandedExpected, {
      orderMatters,
      checkColumnNames,
    });
    if (sampleDifference || expandedDifference) {
      for (const mistake of commonMistakes) {
        try {
          const sampleMistake = await query(sample, mistake.sql);
          const challengeMistake = await query(challenge, mistake.sql);
          const options = { orderMatters, checkColumnNames };
          if (!compareResults(result, sampleMistake, options) &&
              !compareResults(expandedResult, challengeMistake, options)) {
            return { correct: false, result, expected, detail: mistake.feedback };
          }
        } catch {
          // A malformed optional feedback example must not block grading.
        }
      }
    }
    if (sampleDifference) {
      return { correct: false, result, expected, detail: sampleDifference };
    }
    if (expandedDifference) {
      return {
        correct: false,
        result,
        expected,
        detail: `Your query works on the sample rows but misses a case in the expanded dataset. ${expandedDifference}`,
      };
    }
    return { correct: true, result, expected, detail: 'Correct on both datasets.' };
  } catch (error) {
    const message = messageOf(error);
    return { correct: false, error: message, detail: message };
  }
}

async function gradeScalar(answer: string, solutionSql: string): Promise<GradeOutput> {
  try {
    const { sample } = await databases();
    const expected = await query(sample, solutionSql);
    if (expected.rows.length !== 1 || expected.columns.length !== 1) {
      return { correct: false, detail: 'This answer question needs one result cell.' };
    }
    const correct = scalarAnswerEqual(answer, expected.rows[0][0]);
    return {
      correct,
      expected,
      detail: correct ? 'That answer matches the data.' : 'That value does not match the data. Try exploring again.',
    };
  } catch (error) {
    return { correct: false, detail: messageOf(error) };
  }
}

// PGlite has a single connection per database, so process requests in order.
let queue = Promise.resolve();
const workerScope = self as unknown as DedicatedWorkerGlobalScope;
workerScope.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  queue = queue.then(async () => {
    if (request.kind === 'init') {
      activeSessionSeed = request.sessionSeed;
      return;
    }
    if (request.kind === 'run') {
      const output = await run(request.sql);
      workerScope.postMessage({ id: request.id, kind: 'run', output });
    } else if (request.kind === 'scalar') {
      const output = await gradeScalar(request.answer, request.solutionSql);
      workerScope.postMessage({ id: request.id, kind: 'scalar', output });
    } else {
      const output = await grade(
        request.sql,
        request.solutionSql,
        request.orderMatters,
        request.checkColumnNames,
        request.commonMistakes,
        request.requiredPatterns,
        request.forbiddenPatterns,
      );
      workerScope.postMessage({ id: request.id, kind: 'grade', output });
    }
  });
};
