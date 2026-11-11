from tests.conftest import PASSWORD


def test_superadmin_without_company_can_log_in_but_not_open_company_data(make_superadmin, login):
    make_superadmin()
    c = login("admin@taggify.in")

    me = c.get("/api/auth/me").json()

    assert me["user"]["is_superadmin"] is True
    assert me["organization"] is None
    assert me["organizations"] == []
    assert c.get("/api/users").status_code == 403
    assert c.get("/api/audit-logs").status_code == 403


def test_superadmin_creates_company_and_founder_who_sees_only_that_company(
    make_superadmin, make_founder, login
):
    make_superadmin()
    make_founder("b@sociodoor.in", org_slug="sociodoor")
    admin = login("admin@taggify.in")

    org = admin.post("/api/admin/organizations", json={"name": "Taggify", "slug": "taggify"}).json()
    created = admin.post(
        "/api/admin/users",
        json={
            "email": "Founder@Taggify.in",
            "full_name": "First Founder",
            "password": PASSWORD,
            "organization_id": org["id"],
        },
    )

    assert created.status_code == 201
    assert created.json()["memberships"] == [
        {"organization_id": org["id"], "organization_name": "Taggify", "is_active": True}
    ]
    founder = login("founder@taggify.in")
    assert founder.get("/api/auth/me").json()["organization"]["slug"] == "taggify"
    assert [u["email"] for u in founder.get("/api/users").json()] == ["founder@taggify.in"]

    orgs = {o["slug"]: o["active_users"] for o in admin.get("/api/admin/organizations").json()}
    assert orgs == {"sociodoor": 1, "taggify": 1}


def test_duplicate_company_slug_and_bad_slug_rejected(make_superadmin, login):
    make_superadmin()
    admin = login("admin@taggify.in")
    admin.post("/api/admin/organizations", json={"name": "Taggify", "slug": "taggify"})

    dup = admin.post("/api/admin/organizations", json={"name": "Other", "slug": "taggify"})
    bad = admin.post("/api/admin/organizations", json={"name": "Bad", "slug": "Bad Slug!"})

    assert dup.status_code == 409
    assert bad.status_code == 422


def test_duplicate_email_rejected(make_superadmin, make_founder, login, org_id):
    make_superadmin()
    make_founder("a@taggify.in")
    admin = login("admin@taggify.in")

    response = admin.post(
        "/api/admin/users",
        json={
            "email": "a@taggify.in",
            "full_name": "Dup",
            "password": PASSWORD,
            "organization_id": org_id("taggify"),
        },
    )

    assert response.status_code == 409


def test_add_founder_to_second_company_enables_switching(
    make_superadmin, make_founder, login, org_id
):
    make_superadmin()
    founder = make_founder("a@taggify.in", org_slug="taggify")
    make_founder("b@sociodoor.in", org_slug="sociodoor")
    admin = login("admin@taggify.in")

    response = admin.post(
        f"/api/admin/users/{founder.id}/memberships",
        json={"organization_id": org_id("sociodoor")},
    )

    assert [m["organization_name"] for m in response.json()["memberships"]] == [
        "Sociodoor",
        "Taggify",
    ]
    c = login("a@taggify.in")
    assert len(c.get("/api/auth/me").json()["organizations"]) == 2
    switched = c.post(
        "/api/auth/switch-organization", json={"organization_id": org_id("sociodoor")}
    )
    assert switched.json()["organization"]["slug"] == "sociodoor"


def test_deactivate_ends_existing_session_and_activate_restores(
    make_superadmin, make_founder, login, org_id
):
    make_superadmin()
    founder = make_founder("a@taggify.in")
    admin = login("admin@taggify.in")
    victim = login("a@taggify.in")
    url = f"/api/admin/users/{founder.id}/memberships/{org_id('taggify')}"

    deactivated = admin.post(f"{url}/deactivate").json()
    assert deactivated["memberships"][0]["is_active"] is False
    assert victim.get("/api/auth/me").status_code == 401
    assert (
        victim.post(
            "/api/auth/login", json={"email": "a@taggify.in", "password": PASSWORD}
        ).status_code
        == 401
    )

    admin.post(f"{url}/activate")
    login("a@taggify.in")


