# SQL Land — Improvement Plan

This file is a work order for an AI assistant (or developer) improving this project. Read all of it before changing any code.

## Who this app is for

The learner finds writing plain SQL boring but wants to become genuinely good at it. The app must therefore:

- **Challenge** them: business-style problems, traps and multi-step "boss" questions rather than keyword drills.
- **Vary** the exercises: many different formats, so practice never turns into typing the same kind of query over and over.
- **Prevent memorization**: an exercise should not be passable by remembering the previous answer.

The current app is a solid foundation but covers only about 1–2 hours of beginner material (36 questions, 4 levels).

## Rules for making changes

1. Work **one phase at a time**, in the order below. Do not start a phase until the previous phase's acceptance criteria pass.
2. Run `npm test` and `npm run build` after every change. Both must pass.
3. Do not rename existing tables, columns or exercise IDs. Saved progress and existing questions depend on them. Only add.
4. Keep what already works well:
   - SQL runs in a Web Worker using PGlite (`src/engine/sqlWorker.ts`).
   - Queries run inside a read-only transaction.
   - Answers are graded on two fixtures, which catches hard-coded answers.
   - Content lives in `src/content`, separate from UI code.
   - The validator proves that exactly one multiple-choice option is correct.
5. When you finish an item, tick its checkbox in this file.
6. Prefer small components and files. Do not write long single-line JSX.

---

## Phase 1 — Fix grading bugs

Each bug below was reproduced against the real grading logic in `src/engine/sqlWorker.ts`.

### 1.1 Sorted answers pass without `ORDER BY`
- [x] **Problem:** `l2-p5` (`src/content/levels.ts`, "Recent shipped orders", asks for "earliest first") accepts a query with no `ORDER BY`. Orders are inserted in date order in both fixtures, so the default row order happens to match.
- **Reproduce:** `SELECT id, order_date FROM orders WHERE status='shipped' AND order_date >= '2026-01-10'` is graded correct.
- **Fix:**
  - Insert rows into the challenge fixture in a shuffled (non-sorted) order.
  - Add a validator check: for every `orderMatters: true` question, the solution with its `ORDER BY` clause removed must produce a different result on at least one fixture.
- **Done when:** the reproduce query is rejected and the new validator check passes for all questions.

### 1.2 Required column names are not checked
- [x] **Problem:** prompts say things like "named order_count", but `SELECT COUNT(*) FROM orders` is accepted. `difference()` in `src/engine/sqlWorker.ts` compares only the number of columns, never their names.
- **Fix:**
  - Compare column names, ignoring case.
  - Add an optional `checkColumnNames?: boolean` field to `Exercise` (default `true`), so a question can opt out when names don't matter.
  - Give a specific message, e.g. "Rename column `count` to `order_count`."
- **Done when:** `SELECT COUNT(*) FROM orders` is rejected for `l3-p1` with that message, and `SELECT COUNT(*) AS order_count FROM orders` passes.

### 1.3 Numeric comparison is too strict
- [x] **Problem:** PGlite returns `NUMERIC` values as strings (for example `AVG(price)` returns `"17.5625000000000000"`). A correct `ROUND(AVG(price), 2)` is marked wrong.
- **Fix:** normalize numeric strings and JS numbers to numbers, then compare with a tolerance (e.g. `1e-6`), or allow a per-question `decimals` setting. Where a question needs rounding, say so in the prompt and round in `solutionSql`.
- **Done when:** a grader unit test shows `ROUND(AVG(price), 2)` matching a reference that also rounds to 2 decimals, and `COUNT(*)::int` matching `COUNT(*)`.

### 1.4 Misleading feedback messages
- [x] **Problem:** correct columns in the wrong order (`SELECT price, name` instead of `name, price`) produce "Some values differ from the expected result."
- **Fix:** detect and report each case separately:
  - Same columns, different order → "Your columns are in a different order: expected name, price."
  - Duplicate rows where the expected result has none → "You have duplicate rows. Do you need DISTINCT?"
  - Missing rows → "You are missing N rows."
  - Extra rows → "You returned N extra rows."
  - Rows correct but in the wrong order (when `orderMatters`) → "Right rows, wrong order."
- **Done when:** each case has a grader unit test with the expected message.

### 1.5 Practice mode can dead-end
- [x] **Problem:** in practice mode, the Continue button only appears after a correct answer (`isFrozen` in `src/QuestionPlayer.tsx`). A stuck learner cannot move on.
- **Fix:** after 3 failed checks, show a "Show solution" button. Revealing the solution unlocks Continue but does **not** mark the exercise completed. Queue it for review instead (see Phase 5).
- **Done when:** a learner can get past any practice question after 3 wrong attempts.

