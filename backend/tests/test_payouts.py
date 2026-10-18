from datetime import timedelta

import pytest

from tests.test_channels_people import channel, cms, employee, post, slot_id, team
from tests.test_deals import deal_body, owner
from tests.test_finance import LAST, MONTH, TIERS, TODAY, day, upload

FX = "80"


@pytest.fixture
def founder(make_founder, login):
    make_founder("a@taggify.in", name="Asha")
    return login("a@taggify.in")


@pytest.fixture
def setup(founder):
    """Slide 13: Kapil YT-01 managed by Ananya (1 %), whose team lead is Kabir (0.5 %)."""
    cms_a = cms(founder, "CMS A")
    founder.post(
        f"/api/cms-partners/{cms_a}/fee-schedules",
        json={"effective_from": str(LAST), "tier_type": "whole", "currency": "USD", "tiers": TIERS},
    )
    founder.put("/api/fx-rates", json={"month": MONTH, "currency": "USD", "rate": FX})
    ch = channel(founder, "Kapil Comedy 01", external_id="UCK1", cms_id=cms_a)
    kabir = employee(founder, "Kabir", "team_lead")
    kapil = team(founder, "Kapil Team")
    post(founder, f"/api/teams/{kapil}/lead", employee_id=kabir, effective_date=str(LAST))
    ananya = employee(founder, "Ananya", team_id=kapil, team_effective_date=str(LAST))
    post(founder, f"/api/channels/{ch}/manager", employee_id=ananya, effective_date=str(LAST))
    rate(founder, ananya, "manager", "1")
    rate(founder, kabir, "team_lead", "0.5")
    return {"cms": cms_a, "channel": ch, "ananya": ananya, "kabir": kabir, "team": kapil}


def rate(c, employee_id, kind, pct, start=None):
    r = c.post(
        f"/api/employees/{employee_id}/incentive-rates",
        json={"kind": kind, "rate_pct": pct, "effective_from": str(start or LAST)},
    )
    assert r.status_code == 201, r.text


def revenue(c, rows):
    body = "date,channel_id,gross_revenue,currency\n" + "\n".join(
        f"{d},UCK1,{amt},USD" for d, amt in rows
    )
    r = upload(c, body)
    assert r.status_code == 201, r.text
    return r.json()


def people(run):
    return {p["employee"]["name"]: p for p in run["people"]}


# ---- Incentives (slides 12–13) -------------------------------------------------------------------


def test_slide13_manager_and_team_lead_on_gross(founder, setup):
    revenue(founder, [(day(1), 1000)])
    run = founder.get(f"/api/finance/incentives?month={MONTH}").json()
    assert run["status"] == "preview"
    p = people(run)
    assert (p["Ananya"]["manager_base"], p["Kabir"]["team_lead_base"]) == (
        "800.00",
        "400.00",
    )  # $10, $5 at 80
    line = next(x for x in run["lines"] if x["employee"]["name"] == "Ananya")
    assert (line["gross"], line["amount"], line["rates"], line["days"]) == (
        "1000.00",
        "10.00",
        "1%",
        1,
    )
    assert run["total_base"] == "1200.00"


def test_handover_mid_month_splits_by_day(founder, setup):
    arjun = employee(founder, "Arjun")
    revenue(founder, [(day(1), 1000), (day(5), 1000)])
    post(
        founder,
        f"/api/channels/{setup['channel']}/manager",
        employee_id=arjun,
        effective_date=day(3),
    )
    run = founder.get(f"/api/finance/incentives?month={MONTH}").json()
    p = people(run)
    assert p["Ananya"]["manager_base"] == "800.00"  # only day 1
    assert p["Arjun"]["manager_base"] == "0.00"  # has no rate yet
    assert any("Arjun has no manager incentive rate" in w for w in run["warnings"])
    # Kabir only leads Ananya's team, so day 5 (Arjun, no team) earns him nothing.
    assert p["Kabir"]["team_lead_base"] == "400.00"


def test_rate_change_mid_month(founder, setup):
    rate(founder, setup["ananya"], "manager", "2", start=day(3))
    revenue(founder, [(day(1), 1000), (day(5), 1000)])
    line = next(
        x
        for x in founder.get(f"/api/finance/incentives?month={MONTH}").json()["lines"]
        if x["employee"]["name"] == "Ananya"
    )
    assert (line["amount"], line["rates"]) == ("30.00", "1% → 2%")


