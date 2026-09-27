import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('./progress.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: 'progress.ts',
});
const {
  emptyProgress,
  recordAttempt,
  recordRepetition,
  isExerciseDue,
  recentAccuracy,
  reviewStatus,
  loadProgress,
  saveProgress,
} = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
);

test('recordAttempt maintains rolling window of last 20 attempts', () => {
  let p = emptyProgress;
  // Record 15 incorrect attempts
  for (let i = 0; i < 15; i++) {
    p = recordAttempt(p, 'filter', false);
  }
  assert.equal(p.skillStats.filter.attempts, 15);
  assert.equal(p.skillStats.filter.correct, 0);
  assert.equal(p.skillStats.filter.recentAttempts.length, 15);
  assert.equal(recentAccuracy(p.skillStats.filter), 0);

  // Now record 10 correct attempts (total 25, window capped at 20)
  for (let i = 0; i < 10; i++) {
    p = recordAttempt(p, 'filter', true);
  }
  assert.equal(p.skillStats.filter.attempts, 25);
  assert.equal(p.skillStats.filter.correct, 10);
  assert.equal(p.skillStats.filter.recentAttempts.length, 20);
  // Last 20 attempts: 10 falses followed by 10 trues -> 50% accuracy
  assert.equal(recentAccuracy(p.skillStats.filter), 50);

  // Now record 10 more correct attempts (last 20 are all true)
  for (let i = 0; i < 10; i++) {
    p = recordAttempt(p, 'filter', true);
  }
  assert.equal(p.skillStats.filter.attempts, 35);
  assert.equal(p.skillStats.filter.correct, 20);
  assert.equal(p.skillStats.filter.recentAttempts.length, 20);
  // Recent accuracy is 100%, even though lifetime is 20/35 (~57%)!
  assert.equal(recentAccuracy(p.skillStats.filter), 100);
});

test('reviewStatus flags focus when recent accuracy is under 70%', () => {
  let p = emptyProgress;
  p = recordAttempt(p, 'sort', false);
  p = recordAttempt(p, 'sort', false);
  p = recordAttempt(p, 'sort', true); // 1/3 ~ 33%
  assert.equal(reviewStatus(p.skillStats.sort), 'focus');

  // Bring it above 70%
  for (let i = 0; i < 8; i++) {
    p = recordAttempt(p, 'sort', true);
  }
  // 9/11 ~ 82%
  assert.equal(reviewStatus(p.skillStats.sort), 'fresh');
});

test('recordRepetition handles Leitner box progression and resets', () => {
  let p = emptyProgress;
  const id = 'l1-p1';

  // Initially wrong -> box 1, due tomorrow (~1 day), queued for review
  p = recordRepetition(p, id, false);
  assert.equal(p.exerciseRepetition[id].box, 1);
  assert.equal(p.queuedReviewExerciseIds.includes(id), true);
  const due1 = Date.parse(p.exerciseRepetition[id].dueDate);
  assert.ok(due1 > Date.now());

  // Correct answer -> advances to box 2 (3 days), removed from immediate queue
  p = recordRepetition(p, id, true);
  assert.equal(p.exerciseRepetition[id].box, 2);
  assert.equal(p.queuedReviewExerciseIds.includes(id), false);
  const due2 = Date.parse(p.exerciseRepetition[id].dueDate);
  // Interval should be ~3 days from now
  const diffDays2 = Math.round((due2 - Date.now()) / 86_400_000);
  assert.equal(diffDays2, 3);

  // Correct again -> box 3 (7 days)
  p = recordRepetition(p, id, true);
  assert.equal(p.exerciseRepetition[id].box, 3);
  const diffDays3 = Math.round((Date.parse(p.exerciseRepetition[id].dueDate) - Date.now()) / 86_400_000);
  assert.equal(diffDays3, 7);

  // Correct again -> box 4 (21 days)
  p = recordRepetition(p, id, true);
  assert.equal(p.exerciseRepetition[id].box, 4);
  const diffDays4 = Math.round((Date.parse(p.exerciseRepetition[id].dueDate) - Date.now()) / 86_400_000);
  assert.equal(diffDays4, 21);

  // Wrong answer in box 4 -> drops straight back to box 1 (1 day), re-queued!
  p = recordRepetition(p, id, false);
  assert.equal(p.exerciseRepetition[id].box, 1);
  assert.equal(p.queuedReviewExerciseIds.includes(id), true);
  const diffDaysReset = Math.round((Date.parse(p.exerciseRepetition[id].dueDate) - Date.now()) / 86_400_000);
  assert.equal(diffDaysReset, 1);
});

test('isExerciseDue returns true for past due dates and queued questions', () => {
  assert.equal(isExerciseDue(undefined, true), true);

  const pastDate = new Date(Date.now() - 3600_000).toISOString();
  assert.equal(isExerciseDue({ box: 2, dueDate: pastDate }), true);

  const futureDate = new Date(Date.now() + 3600_000 * 24).toISOString();
  assert.equal(isExerciseDue({ box: 2, dueDate: futureDate }), false);
});

test('v1 progress migration initializes v2 storage and preserves history', () => {
  // Mock localStorage
  const store = new Map();
  globalThis.window = {
    localStorage: {
      getItem: (key) => store.get(key) ?? null,
      setItem: (key, val) => store.set(key, String(val)),
    },
  };

  const v1Data = {
    completedExerciseIds: ['l1-p1', 'l1-p2'],
    queuedReviewExerciseIds: ['l1-p3'],
    passedLevelIds: ['level-1'],
    examAttempts: { 'level-1': 1 },
    lastExamQuestionIds: { 'level-1': ['l1-e1', 'l1-e2'] },
    skillStats: {
      select: {
        attempts: 10,
        correct: 8,
        lastPracticedAt: '2026-09-01T12:00:00Z',
      },
    },
  };

  store.set('sql-land-progress-v1', JSON.stringify(v1Data));

  const migrated = loadProgress();
  assert.deepEqual(migrated.completedExerciseIds, ['l1-p1', 'l1-p2']);
  assert.deepEqual(migrated.passedLevelIds, ['level-1']);
  assert.equal(migrated.exerciseRepetition['l1-p3'].box, 1);
  assert.ok(migrated.skillStats.select.recentAttempts.length > 0);
  assert.equal(migrated.skillStats.select.attempts, 10);
  assert.equal(migrated.skillStats.select.correct, 8);
  // Confirm migrated into v2 storage key
  assert.ok(store.has('sql-land-progress-v2'));
});
