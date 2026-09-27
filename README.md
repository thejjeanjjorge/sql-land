<p align="center">
  <img src="public/logo.svg" width="96" height="96" alt="SQL Land logo">
</p>

# SQL Land

A local-first PostgreSQL practice app. Work through short rule cards, solve varied questions across 16 levels, pass level exams, and revisit skills from the Review screen.

## Open it

**In your browser, nothing to install:** https://thejjeanjjorge.github.io/sql-land/

## Run your own copy

1. Install [Node.js](https://nodejs.org) (the LTS version, 20.19 or newer).
2. Download this repo: the green **Code** button → **Download ZIP**, then unzip it. Or use `git clone`.
3. Double-click the launcher in the folder:
   - **Windows:** `Start SQL Land.bat`
   - **Mac:** `Start SQL Land.command`. The first time, macOS may block it: right-click it, choose **Open**, then **Open** again.

The first run sets things up, which takes a minute. After that, the app opens in your browser. Keep the launcher window open while you practice, and close it to stop SQL Land.

Progress is saved in the browser you use, so the online version and your own copy each keep their own progress.

### From a terminal

```bash
npm install
npm start
```

`npm start` opens the app in your browser. To verify the production build and curriculum:

```bash
npm test
npm run build
```

## How practice works

- Each level starts with small rule cards, followed by practice questions in at least five formats. These include writing queries, choosing code, filling blanks, fixing SQL, predicting results, answering from explored data, matching output, and correcting logic bugs.
- Each level draws four questions from an eight-question exam pool. Three correct answers pass and unlock the next level. Exam answers appear after the attempt, and retries favor new questions.
- SQL runs in a browser Web Worker using PGlite. Query answers are compared with reference results on both sample and expanded datasets, so equivalent SQL can pass. The content validator also loads a deterministic fixture with 2,000 orders.
- Review offers short sessions for unlocked skills. The app records the last practice date and answer accuracy for each skill.
- Progress is saved in this browser's local storage. It does not sync between devices or browsers.

## Add more content

Curriculum files live in [`src/content`](src/content), with instructions in [`src/content/README.md`](src/content/README.md). Each fixture is a complete PostgreSQL schema and data script; each question has a reference query or marked choice. Run `npm test` after changing content to validate every question against both fixtures.

The app code is in `src/App.tsx`, the reusable question interface in `src/QuestionPlayer.tsx`, and the worker-based SQL engine in `src/engine`.

## Credits

SQL Land was made in collaboration with [Claude](https://claude.ai) by Anthropic. The lesson content was researched from open source material.
