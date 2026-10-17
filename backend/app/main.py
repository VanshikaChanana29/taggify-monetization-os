from fastapi import APIRouter, FastAPI

from app.api import admin, audit_logs, auth, content_owners, deals, health, users

app = FastAPI(title="Taggify Monetization OS", version="0.1.0")

# Everything lives under /api. The Next.js frontend proxies /api/* to this service,
# so the browser only ever talks to one origin (no CORS, first-party session cookie).
api = APIRouter(prefix="/api")
api.include_router(health.router)
api.include_router(auth.router)
api.include_router(users.router)
api.include_router(audit_logs.router)
api.include_router(admin.router)
api.include_router(content_owners.router)
api.include_router(deals.router)
app.include_router(api)
