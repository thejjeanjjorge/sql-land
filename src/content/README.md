# Adding a learning pack

The app reads its curriculum from `LEVELS` in `levels.ts`. Each level contains short rule cards, at least six practice exercises, an exam pool of eight to ten questions, `examDrawCount` (currently four), and the number of drawn exam answers needed to pass. The UI unlocks levels in array order, so append new levels after the existing ones and give every exercise a unique ID. Keep the question formats varied: `write`, `choose`, `complete`, and `fix`.

Every exercise needs a reference `solutionSql`. For `choose`, the `choose()` helper derives it from the option marked by `correctOptionId`. For `complete`, `templateParts` must have one more entry than `blankLabels`; the learner fills the gaps between parts. For `fix`, provide broken `starterSql`. Set `orderMatters: true` when the prompt requires a particular row order.

The schema and sample data live in `fixtures.ts`. Both exported SQL strings are independent scripts: each creates the tables and inserts all rows. Add representative rows to the base fixture and edge cases to the challenge fixture. Check that each reference query works on both fixtures and that only one choice option satisfies its prompt. Preserve existing table and column names when extending the pack, since prior exercises depend on them. For ordered questions, insert rows out of the requested order so a missing `ORDER BY` cannot accidentally pass.

Comparisons need boundary rows. For `write`, `fix`, `bug`, and `refactor` questions, the validator flips each `<`, `<=`, `>`, and `>=` in `solutionSql` (`<` becomes `<=`, and so on) and fails if the result stays the same in both fixtures, because an off-by-one answer would then pass. When that happens, add a row to the challenge fixture that sits exactly on the threshold: a product priced exactly 10.00 for `price < 10`, a shipment at midnight on the first of the next month for a month range, or a row equal to the average for `> (SELECT AVG(...))`. The boundary block at the end of the challenge fixture explains the rows already there; adding rows changes those averages, so recheck them.

After changing the content, run `node src/content/validate.mjs`. It checks the level structure, reference queries, and choice answers against both PostgreSQL fixtures.

To add an entirely separate topic pack later, create another content module with its own levels and fixtures, then register that pack in the app's content selector. Do not mix its data or progression IDs into this shop pack.
