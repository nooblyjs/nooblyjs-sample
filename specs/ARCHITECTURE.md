# Architecture — Noobly Knowledge Hub

| | |
|---|---|
| **Status** | Draft |
| **Date** | 2026-10-05 |
| **Companion docs** | [PRD.md](./PRD.md) · [ROADMAP.md](./ROADMAP.md) |

---

## 1. Overview

Noobly Knowledge Hub is a single Node.js/Express process. All backend capability comes from the `nooblyjs-core` `ServiceRegistry`, using every service's **default provider**. The app adds a thin domain layer (documents, imports, digests, AI features) and a Bootstrap UI.

```
                    ┌───────────────────────────── Browser ─────────────────────────────┐
                    │  App UI (/, /library, /doc/:id, /search, /activity, /admin/*)      │
                    │   ├─ calls app API          /api/v1/*                              │
                    │   ├─ calls core service API /services/{svc}/api/*  (admin screens) │
                    │   └─ embeds core UI widgets  WorkflowManagerUI, ScheduleManagerUI, │
                    │                              SettingsUIManager                     │
                    └───────────────┬───────────────────────────────┬───────────────────┘
                                    │ session cookie / API key / dtk_ token
┌───────────────────────────────────▼───────────────────────────────▼──────────────────────┐
│ Express app (app.js)  helmet+CSP · cors · body limits · session · passport · errorHandler │
│                                                                                          │
│  ┌──────────── App domain layer (src/) ─────────────┐   ┌──── nooblyjs-core ─────────┐   │
│  │ routes/  /api/v1/*  pages                        │   │ ServiceRegistry (singleton)│   │
│  │ services/ LibraryService  IngestService          │──▶│  16 services, default      │   │
│  │           SearchService   ImportService          │   │  providers, REST APIs and  │   │
│  │           AiService       NotificationService    │   │  dashboards /services/*    │   │
│  │           DigestService   SnapshotService        │   └────────────┬───────────────┘   │
│  │           MetricsService  JobsService            │                │ worker_threads    │
│  └──────────────────────────────────────────────────┘   ┌────────────▼───────────────┐   │
│                                                         │ activities/*.js (pure fns) │   │
│                                                         └────────────────────────────┘   │
└──────────────────────────────────────────┬───────────────────────────────────────────────┘
                                           │ disk
                         ./.application/{files,data,settings,logs}
                                           │ https (optional)
                                   api.anthropic.com · imported URLs
```

## 2. Technology stack

| Concern | Choice | Notes |
|---|---|---|
| Runtime | Node.js ≥ 18 (CI on 22 and 24), CommonJS | Matches core |
| Web | Express 4 (pinned: core routes use Express 4 path patterns), `express-async-errors`, helmet, cors, express-session, passport | Same middleware as core `app.js`. `passport` is resolved from `nooblyjs-core`, so the auth providers' serializers apply |
| Backend services | `nooblyjs-core` | Local checkout: `file:../nooblyjs-core` |
| UI | Static HTML + vanilla JS, Bootstrap 5.3, Bootstrap Icons, NooblyJS design tokens | Loads `/services/css/styles.css` and `/services/css/core.css` from core |
| Uploads | `multer` (memory storage, size-capped) → `filing` | |
| PDF text | `pdf-parse` (direct dependency; require `pdf-parse/lib/pdf-parse.js`) | Runs inside an activity, which resolves packages from `activities/` |
| Tests | Jest + supertest, Playwright | Mirrors core config |
| Packaging | Dockerfile `node:24-alpine`, non-root user, `.application` volume | |

## 3. Repository layout

The layout follows the **appservice** conventions: `serviceRegistry.appservice()` auto-mounts `./src/services`, `./src/data`, `./src/routes` and `./src/views` relative to `process.cwd()`. The working service resolves activity scripts from `./activities`.

