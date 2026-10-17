from datetime import date, timedelta

import pytest

from tests.test_channels_people import channel, employee, post, role_id, team

TODAY = date.today()


@pytest.fixture
def founder(make_founder, login):
    make_founder("a@taggify.in", name="Asha")
    return login("a@taggify.in")


def person_body(c, name, role="channel_manager", team_id=None, **extra) -> dict:
    return {"full_name": name, "role_id": role_id(c, role), "team_id": team_id, **extra}


# ---- Roles ----------------------------------------------------------------------------------


def test_new_company_gets_default_roles(make_superadmin, login):
    make_superadmin()
    admin = login("admin@taggify.in")
    org = admin.post("/api/admin/organizations", json={"name": "New Co", "slug": "new-co"}).json()
    admin.post(
        "/api/admin/users",
        json={
            "email": "f@new.co",
            "full_name": "F",
            "password": "correct-horse-battery",
            "organization_id": org["id"],
        },
    )
    roles = {r["name"]: r for r in login("f@new.co").get("/api/employee-roles").json()}
    assert set(roles) == {
        "Channel manager",
        "FB page manager",
        "Team lead",
        "Rights coordinator",
        "Finance analyst",
    }
    assert roles["Team lead"]["can_lead_team"] and roles["Channel manager"]["can_manage_youtube"]


def test_founders_add_rename_and_delete_roles(founder):
    r = founder.post("/api/employee-roles", json={"name": "Instagram editor"})
    assert r.status_code == 201
    rid = r.json()["id"]
    assert founder.post("/api/employee-roles", json={"name": "instagram EDITOR"}).status_code == 409
    renamed = founder.put(
        f"/api/employee-roles/{rid}", json={"name": "Reels editor", "can_manage_facebook": True}
    )
    assert renamed.json()["name"] == "Reels editor" and renamed.json()["can_manage_facebook"]

    employee(founder, "Riya", "Reels editor")
    blocked = founder.delete(f"/api/employee-roles/{rid}")
    assert blocked.status_code == 409 and "1 person" in blocked.text

    spare = founder.post("/api/employee-roles", json={"name": "Spare"}).json()["id"]
    assert founder.delete(f"/api/employee-roles/{spare}").status_code == 204


def test_permission_cannot_be_removed_while_in_use(founder):
    ananya = employee(founder, "Ananya")
    post(founder, f"/api/channels/{channel(founder)}/manager", employee_id=ananya)
    rid = role_id(founder, "channel_manager")
    r = founder.put(
        f"/api/employee-roles/{rid}", json={"name": "Channel manager", "can_manage_youtube": False}
    )
    assert r.status_code == 409 and "Ananya" in r.text

    kabir = employee(founder, "Kabir", "team_lead")
    team(founder, "Kapil Team", lead_id=kabir)
    lead_role = role_id(founder, "team_lead")
    r = founder.put(
        f"/api/employee-roles/{lead_role}",
        json={
            "name": "Team lead",
            "can_manage_youtube": True,
            "can_manage_facebook": True,
            "can_lead_team": False,
        },
    )
    assert r.status_code == 409 and "Kabir" in r.text


# ---- Manager dropdown rule: only roles allowed for that platform -------------------------


@pytest.mark.parametrize(
    "role, platform, allowed",
    [
        ("channel_manager", "youtube", True),
        ("channel_manager", "facebook", False),
        ("fb_page_manager", "facebook", True),
        ("fb_page_manager", "youtube", False),
        ("team_lead", "youtube", True),
        ("finance_analyst", "youtube", False),
    ],
)
def test_manager_must_have_a_role_allowed_for_the_platform(founder, role, platform, allowed):
    person = employee(founder, "Someone", role)
    ch = channel(founder, "Ch", platform=platform)
    r = post(founder, f"/api/channels/{ch}/manager", employee_id=person)
    assert (r.status_code == 200) is allowed, r.text
    if not allowed:
        assert "cannot manage" in r.text


def test_role_change_cannot_strand_a_channel(founder):
    ananya = employee(founder, "Ananya")
    post(founder, f"/api/channels/{channel(founder)}/manager", employee_id=ananya)
    r = founder.put(
        f"/api/employees/{ananya}", json=person_body(founder, "Ananya", "finance_analyst")
    )
    assert r.status_code == 409 and "cannot manage" in r.text


# ---- Teams -----------------------------------------------------------------------------------


def test_team_lead_must_be_allowed_to_lead(founder):
    ananya = employee(founder, "Ananya")
    r = founder.post("/api/teams", json={"name": "Kapil Team", "lead_id": ananya})
    assert r.status_code == 409 and "cannot lead a team" in r.text


