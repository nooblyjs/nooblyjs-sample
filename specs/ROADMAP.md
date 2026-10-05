# Roadmap — Noobly Knowledge Hub

| | |
|---|---|
| **Status** | Draft |
| **Date** | 2026-10-05 |
| **Companion docs** | [PRD.md](./PRD.md) · [ARCHITECTURE.md](./ARCHITECTURE.md) |

The roadmap is ordered so that **each phase adds core services only after the services they depend on are in place**, following the registry's dependency levels. Each phase ends with a runnable app. Durations are rough single-developer estimates.

---

## Service adoption at a glance

| Service (default provider) | P0 | P1 | P2 | P3 | P4 | P5 | P6 |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| logging (`memory`) | ● | | | | | | |
| settings (`file`) | ● | | | | | | |
| appservice | ● | | | | | | |
| caching (`memory`) | | ● | | | | | |
| dataservice (`memory`) | | ● | | | | | |
| filing (`local`) | | ● | | | | | |
| authservice (`file`) | ○ | ● | | | | | |
| queueing (`memory`) | | | ● | | | | |
| working (`memory`) | | | ● | | | | |
| workflow (`memory`) | | | ● | | | | |
| notifying (`memory`) | | | ● | | | | |
| searching (`memory`) | | | | ● | | | |
| fetching (`node`) | | | | ● | | | |
| scheduling (`memory`) | | | | | ● | | |
| measuring (`memory`) | | | | | ● | | |
| aiservice (`claude`) | | | | | | ● | |
| *(hardening, all)* | | | | | | | ● |

● = introduced and used for a real feature in that phase. ○ = wired early for infrastructure only (authservice provides the `/services` admin login from Phase 0; creating it also instantiates caching, dataservice and queueing as injected dependencies). After P5, all **16 / 16** services are in use.

---

## Phase 0 — Scaffold and spikes (2–3 days) — ✅ done 2026-10-05

**Goal:** an empty app that boots with the core's security posture and resolves the open technical questions.

| Deliverable | Services |
|---|---|
| `package.json` (`nooblyjs-core` from the local checkout via `file:../nooblyjs-core`), scripts `start`, `dev`, `dev:noauth`, `test`, `coverage`, `test:ui` | — |
| `app.js` and `app-noauth.js`, adapted from the core `app.js`: helmet + CSP, cors, body limits, session store, passport, API keys, `serviceRegistry.initialize`, error handler, graceful shutdown | logging |
| `src/config/services.js` skeleton: the single provider choice point | — |
| `src/config/settingsSchema.js`; create groups `app`, `library`, `pipeline`, `digest`, `ai` with defaults on first boot | settings |
| `appservice` mounting of `src/routes`, `src/views`; home page with design tokens loaded from `/services/css/*` | appservice |
| `/health*` via core `healthCheck` middleware | — |
| authservice created so the `/services` dashboards have a working admin login (app-level roles come in Phase 1) | authservice |
| `.env.example`, `.gitignore` (`.application/`, `.temp/`), `CLAUDE.md` for the sample | — |

**Spikes:** results are recorded in [`spikes.md`](./spikes.md); all four are resolved.
1. appservice `mountFiles` contract and mount order (ARCHITECTURE §3).
2. `scheduling.startCron(string, …)` callback behaviour (§8.3).
3. Whether dataservice `memory` accepts a caller-supplied id, or restore needs the id map (§8.8).
4. Whether a worker-thread activity can `require('pdf-parse')` and read a path under `FILING_BASE_DIR`.

**Exit criteria:** `npm start` serves `/` and `/services`; `/health/ready` is 200; a settings value survives a restart (encrypted file present).

---

## Phase 1 — Accounts and document library (MVP core, 4–5 days) — ✅ done 2026-10-05

**Goal:** signed-in users can upload, list, view, download, edit and delete documents.

