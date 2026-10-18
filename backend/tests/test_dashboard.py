from datetime import timedelta

from sqlalchemy import select

from app.models import Membership, Organization, User
from tests.test_channels_people import channel, post, slot_id
from tests.test_deals import deal_body, owner
from tests.test_finance import LAST, MONTH, TODAY, day
from tests.test_payouts import founder, make_deal, revenue, setup  # noqa: F401

PREV = f"{(LAST - timedelta(days=1)):%Y-%m}"


def items(d, box):
    return {i["key"]: i for i in d[box]}


def test_cards_match_finance_and_deals(founder, setup):  # noqa: F811
    d = make_deal(founder, setup["channel"])
    revenue(founder, [(day(1), 1000), (day(2), 1000)])
    founder.post(
        "/api/finance/receipts",
        json={
            "cms_partner_id": setup["cms"],
            "month": MONTH,
            "received_on": str(TODAY),
            "amount": "100000",
        },
    )

    dash = founder.get("/api/dashboard").json()  # defaults to the latest month with revenue
    assert dash["month"] == MONTH
    cur = dash["current"]
    # $2,000 at 80 = ₹1,60,000; CMS A 20 % → ₹32,000; ₹1,00,000 received.
    assert (cur["gross"], cur["fee"], cur["net"], cur["received"], cur["outstanding"]) == (
        "160000.00",
        "32000.00",
        "128000.00",
        "100000.00",
        "28000.00",
    )
    assert cur["complete"] is True
    finance = founder.get(f"/api/finance/settlements?month={MONTH}").json()
    assert (finance["gross"], finance["outstanding"]) == (cur["gross"], cur["outstanding"])

    # Deal recovery equals the deal page: day 2 only → net ₹62,800 of ₹50L.
    economics = founder.get(f"/api/deals/{d['id']}/economics").json()
    assert (dash["rights_cost"], dash["net_contribution"]) == (
        economics["rights_cost"],
        economics["net_contribution"],
    )
    assert dash["recovery_pct"] == "1.3"
    assert dash["deals"][0]["title"] == "The Kapil Sharma Show"

    assert [p["month"] for p in dash["trend"]][-2:] == [PREV, MONTH]
    assert dash["previous"]["gross"] == "0.00"
    assert dash["channels"][0] == {
        "id": setup["channel"],
        "name": "Kapil Comedy 01",
        "platform": "youtube",
        "manager": "Ananya",
        "gross": "160000.00",
    }

    # Receivables aging (docx §9): last month's balance is 0–30 days old.
    assert dash["aging"] == [
        {
            "cms_id": setup["cms"],
            "cms_name": "CMS A",
            "buckets": {
                "not_due": "0.00",
                "d0_30": "28000.00",
                "d31_60": "0.00",
                "d61_90": "0.00",
                "d90_plus": "0.00",
            },
            "total": "28000.00",
        }
    ]
    # Leaderboard: Ananya managed ₹1,60,000 and earns 1 % ($20 = ₹1,600); Kabir leads (0.5 %).
    top = {p["name"]: p for p in dash["people"]}
    assert dash["people"][0]["name"] == "Ananya"
    assert (top["Ananya"]["gross"], top["Ananya"]["incentive"], top["Ananya"]["channels"]) == (
        "160000.00",
        "1600.00",
        1,
    )
    assert (top["Kabir"]["gross"], top["Kabir"]["incentive"]) == ("0.00", "800.00")


def test_money_needing_attention(founder, setup):  # noqa: F811
    d = make_deal(founder, setup["channel"])
    revenue(founder, [(day(2), 1000)])
    for due, amount in ((LAST, "500000"), (TODAY + timedelta(days=10), "800000")):
        founder.post(
            f"/api/deals/{d['id']}/installments", json={"due_date": str(due), "amount": amount}
        )
    founder.put(
        "/api/finance/statements",
        json={
            "cms_partner_id": setup["cms"],
            "month": MONTH,
            "currency": "USD",
            "gross_amount": "1000",
            "fee_amount": "150",
            "net_amount": "850",
        },
    )

    money = items(founder.get(f"/api/dashboard?month={MONTH}").json(), "money")
    owed = money[f"cms-outstanding-{setup['cms']}"]
    assert (owed["title"], owed["amount"], owed["href"]) == (
        "CMS A outstanding",
        "64000.00",
        f"/finance/{setup['cms']}?month={MONTH}",
    )
    installments = sorted(
        (i["severity"], i["amount"]) for k, i in money.items() if k.startswith("installment-")
    )
    assert installments == [("danger", "500000.00"), ("info", "800000.00")]
    assert money["mismatches"]["title"] == "1 settlement mismatch"
    assert money["incentives"]["href"] == f"/finance/incentives?month={MONTH}"
    assert money["close"]["href"] == f"/finance/close?month={MONTH}"


def test_operations_needing_attention(founder, setup):  # noqa: F811
    spare = channel(founder, "Spare Channel", external_id="UCSPARE")
    soon = founder.post(
        "/api/deals",
        json=deal_body(
            owner(founder, "Vendor B"),
            title="CID",
            term_end=str(TODAY + timedelta(days=20)),
            yt_slot_limit=2,
            fb_slot_limit=0,
            notice_period_days=15,
        ),
    ).json()
    r = post(
        founder,
        f"/api/deals/{soon['id']}/slots/{slot_id(soon, 'YT-01')}/assign",
        channel_id=spare,
        status="pending_whitelist",
    )
    assert r.status_code == 200, r.text

    ops = items(founder.get("/api/dashboard").json(), "operations")
    assert ops["expiring"]["title"] == "1 deal expiring soon"
    assert ops["expiring"]["severity"] == "danger"
    assert ops["whitelisting"]["title"] == "1 whitelisting request pending"
    assert ops["vacant"]["title"] == "1 unused slot on live deals"
    assert ops["vacant"]["href"] == f"/deals/{soon['id']}?tab=slots"
    assert ops["unmanaged"]["title"] == "1 channel without a manager"
    notice = ops[f"notice-{soon['id']}"]  # ends in 20 days, 15 days' notice → due in 5
    assert (notice["title"], notice["severity"]) == ("Renewal notice due for CID", "danger")

    listed = founder.get("/api/channels?managed=no").json()["items"]
    assert [c["name"] for c in listed] == ["Spare Channel"]


def test_group_view_and_isolation(founder, setup, make_founder, login, db):  # noqa: F811
    revenue(founder, [(day(1), 1000)])
    make_founder("b@sociodoor.in", org_slug="sociodoor")
    asha = db.scalar(select(User).where(User.email == "a@taggify.in"))
    sociodoor = db.scalar(select(Organization).where(Organization.slug == "sociodoor"))
    db.add(Membership(user_id=asha.id, organization_id=sociodoor.id))
    db.commit()

    group = founder.get(f"/api/dashboard/group?month={MONTH}").json()
    rows = {c["name"]: c for c in group["companies"]}
    assert set(rows) == {"Taggify", "Sociodoor"}
    assert (rows["Taggify"]["gross"], rows["Taggify"]["current"]) == ("80000.00", True)
    assert (rows["Sociodoor"]["gross"], rows["Sociodoor"]["current"]) == ("0.00", False)
    assert group["total"]["gross"] == "80000.00" and group["currency"] == "INR"

    other = login("b@sociodoor.in")
    assert other.get(f"/api/dashboard?month={MONTH}").json()["current"]["gross"] == "0.00"
    assert [c["name"] for c in other.get("/api/dashboard/group").json()["companies"]] == [
        "Sociodoor"
    ]
    assert other.get("/api/dashboard?month=2026-13").status_code == 422
