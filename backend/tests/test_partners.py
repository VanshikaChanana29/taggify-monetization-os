"""Deal partners (founders' rules, 26 Oct 2026): Vanshika holds 50% of the Sony deal, pays
Taggify half the licence fee, runs her own channels and is paid their earnings after the
CMS fee — once the CMS has paid Taggify — less TDS."""

from datetime import timedelta
from decimal import Decimal

import pytest

from tests.test_channels_people import channel, cms, employee, new_deal, post, slot_id
from tests.test_finance import LAST, MONTH, TODAY, upload

FX = "80"


@pytest.fixture
def founder(make_founder, login):
    make_founder("a@taggify.in", name="Asha")
    return login("a@taggify.in")


@pytest.fixture
def setup(founder):
    giri = cms(founder, "Giri CMS")  # fee after tax by default
    founder.post(
        f"/api/cms-partners/{giri}/fee-schedules",
        json={
            "effective_from": str(LAST),
            "tier_type": "whole",
            "currency": "USD",
            "tiers": [{"from_amount": "0", "rate_pct": "10"}],
        },
    )
    founder.put("/api/fx-rates", json={"month": MONTH, "currency": "USD", "rate": FX})
    deal = new_deal(founder, term_start=str(LAST), fee_amount="5000000")
    vanshika = founder.post(
        "/api/partners", json={"name": "Vanshika", "tds_pct": "10", "email": "v@example.com"}
    ).json()["id"]
    r = founder.put(
        f"/api/deals/{deal['id']}/partners",
        json={"partners": [{"partner_id": vanshika, "share_pct": "50"}]},
    )
    assert r.status_code == 200, r.text
    hers = channel(founder, "Vanshika Comedy", external_id="UCV1", cms_id=giri, partner_id=vanshika)
    ours = channel(founder, "Taggify Comedy", external_id="UCT1", cms_id=giri)
    for ch, code in ((hers, "YT-01"), (ours, "YT-02")):
        r = post(
            founder,
            f"/api/deals/{deal['id']}/slots/{slot_id(deal, code)}/assign",
            channel_id=ch,
            status="active",
            effective_date=str(LAST),
        )
        assert r.status_code in (200, 201), r.text
    # $1,000 each; the CMS takes 10% of the $2,000 total, shared by gross.
    r = upload(
        founder,
        "date,channel_id,gross_revenue,currency\n" f"{LAST},UCV1,1000,USD\n{LAST},UCT1,1000,USD",
    )
    assert r.status_code == 201, r.text
    return {"cms": giri, "deal": deal, "vanshika": vanshika, "hers": hers, "ours": ours}


def detail(c, pid):
    return c.get(f"/api/partners/{pid}").json()


def test_partner_gets_her_channels_after_cms_fee_once_the_cms_pays_less_tds(founder, setup):
    d = detail(founder, setup["vanshika"])
    m = d["months"][0]
    # $1,000 − 10% CMS fee = $900 → ₹72,000; TDS 10% = ₹7,200; ₹64,800 to pay.
    assert (m["share"], m["share_base"], m["tds"], m["to_pay"]) == (
        "900.00",
        "72000.00",
        "7200.00",
        "64800.00",
    )
    assert m["status"] == "waiting_cms" and d["partner"]["waiting"] == "64800.00"
    assert d["partner"]["outstanding"] == "0.00"

    # The CMS pays Taggify for both channels: $1,800 → now due.
    founder.post(
        "/api/finance/receipts",
        json={
            "cms_partner_id": setup["cms"],
            "month": MONTH,
            "received_on": str(TODAY),
            "amount": "144000",
        },
    )
    d = detail(founder, setup["vanshika"])
    assert d["months"][0]["status"] == "due" and d["partner"]["outstanding"] == "64800.00"

    r = founder.post(
        f"/api/partners/{setup['vanshika']}/payouts",
        json={
            "month": MONTH,
            "amount": "64800",
            "tds_amount": "7200",
            "paid_on": str(TODAY),
            "reference": "UTR9",
        },
    )
    assert r.status_code == 201, r.text
    d = detail(founder, setup["vanshika"])
    assert d["months"][0]["status"] == "paid" and d["partner"]["outstanding"] == "0.00"
    assert d["channels"][0]["name"] == "Vanshika Comedy"