### 1.6 Multiple choice can be brute-forced
- [x] **Problem:** a wrong choice in practice doesn't lock, so the learner can click through all four options. The options are also never shuffled, so the correct letter is always in the same position.
- **Fix:** shuffle the options each time the question is shown. After a wrong pick, lock the question and show the explanation (practice mode may offer "Try a similar question" instead of a retry).
- **Done when:** option order differs between sessions and a second guess on the same question is impossible.

### 1.7 Exams can be memorized
- [x] **Problem:** each exam has 3 fixed questions, the reference SQL is shown immediately after a wrong answer (`src/QuestionPlayer.tsx`, exam branch of `handleCheck`), and retries are unlimited. Anyone can pass on the second try by copying.
- **Fix:**
  - Give each level an exam **pool** of 8–10 questions and draw 3–4 at random per attempt, with at least one `write` question.
  - Do not reveal reference answers until the exam is over; show them on the results screen.
  - On a retry, prefer questions the learner hasn't seen in the previous attempt.
- **Done when:** two consecutive exam attempts for the same level show different questions, and no answer is visible before the results screen.

### 1.8 Shared comparator and grader tests
- [x] **Problem:** `src/content/validate.mjs` has its own comparison function (`signature()`) that behaves differently from `difference()`/`canonical()` in `sqlWorker.ts`. Content could validate but grade differently in the app.
- **Fix:** move the comparison into one shared module (e.g. `src/engine/compare.ts`) used by both the worker and the validator. Add unit tests (e.g. with Vitest) covering items 1.1–1.4.
- **Done when:** `npm test` runs both the content validator and the grader unit tests.

**Phase 1 acceptance:** all items above ticked; `npm test` and `npm run build` pass.

---

## Phase 2 — Richer data and a stronger validator

### 2.1 Expand the fixtures (`src/content/fixtures.ts`)
- [x] **Problem:** every column is `NOT NULL`, every customer has at least one order, and every product has sold. As a result `LEFT JOIN` and `INNER JOIN` give identical answers, and NULL handling cannot be taught.
- **Add these columns and tables** (keep all existing ones):
  - `customers`: `email TEXT NULL`, `signup_date DATE`, `referred_by INTEGER NULL REFERENCES customers(id)` (for self-joins and recursive CTEs).
  - New `categories(id, name, parent_id NULL)`: a category tree at least 3 levels deep. Add `products.category_id` alongside the existing `category` text column.
  - `orders`: `shipped_at TIMESTAMP NULL`, `discount_code TEXT NULL`.
  - New `payments(id, order_id, amount, paid_at, method)`. Include orders with multiple payments and orders with partial payments, so joining payments and order_items together double-counts totals.
  - New `reviews(id, product_id, customer_id, rating INTEGER NULL, created_at)`.
- **Rows that must exist:**
  - customers with no orders
  - products that never sold
  - two or more products with the same price (ties)
  - two different customers with the same name
  - orders spanning at least 18 months across 2 calendar years
  - at least one NULL in every nullable column
  - a cancelled order that still has a payment

### 2.2 Validator upgrades (`src/content/validate.mjs`)
- [x] Remove the hard-coded "exactly 6 practice / 3 exam" rule. Require a minimum instead (e.g. ≥ 6 practice, exam pool ≥ 8).
- [x] For `fix` questions: check that `starterSql` either errors or returns a different result from `solutionSql`.
- [x] For `complete` questions: add a `blankAnswers: string[]` field. Check that the template parts joined with `blankAnswers` produce the same result as `solutionSql`.
- [x] For `orderMatters` questions: check that the ORDER BY keys have no ties in any fixture, so the expected order is deterministic.
- [x] Add an optional `commonMistakes: { sql: string; feedback: string }[]` field to `Exercise`.
  - The validator must confirm each mistake query produces a **different** result from the solution on at least one fixture.
  - The grader uses them too: if the learner's result matches a known mistake's result, show that mistake's `feedback`. This gives targeted feedback for free.

**Phase 2 acceptance:** new fixtures load in both the app and the validator; all existing questions still pass; new checks are active.

---

## Phase 3 — New exercise formats (the fix for "SQL is boring")

Add each format as a new `ExerciseKind` in `src/content/schema.ts`, with a renderer in the UI and validator support. Implement them in the order listed. Each level should eventually mix at least 5 different formats.