| Deliverable | Services |
|---|---|
| Login, register and logout through the built-in auth views. `loginSuccessRedirectUrl: '/'`. Default admin bootstrap. `requireAuth` / `requireRole('admin')` helpers. `/api/v1/me` | authservice |
| `DocumentRepo` (extends `appDataBase`) over the `documents` container | dataservice |
| `LibraryService.upload/list/get/update/delete`; multer with the settings-driven size/type limits; files under `library/{id}/` | filing |
| Detail caching `doc:{id}` with invalidation on write | caching |
| Pages: `/library`, `/doc/:id` (Bootstrap, phone-width) | — |
| Demo content committed under `seed/` (markdown, text, CSV, JSON, HTML, a small PDF) | — |
| Structured logs on every mutation; admin link to `/services/logging` | logging |
| Jest: repo and service unit tests; supertest authorisation matrix | — |

**Exit criteria:** FR-AUTH-1/3/4 and FR-DOC-1…6 pass. Documents stay `queued`, because there is no pipeline yet.

**Outcome:**
- Delivered as planned, plus FR-AUTH-5 (personal `dtk_` tokens work on `/api/v1`).
- Admin-only writes on `/services/filing/api`, because the core lets any signed-in user upload or remove files there.
- Demo content loads into an empty library on boot (`SEED_DEMO_CONTENT=false` turns it off), so `npm run seed` is no longer needed in Phase 6.
- Known limitation until Phase 4: document metadata is in memory, so after a restart only the demo content comes back. Uploaded files stay on disk but are not listed.

---

## Phase 2 — Ingestion pipeline and notifications (4–5 days)

**Goal:** uploads are processed asynchronously into `ready` documents, and users are told when that happens.

| Deliverable | Services |
|---|---|
| `ingest` queue; upload enqueues `{ docId }` and returns 202 | queueing |
| Activities `extract-text` (txt/md/json/csv/html/pdf), `normalise-text`, `analyse-text`: pure functions with unit tests. Add `pdf-parse` as a direct dependency (spikes.md §4) | working |
| `ingest-document` workflow defined at boot; `IngestService.drain()` runs `executeWorkflow` and applies side effects in the main process | workflow |
| Topics `document.ingested`, `document.failed`, `system.alert`; subscribers write to the `activity` container and increment unread counters in cache | notifying |
| Retry for failed documents; notification bell and `/activity` page | — |
| Admin `/admin/workflows` embedding `WorkflowManagerUI` | workflow (UI) |

**Exit criteria:** FR-ING-1…5 and FR-NTF-1…3 pass. An integration test uploads a `.md` and a `.pdf` and sees both reach `ready` with stats. A corrupt PDF ends `failed` with a safe error.

---

## Phase 3 — Search and URL import (3–4 days)

**Goal:** the library is searchable, and web pages can be imported.

| Deliverable | Services |
|---|---|
| Index `documents` on `ready`; remove on delete; `replace` on title or tag edit | searching |
| `SearchService` with snippets, tag filter, cached results and the generation-counter invalidation | searching, caching |
| `/search` page; autosuggest via `/api/v1/search/suggest` → `searching.autoSuggest()` (the core endpoint is admin-only) | searching |
| `ImportService` using `fetching.fetch` (SSRF guard, response cache), HTML → text, reuses the ingest path; `imports` container | fetching |
| Admin "Reindex" action | — |

**Exit criteria:** FR-SRCH-1…3 and FR-IMP-1…3 pass. Searching for a word from an uploaded PDF returns it with a highlighted snippet. A second import of the same URL is served from the fetch cache, which is visible on the `/services/fetching` dashboard.

---

## Phase 4 — Jobs, metrics, durability and the admin console (4–5 days)

**Goal:** background jobs run on schedules, the app is measurable, and **data survives restarts on default providers**.

| Deliverable | Services |
|---|---|
| `JobsService`: `ingest-drain` (interval), `snapshot` (interval), `daily-digest` (cron from settings) using the tick-activity + callback pattern; reacts to settings changes via `scheduling.update` | scheduling |
| `DigestService`: yesterday's new documents → `digests` container → `digest.ready` | notifying, dataservice |
| `SnapshotService` save/restore through `filing` (`_system/snapshot.json`), including `workflow.exportState()` / `importState()`; search index rebuild; re-enqueue stuck documents; final snapshot on SIGTERM | filing, workflow |
| `MetricsService` recording the metric names in ARCHITECTURE §7.2 | measuring |
| `/admin` console: KPI tiles (measuring + `dataservice.count` + core `/services/queueing/api/size/*`), log tail, links to all 16 dashboards | measuring, logging |
| `/admin/jobs` embedding `ScheduleManagerUI`; `/admin/settings` embedding `SettingsUIManager` | scheduling, settings (UI) |