```
nooblyjs-application-sample/
├── app.js                     # bootstrap: express + registry + services + server
├── app-noauth.js              # local UI dev entry (ALLOW_NOAUTH=1), servicesAuth.requireLogin=false
├── activities/                # worker-thread activities (pure: data in → data out)
│   ├── tick.js                #   no-op used by scheduler jobs (work done in callback)
│   ├── extract-text.js        #   pipeline step 1
│   ├── normalise-text.js      #   pipeline step 2
│   └── analyse-text.js        #   pipeline step 3
├── src/
│   ├── lib/                   # createApplication (bootstrap), startServer, helpers (not auto-mounted)
│   ├── config/
│   │   ├── services.js        # THE ONLY place providers/options are chosen
│   │   └── settingsSchema.js  # settings groups, defaults, secret flags
│   ├── services/              # domain services (mounted by appservice)
│   │   ├── index.js           #   mount fn: builds the domain layer, attaches it to options.context
│   │   └── modules/           #   classes (not auto-called)
│   │       ├── libraryService.js  ingestService.js  importService.js
│   │       ├── searchService.js   aiService.js      notificationService.js
│   │       └── digestService.js   snapshotService.js metricsService.js jobsService.js
│   ├── data/
│   │   └── models/            # records.js (shapes, validation), documentRepo.js, activityRepo.js
│   ├── routes/                # /api/v1/* and page routes (mounted by appservice)
│   │   ├── index.js
│   │   ├── documents.js  imports.js  search.js  activity.js  admin.js
│   └── views/
│       ├── index.js           # mount fn: serves public/ only
│       └── public/            # static pages + browser JS
│           ├── index.html  library.html  document.html  search.html  activity.html
│           ├── admin/{index,settings,jobs,workflows}.html
│           └── js/ css/
├── seed/                      # demo documents (in repo) + seed script
├── tests/{unit,api,ui,helpers}/
├── specs/                     # PRD, ARCHITECTURE, ROADMAP
├── .env.example  Dockerfile  playwright.config.js  package.json
└── .application/              # runtime data (git-ignored)
```

> **Confirmed in Phase 0 (spikes.md §1):** `mountFiles` calls **every top-level `.js` file** in each folder as `fn(type, options, eventEmitter)`. Domain classes therefore live in subfolders (e.g. `src/services/modules/`), and each folder's top-level files are mount functions. The app's context (registry, core services) reaches them as `options.context`. Paths are relative to `process.cwd()`; the entry points `chdir` to the repo root.

## 4. Integration styles

There are two supported ways to use a core service. The codebase uses both on purpose, and each feature uses whichever style fits.

### 4.1 Direct calls through `serviceRegistry` (server side)

Domain services get service instances from the registry once at startup. They call provider methods directly, for example `cache.put()`, `dataService.add()` and `searching.search()`.

**Use this for:**
- Any operation that combines several services (upload → filing + dataservice + queueing + logging).
- Anything that needs domain authorisation (owner checks).
- Anything that must stay consistent (cache invalidation after update).

```js
// src/services/libraryService.js (sketch)
class LibraryService {
  constructor({ filing, dataService, cache, queue, logger, measuring }) { Object.assign(this, { filing, dataService, cache, queue, logger, measuring }); }

  async upload(user, file) {
    const record = newDocumentRecord(user, file);                 // src/data
    const docId = await this.dataService.add('documents', record);
    await this.filing.create(`library/${docId}/${file.originalname}`, file.buffer);
    await this.dataService.update('documents', docId, { ...record, id: docId, status: 'queued' });
    await this.queue.enqueue('ingest', { docId });
    this.measuring.add('documents.uploaded', 1);
    this.logger.info('[LibraryService] document uploaded', { docId, owner: user.email });
    return docId;
  }
}
```

### 4.2 The core service's REST API and embeddable UI (browser side)

