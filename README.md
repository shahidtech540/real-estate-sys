# Society Plot Manager (SPM)

Internal system for one real-estate society: plot inventory on a master plan,
bookings with installment plans, payments and Roznamcha, recovery reporting,
reminders, and PDF documents. Single company, single database, bilingual
(English / Urdu) UI.

**Status: scaffold only.** This repository contains the Step 8 project scaffold:
folder structure, pinned dependencies, the full Prisma schema, Compose and CI.
There is no business logic, API route (other than the minimal health check) or
screen yet. Phase 1 of `IMPLEMENTATION-PLAN.md` starts the build.

## Documents (source of truth)

Read in this order; nothing in code overrides them.

| Document | Governs |
|---|---|
| [`PRD.md`](PRD.md) | Product behavior, users, acceptance criteria |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Stack, module boundaries, transactions, operations |
| [`DATABASE.md`](DATABASE.md) | Tables, columns, enums, constraints, grants, migrations |
| [`DESIGN.md`](DESIGN.md) | Screen layouts, design tokens, accessibility |
| [`API.md`](API.md) | Endpoints, payloads, status codes, error codes |
| [`AGENTS.md`](AGENTS.md) | How the coding agent works, tests and delivers |
| [`IMPLEMENTATION-PLAN.md`](IMPLEMENTATION-PLAN.md) | Build order: 7 phases, 81 endpoints |

Precedence and the conflict procedure are in `AGENTS.md` §2 and
`IMPLEMENTATION-PLAN.md` §0.1.

## Requirements

- Node.js **24 LTS** (pinned in `package.json` `engines`; `ARCHITECTURE.md` §3.1)
- Docker Engine with Compose v2 (for the local stack)
- PostgreSQL **17** — provided by Compose; no host install needed

## Local run with Docker Compose

```bash
git clone <repo> && cd real-estate-sys

cp .env.example .env
# Edit .env: replace every "change-me" placeholder. Use throwaway local values;
# never commit the file (ARCHITECTURE.md §14.5).

docker compose up -d --build          # db + web + worker, one image, two processes
docker compose run --rm migrate       # Prisma migrate deploy, as spm_migrator
curl http://127.0.0.1:3000/api/health  # {"status":"ok","version":"0.1.0"}
# http://127.0.0.1:3000 -> blank home page (scaffold)
```

Notes:

- `db` publishes no port (`ARCHITECTURE.md` §14.1). For a psql shell:
  `docker compose exec db psql -U spm -d spm`.
- `web` binds `127.0.0.1:3000` only, mirroring the Nginx layout of
  `ARCHITECTURE.md` §14.2.
- `infra/db/init/01-roles.sql` runs **only on the first boot of an empty volume**
  and creates `spm_migrator` and `spm_app` (`DATABASE.md` §8.1). To start over:
  `docker compose down -v` (deletes local data).
- Uploaded files go to the `files` volume at `/srv/spm/files`
  (`ARCHITECTURE.md` §14.1).
- Reminders stay in `dry_run` until the client flips `REMINDER_MODE`
  (`ARCHITECTURE.md` §10.9).
- The production stack is `infra/docker-compose.yml`, which is
  `ARCHITECTURE.md` §14.2 verbatim (GHCR image + host paths). Run it from
  `infra/`, with the deployment `.env` beside it.

## Local run without Docker

Requires a PostgreSQL 17 instance already running and a `DATABASE_URL` in `.env`.

```bash
npm ci
npx prisma generate
npm run dev               # http://localhost:3000
npm run build:worker      # then, in a second terminal:
node dist/worker/main.js  # same entrypoint the worker container runs
```

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Next.js dev server |
| `npm run build` | Production build (`output: 'standalone'`) |
| `npm run build:worker` | Compile `src/worker/main.ts` to `dist/worker/main.js` |
| `npm start` | Start the production server |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint (flat config, `AGENTS.md` conventions) |
| `npm run format` / `format:check` | Prettier |
| `npm run prisma:validate` | `prisma validate` |
| `npm run db:generate` | `prisma generate` |
| `npm run db:migrate` | `prisma migrate dev` (local) |
| `npm run db:deploy` | `prisma migrate deploy` (deployments) |
| `npm run db:seed` | Seed (no-op stub until Phase 1) |
| `npm test` | Vitest (no tests yet) |
| `npm run test:e2e` | Playwright (no tests yet) |

## Repository layout

Matches `ARCHITECTURE.md` §4.1.

```text
prisma/            schema.prisma (all 26 tables), migrations/, seed.ts stub
src/app/           Next.js App Router: (auth)/login, (app)/13 screens, api/
src/modules/       12 modules, one folder each, README stub per module
src/core/          db, config, authz, money, datetime, files, logging, jobs
src/i18n/          catalogs and language switching
src/components/    design-system components
src/styles/        tokens, fonts, print CSS
src/worker/        scheduler entrypoint
tests/             unit/, integration/, e2e/
infra/             compose (production), db init, nginx, backup, deploy
docs/adr/          architecture decision records
```

Modules and the phase that starts them (`IMPLEMENTATION-PLAN.md` §0.4):

| Phase | Modules |
|---|---|
| 1 | `core`, `identity`, `audit` (write path) |
| 2 | `setup` |
| 3 | `inventory` |
| 4 | `sales` |
| 5 | `cashbook`, `ledger` |
| 6 | `recovery`, `reminders`, `documents`, `reporting` |
| 7 | `audit` (read surface) |

## CI

`.github/workflows/ci.yml` runs on every pull request and on `main`:
install (`npm ci`) → typecheck → lint → `prisma validate`. Tests, build and the
image publish pipeline arrive with the phases that need them
(`ARCHITECTURE.md` §14.3).

## Conventions

- TypeScript `strict`; path alias `@/*` → `src/*`.
- Money is `numeric(12,2)` in PostgreSQL and a decimal string on the wire — never
  a JS `number` (`ARCHITECTURE.md` ADR-09).
- All user-facing text is translated; `react/jsx-no-literals` is an ESLint error
  in `src/app`, `src/components` and `src/modules/*/ui` (`ARCHITECTURE.md` §9.4).
- Dates use `Asia/Karachi`; storage is `timestamptz` (`ARCHITECTURE.md` §12.7).
- Do not add a runtime dependency without the note required by
  `ARCHITECTURE.md` §3.6.
