# Taggify Monetization OS

Internal operating system for content rights → channels → revenue → CMS settlement → cash → incentives.
Multi-company: Taggify and Sociodoor run on the same app with separate data.

| Layer | Stack |
|---|---|
| Backend | Python 3.12, FastAPI, SQLAlchemy 2, Alembic, PostgreSQL 16 |
| Frontend | Next.js 15 (App Router, TypeScript), Tailwind 3, shadcn/ui |
| Deploy | Render (Blueprint in `render.yaml`) |
| CI | GitHub Actions (`.github/workflows/ci.yml`) |

Background jobs (Redis + Celery) are added in Part 6 for YouTube/Meta sync. `backend/app/workers/` is reserved for them.

## Project layout

```
backend/
  app/
    main.py          FastAPI app
    core/            config (env), database session
    api/             routers (one file per module)
    models/          SQLAlchemy tables
    schemas/         Pydantic request/response models
    services/        business logic (CMS fee, incentives, recovery…)
    integrations/    YouTube, Meta, Gmail, Claude clients
    workers/         background jobs (Part 6)
  alembic/           migrations
  tests/
frontend/
  src/app/           pages
  src/components/ui/ shadcn components
  src/lib/api.ts     API client
```

## Conventions

- **Money** is `Numeric(18, 2)` / `Decimal` with a `currency` column — never float.
- **History** (assignments, rates, slots) uses `effective_from` / `effective_to`; rows are closed, not overwritten.
- **Multi-company**: every business table has `organization_id`; every query is scoped to the current organization.
- A locked month is never edited; later changes become adjustment entries.
- **Lists** always get sorting, filters and pagination:
  - Lists that grow without bound (activity, deals, channels, revenue rows) are paginated **on the
    server**: return `Page[T]` via `paginate()` in `backend/app/api/pagination.py` (`page`,
    `page_size` ≤ 100, filters as query params, a stable `ORDER BY … , id`).
  - Small bounded lists (a company's founders, companies, all users) are returned whole and
    sorted/filtered/paginated in the browser with `useClientTable` (`frontend/src/lib/use-client-table.ts`).
  - UI pieces: `SortableHead`, `FilterBar`, `SearchInput`, `TablePagination`, `EmptyRow`
    in `frontend/src/components/data-table.tsx`.

## Local setup (Windows)

Prerequisites: Git, Python 3.12, Node 20.19+ (22 LTS recommended), PostgreSQL 16 running on `localhost:5432`.

One-time database setup (as the `postgres` superuser):

```sql
CREATE ROLE taggify WITH LOGIN PASSWORD 'taggify_dev';
CREATE DATABASE taggify_dev OWNER taggify;
CREATE DATABASE taggify_test OWNER taggify;
```

Backend:

```powershell
cd backend
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements-dev.txt
copy .env.example .env
.venv\Scripts\alembic upgrade head
.venv\Scripts\uvicorn app.main:app --reload --port 8000
```

API: http://localhost:8000/api/health · docs: http://localhost:8000/docs

Create the super admin (there is no signup page; the password is asked for):

```powershell
cd backend
.venv\Scripts\python -m app.cli create-superadmin --email you@taggify.in --name "Your Name"
```

Log in as the super admin, then in the app:
1. **Super admin → Companies**: create Taggify, Sociodoor, …
2. **Super admin → All users**: create each company's founders (with a temporary password),
   or add an existing user to another company (a company switcher then appears for them).

`python -m app.cli list` prints every company and its users. `create-org`, `create-user` and
`add-member` do the same as the Admin pages, for scripting or recovery.

Frontend (second terminal):

```powershell
cd frontend
npm install
copy .env.example .env.local
npm run dev
```

App: http://localhost:3000 → login page.

## How login works

- **Super admin** runs the tool: creates companies and founders, removes access, resets passwords.
  Only the super admin can manage users. Create the first one with `create-superadmin`.
- **Founders** log in to their company and have full access to its data and nothing else.
  They can see who else has access (**Settings → Users**) but cannot add or remove users.
- Login sets an `httpOnly` session cookie (7 days). Only a hash of the token is stored in `user_sessions`,
  so logout, deactivation and password resets take effect immediately.
- 5 wrong passwords lock the account for 15 minutes.
- The browser only talks to the Next.js app; `/api/*` is proxied to FastAPI (`frontend/next.config.ts`),
  so the cookie is first-party and there is no CORS.
- Every login, logout and user change is recorded in `audit_logs` (**Settings → Activity**).

## Checks

```powershell
cd backend;  .venv\Scripts\ruff check . ; .venv\Scripts\ruff format --check . ; .venv\Scripts\pytest
cd frontend; npm run lint ; npm run build
```

New migration after changing models:

```powershell
cd backend; .venv\Scripts\alembic revision --autogenerate -m "describe change"
```

Adding a shadcn component (answer the React 19 prompt with **Use --force**), then re-resolve the
lockfile without `--force` and check it the way CI and Render install it:

```powershell
cd frontend; npx shadcn@2.3.0 add table
npm install
npm ci
```

`--force` installs can leave a lockfile that Windows npm accepts but Linux `npm ci` rejects
("package.json and package-lock.json are not in sync"). `picomatch` is a direct dev dependency
for that reason: it pins v4 at the top of the tree so every platform resolves the same layout.

## Deploy (free: Render + Neon + Cloudflare R2)

1. **Neon** → new project (region Singapore) → copy the connection string
   (`postgresql://…neon.tech/…?sslmode=require`).
2. **Cloudflare R2** → create a private bucket, e.g. `taggify-files` → *Manage API tokens* →
   token with **Object Read & Write** on that bucket → note the Account ID, Access Key ID and
   Secret Access Key. Do not make the bucket public: files are served only through the API.
3. Push to GitHub `main`. Render → **New → Blueprint** → select this repo. It creates
   `taggify-api` and `taggify-web` and asks for:
   - `DATABASE_URL` (Neon), `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`
   - `API_URL` on `taggify-web`: the API service URL, e.g. `https://taggify-api.onrender.com`
4. After the first deploy, open `<api-url>/api/health` → `{"status":"ok","db":"ok"}`.
   Migrations run on every start.
5. Create the super admin from your laptop against Neon:
   ```powershell
   cd backend
   $env:DATABASE_URL = "<neon connection string>"
   .venv\Scripts\python -m app.cli create-superadmin --email you@taggify.in --name "Your Name"
   Remove-Item Env:DATABASE_URL
   ```
   Then log in at the web URL and create companies and founders from the Admin pages.
6. Domain: Render → `taggify-web` → *Custom domains* → `monetization.taggify.in`, then add the
   CNAME it shows at the DNS provider. SSL is automatic.

`API_URL` is read when the frontend is built — after changing it, redeploy the web service.
Free web services sleep after 15 minutes idle (the first request takes ~1 minute). Neon's free
plan holds 1 GB per project; files go to R2 (10 GB free), so the database stays small.