Every service mounts `/services/{service}/api/*` (with Swagger docs) and a dashboard. The browser calls these endpoints directly when a call is **read-only, user-agnostic, or admin-only** and the app has no domain logic to add.

The same session cookie authenticates the browser. The registry's API-key guard accepts browser session tokens and `dtk_` personal tokens.

| UI feature | Core endpoint or widget |
|---|---|
| Search autosuggest (admin tools) | `GET /services/searching/api/autosuggest/:term`. Members use `/api/v1/search/suggest`, because `/services/*` is admin-only (see spikes.md) |
| Admin queue depth tile | `GET /services/queueing/api/size/ingest`, `…/size/ai-summaries` |
| Admin metrics chart | `GET /services/measuring/api/metrics` |
| Admin log tail | `GET /services/logging/api/logs` |
| File download | `GET /services/filing/api/download/library/{docId}/{file}` (admin). Members use `/api/v1/documents/:id/download`, which checks ownership/visibility first. |
| Login / register / logout / tokens / invitations | `/services/authservice/api/*` and built-in `views/login.html`, `register.html`, `profile.html` |
| Settings admin | `new SettingsUIManager({ containerId, groups, allowReveal:false }).initialize()` from `/services/settings/scripts/js/index.js` |
| Schedules admin | `ScheduleManagerUI` from `/services/scheduling/scripts/js/index.js` |
| Workflows admin | `WorkflowManagerUI` from `/services/workflow/scripts/js/index.js` |
| "Open dashboard" links | `/services`, `/services/{logging,caching,queueing,notifying,fetching,settings,dataservice,working,measuring,scheduling,searching,workflow,filing,authservice}`, `/services/ai` |

**Rules:**

1. **Don't duplicate core APIs.** If the browser only needs what a core endpoint already returns, call the core endpoint. Do not add a `/api/v1` passthrough.
2. **Write paths that touch domain data go through `/api/v1`.** A browser must never `POST /services/dataservice/api/documents` directly. Doing so would bypass validation, ownership checks, cache invalidation and indexing.
3. **Admin-only core endpoints stay admin-only.** `servicesAuth.requireLogin` stays `true`. `/services/*` requires an admin session, apart from static assets, auth pages and the filing API. Member features therefore always go through `/api/v1`.

## 5. Service wiring

### 5.1 Bootstrap order (`app.js`)

```js
const serviceRegistry = require('nooblyjs-core');
serviceRegistry.initialize(app, eventEmitter, {
  logDir:  path.join(__dirname, '.application', 'logs'),
  dataDir: path.join(__dirname, '.application', 'data'),
  security: {
    apiKeyAuth:  { apiKeys, requireApiKey: apiKeys.length > 0,
                   excludePaths: ['/services/*/status', '/services/', '/services/*/views/*',
                                  '/services/authservice/api/login', '/services/authservice/api/register'] },
    servicesAuth: { requireLogin: true }
  }
});

const svc = require('./src/config/services')(serviceRegistry);  // §5.2, creates all 16
await svc.snapshot.restore();                                     // rehydrate before serving
serviceRegistry.appservice('default', { name: 'Knowledge Hub', baseUrl: '/' }); // mounts src/*
setupHealthChecks(app, serviceRegistry.servicesAuthMiddleware);   // core middleware/healthCheck
app.use(errorHandler);                                            // core middleware/errorHandler
server.listen(PORT);
```

### 5.2 `src/config/services.js` — the single provider choice point

Instances are created in dependency order. Each uses the registry's default provider, and **no `instanceName`** is passed. As a result, the instance the app uses is the same singleton that the registry injects into dependent services. For example, the queue the app enqueues on is the same queue that `dataservice`, `working`, `workflow` and `aiservice` receive.

