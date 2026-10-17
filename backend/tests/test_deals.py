from datetime import date, timedelta

import pytest
from sqlalchemy import select

from app.models import AuditLog

TODAY = date.today()


def owner(c, name="Sony", owner_type="licensor", **extra) -> str:
    r = c.post("/api/content-owners", json={"name": name, "owner_type": owner_type, **extra})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def deal_body(owner_id: str, **overrides) -> dict:
    body = {
        "owner_id": owner_id,
        "title": "The Kapil Sharma Show",
        "deal_type": "fixed_fee",
        "fee_amount": "5000000",
        "currency": "inr",
        "term_start": str(TODAY - timedelta(days=30)),
        "term_end": str(TODAY + timedelta(days=5 * 365)),
        "episode_scope": "ranges",
        "episode_ranges": [{"from_episode": 101, "to_episode": 180}],
        "is_worldwide": True,
        "yt_slot_limit": 10,
        "fb_slot_limit": 10,
    }
    body.update(overrides)
    return body


@pytest.fixture
def founder(make_founder, login):
    make_founder("a@taggify.in", name="Asha")
    return login("a@taggify.in")


# ---- Content owners ---------------------------------------------------------------------


def test_owner_name_is_unique_per_company_case_insensitive(founder):
    owner(founder, "Sony")
    dup = founder.post("/api/content-owners", json={"name": "sony", "owner_type": "vendor"})
    assert dup.status_code == 409


def test_owner_requires_name_and_type_and_valid_email(founder):
    assert (
        founder.post("/api/content-owners", json={"name": " ", "owner_type": "vendor"}).status_code
        == 422
    )
    assert founder.post("/api/content-owners", json={"name": "X"}).status_code == 422
    bad = {"name": "X", "owner_type": "vendor", "contact_email": "nope"}
    assert founder.post("/api/content-owners", json=bad).status_code == 422
    ok = {"name": "X", "owner_type": "vendor", "contact_email": "", "contact_name": "  "}
    created = founder.post("/api/content-owners", json=ok).json()
    assert created["contact_email"] is None and created["contact_name"] is None


def test_owner_update_is_audited_with_changes(founder, db):
    oid = owner(founder, "Sony")
    r = founder.put(
        f"/api/content-owners/{oid}",
        json={
            "name": "Sony Pictures",
            "owner_type": "licensor",
            "contact_email": "rights@sony.com",
        },
    )
    assert r.json()["name"] == "Sony Pictures"
    log = db.scalar(select(AuditLog).where(AuditLog.action == "owner.updated"))
    assert log.details["changes"]["name"] == ["Sony", "Sony Pictures"]
    assert log.details["changes"]["contact_email"] == [None, "rights@sony.com"]


# ---- Deal validation --------------------------------------------------------------------


def test_create_fixed_fee_deal_generates_slots(founder):
    r = founder.post("/api/deals", json=deal_body(owner(founder), yt_slot_limit=3, fb_slot_limit=2))
    assert r.status_code == 201, r.text
    d = r.json()
    assert d["status"] == "active"
    assert d["currency"] == "INR" and d["fee_amount"] == "5000000.00"
    assert [s["code"] for s in d["slots"]] == ["YT-01", "YT-02", "YT-03", "FB-01", "FB-02"]
    assert all(s["status"] == "unassigned" for s in d["slots"])


@pytest.mark.parametrize(
    "overrides, message",
    [
        ({"term_end": str(TODAY - timedelta(days=40))}, "Term end must be after term start"),
        ({"fee_amount": None}, "licence fee and currency"),
        ({"currency": None}, "licence fee and currency"),
        ({"deal_type": "revenue_share", "revenue_share_pct": None}, "share percentage"),
        ({"episode_ranges": []}, "at least one episode range"),
        (
            {"episode_scope": "seasons", "episode_ranges": [{"from_episode": 1, "to_episode": 5}]},
            "needs a season",
        ),
        ({"episode_ranges": [{"from_episode": 9, "to_episode": 3}]}, "lower to a higher"),
        ({"is_worldwide": False, "territories": []}, "at least one territory"),
        ({"is_worldwide": False, "territories": ["IND"]}, "2-letter"),
        ({"yt_slot_limit": 0, "fb_slot_limit": 0}, "at least one YouTube or Facebook slot"),
        ({"contract_url": "drive.google.com/x"}, "https://"),
        ({"title": "   "}, "Title is required"),
    ],
)
def test_mandatory_fields_and_rules(founder, overrides, message):
    r = founder.post("/api/deals", json=deal_body(owner(founder), **overrides))
    assert r.status_code == 422
    assert message in r.text


def test_deal_type_clears_fields_that_do_not_apply(founder):
    oid = owner(founder)
    rev = founder.post(
        "/api/deals",
        json=deal_body(oid, deal_type="revenue_share", revenue_share_pct="40", fee_amount="10"),
    ).json()
    own = founder.post(
        "/api/deals",
        json=deal_body(oid, title="Owned Shorts", deal_type="owned", revenue_share_pct="40"),
    ).json()
    assert (rev["fee_amount"], rev["currency"], rev["revenue_share_pct"]) == (None, None, "40.00")
    assert (own["fee_amount"], own["revenue_share_pct"]) == (None, None)


