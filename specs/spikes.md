# Phase 0 spikes — results

Date: 2026-10-05 · Core: local `../nooblyjs-core` (v1.0.10) · Node 24

Each spike was run against the real core with throwaway scripts. The specs have been updated to match these results.

## 1. appservice mount contract — confirmed, with constraints

- `appservice` resolves `./src/services`, `./src/data`, `./src/routes`, `./src/views` relative to **`process.cwd()`**, in that order. `./src/activities/index.js` is mounted too if it exists. It also exposes `./README.md` at `/readme`, and `./docs` at `/docs` when present.
- `mountFiles` requires **every top-level `.js` file** in each folder, not just `index.js`. It calls each export as `fn(type, options, eventEmitter)`. Subfolders are ignored.
  - Consequence: a class file at the top level of `src/services/` would be *called* without `new` and throw. Top-level files in these folders must export mount functions. Classes go in subfolders (e.g. `src/services/modules/`).
  - Consequence: `src/views/index.js` serves only `src/views/public/`, so the module's own source is never exposed.
- The same `options` object, merged with the registry's global options, reaches every mounted file. The app passes `options.context` (registry, core services, helpers) through `serviceRegistry.appservice('default', { …, context })`.
- Entry points call `process.chdir(rootDir)` so the cwd assumption always holds.

## 2. `scheduling.startCron(string, …)` callback — confirmed

`startCron('tick.js', '* * * * *', 'name', cb)` runs the script in a worker. `cb(status, data)` then fires **in the main process** with `status === 'completed'`. `runNow(name)` works. `update(name, { cron })` changes the expression in place. `start(name, script, data, intervalSec, cb, opts)` fires on schedule.

The tick-activity + callback pattern (ARCHITECTURE §8.3) is viable as designed.

## 3. dataservice caller-supplied id — not supported

`dataService.add(container, { id: 'my-id', … })` returns a generated UUID. `getByUuid(container, 'my-id')` returns `null`. Snapshot restore therefore needs the stable `id`-inside-the-record approach with an `id → uuid` map in `DocumentRepo`, as described in ARCHITECTURE §8.8.

## 4. PDF parsing inside a worker — confirmed, with constraints

- An activity read a 10-page PDF from an absolute path and parsed it with `pdf-parse` (4,286 characters). Errors such as a missing file or a bad PDF come back to the callback as `status === 'error'` with the message.
- Activities resolve packages from **their own location**. The sample must therefore list `pdf-parse` as a direct dependency, because the core's copy is not resolvable from `activities/`. Require `pdf-parse/lib/pdf-parse.js`, not the package root: its `index.js` runs debug code when it has no parent module.
- The working service polls its queue about once a second, so each pipeline step costs at least ~1 s.

## Phase 2 findings

| Finding | Effect |
|---|---|
| Small PDFs fail with "bad XRef entry" **only inside worker threads**. In the worker, `fs.readFile` returned the PDF as a slice 8 bytes into a shared 64 KB buffer pool, and pdf.js reads the whole underlying `ArrayBuffer` from byte 0. Larger files get their own allocation, so they worked | `extract-text` passes `new Uint8Array(buffer)` (a copy that owns its memory) to pdf-parse |
| The workflow service stores every step's `inputData` and `outputData` in its run history (default 1,000 runs per workflow) | Steps exchange file paths, not text; history capped at 200 runs (`maxExecutionsPerWorkflow`) |
| `notifying.notify()` calls subscribers synchronously and does not await them | Subscribers catch their own errors; an escaped async error would become an unhandled rejection and shut the app down |
| `workflow.executeWorkflow()` resolves with the failed run record instead of throwing | `IngestService` checks `run.status` and finds the failed step in `run.stepExecutions` |
| The core workflow manager UI loads from `/services/workflow/scripts`, which needs no login | The admin workflows page embeds it; its API calls use the admin's session |

## Additional findings during Phase 0

| Finding | Effect |
|---|---|
| `/services/*` requires an **admin** session except `/services/css/*`, `*/scripts`, `*/status`, static assets, auth views/login, profile and `/services/filing/api/*` | Members cannot call `/services/searching/api/autosuggest`. Member autosuggest moves to `/api/v1/search/suggest` (direct `searching.autoSuggest()`). The core REST APIs remain the integration style for admin screens |
| The auth providers register serializers on the core's own `passport` instance | The app resolves `passport` from `nooblyjs-core`'s location instead of depending on its own copy |
| The core registers routes with Express 4 patterns (`:name(*)`) | The sample pins `express@^4` |
| Without authservice, `/services/*` redirects to a login page that does not exist | authservice is created in Phase 0 (portal login only). App-level roles and guards stay in Phase 1 |
| Creating authservice also instantiates caching, queueing and dataservice (its injected dependencies) with default providers | `/api/v1/info` already reports 7 of 16 services running after Phase 0 |
| Settings and auth warn when using built-in development secrets | `.env.example` documents `SETTINGS_SECRET` / `SESSION_SECRET` / `DEFAULT_ADMIN_PASSWORD` |