| Level | Service | Factory call | Options |
|---|---|---|---|
| 0 | logging | `logger('memory')` | — (the dashboard reads from it; the file logger is a provider swap) |
| 1 | caching | `cache('memory')` | — |
| 1 | queueing | `queue('memory')` | — |
| 1 | notifying | `notifying('memory')` | `maxNotificationHistory: 500` |
| 1 | fetching | `fetching('node')` | default cache window |
| 1 | settings | `settings('file')` | `filepath: .application/settings/settings.enc.json`, secret from `SETTINGS_SECRET` / `SESSION_SECRET` |
| 2 | dataservice | `dataService('memory')` | — |
| 2 | working | `working('memory')` | `activitiesFolder: 'activities'`, `maxQueueSize: 1000` |
| 2 | measuring | `measuring('memory')` | — |
| 3 | scheduling | `scheduling('memory')` | — |
| 3 | searching | `searching('memory')` | `fields: ['title','tags','body']`, `storeFields: ['title','tags','ownerEmail']`, `idField: 'id'`, `snippet: true` |
| 3 | workflow | `workflow('memory')` | — (history restored later with `importState()`, §8.8) |
| 3 | filing | `filing('local')` | `baseDir: FILING_BASE_DIR` (default `.application/files`) |
| 4 | authservice | `authservice('file')` | `dataDir: .application/data/auth`, `loginSuccessRedirectUrl: '/'` |
| 4 | aiservice | `aiservice('claude', { apiKey, model })` | **Only if a key exists**; otherwise `null` and `AiService.enabled = false` |
| — | appservice | `appservice('default', { name, baseUrl:'/' })` | Created last so routes can read the other services |

Registry dependency graph (`initializeServiceDependencies()`, the source of truth):

```
logging
 ├─ caching · queueing · notifying · appservice · fetching · settings      (L1)
 ├─ dataservice ← queueing                                                 (L2)
 ├─ working, measuring ← queueing, caching                                 (L2)
 ├─ scheduling ← working · searching · filing ← queueing, dataservice      (L3)
 ├─ workflow ← queueing, scheduling, measuring, working                    (L3)
 └─ authservice ← caching, dataservice · aiservice ← caching, workflow, queueing (L4)
```

**Swapping a provider later** (e.g. Redis queueing): call `serviceRegistry.setDefaultProvider('queueing', 'redis', { … })` at the top of `services.js`, **before** any factory call. Resolved dependencies are cached, so the order matters. No feature code changes.

## 6. Service API reference (actual provider methods used)

The core README is partly stale. These are the methods the app relies on, verified against the provider sources:

| Service | Methods used |
|---|---|
| logging | `info/warn/error/debug(message, meta)` |
| caching | `put(key, value)`, `get(key)`, `delete(key)`, `getAnalytics()` |
| queueing | `enqueue(queue, item)`, `dequeue(queue)` (returns `undefined`/`null` when empty), `size(queue)`, `listQueues()`, `purge(queue)` |
| notifying | `createTopic(t)`, `subscribe(t, cb)`, `unsubscribe(t, cb)`, `notify(t, message)`, `getNotifications()` |
| fetching | `fetch(url, options)` (response-cached), `getAnalytics()`, `clear()` |
| settings | `get(key, group)`, `set(key, value, group, { secret })`, `has`, `createGroup(group, desc)`, `listGroups()`, `getGroup(group)` |
| dataservice | `createContainer(name)`, `add(c, obj)` → uuid, `getByUuid(c, id)`, `update(c, id, obj)`, `remove(c, id)`, `find(c, term)`, `listAll(c)`, `count(c)`, `jsonFindByCriteria(c, criteria)`, `jsonFind(c, predicate)` |
| working | (indirect) `start(scriptPath, data, cb)`, `getStatus()`, `getTaskHistory()` |
| measuring | `add(metric, value)`, `list(metric, from, to)`, `total(metric, from, to)`, `average(metric, from, to)` |
| scheduling | `start(name, script, data, intervalSec, cb, { description, group, runImmediately })`, `startCron(script, cron, name, cb)`, `pause/resume/update/runNow/stop(name)`, `listSchedules()` |
| searching | `add(id, doc, index)`, `replace(doc, index)`, `remove(id, index)`, `search(query, index \| options)`, `autoSuggest(q, opts)`, `clearIndex(index)`, `getIndexStats(index)` |
| workflow | `defineWorkflow(name, stepPaths, meta)`, `executeWorkflow(name, input)` (resolves even on failure), `listExecutions()`, `exportState()`, `importState(s)`; event `workflow:state:changed` |
| filing | `create(path, content)`, `read(path, encoding)`, `update(path, content)`, `delete(path)`, `list(dir)` |
| authservice | `createUser`, `getUser`, `listUsers`, `addUserToRole`, `validateSession`, `createAuthMiddleware()`, `createAuthMiddlewareWithHandler({ onUnauthorized })` |
| aiservice | `prompt(text, opts)` → `{ content, usage, model, provider }`, `getAnalytics()` |
| appservice | factory call only; base classes `appServiceBase`, `appRouteBase`, `appDataBase`, `appWorkerBase` |