def test_licence_share_and_what_she_paid_in(founder, setup):
    pid = setup["vanshika"]
    r = founder.post(
        f"/api/partners/{pid}/contributions",
        json={"deal_id": setup["deal"]["id"], "amount": "2000000", "received_on": str(TODAY)},
    )
    assert r.status_code == 201, r.text
    deal = detail(founder, pid)["deals"][0]
    assert (
        deal["share_pct"],
        deal["licence_share"],
        deal["contributed"],
        deal["contribution_due"],
    ) == (
        "50.00",
        "2500000.00",
        "2000000.00",
        "500000.00",
    )


def test_taggify_recovery_and_incentives_leave_the_partner_out(founder, setup):
    # Taggify's rights cost is its own 50% of ₹50L, and only its own channel earns for it.
    e = founder.get(f"/api/deals/{setup['deal']['id']}/economics").json()
    assert Decimal(e["rights_cost"]) == Decimal("2500000")
    assert Decimal(e["gross"]) == Decimal("80000")  # $1,000 of Taggify's channel at ₹80

    # A manager on her channel earns nothing: she runs it herself.
    ananya = employee(founder, "Ananya")
    post(
        founder,
        f"/api/channels/{setup['hers']}/manager",
        employee_id=ananya,
        effective_date=str(LAST),
    )
    founder.post(
        f"/api/employees/{ananya}/incentive-rates",
        json={"kind": "manager", "rate_pct": "1", "effective_from": str(LAST)},
    )
    run = founder.post("/api/finance/incentives/compute", json={"month": MONTH}).json()
    assert Decimal(run["total_base"]) == 0


def test_partner_rules(founder, setup):
    deal = setup["deal"]["id"]
    other = founder.post("/api/partners", json={"name": "Rohan"}).json()["id"]
    too_much = founder.put(
        f"/api/deals/{deal}/partners",
        json={
            "partners": [
                {"partner_id": setup["vanshika"], "share_pct": "60"},
                {"partner_id": other, "share_pct": "40"},
            ]
        },
    )
    assert too_much.status_code == 422
    ok = founder.put(
        f"/api/deals/{deal}/partners",
        json={
            "partners": [
                {"partner_id": setup["vanshika"], "share_pct": "40"},
                {"partner_id": other, "share_pct": "20"},
            ]
        },
    )
    assert ok.status_code == 200 and {p["name"] for p in ok.json()} == {"Vanshika", "Rohan"}
    assert founder.post("/api/partners", json={"name": "vanshika"}).status_code == 409
    # Channels list can be filtered to a partner's channels.
    rows = founder.get(f"/api/channels?partner_id={setup['vanshika']}").json()["items"]
    assert [r["name"] for r in rows] == ["Vanshika Comedy"] and rows[0]["partner"][
        "name"
    ] == "Vanshika"
    # Paying in for a deal they are not on is refused.
    lone = new_deal(founder, owner_name="Zee", title="Other deal")
    r = founder.post(
        f"/api/partners/{other}/contributions",
        json={"deal_id": lone["id"], "amount": "1", "received_on": str(TODAY - timedelta(days=1))},
    )
    assert r.status_code == 422


def test_partners_are_per_company(make_founder, login, founder, setup):
    make_founder("s@sociodoor.in", org_slug="sociodoor")
    s = login("s@sociodoor.in")
    assert s.get("/api/partners").json() == []
    assert s.get(f"/api/partners/{setup['vanshika']}").status_code == 404


def test_import_marks_partner_channels(founder, setup):
    r = founder.post(
        "/api/channels/import",
        files={
            "file": (
                "c.csv",
                b"Channel ID,Channel name,Partner\nUCV2,Vanshika Two,vanshika\nUCX9,Ours,Nobody\n",
                "text/csv",
            )
        },
    )
    lines = {x["external_id"]: x for x in r.json()["lines"]}
    assert lines["UCV2"]["partner"] == "Vanshika"
    assert lines["UCX9"]["partner"] is None and "not in the tool" in lines["UCX9"]["notes"][0]