def test_all_episodes_and_worldwide_ignore_extra_input(founder):
    d = founder.post(
        "/api/deals",
        json=deal_body(
            owner(founder),
            episode_scope="all",
            episode_ranges=[{"from_episode": 1, "to_episode": 2}],
            is_worldwide=True,
            territories=["IN"],
        ),
    ).json()
    assert d["episode_ranges"] == [] and d["territories"] == []


def test_inactive_owner_cannot_get_new_deals(founder):
    oid = owner(founder)
    founder.put(
        f"/api/content-owners/{oid}",
        json={"name": "Sony", "owner_type": "licensor", "is_active": False},
    )
    r = founder.post("/api/deals", json=deal_body(oid))
    assert r.status_code == 422 and "inactive" in r.text


# ---- Slots ------------------------------------------------------------------------------


def test_raising_and_lowering_slot_limits(founder):
    oid = owner(founder)
    d = founder.post("/api/deals", json=deal_body(oid, yt_slot_limit=2, fb_slot_limit=1)).json()

    up = founder.put(
        f"/api/deals/{d['id']}", json=deal_body(oid, yt_slot_limit=4, fb_slot_limit=1)
    ).json()
    assert [s["code"] for s in up["slots"]] == ["YT-01", "YT-02", "YT-03", "YT-04", "FB-01"]

    yt4 = next(s for s in up["slots"] if s["code"] == "YT-04")
    founder.patch(f"/api/deals/{d['id']}/slots/{yt4['id']}", json={"status": "reserved"})
    blocked = founder.put(
        f"/api/deals/{d['id']}", json=deal_body(oid, yt_slot_limit=2, fb_slot_limit=1)
    )
    assert blocked.status_code == 409 and "YT-04" in blocked.text

    founder.patch(f"/api/deals/{d['id']}/slots/{yt4['id']}", json={"status": "unassigned"})
    down = founder.put(
        f"/api/deals/{d['id']}", json=deal_body(oid, yt_slot_limit=2, fb_slot_limit=1)
    ).json()
    assert [s["code"] for s in down["slots"]] == ["YT-01", "YT-02", "FB-01"]


def test_slot_status_update_is_audited(founder, db):
    d = founder.post(
        "/api/deals", json=deal_body(owner(founder), yt_slot_limit=1, fb_slot_limit=0)
    ).json()
    slot = d["slots"][0]
    r = founder.patch(
        f"/api/deals/{d['id']}/slots/{slot['id']}",
        json={"status": "reserved", "notes": "Held for Kapil Comedy 02"},
    )
    assert r.json()["status"] == "reserved"
    log = db.scalar(select(AuditLog).where(AuditLog.action == "slot.updated"))
    assert log.details["slot"] == "YT-01"
    assert log.details["changes"]["status"] == ["unassigned", "reserved"]


# ---- Edits and audit --------------------------------------------------------------------


def test_edit_records_only_real_changes(founder, db):
    oid = owner(founder)
    d = founder.post("/api/deals", json=deal_body(oid)).json()

    founder.put(f"/api/deals/{d['id']}", json=deal_body(oid))  # nothing changed
    founder.put(
        f"/api/deals/{d['id']}",
        json=deal_body(
            oid, fee_amount="5500000", episode_ranges=[{"from_episode": 101, "to_episode": 200}]
        ),
    )

    logs = db.scalars(select(AuditLog).where(AuditLog.action == "deal.updated")).all()
    assert len(logs) == 1
    changes = logs[0].details["changes"]
    assert changes["fee_amount"] == ["5000000.00", "5500000.00"]
    assert changes["episode_ranges"][1] == [
        {"season": None, "from_episode": 101, "to_episode": 200}
    ]
    assert set(changes) == {"fee_amount", "episode_ranges"}


# ---- Listing ----------------------------------------------------------------------------


def test_list_filters_status_and_sorting(founder):
    sony, vendor = owner(founder, "Sony"), owner(founder, "Studio B", "vendor")
    days = lambda n: str(TODAY + timedelta(days=n))  # noqa: E731
    founder.post("/api/deals", json=deal_body(sony, title="Live", term_end=days(400)))
    founder.post("/api/deals", json=deal_body(sony, title="Ending", term_end=days(30)))
    founder.post(
        "/api/deals",
        json=deal_body(vendor, title="Past", term_start=days(-400), term_end=days(-10)),
    )
    founder.post(
        "/api/deals",
        json=deal_body(vendor, title="Future", term_start=days(10), term_end=days(100)),
    )
    founder.post("/api/deals", json=deal_body(vendor, title="Draft one", status="draft"))

    def titles(query: str) -> list[str]:
        return [d["title"] for d in founder.get(f"/api/deals?{query}").json()["items"]]

    assert titles("status=active&sort=title") == ["Ending", "Live"]
    assert titles("status=expiring") == ["Ending"]
    assert titles("status=expired") == ["Past"]
    assert titles("status=upcoming") == ["Future"]
    assert titles("status=draft") == ["Draft one"]
    assert titles(f"owner_id={vendor}&sort=title&direction=desc") == ["Past", "Future", "Draft one"]
    assert titles("q=studio&sort=title") == ["Draft one", "Future", "Past"]
    page = founder.get("/api/deals?page=2&page_size=2&sort=title").json()
    assert page["total"] == 5 and [d["title"] for d in page["items"]] == ["Future", "Live"]


