"""Deal partners (founders' rules, 26 Oct and 11 Nov 2026): Vanshika holds 50% of the Sony
deal, pays Taggify half the licence fee, runs her own channels and is paid their earnings
after the CMS fee and Taggify's own commission (none unless set) — once the CMS has paid
Taggify. No TDS."""

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


def test_partner_gets_her_channels_after_cms_fee_once_the_cms_pays(founder, setup):
    d = detail(founder, setup["vanshika"])
    m = d["months"][0]
    # $1,000 − 10% CMS fee = $900 → ₹72,000, all of it to pay: no commission set, no TDS.
    assert (m["share"], m["share_base"], m["commission"], m["tds"], m["to_pay"]) == (
        "900.00",
        "72000.00",
        "0.00",
        "0.00",
        "72000.00",
    )
    assert d["partner"]["commission_pct"] is None and d["partner"]["commission"] == "0.00"
    assert m["status"] == "waiting_cms" and d["partner"]["waiting"] == "72000.00"
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
    assert d["months"][0]["status"] == "due" and d["partner"]["outstanding"] == "72000.00"

    r = founder.post(
        f"/api/partners/{setup['vanshika']}/payouts",
        json={"month": MONTH, "amount": "72000", "paid_on": str(TODAY), "reference": "UTR9"},
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
                (
                    b"Channel ID,Channel name,Platform,CMS,Status,Link,Partner\n"
                    b"UCV2,Vanshika Two,YouTube,Giri CMS,Active,https://youtube.com/c/v2,vanshika\n"
                    b"UCX9,Ours,YouTube,Giri CMS,Active,https://youtube.com/c/x9,Nobody\n"
                ),
                "text/csv",
            )
        },
    )
    lines = {x["external_id"]: x for x in r.json()["lines"]}
    assert lines["UCV2"]["partner"] == "Vanshika"
    assert lines["UCX9"]["partner"] is None and "not in the tool" in lines["UCX9"]["notes"][0]


def test_unused_partner_can_be_deleted(founder):
    pid = founder.post("/api/partners", json={"name": "Added by mistake"}).json()["id"]

    assert founder.delete(f"/api/partners/{pid}").status_code == 204

    assert founder.get("/api/partners").json() == []


def test_partner_on_a_deal_or_with_channels_is_not_deleted(founder, setup):
    r = founder.delete(f"/api/partners/{setup['vanshika']}")

    assert r.status_code == 409
    detail_text = r.json()["detail"]
    assert "take them off 1 deal" in detail_text and "1 channel" in detail_text
    assert len(founder.get("/api/partners").json()) == 1


def test_partner_with_money_is_never_deleted(founder, setup):
    pid = setup["vanshika"]
    founder.post(
        f"/api/partners/{pid}/contributions",
        json={"deal_id": setup["deal"]["id"], "amount": "1000", "received_on": str(TODAY)},
    )
    founder.put(f"/api/deals/{setup['deal']['id']}/partners", json={"partners": []})
    founder.put(f"/api/channels/{setup['hers']}", json={"partner_id": None})

    r = founder.delete(f"/api/partners/{pid}")

    assert r.status_code == 409
    assert "mark them inactive" in r.json()["detail"]


def set_pct(c, pid, pct, month=MONTH, channel_id=None):
    r = c.put(
        f"/api/partners/{pid}/commission",
        json={"pct": pct, "month": month, "channel_id": channel_id},
    )
    assert r.status_code == 200, r.text
    return r.json()


def test_taggify_commission_on_top_of_the_cms_fee(founder, setup):
    pid = setup["vanshika"]
    # 5% for all her channels from last month: CMS 10% + Taggify 5% = 15% off the $1,000.
    set_pct(founder, pid, "5")
    d = detail(founder, pid)
    m = d["months"][0]
    assert (m["cms_fee"], m["commission"], m["share"], m["share_base"]) == (
        "100.00",
        "50.00",
        "850.00",
        "68000.00",
    )
    assert m["commission_base"] == "4000.00" and d["partner"]["commission"] == "4000.00"
    (line,) = d["channel_months"]
    assert (line["commission_pct"], line["commission"], line["share"]) == (
        "5.00",
        "50.00",
        "850.00",
    )

    # Her channel gets its own 3%: it wins over her 5%.
    set_pct(founder, pid, "3", channel_id=setup["hers"])
    d = detail(founder, pid)
    assert d["months"][0]["commission"] == "30.00"
    assert d["channels"][0]["commission_pct"] == "3.00"
    assert {(c["channel_name"], c["pct"]) for c in d["commissions"]} == {
        (None, "5.00"),
        ("Vanshika Comedy", "3.00"),
    }
    # Clearing the channel's rate goes back to her 5%.
    set_pct(founder, pid, None, channel_id=setup["hers"])
    assert detail(founder, pid)["months"][0]["commission"] == "50.00"