## 7. Domain model

### 7.1 Dataservice containers (created at boot with `createContainer`)

| Container | Record shape (key fields) |
|---|---|
| `documents` | `id, title, filename, path, mime, sizeBytes, ownerEmail, tags[], status (queued\|processing\|ready\|failed), error?, source (upload\|url), sourceUrl?, stats{words, readingMin, keywords[]}, summary?, aiTags[], createdAt, updatedAt, ingestedAt?` |
| `imports` | `id, url, requestedBy, status, docId?, error?, createdAt` |
| `activity` | `id, type (document.ingested\|document.failed\|digest.ready\|…), actor, docId?, message, createdAt` |
| `digests` | `id, date, docIds[], text, createdAt` |

The extracted body text is **not** stored in dataservice. It goes to `filing` at `library/{id}/extracted.txt` and to the search index.

### 7.2 Other keyspaces

| Service | Names |
|---|---|
| filing | `library/{docId}/{original}`, `library/{docId}/extracted.txt`, `_system/snapshot.json` |
| queueing | `ingest` (`{ docId, attempt }`), `ai-summaries` (`{ docId }`) |
| notifying topics | `document.ingested`, `document.failed`, `digest.ready`, `system.alert` |
| caching keys | `doc:{id}`, `search:{sha1(q)}`, `stats:dashboard`, `unread:{email}`, `ai:{sha1(prompt)}` |
| searching index | `documents` |
| measuring metrics | `documents.uploaded`, `ingest.duration.ms`, `ingest.success`, `ingest.failure`, `search.count`, `search.latency.ms`, `ai.tokens`, `imports.count` |
| settings groups | `app`, `library`, `pipeline`, `digest`, `ai` (`ai.apiKey` stored with `secret: true`) |
| workflows | `ingest-document` |
| schedules | `ingest-drain` (interval), `ai-drain` (interval), `snapshot` (interval), `daily-digest` (cron) |

## 8. Key flows

### 8.1 Upload → ingest → ready

```
Browser ─POST /api/v1/documents (multipart)──▶ routes/documents
  LibraryService.upload
    dataService.add('documents', {status:'queued'})       ─┐
    filing.create('library/{id}/{file}', buffer)            │ direct registry calls
    queue.enqueue('ingest', {docId})                        │
    measuring.add / logger.info                            ─┘
  ◀── 202 { id, status:'queued' }

IngestService.drain()   ← triggered right after enqueue (setImmediate) and by schedule 'ingest-drain'
  loop up to pipeline.drainBatch: item = queue.dequeue('ingest')
    dataService.update(status:'processing')
    run = await workflow.executeWorkflow('ingest-document',
            { docId, filePath: <absolute path under FILING_BASE_DIR>, mime })
         └─ working → worker_threads: extract-text → normalise-text → analyse-text
    if run.status === 'completed':
        filing.create('library/{id}/extracted.txt', text)
        dataService.update(status:'ready', stats)
        searching.add(id, {id,title,tags,body:text}, 'documents'); cache.delete('search:*' via generation bump)
        if ai.enabled → queue.enqueue('ai-summaries', {docId})
        notifying.notify('document.ingested', {docId, ownerEmail})
        measuring.add('ingest.duration.ms', ms); measuring.add('ingest.success', 1)
    else: dataService.update(status:'failed', error: safe); notifying.notify('document.failed', …)
```