- [x] **3.1 `answer` — answer the question.** A business question with a single-value answer, e.g. "Which city brought in the most revenue in March 2026?" The learner explores with as many queries as they like, then types the answer. Graded against the single cell returned by `solutionSql` (normalized: trim, case-insensitive text, numeric tolerance).
- [x] **3.2 `predict` — predict the output.** Show a query; the learner picks the correct result table from 3–4 options, or types a value such as a row count. Builds understanding without typing SQL.
- [x] **3.3 `match` — match the output.** Show only a target result table and no written prompt. The learner writes the query that produces it.
- [x] **3.4 `bug` — spot the logic bug.** The query runs without errors but returns the wrong answer. The learner fixes it, or picks the reason it is wrong. Use the traps in Phase 4. Gradually replace typo-only `fix` questions such as `SELCT`, which teach little.
- [x] **3.5 Constraint challenges.** Add optional `requiredPatterns` and `forbiddenPatterns` fields to any `write` question, e.g. "solve without JOIN", "must use a window function", "no subqueries". Check them against the SQL text with comments and string literals stripped.
- [x] **3.6 `order` — clause shuffle (Parsons problem).** Scrambled clauses the learner drags into the correct order.
- [x] **3.7 `explain` — explain it.** Pick the plain-English description that matches a query.
- [x] **3.8 `refactor` — refactor.** Rewrite a messy nested query as a CTE. Graded on result plus a required `WITH`.
- [ ] **3.9 Two ways.** A paired question: solve with JOIN, then solve again with EXISTS (uses 3.5).
- [ ] **3.10 Query golf.** Shortest correct query (whitespace-normalized length). Store the personal best in progress.
- [ ] **3.11 Speed round.** 90 seconds of rapid `predict`/`choose`/`explain` questions, with the score saved.
- [ ] **3.12 Case files (story mode).** A mystery in which each query result unlocks the next clue (in the spirit of SQL Murder Mystery). Build it as its own content pack with its own fixture.

**Phase 3 acceptance:** formats 3.1–3.8 are implemented, validated and used in existing levels; each level uses at least 5 distinct formats.

---

## Phase 4 — Harder, deeper curriculum

### 4.1 Rewrite prompts in business language
- [ ] Prompts must not contain SQL keywords or give away the solution. Hints must not contain the full answer.
  - Before: *"Which query shows customer IDs with more than one order and their order_count?"* Hint: *"Use HAVING COUNT(\*) > 1 after grouping by customer_id."*
  - After: *"Marketing wants to thank repeat buyers. Who are they, and how many orders has each placed?"*
- [ ] Replace the single `hint` with `hints: string[]` (tier 1: nudge; tier 2: name the concept; tier 3: partial code). Record how many hints were used and reduce the score for each.

### 4.2 Difficulty tiers
- [ ] Add `difficulty: 'warmup' | 'core' | 'stretch' | 'boss'` to `Exercise`.
- [x] Every level ends with at least one multi-step **boss** question that combines the level's skill with earlier skills.

### 4.3 New levels
Append these after the existing 4 levels. Add each new skill to the single skill registry (see Phase 6).

| # | Topic |
|---|---|
| 5 | DISTINCT, LIMIT/OFFSET, computed columns (`quantity * price`), ROUND, casting |
| 6 | IN, BETWEEN, LIKE/ILIKE, NOT, AND/OR precedence and parentheses |
| 7 | NULLs: IS NULL, COALESCE, NULLIF, NULLs in aggregates, COUNT(\*) vs COUNT(col) |
| 8 | CASE, conditional aggregation (`SUM(CASE …)`, `FILTER (WHERE …)`), pivots |
| 9 | LEFT JOIN, anti-joins, 4-table joins, self-joins |
| 10 | Subqueries: scalar, IN, EXISTS/NOT EXISTS, correlated, derived tables |
| 11 | CTEs, including recursive (referral chain, category tree) |
| 12 | Dates: date_trunc, EXTRACT, intervals, generate_series gap-filling |
| 13 | Window functions I: ROW_NUMBER/RANK/DENSE_RANK, top-N per group |
| 14 | Window functions II: running totals, moving averages, LAG/LEAD, period-over-period |
| 15 | UNION/INTERSECT/EXCEPT, string_agg, string functions |
| 16 | Analyst capstones: cohort retention, funnels, month-over-month growth, "latest row per group" |