def test_team_lead_rate_needs_a_role_that_can_lead(founder, setup):
    r = founder.post(
        f"/api/employees/{setup['ananya']}/incentive-rates",
        json={"kind": "team_lead", "rate_pct": "1", "effective_from": str(LAST)},
    )
    assert r.status_code == 409


def test_run_lifecycle(founder, setup):
    revenue(founder, [(day(1), 1000)])
    url = "/api/finance/incentives"
    assert post(founder, f"{url}/approve", month=MONTH).status_code == 409  # nothing to approve
    draft = post(founder, f"{url}/compute", month=MONTH).json()
    assert (draft["status"], draft["total_base"]) == ("draft", "1200.00")
    revenue(founder, [(day(2), 1000)])
    assert post(founder, f"{url}/compute", month=MONTH).json()["total_base"] == "2400.00"
    approved = post(founder, f"{url}/approve", month=MONTH).json()
    assert approved["status"] == "approved" and approved["approved_by"] == "Asha"
    assert post(founder, f"{url}/compute", month=MONTH).status_code == 409
    assert post(founder, f"{url}/reopen", month=MONTH).json()["status"] == "draft"


# ---- Month close (slide 16 step 8) -----------------------------------------------------------


def test_close_needs_pricing_and_approved_incentives_then_locks(founder, setup):
    revenue(founder, [(day(1), 1000)])
    status = founder.get(f"/api/finance/close?month={MONTH}").json()
    assert status["can_close"] is False
    cash = next(c for c in status["checks"] if c["key"] == "cash")  # slide 16 step 6
    assert (cash["ok"], cash["blocking"], cash["message"]) == (
        False,
        False,
        "No bank receipt yet for: CMS A",
    )
    assert post(founder, "/api/finance/close", month=MONTH).status_code == 409

    post(founder, "/api/finance/incentives/compute", month=MONTH)
    post(founder, "/api/finance/incentives/approve", month=MONTH)
    closed = post(founder, "/api/finance/close", month=MONTH, notes="Sept reconciled").json()
    assert closed["closed"] is True
    assert founder.get(f"/api/finance/incentives?month={MONTH}").json()["status"] == "locked"
    snap = founder.get("/api/finance/closes").json()[0]
    assert (snap["month"], snap["incentives"]) == (MONTH, "1200.00")

    # Locked: revenue, FX, fee tiers, rates, back-dated handovers.
    blocked = revenue(founder, [(day(2), 50)])
    assert blocked["rows_failed"] == 1 and "closed" in blocked["errors"][0]["message"]
    assert (
        founder.put(
            "/api/fx-rates", json={"month": MONTH, "currency": "USD", "rate": "90"}
        ).status_code
        == 409
    )
    sched = {
        "effective_from": str(LAST),
        "tier_type": "marginal",
        "currency": "USD",
        "tiers": TIERS,
    }
    assert (
        founder.post(f"/api/cms-partners/{setup['cms']}/fee-schedules", json=sched).status_code
        == 409
    )
    r = founder.post(
        f"/api/employees/{setup['ananya']}/incentive-rates",
        json={"kind": "manager", "rate_pct": "5", "effective_from": day(10)},
    )
    assert r.status_code == 409
    arjun = employee(founder, "Arjun")
    assert (
        post(
            founder,
            f"/api/channels/{setup['channel']}/manager",
            employee_id=arjun,
            effective_date=day(10),
        ).status_code
        == 409
    )
    # Cash still arrives after the month ends.
    receipt = {
        "cms_partner_id": setup["cms"],
        "month": MONTH,
        "received_on": str(TODAY),
        "amount": "1000",
    }
    assert founder.post("/api/finance/receipts", json=receipt).status_code == 201

    assert (
        post(founder, "/api/finance/reopen", month=MONTH, reason="CMS revised").json()["closed"]
        is False
    )
    assert revenue(founder, [(day(2), 50)])["rows_created"] == 1
    assert founder.get(f"/api/finance/incentives?month={MONTH}").json()["status"] == "approved"


def test_cannot_close_current_month(founder):
    assert post(founder, "/api/finance/close", month=f"{TODAY:%Y-%m}").status_code == 409


# ---- Deal economics (slide 11) ------------------------------------------------------------------