### 8.2 Worker-thread boundary (important)

`working` runs each step in a `worker_thread` that loads its **own** copy of the registry. Its in-memory services (dataservice, cache, queue) are **empty and not shared** with the main process. Therefore:

- Activities in `activities/` are **pure**. They receive `{ ...input, steps:[…previous outputs] }` and return plain JSON.
- Activities may read the file system (the `local` filing base dir is a real path, passed in as `filePath`), and they may use pure libraries such as `pdf-parse`.
- **All side effects run in the main process** after `executeWorkflow` resolves, or in scheduling callbacks.

Activity contract:

```js
// activities/analyse-text.js
module.exports.run = async (data) => {
  const text = data.steps.at(-1).data.text;
  return { text, words: countWords(text), readingMin: …, keywords: topKeywords(text, 10) };
};
```

### 8.3 Scheduled jobs (scheduling → working → callback)

Scheduler tasks also run their script in a worker. Every app job therefore uses the no-op `activities/tick.js` as its script and does the real work in the **completion callback**, which runs in the main process:

```js
await scheduling.start('ingest-drain', 'tick.js', {}, settings.pipeline.drainIntervalSec,
  () => ingest.drain(), { group: 'pipeline', description: 'Drain ingest queue', runImmediately: false });
await scheduling.startCron('tick.js', digestCron, 'daily-digest', () => digest.build());
```

Admins manage these jobs in `ScheduleManagerUI`: pause, resume, run now, change interval or cron. When `digest.cron` changes in settings, `JobsService` calls `scheduling.update('daily-digest', { cron })`.

> **Confirmed in Phase 0 (spikes.md §2):** `startCron` with a string script fires the callback in the main process, and `update(name, { cron })` works in place.

### 8.4 Search

```
GET /api/v1/search?q=…&tag=…&limit=…
  SearchService: key = 'search:' + gen + sha1(normalised)
    cache.get(key) ─hit─▶ return
    results = searching.search(q, { container:'documents', … snippet })   // BM25, fuzzy/prefix
    filter by visibility/tag → hydrate titles from cache/dataservice → cache.put(key, results)
    measuring.add('search.count',1); measuring.add('search.latency.ms', ms)
Browser autosuggest → GET /api/v1/search/suggest?q= → searching.autoSuggest() (direct call; /services/* is admin-only)
```

Cache invalidation uses a **generation counter**: `cache.put('search:gen', n+1)` after every index change. The default cache provider has no key scan, so old keys are left to LRU eviction.

### 8.5 Import from URL

`ImportService.import(url)`:
1. `validate` the URL.
2. `fetching.fetch(url, { cacheTime })`. The core SSRF guard throws `ClientError(400)` for private addresses.
3. Strip HTML to text (simple sanitiser; no DOM dependency).
4. Store as `library/{id}/page.html`, then reuse the upload path (§8.1) with `source:'url'`.

### 8.6 AI

```
AiService (enabled iff apiKey)
  drainSummaries(): item = queue.dequeue('ai-summaries')
    text = filing.read('library/{id}/extracted.txt','utf8') truncated to settings.ai.maxChars
    cached = cache.get('ai:'+sha1(prompt)) || ai.prompt(prompt, { maxTokens })
    parse JSON {summary, tags} → dataService.update; searching.replace(...) to include aiTags
    measuring.add('ai.tokens', usage.totalTokens)
```