Optional level 17 — changing data (INSERT/UPDATE/DELETE, constraints, transactions, indexes, EXPLAIN). This needs a different grader: run the statement on a fresh copy of the fixture and compare table state afterwards. The current read-only guard must stay in place for all other levels.

### 4.4 Trap library
- [x] Turn each classic mistake below into at least one `bug` question and one `commonMistakes` entry:
  - `WHERE col = NULL` returns nothing
  - `NOT IN (subquery)` returns nothing when the subquery contains a NULL
  - a WHERE filter on a LEFT JOIN's right-hand table silently turns it into an inner join
  - joining payments and order_items together double-counts totals (fan-out)
  - `COUNT(*)` after a LEFT JOIN counts customers with no orders as 1
  - `a OR b AND c` precedence without parentheses
  - integer division: `7 / 2 = 3`
  - `GROUP BY name` merges two different customers who share a name
  - `BETWEEN` on timestamps drops the last day
  - `ORDER BY … LIMIT` with ties gives a nondeterministic top-N (RANK vs ROW_NUMBER)

**Phase 4 acceptance:** 16 levels, every level has a boss question, no prompt contains its solution, every trap is covered.

---

## Phase 5 — Variation and memory

- [x] **5.1 Parameterized templates.** Questions whose values are filled in at random from the data:
  ```ts
  {
    prompt: 'Which {category} products cost under {max}? Show name and price.',
    params: {
      category: { fromSql: 'SELECT DISTINCT category FROM products' },
      max: { pick: [10, 15, 20] },
    },
    solutionSql: "SELECT name, price FROM products WHERE category = '{category}' AND price < {max}",
  }
  ```
  The validator must test every combination of parameter values.
- [x] **5.2 Seeded random data per session.** Generate a session dataset from a random seed, so result tables differ between sessions. Grade on it, plus a hidden fixture the learner never sees.
- [x] **5.3 Mixed review.** Review sessions mix questions from all unlocked skills, weighted toward weak skills, instead of one skill at a time (`reviewQuestions` in `src/App.tsx`).
- [x] **5.4 Per-question spaced repetition.** Leitner boxes: wrong → due tomorrow; right → due in 3, then 7, then 21 days. Store per-exercise state in progress. Solutions revealed in practice (1.5) go straight into box 1.
- [x] **5.5 Recent accuracy.** Compute skill accuracy over the last ~20 attempts instead of lifetime (`reviewStatus` in `src/progress.ts`), so improvement becomes visible. Migrate saved progress to a new storage key version without losing it.

**Phase 5 acceptance:** the same question can show different values on different days; review sessions mix skills; due dates are tracked per question.

---

## Phase 6 — UX and maintainability

### UX
- [ ] "Show target output" toggle in practice: first as a hint tier (first 3 rows), then the full table.
- [ ] Diff view after a wrong answer: expected rows next to the learner's rows, with missing and extra rows highlighted.
- [ ] Editor autocomplete: pass the schema to `sql({ dialect: PostgreSQL, schema })` in `src/QuestionPlayer.tsx`.
- [ ] Keyboard shortcuts: Ctrl+Enter to run, Ctrl+Shift+Enter to check.
- [ ] After a choice question is answered, let the learner run each option to see why the others are wrong.
- [ ] Light gamification: XP, a daily streak and a daily challenge. Keep it subtle.
- [ ] Export/import progress as a JSON file (progress currently lives only in localStorage).

### Code
- [ ] Split `src/App.tsx` into `HomeView`, `LessonView`, `ReviewView` and `SchemaPanel` components. The schema panel is currently duplicated in the exercise and review screens.
- [ ] One source of truth for skills. They are currently defined three times: the `SkillId` union (`src/content/schema.ts`), the `SKILLS` array (`src/App.tsx`) and `SKILL_LABELS` (`src/content/levels.ts`).
- [ ] Split `src/content/levels.ts` into one file per level (e.g. `src/content/levels/05-distinct.ts`) plus an index that exports `LEVELS`.
- [ ] Add ESLint with the React Hooks plugin.

**Phase 6 acceptance:** no component file over ~200 lines; adding a skill means editing one place; lint passes.

---

## How to verify at any point

```bash
npm install
npm test
npm run build
npm run dev
```

Then, in the running app:
1. Complete level 1 practice, fail the exam on purpose, and check that the retry shows different questions and that no answers appeared before the results screen.
2. On a sorted question, submit the correct rows **without** `ORDER BY` and check it is rejected.
3. Submit a correct query with a missing alias and check the message asks you to rename the column.
4. Get a practice question wrong 3 times and check that "Show solution" appears.