def make_deal(c, ch, **overrides):
    body = deal_body(
        owner(c),
        fee_amount=overrides.pop("fee_amount", "5000000"),
        currency="INR",
        yt_slot_limit=1,
        fb_slot_limit=0,
        term_start=str(LAST - timedelta(days=30)),
        **overrides,
    )
    d = c.post("/api/deals", json=body).json()
    r = post(
        c,
        f"/api/deals/{d['id']}/slots/{slot_id(d, 'YT-01')}/assign",
        channel_id=ch,
        status="active",
        effective_date=day(2),
    )
    assert r.status_code == 200, r.text
    return d


def test_deal_economics(founder, setup):
    d = make_deal(founder, setup["channel"])
    revenue(founder, [(day(1), 500), (day(2), 1000)])  # day 1 is before the channel held the slot
    founder.post(
        f"/api/deals/{d['id']}/expenses",
        json={"spent_on": day(3), "amount": "2800", "description": "Editing"},
    )

    e = founder.get(f"/api/deals/{d['id']}/economics").json()
    # $1,000 at 80 = ₹80,000; CMS A month gross $1,500 < $20k → 20 %; incentives 1.5 %.
    assert (e["rights_cost"], e["gross"], e["cms_fee"], e["incentives"], e["expenses"]) == (
        "5000000.00",
        "80000.00",
        "16000.00",
        "1200.00",
        "2800.00",
    )
    assert (e["net_contribution"], e["recovery_pct"], e["remaining"]) == (
        "60000.00",
        "1.2",
        "4940000.00",
    )
    assert e["by_month"] == [
        {"month": MONTH, "gross": "80000.00", "cms_fee": "16000.00", "incentives": "1200.00"}
    ]


def test_installments_reduce_payable_not_rights_cost(founder, setup):
    d = make_deal(founder, setup["channel"])
    first = founder.post(
        f"/api/deals/{d['id']}/installments", json={"due_date": str(LAST), "amount": "2000000"}
    ).json()
    founder.post(
        f"/api/deals/{d['id']}/installments",
        json={"due_date": str(TODAY + timedelta(days=60)), "amount": "3000000"},
    )
    founder.patch(
        f"/api/installments/{first['id']}", json={"paid_on": str(TODAY), "reference": "NEFT-1"}
    )

    e = founder.get(f"/api/deals/{d['id']}/economics").json()
    assert (e["installments_total"], e["paid"], e["payable"]) == (
        "5000000.00",
        "2000000.00",
        "3000000.00",
    )
    assert (e["next_due_amount"], e["rights_cost"]) == ("3000000.00", "5000000.00")
    assert e["warnings"] == []
    assert founder.delete(f"/api/installments/{first['id']}").status_code == 409


def test_revenue_share_owner_cut(founder, setup):
    d = make_deal(founder, setup["channel"], deal_type="revenue_share", revenue_share_pct="40")
    revenue(founder, [(day(2), 1000)])
    e = founder.get(f"/api/deals/{d['id']}/economics").json()
    assert (e["rights_cost"], e["owner_share"]) == (None, "32000.00")
    assert e["net_contribution"] == "30800.00"  # 80000 − 16000 − 1200 − 32000
    r = founder.post(
        f"/api/deals/{d['id']}/installments", json={"due_date": str(LAST), "amount": "1"}
    )
    assert r.status_code == 409


def test_payouts_isolated(make_founder, login, setup, founder):
    make_founder("b@sociodoor.in", org_slug="sociodoor")
    s = login("b@sociodoor.in")
    revenue(founder, [(day(1), 1000)])
    assert s.get(f"/api/finance/incentives?month={MONTH}").json()["lines"] == []
    assert s.get(f"/api/employees/{setup['ananya']}/incentive-rates").status_code == 404
    d = make_deal(founder, setup["channel"])
    assert s.get(f"/api/deals/{d['id']}/economics").status_code == 404


def test_roster_shows_channels_and_current_rates(founder, setup):  # noqa: F811
    """Slide 12: the people list shows assigned assets and the gross incentive %."""
    rate(founder, setup["ananya"], "manager", "2", start=TODAY + timedelta(days=30))  # future
    people = {p["full_name"]: p for p in founder.get("/api/employees").json()}
    a, k = people["Ananya"], people["Kabir"]
    assert (a["channel_names"], a["manager_rate"], a["team_lead_rate"]) == (
        ["Kapil Comedy 01"],
        "1.000",
        None,
    )
    assert (k["manager_rate"], k["team_lead_rate"]) == (None, "0.500")