AI errors are logged and recorded on the document as `summaryError`. They never fail ingestion.

### 8.7 Notifications

`NotificationService` creates the topics at boot and subscribes once:

```js
await notifying.subscribe('document.ingested', async (msg) => {
  await dataService.add('activity', activityRecord('document.ingested', msg));
  await bumpUnread(msg.ownerEmail);            // cache.put('unread:'+email, n+1)
});
```

The browser polls `GET /api/v1/activity/unread` every 15 s.

### 8.8 Snapshot and rehydrate (durability on default providers)

```
SnapshotService.save()   ← schedule 'snapshot' (5 min), debounced on workflow:state:changed, SIGTERM
  { version, savedAt,
    documents: dataService.listAll('documents'), imports, activity (last 1000), digests,
    workflow:  workflow.exportState() }
  → filing.update/create('_system/snapshot.json', JSON)   (write tmp + rename semantics via create then update)

SnapshotService.restore()  ← boot, before routes mount
  read snapshot → createContainer(*) → re-add each record with its original id*
  → workflow.importState(snapshot.workflow)
  → rebuild search index from documents + extracted.txt
  → re-enqueue documents stuck in queued/processing
```

\* `dataservice.add()` generates a new uuid. Restore therefore keeps `id` inside each record, and the app's `docId` is the record's `id` field. Lookups go through a small `DocumentRepo` (extends `appDataBase`) that keeps an `id → uuid` map. **Confirmed in Phase 0 (spikes.md §3):** the memory provider ignores caller-supplied ids, so the map is required.

## 9. App HTTP API (`/api/v1`)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/documents?tag&owner&status&limit&offset` | member | List (capped with `parseLimit`) |
| POST | `/documents` | member | Upload (multer → filing). Returns 202 |
| GET | `/documents/:id` | member | Detail (cached) |
| PATCH | `/documents/:id` | owner/admin | Title and tags |
| DELETE | `/documents/:id` | owner/admin | Delete everywhere |
| POST | `/documents/:id/retry` | owner/admin | Re-enqueue a failed document |
| POST | `/documents/:id/summarise` | owner/admin | Enqueue an AI summary (503 if AI disabled) |
| GET | `/documents/:id/download` | member | Streams via `filing.read` |
| POST | `/imports` | member | `{ url }` → 202 |
| GET | `/search?q&tag&limit` | member | Search |
| GET | `/search/suggest?q` | member | Autosuggest (`searching.autoSuggest`) |
| GET | `/activity`, `/activity/unread`, POST `/activity/read` | member | Feed |
| GET | `/admin/stats` | admin | KPI tiles (cached 10 s) |
| POST | `/admin/snapshot`, `/admin/reindex` | admin | Ops actions |
| GET | `/me` | member | Current user, roles, `aiEnabled` flag |
| GET | `/info` | public | App name, version, which core services run with which provider (Phase 0) |

Errors follow the core convention: throw `ClientError(status, msg)`, then respond with `sendSafeError(res, err, { status: 500, eventEmitter })`.

## 10. Security

| Layer | Mechanism |
|---|---|
| Transport and headers | `helmet` with core `helmetCspOption()`; `createServer` for optional HTTPS; `TRUST_PROXY` |
| Browser sessions | `express-session` with core `createSessionStore` (pruning memory store; Redis when `SESSION_REDIS_URL` is set), `httpOnly`, `sameSite=strict`, `secure` in production |
| App routes | `src/lib/auth.js`: `requireUser` (401 JSON), `requireAdmin` (403) and `requirePage` (redirect to login). They accept a Passport session, a `dtk_` personal token or a core session token. The core `createAuthMiddleware` only accepts Passport sessions |
| Core service routes | Registry `apiKeyAuth` (API keys, session tokens, `dtk_` tokens) + `servicesAuth.requireLogin=true` (admin session). The core exempts `/services/filing/api/*` from the admin gate so members can download; the app restricts **writes** there to admins (`requireAdminForFilingWrites`) |
| Uploads | multer `limits.fileSize` from settings; MIME/extension allow-list; filing `pathSafety`; filenames sanitised; never written outside `FILING_BASE_DIR` |
| Outbound fetch | core fetching SSRF guard; http(s) only; size cap |
| Secrets | `SESSION_SECRET`, `SETTINGS_SECRET`, `API_KEYS`, `ANTHROPIC_API_KEY` from env. The AI key override is stored encrypted in settings with `secret: true`. The process refuses to start in production without the required secrets. |
| Output | Never send `err.message` for 5xx; log with metadata |

