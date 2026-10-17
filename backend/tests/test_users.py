from tests.conftest import PASSWORD


def test_users_list_only_shows_own_company(make_founder, login):
    make_founder("a@taggify.in", org_slug="taggify")
    make_founder("b@sociodoor.in", org_slug="sociodoor")

    taggify = login("a@taggify.in").get("/api/users").json()
    sociodoor = login("b@sociodoor.in").get("/api/users").json()

    assert [u["email"] for u in taggify] == ["a@taggify.in"]
    assert [u["email"] for u in sociodoor] == ["b@sociodoor.in"]


def test_founders_cannot_manage_users(make_founder, login):
    make_founder("a@taggify.in")
    other = make_founder("b@taggify.in")
    c = login("a@taggify.in")

    new_user = {"email": "n@taggify.in", "full_name": "N", "password": PASSWORD}
    assert c.post("/api/users", json=new_user).status_code == 405
    assert c.get("/api/admin/users").status_code == 403
    assert c.get("/api/admin/organizations").status_code == 403
    assert (
        c.post(
            f"/api/admin/users/{other.id}/reset-password", json={"password": "x" * 12}
        ).status_code
        == 403
    )


def test_activity_log_is_scoped_to_company(make_founder, login):
    make_founder("a@taggify.in", org_slug="taggify")
    make_founder("b@sociodoor.in", org_slug="sociodoor")
    taggify = login("a@taggify.in")
    login("b@sociodoor.in")

    logs = taggify.get("/api/audit-logs").json()["items"]

    assert [(entry["action"], entry["user_name"]) for entry in logs] == [("auth.login", "Founder")]
