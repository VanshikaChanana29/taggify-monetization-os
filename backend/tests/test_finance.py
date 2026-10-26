from datetime import date, timedelta
from decimal import Decimal

import pytest

from tests.test_channels_people import channel, cms

TODAY = date.today()
LAST = (TODAY.replace(day=1) - timedelta(days=1)).replace(day=1)  # first day of last month
MONTH = f"{LAST:%Y-%m}"
TIERS = [{"from_amount": "0", "rate_pct": "20"}, {"from_amount": "20000", "rate_pct": "15"}]


@pytest.fixture
def founder(make_founder, login):
    make_founder("a@taggify.in", name="Asha")
    return login("a@taggify.in")


def upload(c, text: str, name="rev.csv"):
    return c.post("/api/revenue/import", files={"file": (name, text.encode(), "text/csv")})


def day(n: int) -> str:
    return str(LAST + timedelta(days=n - 1))


def schedule(c, cms_id, tier_type="whole", effective=None, tiers=TIERS, currency="USD"):
    r = c.post(
        f"/api/cms-partners/{cms_id}/fee-schedules",
        json={
            "effective_from": effective or str(LAST),
            "tier_type": tier_type,
            "currency": currency,
            "tiers": tiers,
        },
    )
    assert r.status_code == 201, r.text
    return r.json()


def slide9(c):
    """CMS A with the four channels from PDF slide 9 (USD 25 000 in the month)."""
    cms_a = cms(c, "CMS A")
    for name, ext in [
        ("Kapil Comedy 01", "UCK1"),
        ("CID Stories 01", "UCC1"),
        ("Studio B Laughs", "UCS1"),
        ("Owned Shorts 01", "UCO1"),
    ]:
        channel(c, name, external_id=ext, cms_id=cms_a)
    rows = ["date,channel_id,gross_revenue,currency,views"]
    for ext, total in [("UCK1", 12000), ("UCC1", 6000), ("UCS1", 4000), ("UCO1", 3000)]:
        rows.append(f"{day(1)},{ext},{total / 2:.2f},USD,1000")
        rows.append(f"{day(2)},{ext},{total / 2:.2f},USD,1000")
    r = upload(c, "\n".join(rows))
    assert r.status_code == 201 and r.json()["rows_created"] == 8, r.text
    schedule(c, cms_a)
    return cms_a


# ---- Import ---------------------------------------------------------------------------------


def test_import_reports_each_bad_row_with_its_line(founder):
    channel(founder, "Kapil Comedy 01", external_id="UCK1")
    csv = "\n".join(
        [
            "Date,Channel_ID,Gross_Revenue,Currency,Views",
            f'{day(1)},UCK1,"$1,250.50",USD,1200000',
            f"{day(2)},UNKNOWN,10,USD,",
            "31-02-2026,UCK1,10,USD,",
            f"{TODAY + timedelta(days=2)},UCK1,10,USD,",
            f"{day(3)},UCK1,-5,USD,",
            f"{day(4)},UCK1,10,US,",
            f"{day(5)},UCK1,10,USD,",
            f"{day(5)},UCK1,11,USD,",
        ]
    )
    r = upload(founder, csv).json()
    assert (r["rows_total"], r["rows_created"], r["rows_failed"]) == (8, 2, 6)
    by_line = {e["line"]: e["message"] for e in r["errors"]}
    assert "no channel with ID 'UNKNOWN'" in by_line[3]
    assert "not a date" in by_line[4]
    assert "future" in by_line[5]
    assert "negative" in by_line[6]
    assert "3-letter" in by_line[7]
    assert "appear twice" in by_line[9]


def test_missing_columns_and_template(founder):
    r = upload(founder, "date,channel\n2026-01-01,x").json()
    assert r["rows_created"] == 0 and "Missing column" in r["errors"][0]["message"]
    template = founder.get("/api/revenue/template")
    assert template.status_code == 200 and template.text.startswith("date,channel_id")


def test_reimport_updates_instead_of_duplicating(founder):
    channel(founder, "Kapil Comedy 01", external_id="UCK1")
    upload(founder, f"date,channel_id,gross_revenue,currency\n{day(1)},UCK1,100,USD")
    again = upload(founder, f"date,channel_id,gross_revenue,currency\n{day(1)},UCK1,120,USD").json()
    same = upload(founder, f"date,channel_id,gross_revenue,currency\n{day(1)},UCK1,120,USD").json()
    assert (again["rows_created"], again["rows_updated"]) == (0, 1)
    assert (same["rows_created"], same["rows_updated"]) == (0, 0)
    facts = founder.get(f"/api/revenue/facts?month={MONTH}").json()
    assert facts["total"] == 1 and facts["items"][0]["gross_amount"] == "120.00"