## 11. Configuration (`.env.example`)

```
PORT=3000
NODE_ENV=development
SESSION_SECRET=            # required in production
SETTINGS_SECRET=           # encrypts .application/settings (falls back to SESSION_SECRET)
API_KEYS=                  # comma-separated; a dev key is generated and logged if empty
DEFAULT_ADMIN_PASSWORD=    # otherwise generated to a 0600 bootstrap file
FILING_BASE_DIR=./.application/files
ANTHROPIC_API_KEY=         # optional — enables AI features
AI_MODEL=                  # optional — overrides the claude provider's default model
TRUST_PROXY=  CSP_MODE=enforce  CORS_ORIGINS=  BODY_LIMIT=1mb  SESSION_REDIS_URL=
```

Runtime-tunable values (upload limit, drain batch, digest cron, AI on/off) live in **settings**, not env. Env holds secrets and infrastructure only.

## 12. Observability

- **Logs:** the injected logger with structured metadata (`[ServiceName] message`, `{ docId, … }`), viewable at `/services/logging`.
- **Metrics:** business metrics via measuring (§7.2); system metrics via the core `/services/api/monitoring/{metrics,snapshot}`.
- **Per-service analytics:** each core dashboard (cache hit rate, queue depth, worker history, workflow runs, search terms, AI token cost).
- **Health:** `/health`, `/health/live`, `/health/ready` (ready only after snapshot restore and a cache/dataservice/filing probe), `/health/detailed` (admin).

## 13. Testing strategy

| Layer | Tooling | Scope |
|---|---|---|
| Unit | Jest | Domain services with mock dependencies passed via constructor; activities as pure functions |
| Integration | Jest + real registry | Boot all 16 services into a temp dir (`.temp/tests/data`). Assert `listServices()` covers all 16; run upload → ready; run snapshot → reset → restore |
| API | supertest | `/api/v1/*` authorisation matrix (anon / member / owner / admin), validation and error shapes |
| UI | Playwright (`app-noauth.js` on a test port) | Smoke: every page loads with no CSP violations; journey: upload → search → open |
| CI | GitHub Actions | `npm run coverage`, `npm run test:ui`, `npm audit --omit=dev`, Docker build + `/health/live` check |

Tests call `serviceRegistry.reset()` / `shutdown()` in `afterAll` and clear scheduler timers (Jest runs with `detectOpenHandles`).

## 14. Provider upgrade paths (beyond the default-provider release)

| Service | Default → production option | Change |
|---|---|---|
| logging | memory → `file` | one line in `services.js` |
| caching | memory → `redis` | `setDefaultProvider('caching','redis',{…})` |
| queueing | memory → `redis` / `rabbitmq` / `aws` | `setDefaultProvider` before any factory |
| dataservice | memory → `file` / `mongodb` | plus remove the snapshot of containers |
| filing | local → `s3` / `gcp` | the worker gets a temp file instead of `baseDir` path |
| searching | memory → `memory` with `indexDir`, or `solr` | |
| aiservice | claude → `openai` / `ollama` / `gemini` | key/env change |
| authservice | file → `google` / `azure` / `passport` | SSO config |
