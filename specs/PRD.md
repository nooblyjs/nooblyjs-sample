# Product Requirements Document — Noobly Knowledge Hub

| | |
|---|---|
| **Product** | Noobly Knowledge Hub (`nooblyjs-application-sample`) |
| **Built on** | [`nooblyjs-core`](../../nooblyjs-core) v1.0.x |
| **Status** | Draft |
| **Date** | 2026-10-05 |
| **Companion docs** | [ARCHITECTURE.md](./ARCHITECTURE.md) · [ROADMAP.md](./ROADMAP.md) |

---

## 1. Summary

Noobly Knowledge Hub is a small team knowledge base. Signed-in users upload documents or import web pages. An ingestion pipeline extracts and indexes the text, and the app can summarise each document with AI. Users can then search, browse and get notified about the library.

The product has two jobs:

1. **Reference application.** It shows how to use **every service in `nooblyjs-core`** with that service's **default provider**, wired together the way a real app would wire them. A developer should be able to read this codebase and know how to use any core service.
2. **Accelerator template.** It is a clean starting point that teams can fork, replacing the knowledge-base domain with their own while keeping the wiring, security, testing and deployment.

The app must start with `npm install && npm start`, with **no external infrastructure** (no Redis, MongoDB or message broker). The only optional external dependency is an Anthropic API key for the AI features.

## 2. Goals and non-goals

### Goals

- **G1 — Full coverage.** Every one of the 16 core services is used for a real feature, not a stub, through its default provider (§4).
- **G2 — Both integration styles.** The code shows both ways to consume a service:
  - **Direct calls** through `serviceRegistry` (server-side domain logic).
  - **The service's own REST API and embeddable UI** under `/services/{service}/…` (browser-side and admin features).
- **G3 — Zero-infrastructure start.** The app runs on a laptop with Node ≥ 18. If no AI key is set, the AI features are disabled cleanly without breaking anything else.
- **G4 — Production-shaped.** Uses the same security posture as the core reference `app.js`: helmet + CSP, sessions, API keys, health checks, graceful shutdown and Docker.
- **G5 — Swappable.** Changing a provider (e.g. `memory` → `redis` queueing) is a configuration change in one place, never a code change in features.

### Non-goals

- Multi-tenant SaaS, billing, or horizontal scaling (the default providers are single-process).
- Rich document editing or collaborative editing.
- Vector or semantic search (the default `searching` provider is BM25 keyword search; semantic search is a roadmap stretch item).
- Non-default providers in the first release. They are listed as upgrade paths only.

## 3. Users and personas

| Persona | Description | Primary needs |
|---|---|---|
| **Developer (primary)** | Evaluating or adopting `nooblyjs-core` | Readable, idiomatic examples of each service; a template to fork |
| **Member** | Signed-in knowledge-base user | Upload/import documents, search, read summaries, get notified |
| **Admin** | Operates the app | Manage users and roles, app settings, jobs, workflows; view logs and metrics |

## 4. Service coverage matrix

Every service is used with the provider that `ServiceRegistry.getDefaultProviderType()` returns. This is the provider dependencies receive automatically, so the app and the injected dependencies share a single instance.

| # | Service | Default provider | Used for (feature) | Integration style |
|---|---|---|---|---|
| 1 | **logging** | `memory` | Application and audit log for every feature; log viewer in the admin console | Direct + `/services/logging` dashboard |
| 2 | **caching** | `memory` | Cache document detail, search results, dashboard stats; invalidate on change | Direct |
| 3 | **queueing** | `memory` | `ingest` job queue between upload/import and the pipeline; `ai-summaries` queue | Direct + `/services/queueing/api/size` on admin page |
| 4 | **notifying** | `memory` | Pub/sub topics (`document.ingested`, `document.failed`, `digest.ready`) that drive the activity feed and in-app notifications | Direct |
| 5 | **appservice** | (type ignored) | Auto-discovers and mounts the app's `src/services`, `src/data`, `src/routes`, `src/views` | Direct (bootstrap) |
| 6 | **fetching** | `node` | "Import from URL": fetch a web page, with fetching's response cache | Direct |
| 7 | **settings** | `file` (AES-256-GCM encrypted) | App configuration: feature flags, upload limits, digest schedule, AI model and AI key override | Direct + embedded `SettingsUIManager` |
| 8 | **dataservice** | `memory` | Document metadata, imports, activity feed, digests (containers) | Direct + `/services/dataservice/api` |
| 9 | **working** | `memory` | Runs pipeline step activities in worker threads | Indirect (via workflow/scheduling) + `/services/working` dashboard |
| 10 | **measuring** | `memory` | Business metrics: uploads, ingest duration, searches, AI tokens | Direct + `/services/measuring/api/metrics` |
| 11 | **scheduling** | `memory` | Recurring jobs: queue drain, nightly digest, snapshot, stale-cache sweep | Direct + embedded `ScheduleManagerUI` |
| 12 | **searching** | `memory` | Full-text search, autosuggest and snippets over document text | Direct + `/services/searching` dashboard |
| 13 | **workflow** | `memory` | The `ingest-document` pipeline (extract → normalise → analyse) | Direct + embedded `WorkflowManagerUI` |
| 14 | **filing** | `local` | Stores uploaded files, imported pages and system snapshots on disk | Direct + `/services/filing/api/download` |
| 15 | **authservice** | `file` | Login, registration, roles (`admin`, `member`), invitations, personal API tokens | Built-in pages and API + `createAuthMiddleware` |
| 16 | **aiservice** | `claude` | Document summaries and suggested tags | Direct + `/services/ai` dashboard. **Optional**: enabled only when `ANTHROPIC_API_KEY` is set |