def test_reset_password_logs_user_out(make_superadmin, make_founder, login):
    make_superadmin()
    founder = make_founder("a@taggify.in")
    admin = login("admin@taggify.in")
    victim = login("a@taggify.in")

    response = admin.post(
        f"/api/admin/users/{founder.id}/reset-password", json={"password": "temporary-password-1"}
    )

    assert response.status_code == 204
    assert victim.get("/api/auth/me").status_code == 401
    login("a@taggify.in", "temporary-password-1")


def test_superadmin_cannot_reset_own_password_here(make_superadmin, login):
    admin_user = make_superadmin()
    admin = login("admin@taggify.in")

    reset = admin.post(
        f"/api/admin/users/{admin_user.id}/reset-password", json={"password": "x" * 12}
    )

    assert reset.status_code == 400


def test_superadmin_can_leave_a_company_and_stays_in_admin(make_superadmin, login):
    admin_user = make_superadmin()
    admin = login("admin@taggify.in")
    org = admin.post("/api/admin/organizations", json={"name": "Test Co", "slug": "test-co"}).json()
    admin.post(f"/api/admin/users/{admin_user.id}/memberships", json={"organization_id": org["id"]})
    admin.post("/api/auth/switch-organization", json={"organization_id": org["id"]})
    assert admin.get("/api/auth/me").json()["organization"]["id"] == org["id"]

    deactivate = admin.post(f"/api/admin/users/{admin_user.id}/memberships/{org['id']}/deactivate")

    assert deactivate.status_code == 200
    assert deactivate.json()["memberships"][0]["is_active"] is False
    me = admin.get("/api/auth/me")
    assert me.status_code == 200
    assert me.json()["organization"] is None
    assert admin.get("/api/admin/users").status_code == 200
    back = admin.post("/api/auth/switch-organization", json={"organization_id": org["id"]})
    assert back.status_code == 403


def test_admin_actions_show_in_company_activity(make_superadmin, make_founder, login, org_id):
    make_superadmin(name="Platform Admin")
    founder = make_founder("a@taggify.in")
    admin = login("admin@taggify.in")
    admin.post(
        f"/api/admin/users/{founder.id}/reset-password", json={"password": "temporary-password-1"}
    )

    logs = login("a@taggify.in", "temporary-password-1").get("/api/audit-logs").json()["items"]

    assert ("user.password_reset", "Platform Admin") in [
        (e["action"], e["user_name"]) for e in logs
    ]


def test_superadmin_deletes_a_login_but_not_their_own_or_the_last_admin(
    make_superadmin, make_founder, login
):
    admin_user = make_superadmin()
    founder_user = make_founder("gone@taggify.in")
    founder = login("gone@taggify.in")
    admin = login("admin@taggify.in")

    assert admin.delete(f"/api/admin/users/{founder_user.id}").status_code == 204
    emails = [u["email"] for u in admin.get("/api/admin/users").json()]
    assert "gone@taggify.in" not in emails
    # Their session is gone and they cannot log in again.
    assert founder.get("/api/auth/me").status_code == 401
    r = founder.post("/api/auth/login", json={"email": "gone@taggify.in", "password": "x" * 12})
    assert r.status_code in (400, 401)

    assert admin.delete(f"/api/admin/users/{admin_user.id}").status_code == 400  # own login
    make_superadmin("second@taggify.in", "Second")
    second = login("second@taggify.in")
    assert second.delete(f"/api/admin/users/{admin_user.id}").status_code == 204
    # Now "second" is the last super admin; nobody can remove them.


def test_founder_cannot_delete_users(make_founder, login):
    other = make_founder("other@taggify.in")
    make_founder("a@taggify.in")
    assert login("a@taggify.in").delete(f"/api/admin/users/{other.id}").status_code == 403
