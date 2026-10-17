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

API: http://localhost:8000/health · docs: http://localhost:8000/docs

Frontend (second terminal):

```powershell
cd frontend
npm install
copy .env.example .env.local
npm run dev
```

App: http://localhost:3000 — should show **API OK**.

## Checks

```powershell
cd backend;  .venv\Scripts\ruff check . ; .venv\Scripts\ruff format --check . ; .venv\Scripts\pytest
cd frontend; npm run lint ; npm run build
```

New migration after changing models:

```powershell
cd backend; .venv\Scripts\alembic revision --autogenerate -m "describe change"
```

Adding a shadcn component (answer the React 19 prompt with **Use --force**):

```powershell
cd frontend; npx shadcn@2.3.0 add table
```

## Deploy on Render (staging)

1. Push to GitHub `main`.
2. Render → **New → Blueprint** → select this repo. It creates `taggify-db`, `taggify-api`, `taggify-web`.
3. When asked for the `sync: false` values:
   - `taggify-api` → `CORS_ORIGINS` = the web service URL, e.g. `https://taggify-web.onrender.com`
   - `taggify-web` → `NEXT_PUBLIC_API_URL` = the API URL, e.g. `https://taggify-api.onrender.com`
4. After the first deploy, open `<api-url>/health` → `{"status":"ok","db":"ok"}`, and the web URL → **API OK**.

`NEXT_PUBLIC_API_URL` is baked in at build time — after changing it, redeploy the web service.
Free plan services sleep when idle (first request is slow) and the free database expires after 30 days.
