# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Project

Noobly Knowledge Hub is a sample app that uses all 16 `nooblyjs-core` services, each with its **default provider**. The specs in `specs/` are the source of truth:
- `PRD.md`: requirements and their IDs (FR-*)
- `ARCHITECTURE.md`: wiring, flows and the verified core API methods (§6)
- `ROADMAP.md`: phases; build the current phase only
- `spikes.md`: confirmed core behaviour

`nooblyjs-core` comes from the sibling checkout `../nooblyjs-core` (`file:` dependency). Read its source, not its README: parts of the README are stale (it shows `cache.set`, `dataService.create`, `auth.register`).

## Commands

- `npm start` / `npm run dev` (port `PORT`, default 3000)
- `npm run dev:noauth`: no login or API keys (sets `ALLOW_NOAUTH=1`)
- `npm test`; one file: `npm test -- tests/unit/appSettings.test.js`
- `npm run coverage`

## Rules

- **Providers are chosen only in `src/config/services.js`.** Use the registry default and no `instanceName`, so the app shares the singletons the registry injects into dependent services.
- **appservice mounts every top-level `.js`** in `src/services`, `src/data`, `src/routes` and `src/views` as `fn(type, options, eventEmitter)`, relative to `process.cwd()`. Put classes in subfolders. Shared objects arrive as `options.context`.
- **Integration styles.** Server-side domain logic calls services directly through the registry. Browser admin screens may call `/services/{svc}/api/*` or embed the core UI widgets. `/services/*` is admin-only, so member features always go through `/api/v1`. Never write domain data through core endpoints from the browser.
- **Activities (`activities/`) run in worker threads with their own empty registry.** They must be pure (data in, data out). Do side effects in the main process: after `workflow.executeWorkflow()` resolves, or in scheduling callbacks. Activities resolve packages from their own location, so their dependencies must be direct dependencies of this repo.
- `passport` is resolved from `nooblyjs-core`'s location (see `createApplication.js`) so the auth providers' serializers apply. Keep Express on v4.
- **Errors:** throw `ClientError(status, msg)` from `nooblyjs-core/src/shared/utils/httpErrors` for 4xx, and respond with `sendSafeError`. Never send `err.message` for 5xx. Validate input with `validate` / `parseLimit` from `nooblyjs-core/src/shared/utils/validation`.
- **Logging:** use the injected logger with a `[ClassName]` prefix and structured metadata.
- **Pages:** Bootstrap 5.3 + `/services/css/styles.css` + `/services/css/core.css` + `/css/app.css`. Use colour tokens (`var(--accent)`), not hex. No inline scripts; put JS in `src/views/public/js/`. Pages must work at 375 px.
- **Output:** runtime data goes only in `.application/`; test output only in `.temp/` (`tests/helpers/testApp.js` gives each suite its own data root). Tests must close the app (`application.close()`) in `afterAll`.
- **Commits:** conventional format, e.g. `feat(library): …`, `chore(phase-0): …`.
