from datetime import date, timedelta

import pytest

from tests.test_deals import deal_body, owner

TODAY = date.today()


@pytest.fixture
def founder(make_founder, login):
    make_founder("a@taggify.in", name="Asha")
    return login("a@taggify.in")


def cms(c, name="CMS A", platform="youtube") -> str:
    r = c.post("/api/cms-partners", json={"name": name, "platform": platform})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def channel(c, name="Kapil Comedy 01", platform="youtube", external_id=None, cms_id=None, **extra):
    body = {
        "platform": platform,
        "name": name,
        "external_id": external_id or f"UC-{name.replace(' ', '-')}",
        "cms_partner_id": cms_id,
        **extra,
    }
    r = c.post("/api/channels", json=body)
    assert r.status_code == 201, r.text
    return r.json()["id"]


ROLE_NAMES = {
    "channel_manager": "Channel manager",
    "fb_page_manager": "FB page manager",
    "team_lead": "Team lead",
    "finance_analyst": "Finance analyst",
}


def role_id(c, name: str) -> str:
    name = ROLE_NAMES.get(name, name)
    return next(r["id"] for r in c.get("/api/employee-roles").json() if r["name"] == name)


def employee(c, name, role="channel_manager", team_id=None, **extra) -> str:
    body = {"full_name": name, "role_id": role_id(c, role), "team_id": team_id, **extra}
    r = c.post("/api/employees", json=body)
    assert r.status_code == 201, r.text
    return r.json()["id"]


def team(c, name, lead_id=None) -> str:
    r = c.post("/api/teams", json={"name": name, "lead_id": lead_id})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def new_deal(c, **overrides) -> dict:
    r = c.post(
        "/api/deals", json=deal_body(owner(c, overrides.pop("owner_name", "Sony")), **overrides)
    )
    assert r.status_code == 201, r.text
    return r.json()


def slot_id(deal: dict, code: str) -> str:
    return next(s["id"] for s in deal["slots"] if s["code"] == code)


def post(c, url, **body):
    return c.post(url, json=body)


# ---- CMS partners & channels --------------------------------------------------------------


def test_cms_platform_must_match_channel(founder):
    fb_cms = cms(founder, "Meta Portfolio P-02", "facebook")
    r = founder.post(
        "/api/channels",
        json={"platform": "youtube", "name": "X", "external_id": "UC1", "cms_partner_id": fb_cms},
    )
    assert r.status_code == 422 and "Facebook CMS" in r.text


def test_channel_external_id_unique_per_platform(founder):
    channel(founder, "One", external_id="UC123")
    dup = founder.post(
        "/api/channels", json={"platform": "youtube", "name": "Two", "external_id": "UC123"}
    )
    assert dup.status_code == 409
    # Same id on the other platform is a different thing.
    channel(founder, "Page", platform="facebook", external_id="UC123")


def test_channel_url_must_be_a_link(founder):
    r = founder.post(
        "/api/channels",
        json={"platform": "youtube", "name": "X", "external_id": "UC9", "url": "youtube.com/@x"},
    )
    assert r.status_code == 422 and "https://" in r.text


# ---- Slot assignment ----------------------------------------------------------------------


def test_assign_shows_channel_cms_and_manager_on_deal(founder):
    cms_a = cms(founder)
    ch = channel(founder, cms_id=cms_a)
    ananya = employee(founder, "Ananya Sharma")
    post(founder, f"/api/channels/{ch}/manager", employee_id=ananya)
    deal = new_deal(founder, yt_slot_limit=2, fb_slot_limit=1)

    r = post(
        founder, f"/api/deals/{deal['id']}/slots/{slot_id(deal, 'YT-01')}/assign", channel_id=ch
    )

    assert r.status_code == 200, r.text
    s = r.json()
    assert (s["status"], s["channel_name"], s["cms_name"], s["manager_name"], s["since"]) == (
        "pending_whitelist",
        "Kapil Comedy 01",
        "CMS A",
        "Ananya Sharma",
        str(TODAY),
    )
    d = founder.get(f"/api/deals/{deal['id']}").json()
    assert d["yt_slots_used"] == 1


