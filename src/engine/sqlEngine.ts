import type { SqlPattern } from '../content/schema';

/** Results are arrays so duplicate column names and their original order survive. */
export type QueryResult = {
  columns: string[];
  rows: unknown[][];
};

export type RunOutput = {
  result?: QueryResult;
  error?: string;
  elapsedMs: number;
};

export type GradeOutput = {
  correct: boolean;
  result?: QueryResult;
  expected?: QueryResult;
  error?: string;
  detail: string;
};

type WorkerRequest =
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

type WorkerRequestWithoutId =
  | { kind: 'run'; sql: string }
  | {
      kind: 'grade';
      sql: string;
      solutionSql: string;
      orderMatters: boolean;
      checkColumnNames: boolean;
      commonMistakes: { sql: string; feedback: string }[];
      requiredPatterns: SqlPattern[];
      forbiddenPatterns: SqlPattern[];
    }
  | { kind: 'scalar'; answer: string; solutionSql: string };

type WorkerResponse =
  | { id: number; kind: 'run'; output: RunOutput }
  | { id: number; kind: 'grade'; output: GradeOutput }
  | { id: number; kind: 'scalar'; output: GradeOutput };

type PendingRequest = {
  resolve: (value: RunOutput | GradeOutput) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

const pending = new Map<number, PendingRequest>();
let worker: Worker | undefined;
let nextId = 1;
let ready = false;

// Initializing and seeding both databases may take longer than a normal query.
const STARTUP_TIMEOUT_MS = 60_000;
const QUERY_TIMEOUT_MS = 20_000;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function stopWorker(reason: Error): void {
  worker?.terminate();
  worker = undefined;
  ready = false;
  for (const request of pending.values()) {
    clearTimeout(request.timer);
    request.reject(reason);
  }
  pending.clear();
}

function getSessionSeed(): number {
  if (typeof window === 'undefined' || !window.sessionStorage) return 42;
  try {
    const existing = window.sessionStorage.getItem('sql-land-session-seed');
    if (existing) return Number(existing) || 42;
    const created = Math.floor(Math.random() * 900) + 100;
    window.sessionStorage.setItem('sql-land-session-seed', String(created));
    return created;
  } catch {
    return 42;
  }
}

function getWorker(): Worker {
  if (worker) return worker;

  const created = new Worker(new URL('./sqlWorker.ts', import.meta.url), {
    type: 'module',
  });

  created.postMessage({ kind: 'init', sessionSeed: getSessionSeed() });

  created.onmessage = (event: MessageEvent<WorkerResponse>) => {
    if (created !== worker) return;
    const response = event.data;
    const request = pending.get(response.id);
    if (!request) return;
    clearTimeout(request.timer);
    pending.delete(response.id);
    ready = true;
    request.resolve(response.output);
  };

  created.onerror = (event) => {
    if (created !== worker) return;
    stopWorker(new Error(event.message || 'The SQL worker stopped unexpectedly.'));
  };

  created.onmessageerror = () => {
    if (created !== worker) return;
    stopWorker(new Error('The SQL worker returned an unreadable result.'));
  };

  worker = created;
  return created;
}

function askWorker<T extends RunOutput | GradeOutput>(
  request: WorkerRequestWithoutId,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let current: Worker;
    try {
      current = getWorker();
    } catch (error) {
      reject(error);
      return;
    }

    const id = nextId++;
    const timeout = ready ? QUERY_TIMEOUT_MS : STARTUP_TIMEOUT_MS;
    const timer = setTimeout(() => {
      if (current !== worker) return;
      stopWorker(new Error('The query took too long. Try a simpler query.'));
    }, timeout);

    pending.set(id, {
      resolve: (output) => resolve(output as T),
      reject,
      timer,
    });

    try {
      current.postMessage({ ...request, id } satisfies WorkerRequest);
    } catch (error) {
      stopWorker(new Error(errorMessage(error)));
    }
  });
}

/** Run a single read-only query against the dataset shown in the lesson. */
export async function runSql(sql: string): Promise<RunOutput> {
  const started = performance.now();
  try {
    return await askWorker<RunOutput>({ kind: 'run', sql });
  } catch (error) {
    return { error: errorMessage(error), elapsedMs: performance.now() - started };
  }
}

/** Compare the answer with the reference on both sample and expanded datasets. */
export async function gradeSql(
  sql: string,
  solutionSql: string,
  orderMatters = false,
  checkColumnNames = true,
  commonMistakes: { sql: string; feedback: string }[] = [],
  requiredPatterns: SqlPattern[] = [],
  forbiddenPatterns: SqlPattern[] = [],
): Promise<GradeOutput> {
  try {
    return await askWorker<GradeOutput>({
      kind: 'grade',
      sql,
      solutionSql,
      orderMatters,
      checkColumnNames,
      commonMistakes,
      requiredPatterns,
      forbiddenPatterns,
    });
  } catch (error) {
    const message = errorMessage(error);
    return { correct: false, error: message, detail: message };
  }
}

/** Grade a single-value answer against the local sample data. */
export async function gradeScalar(answer: string, solutionSql: string): Promise<GradeOutput> {
  try {
    return await askWorker<GradeOutput>({ kind: 'scalar', answer, solutionSql });
  } catch (error) {
    const message = errorMessage(error);
    return { correct: false, error: message, detail: message };
  }
}