def test_commission_from_a_later_month_leaves_earlier_months_as_they_were(founder, setup):
    set_pct(founder, setup["vanshika"], "5", month=f"{TODAY:%Y-%m}")
    assert detail(founder, setup["vanshika"])["months"][0]["commission"] == "0.00"
    # Only her channels; a Taggify channel cannot be given her rate.
    r = founder.put(
        f"/api/partners/{setup['vanshika']}/commission",
        json={"pct": "5", "month": MONTH, "channel_id": setup["ours"]},
    )
    assert r.status_code == 422


def test_dashboard_leaderboard_and_deal_earnings(founder, setup):
    set_pct(founder, setup["vanshika"], "5")
    board = founder.get(f"/api/partners/leaderboard?from={MONTH}&to={MONTH}").json()
    (row,) = board["partners"]
    assert (row["name"], row["gross"], row["commission"], row["share"]) == (
        "Vanshika",
        "80000.00",
        "4000.00",
        "68000.00",
    )
    assert board["top_channels"][0]["name"] == "Vanshika Comedy"
    assert (
        founder.get("/api/partners/leaderboard?from=2001-01&to=2001-02").json()["commission"]
        == "0.00"
    )

    e = founder.get(f"/api/deals/{setup['deal']['id']}/earnings").json()
    rows = {r["name"]: r for r in e["channels"]}
    # Taggify's own channel: all $900 after the CMS fee; hers: Taggify's 5% only.
    assert rows["Taggify Comedy"]["taggify"] == "72000.00"
    assert (rows["Vanshika Comedy"]["taggify"], rows["Vanshika Comedy"]["partner"]) == (
        "4000.00",
        "68000.00",
    )
    assert (e["own"], e["commission"], e["licence_cost"]) == ("72000.00", "4000.00", "2500000.00")


def test_import_from_a_partners_page_makes_every_line_theirs(founder, setup):
    text = (
        b"Channel ID,Channel name,Platform,CMS,Status,Link,Partner\n"
        b"UCV7,Hers Too,YouTube,Giri CMS,Active,https://youtube.com/c/v7,\n"
        b"UCV8,Also Hers,YouTube,Giri CMS,Active,https://youtube.com/c/v8,Someone Else\n"
    )
    r = founder.post(
        "/api/channels/import",
        data={"partner_id": setup["vanshika"]},
        files={"file": ("c.csv", text, "text/csv")},
    )
    assert r.status_code == 201, r.text
    assert {x["partner"] for x in r.json()["lines"]} == {"Vanshika"}
    names = {c["name"] for c in detail(founder, setup["vanshika"])["channels"]}
    assert {"Hers Too", "Also Hers"} <= names


def test_deal_profit_counts_our_commission_on_her_channels(founder, setup):
    url = f"/api/deals/{setup['deal']['id']}/economics"
    before = founder.get(url).json()
    # Taggify's own channel: $1,000 − 10% CMS fee = $900 at ₹80; her channel adds nothing yet.
    assert (before["net_contribution"], before["partner_commission"]) == ("72000.00", "0.00")
    set_pct(founder, setup["vanshika"], "5")
    e = founder.get(url).json()
    # + our 5% of her $1,000 = $50 → ₹4,000. Licence: our 50% of ₹50L = ₹25L.
    assert (e["partner_commission"], e["net_contribution"], e["profit"]) == (
        "4000.00",
        "76000.00",
        "-2424000.00",
    )
    (m,) = e["by_month"]
    assert (m["commission"], m["net"]) == ("4000.00", "76000.00")