**Exit criteria:** FR-SCH-1…4, FR-SET-1…3 and FR-OPS-1…4 pass. Integration test: seed → snapshot → `serviceRegistry.reset()` → boot → documents, activity, workflow history and search results are all back.

---

## Phase 5 — AI features (3 days)

**Goal:** optional AI summaries and tags. ("Ask the library" Q&A is out of scope.)

| Deliverable | Services |
|---|---|
| Conditional `aiservice('claude', { apiKey, model })`. The key comes from `ANTHROPIC_API_KEY` or settings `ai.apiKey` (secret); the model from `AI_MODEL` or settings; `aiEnabled` is exposed via `/api/v1/me` | aiservice |
| `ai-summaries` queue + `ai-drain` job; JSON-structured summary/tags prompt; result stored and re-indexed | queueing, scheduling, searching |
| Prompt-hash response cache; `ai.tokens` metric; link to the `/services/ai` dashboard | caching, measuring |
| UI: summary card, "Summarise" button, hidden when AI is disabled | — |

**Exit criteria:** FR-AI-1/2/4 pass with a key. Without a key the app boots, all AI UI is hidden and AI endpoints return 503. A unit test stubs `prompt()` to cover parsing and failure paths.

**Milestone v1.0:** all **16 services in use** with default providers. The startup self-test asserts that `serviceRegistry.listServices()` contains one entry for each of the 16 services.

---

## Phase 6 — Hardening and release (3–4 days)

| Deliverable |
|---|
| Coverage ≥ 60 % (`coverageThreshold`); tests write only to `.temp/` |
| Playwright: page smoke (no CSP violations, phone and desktop), main journey, admin pages |
| Demo content (loaded on boot since Phase 1) extended so every core dashboard shows activity |
| Dockerfile (`node:24-alpine`, non-root, `HEALTHCHECK /health/live`, `.application` volume); refuses to start in production without secrets |
| GitHub Actions: coverage on Node 22 and 24, UI tests, `npm audit --omit=dev --audit-level=high`, Docker build + boot check |
| README: 5-minute quickstart, a "where each service is used" table linking to source files, and how to fork the template |

**Exit criteria:** PRD §8 success criteria are all met. Tag `v1.0.0`.

---

## Phase 7+ — Beyond defaults (backlog)

Each item is meant to be a one-line change in `src/config/services.js`, plus docs. Each one proves the "swappable" goal (G5).

| Item | Notes |
|---|---|
| `logging` → `file` | Persistent logs under `.application/logs` |
| `dataservice` → `file` or `mongodb` | Remove containers from the snapshot; keep the workflow snapshot |
| `queueing` + `caching` → `redis`, sessions → Redis | Enables multiple replicas; scheduler leader election is needed |
| `searching` with `indexDir`, or `solr` | Removes the rebuild-on-boot step |
| `searching` → `vector` / semantic | Semantic search |
| `filing` → `s3` / `gcp` | Pipeline must download to a temp path before running workers |
| `authservice` → `google` / `azure` SSO | |
| `aiservice` → `ollama` (local) / `openai` / `gemini` | Fully offline AI demo with Ollama |
| Remote service mode (`*Api` providers) | Split the pipeline into a second process that uses `working('api')` / `queue('api')` |

---

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| In-memory defaults lose data on crash | Up to one snapshot interval of loss | Snapshot every 5 min + on shutdown + debounced on workflow changes; documented in PRD §7 |
| Worker threads cannot see main-process services | Pipeline bugs if activities try side effects | Pure-activity rule (ARCHITECTURE §8.2), enforced by code review and unit tests that run activities without a registry |
| Core API drift (README vs source) | Wrong method calls | ARCHITECTURE §6 lists verified methods; the integration test exercises every service |
| `claude` provider throws without a key | Boot failure | Conditional construction (FR-AI-1) + test for the no-key boot |
| Appservice auto-mount conventions don't fit | Rework of the layout | Phase 0 spike, with an explicit-require fallback |
| Core and sample both evolving | Breakage | `file:../nooblyjs-core` keeps them in lockstep; CI must check out both repos side by side |