def test_platform_needed_when_id_is_ambiguous(founder):
    channel(founder, "YT", external_id="123")
    channel(founder, "FB", platform="facebook", external_id="123")
    r = upload(founder, f"date,channel_id,gross_revenue,currency\n{day(1)},123,5,USD").json()
    assert "both platforms" in r["errors"][0]["message"]
    ok = upload(
        founder, f"date,channel_id,platform,gross_revenue,currency\n{day(1)},123,facebook,5,USD"
    ).json()
    assert ok["rows_created"] == 1


# ---- Slide 9: CMS fee across all channels -----------------------------------------------------


def test_slide9_cms_fee_and_channel_shares(founder):
    cms_a = slide9(founder)
    detail = founder.get(f"/api/finance/settlements/{cms_a}?month={MONTH}").json()
    s = detail["summary"]
    assert (s["gross"], s["fee"], s["net"]) == ("25000.00", "3750.00", "21250.00")
    shares = {c["channel_name"]: c["fee_share"] for c in detail["channels"]}
    assert shares == {
        "Kapil Comedy 01": "1800.00",
        "CID Stories 01": "900.00",
        "Studio B Laughs": "600.00",
        "Owned Shorts 01": "450.00",
    }
    assert sum(Decimal(v) for v in shares.values()) == Decimal("3750.00")


def test_schedule_rules(founder):
    cms_a = cms(founder, "CMS A")
    bad = founder.post(
        f"/api/cms-partners/{cms_a}/fee-schedules",
        json={
            "effective_from": str(LAST),
            "tier_type": "whole",
            "currency": "USD",
            "tiers": [{"from_amount": "100", "rate_pct": "10"}],
        },
    )
    assert bad.status_code == 422 and "start at 0" in bad.text
    schedule(founder, cms_a, effective=str(LAST.replace(day=20)))
    dup = founder.post(
        f"/api/cms-partners/{cms_a}/fee-schedules",
        json={"effective_from": str(LAST), "tier_type": "whole", "currency": "USD", "tiers": TIERS},
    )
    assert dup.status_code == 409
    assert founder.get(f"/api/cms-partners/{cms_a}/fee-schedules").json()[0][
        "effective_from"
    ] == str(LAST)


def test_marginal_schedule_and_newer_schedule_wins(founder):
    cms_a = cms(founder, "CMS A")
    channel(founder, "Kapil Comedy 01", external_id="UCK1", cms_id=cms_a)
    upload(founder, f"date,channel_id,gross_revenue,currency\n{day(1)},UCK1,25000,USD")
    schedule(founder, cms_a, effective=str(LAST - timedelta(days=200)))
    schedule(founder, cms_a, tier_type="marginal", effective=str(LAST))
    s = founder.get(f"/api/finance/settlements/{cms_a}?month={MONTH}").json()["summary"]
    assert s["fee"] == "4750.00" and "marginal" in s["fee_rule"]


# ---- Slide 10: receivable, cash, outstanding ---------------------------------------------------


def test_fx_receipts_adjustments_and_outstanding(founder):
    cms_a = slide9(founder)
    m = founder.get(f"/api/finance/settlements?month={MONTH}").json()
    assert m["incomplete"] is True
    assert any("No USD→INR rate" in w for w in m["rows"][0]["warnings"])

    assert (
        founder.put(
            "/api/fx-rates", json={"month": MONTH, "currency": "usd", "rate": "84"}
        ).status_code
        == 200
    )
    founder.post(
        "/api/finance/receipts",
        json={
            "cms_partner_id": cms_a,
            "month": MONTH,
            "received_on": str(TODAY),
            "amount": "1000000",
            "reference": "UTR123",
        },
    )
    founder.post(
        "/api/finance/adjustments",
        json={
            "cms_partner_id": cms_a,
            "month": MONTH,
            "amount": "-50000",
            "reason": "TDS withheld",
        },
    )

    m = founder.get(f"/api/finance/settlements?month={MONTH}").json()
    row = m["rows"][0]
    assert (row["gross_base"], row["fee_base"], row["net_base"]) == (
        "2100000.00",
        "315000.00",
        "1785000.00",
    )
    assert (row["received"], row["adjustments"], row["outstanding"]) == (
        "1000000.00",
        "-50000.00",
        "735000.00",
    )
    assert (m["gross"], m["fee"], m["net_receivable"], m["received"], m["outstanding"]) == (
        "2100000.00",
        "315000.00",
        "1785000.00",
        "1000000.00",
        "735000.00",
    )
    assert m["incomplete"] is False


def test_statement_variance(founder):
    cms_a = slide9(founder)
    bad = founder.put(
        "/api/finance/statements",
        json={
            "cms_partner_id": cms_a,
            "month": MONTH,
            "currency": "USD",
            "gross_amount": "25000",
            "fee_amount": "3750",
            "net_amount": "1",
        },
    )
    assert bad.status_code == 422
    founder.put(
        "/api/finance/statements",
        json={
            "cms_partner_id": cms_a,
            "month": MONTH,
            "currency": "USD",
            "gross_amount": "24900",
            "fee_amount": "3735",
            "net_amount": "21165",
        },
    )
    s = founder.get(f"/api/finance/settlements/{cms_a}?month={MONTH}").json()["summary"]
    assert (s["statement_net"], s["variance"]) == ("21165.00", "-85.00")


