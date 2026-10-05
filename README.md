# Noobly Knowledge Hub

A sample team knowledge base built on [`nooblyjs-core`](../nooblyjs-core). It uses **every core service with its default provider**. It is also a template you can fork to speed up your own NooblyJS application.

- **Product:** [specs/PRD.md](specs/PRD.md)
- **Architecture:** [specs/ARCHITECTURE.md](specs/ARCHITECTURE.md)
- **Roadmap:** [specs/ROADMAP.md](specs/ROADMAP.md) (Phases 0–1 done; Phase 2 next)
- **Phase 0 spike results:** [specs/spikes.md](specs/spikes.md)

## Quick start

`nooblyjs-core` is used from a local checkout next to this repository (`"nooblyjs-core": "file:../nooblyjs-core"`):

```
parent/
├── nooblyjs-core/                  # npm install has been run here
└── nooblyjs-application-sample/    # this repo
```

```bash
npm install
cp .env.example .env      # optional in development
npm start                 # http://localhost:3000
```

- **Library:** `http://localhost:3000/library`. Sign in, then upload, filter, open, edit, download and delete documents. Nine demo documents (`seed/`) are loaded into an empty library on startup; set `SEED_DEMO_CONTENT=false` to start empty.
- **Home page:** `http://localhost:3000/` shows which of the 16 core services are running, and with which provider.
- **Service dashboards:** `http://localhost:3000/services/` requires an admin login. The default admin is `admin@localhost`. Its password is `DEFAULT_ADMIN_PASSWORD` if you set one; otherwise it is generated on first boot into `.application/data/auth/INITIAL_ADMIN_PASSWORD.txt`. Delete that file after logging in.
- **Health:** `/health/live`, `/health/ready`.
- **Users:** new users join by invitation. They use **Create New Account** on the login page to request one, and an admin approves it at `/services/authservice`. Signed-in users can create personal API tokens (`dtk_…`) on their profile and call `/api/v1` with `Authorization: Bearer <token>`.

> **Until Phase 4 (snapshots):** document metadata lives in the in-memory data service, so a restart forgets uploaded documents. Their files stay on disk under `.application/files`. Demo content is reloaded on every start.

## Scripts

| Command | What it does |
|---|---|
| `npm start` | Run the app (`PORT`, default 3000) |
| `npm run dev` | Run with nodemon (restarts on changes in `src/`, `activities/`, `app.js`) |
| `npm run dev:noauth` | Run with no login or API keys. For local UI work only; refuses to run in production |
| `npm test` | Jest unit and integration tests (output in `.temp/`) |
| `npm run coverage` | Tests with coverage (`.temp/coverage`) |

## Where things live

| Path | Purpose |
|---|---|
| `app.js`, `app-noauth.js` | Entry points |
| `src/lib/createApplication.js` | Bootstrap: security middleware, sessions, registry, services, health checks, appservice |
| `src/config/services.js` | **The only place providers are chosen** |
| `src/config/settingsSchema.js` | Settings groups and defaults (encrypted settings service) |
| `src/routes/`, `src/views/` | Mounted automatically by the core **appservice** (each top-level `.js` exports `(type, options, eventEmitter)`) |
| `activities/` | Worker-thread activities for the working, workflow and scheduling services (from Phase 2) |
| `src/data/models/` | Record shapes and validation, `DocumentRepo`, `ActivityRepo` |
| `src/services/` | Domain layer (`index.js` mounts it; classes live in `modules/`) |
| `src/lib/auth.js` | `/api/v1` and page guards (session, `dtk_` token, session token) |
| `seed/` | Demo content; `scripts/make-seed-pdf.js` regenerates the PDF |
| `.application/` | Runtime data (git-ignored) |