@pytest.mark.parametrize(
    "setup, message",
    [
        ("facebook_channel", "is a Youtube slot"),
        ("inactive_channel", "is inactive"),
        ("already_in_deal", "already holds YT-01"),
        ("slot_taken", "Use Replace"),
        ("future_date", "cannot be in the future"),
        ("expired_deal", "deal is expired"),
    ],
)
def test_assign_rules(founder, setup, message):
    expired = setup == "expired_deal"
    deal = new_deal(
        founder,
        yt_slot_limit=2,
        term_start=str(TODAY - timedelta(days=400)) if expired else str(TODAY - timedelta(days=30)),
        term_end=str(TODAY - timedelta(days=1)) if expired else str(TODAY + timedelta(days=900)),
    )
    yt1, yt2 = slot_id(deal, "YT-01"), slot_id(deal, "YT-02")
    url = f"/api/deals/{deal['id']}/slots"
    body = {}
    if setup == "facebook_channel":
        ch = channel(founder, "FB page", platform="facebook")
        target = yt1
    elif setup == "inactive_channel":
        ch = channel(founder, "Old", status="inactive")
        target = yt1
    elif setup == "already_in_deal":
        ch = channel(founder)
        post(founder, f"{url}/{yt1}/assign", channel_id=ch)
        target = yt2
    elif setup == "slot_taken":
        post(founder, f"{url}/{yt1}/assign", channel_id=channel(founder, "First"))
        ch = channel(founder, "Second")
        target = yt1
    elif setup == "future_date":
        ch = channel(founder)
        target = yt1
        body["effective_date"] = str(TODAY + timedelta(days=1))
    else:
        ch = channel(founder)
        target = yt1

    r = founder.post(f"{url}/{target}/assign", json={"channel_id": ch, **body})

    assert r.status_code == 409, r.text
    assert message in r.json()["detail"]


def test_replace_keeps_history_and_unassign_frees_slot(founder):
    deal = new_deal(founder, yt_slot_limit=1, fb_slot_limit=0)
    yt1 = slot_id(deal, "YT-01")
    url = f"/api/deals/{deal['id']}/slots/{yt1}"
    old, new = channel(founder, "Kapil Comedy 01"), channel(founder, "Kapil Comedy 02")
    start = TODAY - timedelta(days=10)

    post(founder, f"{url}/assign", channel_id=old, status="active", effective_date=str(start))
    r = post(founder, f"{url}/replace", channel_id=new, notes="01 got a copyright strike")
    assert r.json()["channel_name"] == "Kapil Comedy 02"
    assert r.json()["status"] == "pending_whitelist"  # new channel waits for approval

    history = founder.get(f"/api/deals/{deal['id']}/assignments").json()
    assert [(h["channel_name"], h["start_reason"], h["end_reason"]) for h in history] == [
        ("Kapil Comedy 02", "replacement", None),
        ("Kapil Comedy 01", "assigned", "replaced"),
    ]
    assert history[1]["start_date"] == str(start)
    assert history[1]["end_date"] == str(TODAY - timedelta(days=1))

    r = post(founder, f"{url}/unassign")
    assert r.json()["status"] == "unassigned" and r.json()["channel_name"] is None
    old_detail = founder.get(f"/api/channels/{old}").json()
    assert old_detail["slots"] == [] and old_detail["slot_history"][0]["end_reason"] == "replaced"


def test_slot_status_must_match_channel(founder):
    deal = new_deal(founder, yt_slot_limit=1, fb_slot_limit=0)
    yt1 = slot_id(deal, "YT-01")

    def patch(status):
        return founder.patch(f"/api/deals/{deal['id']}/slots/{yt1}", json={"status": status})

    assert patch("active").status_code == 409  # no channel yet
    assert patch("reserved").status_code == 200
    post(founder, f"/api/deals/{deal['id']}/slots/{yt1}/assign", channel_id=channel(founder))
    assert patch("unassigned").status_code == 409  # channel still there
    assert patch("active").status_code == 200