def test_revenue_stays_with_the_cms_it_was_earned_under(founder):
    cms_a, cms_b = cms(founder, "CMS A"), cms(founder, "CMS B")
    ch = channel(founder, "Kapil Comedy 01", external_id="UCK1", cms_id=cms_a)
    upload(founder, f"date,channel_id,gross_revenue,currency\n{day(1)},UCK1,500,USD")
    founder.put(
        f"/api/channels/{ch}",
        json={
            "platform": "youtube",
            "name": "Kapil Comedy 01",
            "external_id": "UCK1",
            "cms_partner_id": cms_b,
        },
    )
    upload(founder, f"date,channel_id,gross_revenue,currency\n{day(2)},UCK1,200,USD")

    rows = {
        r["cms_name"]: r["gross"]
        for r in founder.get(f"/api/finance/settlements?month={MONTH}").json()["rows"]
    }
    assert rows == {"CMS A": "500.00", "CMS B": "200.00"}


def test_channels_without_cms_show_separately(founder):
    channel(founder, "Owned direct", external_id="UCD1")
    upload(founder, f"date,channel_id,gross_revenue,currency\n{day(1)},UCD1,300,USD")
    rows = founder.get(f"/api/finance/settlements?month={MONTH}").json()["rows"]
    assert [(r["cms_name"], r["gross"], r["fee"]) for r in rows] == [("No CMS", "300.00", "0.00")]
    detail = founder.get(f"/api/finance/settlements/none?month={MONTH}").json()
    assert detail["channels"][0]["channel_name"] == "Owned direct"


def test_finance_isolated_between_companies(make_founder, login):
    make_founder("a@taggify.in", org_slug="taggify")
    make_founder("b@sociodoor.in", org_slug="sociodoor")
    t, s = login("a@taggify.in"), login("b@sociodoor.in")
    cms_a = slide9(t)
    assert s.get(f"/api/finance/settlements?month={MONTH}").json()["rows"] == []
    assert s.get(f"/api/revenue/facts?month={MONTH}").json()["total"] == 0
    assert s.get(f"/api/finance/settlements/{cms_a}?month={MONTH}").status_code == 404
    receipt = {"cms_partner_id": cms_a, "month": MONTH, "received_on": str(TODAY), "amount": "1"}
    assert s.post("/api/finance/receipts", json=receipt).status_code == 404
    # Sociodoor cannot import onto Taggify's channels either.
    r = upload(s, f"date,channel_id,gross_revenue,currency\n{day(3)},UCK1,1,USD").json()
    assert r["rows_created"] == 0 and r["rows_failed"] == 1


def test_cms_list_shows_slabs_in_force(founder):
    cms_a = cms(founder, "CMS A")
    cms(founder, "CMS B")
    schedule(founder, cms_a, effective=str(LAST - timedelta(days=200)))
    schedule(founder, cms_a, tier_type="marginal", effective=str(LAST))
    rows = {c["name"]: c for c in founder.get("/api/cms-partners").json()}
    slabs = rows["CMS A"]["slabs"]
    assert slabs["tier_type"] == "marginal" and slabs["effective_from"] == str(LAST)
    assert [t["rate_pct"] for t in slabs["tiers"]] == [t["rate_pct"] for t in TIERS]
    assert rows["CMS B"]["slabs"] is None


def test_cms_detail_shows_latest_statement_and_what_is_owed_by_month(founder):
    cms_a = slide9(founder)  # comes with its fee schedule
    founder.put("/api/fx-rates", json={"month": MONTH, "currency": "USD", "rate": "80"})
    d = founder.get(f"/api/finance/settlements/{cms_a}?month={MONTH}").json()
    assert d["latest_statement_month"] is None
    assert [o["month"] for o in d["outstanding_by_month"]] == [MONTH]
    assert d["outstanding_by_month"][0]["outstanding"] == d["summary"]["outstanding"]
    founder.put(
        "/api/finance/statements",
        json={
            "cms_partner_id": cms_a,
            "month": MONTH,
            "currency": "USD",
            "gross_amount": "25000",
            "fee_amount": "3750",
            "net_amount": "21250",
        },
    )
    d = founder.get(f"/api/finance/settlements/{cms_a}?month={MONTH}").json()
    assert d["latest_statement_month"] == MONTH


def test_new_cms_charges_its_fee_after_tax_unless_told_otherwise(founder):
    # Founders: every CMS takes its fee on the earnings left after tax.
    r = founder.post("/api/cms-partners", json={"name": "Giri CMS", "platform": "youtube"})
    assert r.status_code == 201 and r.json()["fee_after_tax"] is True
    r = founder.post(
        "/api/cms-partners",
        json={"name": "Other CMS", "platform": "youtube", "fee_after_tax": False},
    )
    assert r.json()["fee_after_tax"] is False