def test_channel_team_lead_comes_from_the_managers_team(founder):
    kabir = employee(founder, "Kabir Mehta", "team_lead")
    kapil = team(founder, "Kapil Team", lead_id=kabir)
    ananya = employee(founder, "Ananya Sharma", team_id=kapil)
    ch = channel(founder)
    r = post(founder, f"/api/channels/{ch}/manager", employee_id=ananya)
    assert r.json()["team_lead"]["name"] == "Kabir Mehta"

    # The lead managing a channel directly is not their own lead.
    founder.put(
        f"/api/employees/{kabir}",
        json=person_body(founder, "Kabir Mehta", "team_lead", team_id=kapil),
    )
    r = post(founder, f"/api/channels/{ch}/manager", employee_id=kabir)
    assert r.json()["team_lead"] is None


def test_team_and_lead_changes_keep_history(founder):
    kabir = employee(founder, "Kabir", "team_lead")
    priya = employee(founder, "Priya", "team_lead")
    kapil = team(founder, "Kapil Team", lead_id=kabir)
    cid = team(founder, "CID Team")
    ananya = employee(founder, "Ananya", team_id=kapil)

    founder.put(f"/api/employees/{ananya}", json=person_body(founder, "Ananya", team_id=cid))
    post(founder, f"/api/teams/{kapil}/lead", employee_id=priya)

    detail = founder.get(f"/api/employees/{ananya}").json()
    assert detail["team"]["name"] == "CID Team"
    assert [(h["team"]["name"], h["end_date"]) for h in detail["team_history"]] == [
        ("CID Team", None),
        ("Kapil Team", str(TODAY)),
    ]
    kapil_detail = founder.get(f"/api/teams/{kapil}").json()
    assert kapil_detail["lead"]["name"] == "Priya"
    assert [(h["person"]["name"], h["end_date"] is None) for h in kapil_detail["lead_history"]] == [
        ("Priya", True),
        ("Kabir", False),
    ]
    assert kapil_detail["members"] == []


def test_team_list_counts(founder):
    kabir = employee(founder, "Kabir", "team_lead")
    kapil = team(founder, "Kapil Team", lead_id=kabir)
    ananya = employee(founder, "Ananya", team_id=kapil)
    employee(founder, "Meera", "fb_page_manager", team_id=kapil)
    post(founder, f"/api/channels/{channel(founder)}/manager", employee_id=ananya)

    t = next(x for x in founder.get("/api/teams").json() if x["name"] == "Kapil Team")
    assert (t["lead"]["name"], t["member_count"], t["channel_count"]) == ("Kabir", 2, 1)
    kabir_detail = founder.get(f"/api/employees/{kabir}").json()
    assert [t["name"] for t in kabir_detail["leads_teams"]] == ["Kapil Team"]
    assert [p["name"] for p in kabir_detail["team_members"]] == ["Ananya", "Meera"]


def test_team_with_members_cannot_be_deactivated(founder):
    kapil = team(founder, "Kapil Team")
    employee(founder, "Ananya", team_id=kapil)
    r = founder.put(f"/api/teams/{kapil}", json={"name": "Kapil Team", "is_active": False})
    assert r.status_code == 409 and "1 member" in r.text


def test_future_team_change_rejected(founder):
    kapil = team(founder, "Kapil Team")
    body = person_body(
        founder, "Ananya", team_id=kapil, team_effective_date=str(TODAY + timedelta(days=3))
    )
    assert founder.post("/api/employees", json=body).status_code == 409


# ---- Deactivation ----------------------------------------------------------------------------


def test_deactivation_needs_handover_and_leaves_team(founder):
    kabir = employee(founder, "Kabir", "team_lead")
    kapil = team(founder, "Kapil Team", lead_id=kabir)
    ananya = employee(founder, "Ananya", team_id=kapil)
    ch = channel(founder)
    post(founder, f"/api/channels/{ch}/manager", employee_id=ananya)

    r1 = founder.put(
        f"/api/employees/{ananya}",
        json=person_body(founder, "Ananya", team_id=kapil, is_active=False),
    )
    r2 = founder.put(
        f"/api/employees/{kabir}", json=person_body(founder, "Kabir", "team_lead", is_active=False)
    )
    assert r1.status_code == 409 and "manages 1 channel" in r1.text
    assert r2.status_code == 409 and "leads Kapil Team" in r2.text

    post(founder, f"/api/channels/{ch}/manager", employee_id=None)
    ok = founder.put(
        f"/api/employees/{ananya}",
        json=person_body(founder, "Ananya", team_id=kapil, is_active=False),
    )
    assert ok.status_code == 200 and ok.json()["team"] is None
    assert post(founder, f"/api/channels/{ch}/manager", employee_id=ananya).status_code == 409


def test_roles_and_teams_are_isolated(make_founder, login):
    make_founder("a@taggify.in", org_slug="taggify")
    make_founder("b@sociodoor.in", org_slug="sociodoor")
    t, s = login("a@taggify.in"), login("b@sociodoor.in")
    kapil = team(t, "Kapil Team")
    assert s.get("/api/teams").json() == []
    assert s.get(f"/api/teams/{kapil}").status_code == 404
    other_role = role_id(t, "channel_manager")
    assert (
        s.post("/api/employees", json={"full_name": "X", "role_id": other_role}).status_code == 422
    )
    assert s.post("/api/employees", json=person_body(s, "X", team_id=kapil)).status_code == 422
