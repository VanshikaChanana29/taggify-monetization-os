from datetime import timedelta

import pytest
from sqlalchemy import select

from app.core.security import utcnow
from app.models import AuditLog, Membership, Organization
from app.services.auth import validate_new_email
from tests.conftest import PASSWORD


def test_login_sets_httponly_cookie_and_returns_company(client, make_founder):
    make_founder("a@taggify.in", name="Asha")

    response = client.post("/api/auth/login", json={"email": "A@Taggify.in", "password": PASSWORD})

    assert response.status_code == 200
    body = response.json()
    assert body["user"]["email"] == "a@taggify.in"
    assert body["organization"]["slug"] == "taggify"
    cookie = response.headers["set-cookie"]
    assert "taggify_session=" in cookie
    assert "HttpOnly" in cookie
    assert "samesite=lax" in cookie.lower()


def test_wrong_password_and_unknown_email_get_the_same_error(client, make_founder):
    make_founder("a@taggify.in")

    wrong = client.post("/api/auth/login", json={"email": "a@taggify.in", "password": "nope"})
    unknown = client.post("/api/auth/login", json={"email": "x@taggify.in", "password": "nope"})

    malformed = client.post("/api/auth/login", json={"email": "not-an-email", "password": "x"})

    assert wrong.status_code == unknown.status_code == malformed.status_code == 401
    assert wrong.json() == unknown.json() == malformed.json()
    assert wrong.json() == {"detail": "Invalid email or password"}


def test_cli_email_validation_matches_api():
    assert validate_new_email("  Founder@Taggify.IN ") == "founder@taggify.in"
    with pytest.raises(ValueError):
        validate_new_email("demo@taggify.local")


def test_account_locks_after_five_failures_even_with_right_password(client, make_founder):
    make_founder("a@taggify.in")
    for _ in range(5):
        client.post("/api/auth/login", json={"email": "a@taggify.in", "password": "nope"})

    response = client.post("/api/auth/login", json={"email": "a@taggify.in", "password": PASSWORD})

    assert response.status_code == 429
    assert "Try again" in response.json()["detail"]


def test_lock_expires(client, make_founder, db):
    user = make_founder("a@taggify.in")
    user.locked_until = utcnow() - timedelta(minutes=1)
    db.commit()

    response = client.post("/api/auth/login", json={"email": "a@taggify.in", "password": PASSWORD})

    assert response.status_code == 200


def test_me_requires_login(client):
    assert client.get("/api/auth/me").status_code == 401


def test_logout_kills_the_session(make_founder, login):
    make_founder("a@taggify.in")
    c = login("a@taggify.in")
    cookie = c.cookies.get("taggify_session")

    assert c.post("/api/auth/logout").status_code == 204

    # Even if someone kept a copy of the old cookie, it no longer works.
    c.cookies.set("taggify_session", cookie)
    assert c.get("/api/auth/me").status_code == 401


def test_deactivated_user_cannot_log_in(client, make_founder, db):
    user = make_founder("a@taggify.in")
    db.scalar(select(Membership).where(Membership.user_id == user.id)).is_active = False
    db.commit()

    response = client.post("/api/auth/login", json={"email": "a@taggify.in", "password": PASSWORD})

    assert response.status_code == 401
    assert response.json()["detail"] == "Your access has been deactivated."


def test_switch_organization_only_to_own_companies(make_founder, login, db):
    user = make_founder("a@taggify.in", org_slug="taggify")
    make_founder("b@sociodoor.in", org_slug="sociodoor")
    sociodoor = db.scalar(select(Organization).where(Organization.slug == "sociodoor"))
    c = login("a@taggify.in")

    denied = c.post("/api/auth/switch-organization", json={"organization_id": str(sociodoor.id)})
    assert denied.status_code == 403

    db.add(Membership(user_id=user.id, organization_id=sociodoor.id))
    db.commit()
    allowed = c.post("/api/auth/switch-organization", json={"organization_id": str(sociodoor.id)})
    assert allowed.status_code == 200
    assert allowed.json()["organization"]["slug"] == "sociodoor"
    assert c.get("/api/auth/me").json()["organization"]["slug"] == "sociodoor"


def test_login_opens_the_company_picked_last(make_founder, login, db):
    user = make_founder("a@taggify.in", org_slug="taggify")
    make_founder("b@sociodoor.in", org_slug="sociodoor")
    sociodoor = db.scalar(select(Organization).where(Organization.slug == "sociodoor"))
    db.add(Membership(user_id=user.id, organization_id=sociodoor.id))
    db.commit()

    first = login("a@taggify.in")
    assert first.get("/api/auth/me").json()["organization"]["slug"] == "taggify"
    first.post("/api/auth/switch-organization", json={"organization_id": str(sociodoor.id)})

    # A fresh login (new browser) opens Sociodoor again.
    assert login("a@taggify.in").get("/api/auth/me").json()["organization"]["slug"] == "sociodoor"

    # If that access is removed, login falls back to a company they still have.
    db.scalar(
        select(Membership).where(
            Membership.user_id == user.id, Membership.organization_id == sociodoor.id
        )
    ).is_active = False
    db.commit()
    assert login("a@taggify.in").get("/api/auth/me").json()["organization"]["slug"] == "taggify"


def test_change_password_logs_out_other_sessions(make_founder, login):
    make_founder("a@taggify.in")
    laptop = login("a@taggify.in")
    phone = login("a@taggify.in")

    response = laptop.post(
        "/api/auth/change-password",
        json={"current_password": PASSWORD, "new_password": "a-brand-new-password"},
    )

    assert response.status_code == 204
    assert laptop.get("/api/auth/me").status_code == 200
    assert phone.get("/api/auth/me").status_code == 401
    login("a@taggify.in", "a-brand-new-password")


def test_change_password_needs_current_password(make_founder, login):
    make_founder("a@taggify.in")
    c = login("a@taggify.in")

    response = c.post(
        "/api/auth/change-password",
        json={"current_password": "wrong", "new_password": "a-brand-new-password"},
    )

    assert response.status_code == 400


def test_logins_are_audited(client, make_founder, db):
    make_founder("a@taggify.in")
    client.post("/api/auth/login", json={"email": "a@taggify.in", "password": "nope"})
    client.post("/api/auth/login", json={"email": "a@taggify.in", "password": PASSWORD})

    actions = [a.action for a in db.scalars(select(AuditLog).order_by(AuditLog.created_at))]

    assert actions == ["auth.login_failed", "auth.login"]