> **Note on defaults.** Many default providers (`memory`) are volatile. The product requirement in FR-OPS-4 (snapshot and rehydrate through **filing**) is what keeps the library across restarts without changing providers. This also demonstrates cross-service composition.

## 5. Functional requirements

Priority: **P0** = MVP, **P1** = full release, **P2** = stretch.

### 5.1 Authentication and accounts — *authservice, caching, dataservice*

| ID | Requirement | Pri |
|---|---|---|
| FR-AUTH-1 | Users sign in at the built-in `/services/authservice/views/login.html`. After login they are redirected to the app home page (`loginSuccessRedirectUrl`). | P0 |
| FR-AUTH-2 | Self-registration is behind a settings flag (`app.allowRegistration`). When it is off, users join through invitations (`/services/authservice/api/invitations`). | P1 |
| FR-AUTH-3 | Roles: `admin` has full access, including the operations console. `member` can use the library. Route guards use `authservice.createAuthMiddleware()` / `createAuthMiddlewareWithHandler()`. | P0 |
| FR-AUTH-4 | On first boot, a default admin `admin@localhost` exists. Its password comes from `DEFAULT_ADMIN_PASSWORD`, or from the 0600 bootstrap file that the core writes. | P0 |
| FR-AUTH-5 | Users can create personal API tokens (`/services/authservice/api/profile/tokens`) and call the app API with them. | P1 |
| FR-AUTH-6 | Admins manage users and roles through the built-in auth dashboard at `/services/authservice`. | P1 |

### 5.2 Document library — *filing, dataservice, caching, logging, measuring*

| ID | Requirement | Pri |
|---|---|---|
| FR-DOC-1 | Upload `.txt`, `.md`, `.json`, `.csv`, `.html` and `.pdf` files (PDF text extraction via `pdf-parse`, already a core dependency). The maximum size comes from settings (`library.maxUploadMb`, default 10). | P0 |
| FR-DOC-2 | A file is stored through `filing.create('library/{docId}/{filename}', buffer)`. A metadata record is added to the `documents` container: title, owner, mime type, size, status, tags, timestamps. | P0 |
| FR-DOC-3 | The library list shows documents with their status (`queued`, `processing`, `ready`, `failed`), owner and date. It can be filtered by tag and by owner. | P0 |
| FR-DOC-4 | The document detail page shows metadata, extracted text preview, AI summary (if any) and a download link. Detail is cached (`doc:{id}`) and invalidated on update or delete. | P0 |
| FR-DOC-5 | Owners and admins can edit the title and tags, and delete documents. Delete removes the file, the metadata, the search entry and the cache entry. | P0 |
| FR-DOC-6 | Every create, update and delete writes a structured log entry and an activity-feed record. | P0 |

### 5.3 Import from URL — *fetching, queueing*