def test_summary_counts_live_deals_only(founder):
    oid = owner(founder)
    d = founder.post(
        "/api/deals",
        json=deal_body(
            oid, yt_slot_limit=2, fb_slot_limit=0, term_end=str(TODAY + timedelta(days=20))
        ),
    ).json()
    founder.post(
        "/api/deals", json=deal_body(oid, title="USD deal", currency="USD", fee_amount="1000")
    )
    founder.post("/api/deals", json=deal_body(oid, title="Draft", status="draft"))
    founder.patch(f"/api/deals/{d['id']}/slots/{d['slots'][0]['id']}", json={"status": "reserved"})

    s = founder.get("/api/deals/summary").json()

    assert s["active_deals"] == 2 and s["expiring_soon"] == 1
    assert (s["slots_used"], s["slots_total"]) == (1, 2 + 20)
    assert s["licence_value"] == [
        {"currency": "INR", "amount": "5000000.00"},
        {"currency": "USD", "amount": "1000.00"},
    ]


def test_deals_are_isolated_between_companies(make_founder, login):
    make_founder("a@taggify.in", org_slug="taggify")
    make_founder("b@sociodoor.in", org_slug="sociodoor")
    taggify, sociodoor = login("a@taggify.in"), login("b@sociodoor.in")
    tag_owner = owner(taggify)
    d = taggify.post("/api/deals", json=deal_body(tag_owner)).json()

    assert sociodoor.get("/api/deals").json()["total"] == 0
    assert sociodoor.get(f"/api/deals/{d['id']}").status_code == 404
    assert sociodoor.put(f"/api/deals/{d['id']}", json=deal_body(tag_owner)).status_code == 404
    assert sociodoor.get("/api/content-owners").json() == []
    # Using another company's owner id for a new deal is rejected.
    assert sociodoor.post("/api/deals", json=deal_body(tag_owner)).status_code == 422


# ---- Rights check -----------------------------------------------------------------------


def rights(c, deal_id, **body):
    return c.post(f"/api/deals/{deal_id}/check-rights", json=body).json()


def test_rights_check_allows_licensed_use(founder):
    d = founder.post("/api/deals", json=deal_body(owner(founder))).json()
    assert rights(founder, d["id"], platform="youtube", episode=150) == {
        "allowed": True,
        "reasons": [],
        "checked_on": str(TODAY),
    }


def test_rights_check_lists_every_failing_rule(founder):
    d = founder.post(
        "/api/deals",
        json=deal_body(
            owner(founder), fb_slot_limit=0, is_worldwide=False, territories=["IN", "NP"]
        ),
    ).json()
    later = str(TODAY + timedelta(days=6 * 365))

    r = rights(founder, d["id"], platform="facebook", episode=181, territory="us", on_date=later)

    assert r["allowed"] is False
    assert len(r["reasons"]) == 4
    joined = " ".join(r["reasons"])
    for fragment in ("licence ended", "no Facebook slots", "Episode 181", "US is not"):
        assert fragment in joined


def test_rights_check_by_season(founder):
    d = founder.post(
        "/api/deals",
        json=deal_body(
            owner(founder),
            episode_scope="seasons",
            episode_ranges=[{"season": 2, "from_episode": 1, "to_episode": 20}],
        ),
    ).json()
    assert rights(founder, d["id"], platform="youtube", season=2, episode=15)["allowed"] is True
    assert rights(founder, d["id"], platform="youtube", season=3, episode=15)["allowed"] is False
    assert (
        "Enter a season" in rights(founder, d["id"], platform="youtube", episode=15)["reasons"][0]
    )


def test_rights_check_draft_and_terminated(founder):
    oid = owner(founder)
    d = founder.post("/api/deals", json=deal_body(oid, status="draft")).json()
    assert "draft" in rights(founder, d["id"], platform="youtube", episode=150)["reasons"][0]
    founder.put(f"/api/deals/{d['id']}", json=deal_body(oid, status="terminated"))
    assert "terminated" in rights(founder, d["id"], platform="youtube", episode=150)["reasons"][0]


def test_deal_activity_filter_by_entity(founder):
    d = founder.post("/api/deals", json=deal_body(owner(founder))).json()
    items = founder.get(f"/api/audit-logs?entity_type=deal&entity_id={d['id']}").json()["items"]
    assert [i["action"] for i in items] == ["deal.created"]
