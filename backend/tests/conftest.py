import os

# Point the app at the test database before any app module is imported.
# Environment variables take priority over backend/.env in pydantic-settings.
os.environ["DATABASE_URL"] = os.environ.get(
    "TEST_DATABASE_URL", "postgresql://taggify:taggify_dev@localhost:5432/taggify_test"
)
os.environ["COOKIE_SECURE"] = "false"
# YouTube tokens are encrypted; tests use a fixed throwaway key and sync secret.
os.environ["TOKEN_ENCRYPTION_KEY"] = "vbgGyM3Sx9wVxQ6m4C0h3jzKqk7m2V5o0RkV6nqU5yE="
os.environ["SYNC_SECRET"] = "test-sync-secret"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import select, text  # noqa: E402

from app.core.database import SessionLocal, engine  # noqa: E402
from app.core.security import hash_password  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Base, Membership, Organization, User  # noqa: E402
from app.services.teams import seed_default_roles  # noqa: E402

PASSWORD = "correct-horse-battery"


@pytest.fixture(scope="session", autouse=True)
def _schema():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    yield


@pytest.fixture(autouse=True)
def _clean_tables():
    yield
    tables = ", ".join(t.name for t in Base.metadata.sorted_tables)
    with engine.begin() as conn:
        conn.execute(text(f"TRUNCATE {tables} CASCADE"))


@pytest.fixture
def db():
    with SessionLocal() as session:
        yield session


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def make_founder(db):
    """Create a founder in a company (creating the company if needed)."""

    def _make(email: str, org_slug: str = "taggify", name: str = "Founder") -> User:
        org = db.scalar(select(Organization).where(Organization.slug == org_slug))
        if org is None:
            org = Organization(name=org_slug.title(), slug=org_slug)
            db.add(org)
            db.flush()
            seed_default_roles(db, org)
        user = User(email=email, full_name=name, password_hash=hash_password(PASSWORD))
        db.add(Membership(user=user, organization=org))
        db.commit()
        return user

    return _make


@pytest.fixture
def make_superadmin(db):
    """Create a super admin who belongs to no company."""

    def _make(email: str = "admin@taggify.in", name: str = "Super Admin") -> User:
        user = User(
            email=email, full_name=name, password_hash=hash_password(PASSWORD), is_superadmin=True
        )
        db.add(user)
        db.commit()
        return user

    return _make


@pytest.fixture
def org_id(db):
    """Look up a company's id by slug."""

    def _org_id(slug: str) -> str:
        return str(db.scalar(select(Organization.id).where(Organization.slug == slug)))

    return _org_id


@pytest.fixture
def login():
    """Return a TestClient logged in as the given email."""

    def _login(email: str, password: str = PASSWORD) -> TestClient:
        c = TestClient(app)
        response = c.post("/api/auth/login", json={"email": email, "password": password})
        assert response.status_code == 200, response.text
        return c

    return _login