def test_cannot_lower_limit_below_a_slot_with_a_channel(founder):
    deal = new_deal(founder, yt_slot_limit=2, fb_slot_limit=0)
    post(
        founder,
        f"/api/deals/{deal['id']}/slots/{slot_id(deal, 'YT-02')}/assign",
        channel_id=channel(founder),
    )
    r = founder.put(
        f"/api/deals/{deal['id']}",
        json=deal_body(deal["owner_id"], yt_slot_limit=1, fb_slot_limit=0),
    )
    assert r.status_code == 409 and "YT-02" in r.text


# ---- Channel list ---------------------------------------------------------------------------


def test_channel_filters(founder):
    cms_a, cms_b = cms(founder, "CMS A"), cms(founder, "CMS B")
    a = channel(founder, "Alpha", cms_id=cms_a)
    b = channel(founder, "Beta", cms_id=cms_b)
    channel(founder, "Gamma page", platform="facebook")
    lead = employee(founder, "Kabir Mehta", "team_lead")
    kapil = team(founder, "Kapil Team", lead_id=lead)
    ananya = employee(founder, "Ananya Sharma", team_id=kapil)
    post(founder, f"/api/channels/{a}/manager", employee_id=ananya)
    deal = new_deal(founder, yt_slot_limit=1, fb_slot_limit=0)
    post(founder, f"/api/deals/{deal['id']}/slots/{slot_id(deal, 'YT-01')}/assign", channel_id=b)

    def names(query: str) -> list[str]:
        return [c["name"] for c in founder.get(f"/api/channels?{query}").json()["items"]]

    assert names("platform=youtube") == ["Alpha", "Beta"]
    assert names(f"cms_partner_id={cms_b}") == ["Beta"]
    assert names(f"deal_id={deal['id']}") == ["Beta"]
    assert names("slot=unassigned") == ["Alpha", "Gamma page"]
    assert names(f"manager_id={ananya}") == ["Alpha"]
    assert names("q=gam") == ["Gamma page"]
    assert names("sort=name&direction=desc&page_size=1&page=2") == ["Beta"]

    alpha = founder.get("/api/channels?q=alpha").json()["items"][0]
    assert (
        alpha["manager"]["name"] == "Ananya Sharma" and alpha["team_lead"]["name"] == "Kabir Mehta"
    )
    s = founder.get("/api/channels/summary").json()
    assert s == {"active_channels": 3, "in_slots": 1, "without_slot": 2, "without_manager": 2}


# ---- People: see tests/test_people_teams.py ----------------------------------------------


def test_people_and_channels_are_isolated_between_companies(make_founder, login):
    make_founder("a@taggify.in", org_slug="taggify")
    make_founder("b@sociodoor.in", org_slug="sociodoor")
    t, s = login("a@taggify.in"), login("b@sociodoor.in")
    ch, emp, c = channel(t), employee(t, "Ananya"), cms(t)

    assert s.get(f"/api/channels/{ch}").status_code == 404
    assert s.get(f"/api/employees/{emp}").status_code == 404
    assert s.get("/api/channels").json()["total"] == 0
    assert s.get("/api/employees").json() == [] and s.get("/api/cms-partners").json() == []
    # Using another company's ids is refused.
    s_ch = channel(s, "Socio channel")
    assert post(s, f"/api/channels/{s_ch}/manager", employee_id=emp).status_code == 404
    bad = s.post(
        "/api/channels",
        json={"platform": "youtube", "name": "X", "external_id": "U", "cms_partner_id": c},
    )
    assert bad.status_code == 422
    deal = new_deal(s, yt_slot_limit=1, fb_slot_limit=0)
    assert (
        post(
            s, f"/api/deals/{deal['id']}/slots/{slot_id(deal, 'YT-01')}/assign", channel_id=ch
        ).status_code
        == 404
    )