| ID | Requirement | Pri |
|---|---|---|
| FR-IMP-1 | A member pastes an `http(s)` URL. The app fetches it with `fetching.fetch(url)` (core SSRF guard applies), strips HTML to text and stores it as a document. | P1 |
| FR-IMP-2 | A repeated import of the same URL within the fetch cache window does not hit the network (fetching's response cache). | P1 |
| FR-IMP-3 | A failed fetch shows an error to the user (via `ClientError`, never a raw error message) and records a `failed` import. | P1 |

### 5.4 Ingestion pipeline — *queueing, workflow, working, notifying, measuring*

| ID | Requirement | Pri |
|---|---|---|
| FR-ING-1 | An upload or import enqueues `{ docId }` on the `ingest` queue and returns immediately (HTTP 202). | P0 |
| FR-ING-2 | A queue-drain job dequeues items and runs the `ingest-document` workflow. Its steps are: `extract-text` → `normalise-text` → `analyse-text` (word count, reading time, top keywords, language guess). | P0 |
| FR-ING-3 | When the workflow completes, the main process does the following: update the document to `ready`; index it in **searching**; put a summary job on the `ai-summaries` queue (if AI is enabled); publish `document.ingested`. | P0 |
| FR-ING-4 | When the workflow fails, the document is marked `failed` with a safe error message, `document.failed` is published, and the failure is retryable from the detail page. | P0 |
| FR-ING-5 | Pipeline runs are visible and re-runnable in the embedded Workflow Manager (admin). | P1 |
| FR-ING-6 | Ingest duration and success/failure counts are recorded in **measuring**. | P0 |

### 5.5 Search — *searching, caching, measuring*

| ID | Requirement | Pri |
|---|---|---|
| FR-SRCH-1 | Full-text search over title, tags and body, with ranked results and highlighted snippets. | P0 |
| FR-SRCH-2 | Autosuggest as the user types, via `/api/v1/search/suggest` (`searching.autoSuggest()`). The core `/services/searching/api/autosuggest` endpoint is admin-only, so it is used only in admin tools. | P1 |
| FR-SRCH-3 | Results are cached per normalised query (`search:{hash}`, short TTL). The cache is invalidated when the index changes. | P1 |
| FR-SRCH-4 | Each search records a `search.count` metric and a `search.latency.ms` metric. | P1 |

### 5.6 AI features — *aiservice, queueing, caching, measuring* (optional)

| ID | Requirement | Pri |
|---|---|---|
| FR-AI-1 | When `ANTHROPIC_API_KEY` (or the settings override `ai.apiKey`) is present, the app creates `aiservice('claude', { apiKey, model })`. Otherwise all AI UI is hidden and AI endpoints return 503 `AI disabled`. | P1 |
| FR-AI-2 | **Summaries.** A worker drains `ai-summaries`, prompts for a 3–5 sentence summary plus up to 5 tags, and stores both on the document. | P1 |
| FR-AI-4 | Token usage is recorded in measuring (`ai.tokens`). AI responses are cached by prompt hash. | P1 |

### 5.7 Notifications and activity feed — *notifying, dataservice*

| ID | Requirement | Pri |
|---|---|---|
| FR-NTF-1 | The app creates topics `document.ingested`, `document.failed`, `digest.ready` and `system.alert` at startup. | P0 |
| FR-NTF-2 | Subscribers write to the `activity` container and to a per-user unread counter in caching. | P0 |
| FR-NTF-3 | The UI shows a notification bell with the unread count (polling every 15 s) and an activity feed page. | P1 |

### 5.8 Scheduled jobs — *scheduling, working*

| ID | Requirement | Pri |
|---|---|---|
| FR-SCH-1 | `ingest-drain`: every 5 s, drain up to N `ingest` items. | P0 |
| FR-SCH-2 | `daily-digest`: cron (default `0 8 * * *`, from settings). Builds a digest of yesterday's new documents and publishes `digest.ready`. | P1 |
| FR-SCH-3 | `snapshot`: every 5 min (and on shutdown), write the state snapshot (FR-OPS-4). | P0 |
| FR-SCH-4 | Admins can pause, resume, run now and edit schedules in the embedded Schedule Manager. | P1 |

### 5.9 Settings — *settings*

| ID | Requirement | Pri |
|---|---|---|
| FR-SET-1 | Settings groups: `app` (name, allowRegistration), `library` (maxUploadMb, allowedTypes), `pipeline` (drainBatch, drainIntervalSec), `digest` (cron, enabled), `ai` (enabled, model, apiKey — **secret**). | P0 |
| FR-SET-2 | Admins edit settings in the embedded `SettingsUIManager` on `/admin/settings`. Secret values are masked. | P1 |
| FR-SET-3 | Changes take effect without a restart where possible. Example: changing the digest cron calls `scheduling.update()`. | P1 |

### 5.10 Operations console (admin) — *logging, measuring, all dashboards*

| ID | Requirement | Pri |
|---|---|---|
| FR-OPS-1 | `/admin` shows KPI tiles: documents, ready/failed, queue depth, searches today, AI tokens today. Data comes from measuring, dataservice counts and queue sizes. | P1 |
| FR-OPS-2 | `/admin` links to every core service dashboard (`/services`, `/services/logging`, `/services/caching`, …, `/services/ai`). | P0 |
| FR-OPS-3 | Health endpoints `/health`, `/health/live`, `/health/ready` (core `healthCheck` middleware) check cache round-trip, dataservice and filing. | P0 |
| FR-OPS-4 | **Snapshot and rehydrate.** The app serialises the `documents` and `activity` containers and `workflow.exportState()` to `filing` under `_system/snapshot.json`. At boot it restores them and rebuilds the search index, so the library survives restarts on default providers. | P0 |

### 5.11 Public app API

| ID | Requirement | Pri |
|---|---|---|
| FR-API-1 | The app exposes a small JSON API under `/api/v1` (documents, imports, search, activity). It accepts a session, an API key or a personal token. | P0 |
| FR-API-2 | All input is validated with core `validate()` / `parseLimit()`. Errors use `ClientError` / `sendSafeError`. | P0 |

## 6. Non-functional requirements

| ID | Category | Requirement |
|---|---|---|
| NFR-1 | Setup | `npm install && npm start` works with Node 18+ and no other software. `npm run dev:noauth` exists for UI work. |
| NFR-2 | Security | Use the same posture as the core `app.js`: helmet + core CSP, `sameSite=strict` session cookies, API keys required in production, `SESSION_SECRET` and `SETTINGS_SECRET` required in production, uploads limited by size and type, no raw error messages sent to clients. |
| NFR-3 | Performance | On a dev laptop with ≤ 5 000 documents: p95 search ≤ 150 ms and list ≤ 100 ms; a 1 MB document is ingested in ≤ 5 s. |
| NFR-4 | Resilience | Losing the AI provider or a failing pipeline step never takes the app down. The process shuts down gracefully on SIGTERM and writes a final snapshot. |
| NFR-5 | Durability | Data written more than one snapshot interval (5 min) before a crash is recoverable. A clean shutdown loses nothing. |
| NFR-6 | UI | Bootstrap 5.3 + NooblyJS design tokens (`/services/css/styles.css`), the same look as the core dashboards. Usable at 375 px width. |
| NFR-7 | Quality | Jest unit and API tests (≥ 60 % line coverage on `src/`); a Playwright smoke test of the main journeys; CI on Node 22 and 24. |
| NFR-8 | Output hygiene | Runtime data only goes in `./.application/`; test output only goes in `./.temp/`. |
| NFR-9 | Readability | Each service integration lives in an obvious place (`src/services/*`), with JSDoc and a comment that names the core service and provider. |

## 7. Constraints and assumptions

- **Default-provider volatility.** `dataservice`, `caching`, `queueing`, `searching`, `workflow`, `measuring` and `notifying` defaults are in-memory. Durability comes from FR-OPS-4. Queued jobs that have not yet run when the process crashes are lost; on rehydrate they are recovered as documents stuck in `queued`, which are re-enqueued.
- **Worker isolation.** `working` runs activities in `worker_threads`. Each worker has its **own** registry, so activities cannot see the main process's in-memory services. Pipeline activities must be pure functions: data in, data out. All side effects happen in the main process.
- **AI default provider.** The `claude` provider throws at construction when no API key is given. The app must check for the key before creating it (FR-AI-1).
- **Single process.** Default providers do not share state across replicas. Scaling out requires the provider swaps listed in the Roadmap.
- **Core README drift.** Parts of the core README show stale method names (`cache.set`, `dataService.create/read`, `auth.register`). The implementation uses the actual provider APIs listed in ARCHITECTURE.md §6.

## 8. Success criteria

1. All 16 services appear in `serviceRegistry.listServices()` at runtime, each with its default provider. A test asserts this.
2. A new developer can go from clone → first search result in under 5 minutes.
3. End-to-end journey (log in → upload → wait for `ready` → search → open → see summary) passes in Playwright, with the AI step skipped when there is no key.
4. Restarting the process keeps documents, the activity feed and workflow history.
5. Every service dashboard under `/services/*` shows non-zero activity after the demo seed script runs.

## 9. Decisions

| # | Question | Decision (2026-10-05) |
|---|---|---|
| 1 | Where does `nooblyjs-core` come from? | The local checkout, via `"nooblyjs-core": "file:../nooblyjs-core"` |
| 2 | Is "Ask the library" (AI Q&A) in scope? | **No.** It has been removed from scope; AI covers summaries and tags only |
| 3 | Where does demo content live? | **In the repo**, under `seed/`, loaded by `npm run seed` |
