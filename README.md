# Urban Ibile

Backend API and admin panel for Urban Ibile, a video-first fashion e-commerce platform.
One API and one PostgreSQL database serve the website, the mobile app and the admin panel.
Project rules: [CLAUDE.md](CLAUDE.md). Feature brief: [docs/feature-brief.pdf](docs/feature-brief.pdf).

## Repository layout

```
apps/api          Express API (TypeScript, Kysely, Zod, pino)
apps/admin        Admin panel (placeholder until Phase 8)
packages/shared   Types and constants shared by the API and clients
db/               schema_v2.sql (baseline), seed_v2.sql, migrations/
docs/             feature-brief.pdf
```

## Prerequisites

- Node.js 22 LTS (20.11+ works; see `.nvmrc`)
- pnpm: `corepack enable pnpm` (version pinned in `package.json`)
- PostgreSQL 16 with the database `ecom`, already created from `db/schema_v2.sql` and `db/seed_v2.sql`

## First-time setup

These commands work in PowerShell, cmd and Git Bash.

```sh
pnpm install
copy .env.example .env        # Git Bash: cp .env.example .env
```

Edit `.env` and set `DATABASE_URL` and `TEST_DATABASE_URL` (a separate database, e.g. `ecom_test`).
`.env` is git-ignored; never commit it.

```sh
pnpm db:codegen       # generate Kysely types from the live `ecom` database -> apps/api/src/db/types.ts
pnpm db:test:setup    # create `ecom_test` and apply schema + migrations + seed (refuses to touch `ecom`)
```

## Running

| Command                             | What it does                                               |
| ----------------------------------- | ---------------------------------------------------------- |
| `pnpm dev`                          | API in watch mode at `http://localhost:4000` (pretty logs) |
| `pnpm build`                        | Compile `packages/shared` then `apps/api` to `dist/`       |
| `pnpm start`                        | Run the compiled API (`pnpm build` first)                  |
| `pnpm typecheck`                    | TypeScript strict check for every package                  |
| `pnpm lint` / `pnpm lint:fix`       | ESLint (type-aware)                                        |
| `pnpm format` / `pnpm format:check` | Prettier                                                   |
| `pnpm test`                         | Vitest + Supertest                                         |
| `pnpm db:codegen`                   | Regenerate Kysely DB types (run after every migration)     |
| `pnpm db:test:setup`                | Create and prepare the integration-test database           |

Check it is running:

```sh
curl http://localhost:4000/api/v1/health
```

```json
{
  "data": {
    "status": "ok",
    "db": "up",
    "uptimeSeconds": 3,
    "timestamp": "2026-10-06T10:00:00.000Z"
  }
}
```

If the database is unreachable, the endpoint returns `503` with `SERVICE_UNAVAILABLE`.

## API conventions

- Base path `/api/v1`. Success: `{ data }`; lists: `{ data, meta: { page, pageSize, total, totalPages } }`.
- Errors: `{ error: { code, message, details?, requestId } }`. Codes live in
  `packages/shared/src/error-codes.ts`.
- Every response carries `X-Request-Id`. A safe incoming `X-Request-Id` is reused; otherwise a UUID
  is generated. The same id appears in every log line for the request.
- Security middleware: helmet, CORS allow-list (`CORS_ORIGINS`), per-IP rate limit on `/api/v1`
  (the health check is exempt), JSON body limit 100 kB.

## Tests

- Unit and HTTP tests run without a database.
- Integration tests use `TEST_DATABASE_URL` and are **skipped** when it is not set. They refuse to
  run against a database named `ecom`.

## Database changes

`db/schema_v2.sql` is the applied baseline. Never edit it. Add `db/migrations/NNNN_description.sql`,
apply it, then run `pnpm db:codegen`.
