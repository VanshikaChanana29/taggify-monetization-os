from fastapi import APIRouter, FastAPI

from app.api import (
    admin,
    audit_logs,
    auth,
    channels,
    cms_partners,
    content_owners,
    deals,
    employees,
    finance,
    health,
    roles,
    teams,
    users,
)

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
api.include_router(cms_partners.router)
api.include_router(channels.router)
api.include_router(employees.router)
api.include_router(roles.router)
api.include_router(teams.router)
api.include_router(finance.router)
app.include_router(api)
