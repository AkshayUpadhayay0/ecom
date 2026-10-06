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

Edit `.env` and set `DATABASE_URL`, `TEST_DATABASE_URL` (a separate database, e.g. `ecom_test`),
`JWT_ACCESS_SECRET` and `JWT_ADMIN_ACCESS_SECRET` (32+ random characters each, different from each
other; the API refuses to start otherwise). Generate a secret (any shell):

```sh
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

`.env` is git-ignored; never commit it.

```sh
pnpm db:migrate       # apply db/migrations/*.sql to `ecom` (tracked in schema_migrations)
pnpm db:codegen       # generate Kysely types from the live `ecom` database -> apps/api/src/db/types.ts
pnpm db:test:setup    # create `ecom_test` and apply schema + seed + migrations (refuses to touch `ecom`)
pnpm admin:create     # create an admin account (prompts; password input is hidden)
```

## Running

| Command                             | What it does                                               |
| ----------------------------------- | ---------------------------------------------------------- |
| `pnpm dev` / `pnpm dev:api`         | API in watch mode at `http://localhost:4000` (pretty logs) |
| `pnpm dev:admin`                    | Admin panel (Vite) at `http://localhost:5173`              |
| `pnpm dev:all`                      | API and admin panel together in one terminal               |
| `pnpm build`                        | Build `packages/shared`, `apps/api` and `apps/admin`       |
| `pnpm start`                        | Run the compiled API (`pnpm build` first)                  |
| `pnpm typecheck`                    | TypeScript strict check for every package                  |
| `pnpm lint` / `pnpm lint:fix`       | ESLint (type-aware)                                        |
| `pnpm format` / `pnpm format:check` | Prettier                                                   |
| `pnpm test`                         | Vitest + Supertest                                         |
| `pnpm db:codegen`                   | Regenerate Kysely DB types (run after every migration)     |
| `pnpm db:test:setup`                | Create and prepare the integration-test database           |
| `pnpm db:migrate`                   | Apply pending SQL migrations to `ecom`                     |
| `pnpm admin:create`                 | Create an admin account interactively                      |

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

## Authentication (Phase 1)

| Endpoint                                     | Auth           | Notes                                                                    |
| -------------------------------------------- | -------------- | ------------------------------------------------------------------------ |
| `POST /api/v1/auth/register`                 | -              | email, password, fullName, phone?, acceptTerms, client (web/ios/android) |
| `POST /api/v1/auth/login`                    | -              | email, password, client                                                  |
| `POST /api/v1/auth/refresh`                  | refresh token  | rotates the token; reusing an old one revokes the session                |
| `POST /api/v1/auth/logout`                   | refresh token  | idempotent, 204                                                          |
| `GET` / `PATCH /api/v1/auth/me`              | customer       | PATCH: fullName, phone, preferredLanguage (en/pcm)                       |
| `POST /api/v1/auth/verify-email`             | -              | token from the email link                                                |
| `POST /api/v1/auth/resend-verification`      | customer       | 202                                                                      |
| `POST /api/v1/auth/forgot-password`          | -              | always 202                                                               |
| `POST /api/v1/auth/reset-password`           | -              | token, newPassword; signs out every device                               |
| `POST /api/v1/admin/auth/login`              | -              | email, password                                                          |
| `POST /api/v1/admin/auth/refresh`, `/logout` | refresh cookie |                                                                          |
| `GET /api/v1/admin/auth/me`                  | admin          |                                                                          |
| `POST /api/v1/admin/auth/change-password`    | admin          | currentPassword, newPassword; audited                                    |

- **Access token**: `Authorization: Bearer <token>`, 15 minutes. Customer and admin tokens use
  different secrets and audiences, so neither works on the other's routes.
- **Refresh token**: web and admin get an httpOnly `SameSite=Strict` cookie scoped to the auth
  path; iOS/Android get it in the JSON body (store it in the Keychain/Keystore).
- **Emails are MOCK**: they are printed in the API terminal (look for `MOCK EMAIL`), not delivered.
- Try every endpoint with [apps/api/http/auth.http](apps/api/http/auth.http) (VS Code REST Client
  extension).

## Admin panel (apps/admin)

React + Vite + TypeScript, React Router, TanStack Query, Tailwind v4 + shadcn/ui, react-hook-form +
Zod. Current scope: login, authenticated layout, dashboard; other sections show "Coming soon".

- Config: copy `apps/admin/.env.example` to `apps/admin/.env.local` (optional in development; the
  default is `http://localhost:4000/api/v1`). The API's `CORS_ORIGINS` must include
  `http://localhost:5173`.
- Sign-in needs an admin account: `pnpm admin:create`.
- **Tokens**: the access token is kept in memory only. The refresh token is the API's httpOnly
  `SameSite=Strict` cookie; on page load the panel calls `/admin/auth/refresh` to restore the
  session. Refreshes are single-flight per tab and serialised across tabs (Web Locks), because the
  API revokes the session if a rotated refresh token is replayed.
- **Production**: the admin panel and API must be served over HTTPS from the same parent domain
  (e.g. `admin.example.com` + `api.example.com`), otherwise the browser will not send the cookie.
- **Dashboard data is MOCK** (`src/features/dashboard/dashboard.mock.ts`, "Sample data" badge).
  Preview states with `/dashboard?mock=empty` or `/dashboard?mock=error`.
- **Theme**: every colour, font and radius is in `src/styles/theme.css` (TEMP palette until the
  client chooses one). Dark mode toggle in the top bar.

## Tests

- Unit and HTTP tests run without a database.
- Integration tests use `TEST_DATABASE_URL` and are **skipped** when it is not set. They refuse to
  run against a database named `ecom`.

## Database changes

`db/schema_v2.sql` is the applied baseline. Never edit it. Add `db/migrations/NNNN_description.sql`,
apply it, then run `pnpm db:codegen`.
