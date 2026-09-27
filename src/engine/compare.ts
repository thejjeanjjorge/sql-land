/** A query result keeps column order and duplicate column names intact. */
export interface ComparableResult {
  columns: string[];
  rows: unknown[][];
}

export interface CompareOptions {
  orderMatters?: boolean;
  /** Most exercises require the names (including aliases) from their reference. */
  checkColumnNames?: boolean;
}

const NUMERIC_TEXT = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const NUMERIC_TOLERANCE = 1e-6;

function numericValue(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'bigint') {
    const number = Number(value);
    return Number.isSafeInteger(number) ? number : undefined;
  }
  if (typeof value !== 'string' || !NUMERIC_TEXT.test(value.trim())) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function valuesEqual(actual: unknown, expected: unknown): boolean {
  if (actual === expected) return true;
  if (typeof actual === 'number' && typeof expected === 'number' &&
      Number.isNaN(actual) && Number.isNaN(expected)) return true;

  const actualNumber = numericValue(actual);
  const expectedNumber = numericValue(expected);
  if (actualNumber !== undefined && expectedNumber !== undefined) {
    return Math.abs(actualNumber - expectedNumber) <= NUMERIC_TOLERANCE;
  }

  if (actual instanceof Date || expected instanceof Date) {
    return actual instanceof Date && expected instanceof Date &&
      actual.getTime() === expected.getTime();
  }
  if (actual instanceof Uint8Array || expected instanceof Uint8Array) {
    return actual instanceof Uint8Array && expected instanceof Uint8Array &&
      actual.length === expected.length && actual.every((byte, index) => byte === expected[index]);
  }
  if (Array.isArray(actual) || Array.isArray(expected)) {
    return Array.isArray(actual) && Array.isArray(expected) &&
      actual.length === expected.length && actual.every((value, index) => valuesEqual(value, expected[index]));
  }
  if (actual && expected && typeof actual === 'object' && typeof expected === 'object') {
    const actualEntries = Object.entries(actual).sort(([a], [b]) => a.localeCompare(b));
    const expectedEntries = Object.entries(expected).sort(([a], [b]) => a.localeCompare(b));
    return actualEntries.length === expectedEntries.length &&
      actualEntries.every(([key, value], index) =>
        key === expectedEntries[index][0] && valuesEqual(value, expectedEntries[index][1]));
  }
  return false;
}

/** Short answers ignore surrounding whitespace and text case. */
export function scalarAnswerEqual(answer: string, expected: unknown): boolean {
  const trimmed = answer.trim();
  if (expected === null) return trimmed.toUpperCase() === 'NULL';
  if (typeof expected === 'string' && numericValue(expected) === undefined) {
    return trimmed.toLocaleLowerCase() === expected.trim().toLocaleLowerCase();
  }
  return valuesEqual(trimmed, expected);
}

function rowsEqual(actual: unknown[], expected: unknown[]): boolean {
  return actual.length === expected.length &&
    actual.every((value, index) => valuesEqual(value, expected[index]));
}

function plural(count: number): string {
  return count === 1 ? 'row' : 'rows';
}

/** Match each expected row once, preserving duplicates and allowing numeric tolerance. */
function unmatchedRows(actual: unknown[][], expected: unknown[][]): { extra: number; missing: number } {
  const matchedExpected = new Set<number>();
  let extra = 0;
  for (const row of actual) {
    const index = expected.findIndex((candidate, candidateIndex) =>
      !matchedExpected.has(candidateIndex) && rowsEqual(row, candidate));
    if (index < 0) extra++;
    else matchedExpected.add(index);
  }
  return { extra, missing: expected.length - matchedExpected.size };
}

function hasDuplicateRows(rows: unknown[][]): boolean {
  return rows.some((row, index) => rows.slice(0, index).some((previous) => rowsEqual(previous, row)));
}

function columnDifference(actual: string[], expected: string[]): string | undefined {
  if (actual.length !== expected.length) {
    return `Your query returned ${actual.length} column${actual.length === 1 ? '' : 's'}; expected ${expected.length}.`;
  }
  const actualNames = actual.map((name) => name.toLowerCase());
  const expectedNames = expected.map((name) => name.toLowerCase());
  if (actualNames.every((name, index) => name === expectedNames[index])) return undefined;

  const sortedActual = [...actualNames].sort();
  const sortedExpected = [...expectedNames].sort();
  if (sortedActual.every((name, index) => name === sortedExpected[index])) {
    return `Your columns are in a different order: expected ${expected.join(', ')}.`;
  }

  const mismatches = actualNames.flatMap((name, index) =>
    name === expectedNames[index] ? [] : [index]);
  if (mismatches.length === 1) {
    const index = mismatches[0];
    return `Rename column \`${actual[index]}\` to \`${expected[index]}\`.`;
  }
  return `Your column names differ: expected ${expected.join(', ')}.`;
}

/** Return the learner-facing difference, or undefined when both results agree. */
export function compareResults(
  actual: ComparableResult,
  expected: ComparableResult,
  { orderMatters = false, checkColumnNames = true }: CompareOptions = {},
): string | undefined {
  if (actual.columns.length !== expected.columns.length) {
    return columnDifference(actual.columns, expected.columns);
  }
  if (checkColumnNames) {
    const difference = columnDifference(actual.columns, expected.columns);
    if (difference) return difference;
  }

  const { extra, missing } = unmatchedRows(actual.rows, expected.rows);
  if (extra === 0 && missing === 0) {
    if (orderMatters && !actual.rows.every((row, index) => rowsEqual(row, expected.rows[index]))) {
      return 'Right rows, wrong order.';
    }
    return undefined;
  }

  if (hasDuplicateRows(actual.rows) && !hasDuplicateRows(expected.rows)) {
    return 'You have duplicate rows. Do you need DISTINCT?';
  }
  if (extra === 0) return `You are missing ${missing} ${plural(missing)}.`;
  if (missing === 0) return `You returned ${extra} extra ${plural(extra)}.`;

  // With equally sized results, a changed cell appears as both one missing and
  // one extra row. Report the row count only when there is a true count gap.
  if (actual.rows.length < expected.rows.length) {
    const gap = expected.rows.length - actual.rows.length;
    return `You are missing ${gap} ${plural(gap)}.`;
  }
  if (actual.rows.length > expected.rows.length) {
    const gap = actual.rows.length - expected.rows.length;
    return `You returned ${gap} extra ${plural(gap)}.`;
  }
  return 'Some values differ from the expected result.';
}
