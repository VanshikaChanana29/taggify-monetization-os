"""A channel's own page: its money month by month — gross, tax, CMS fee, what the CMS pays."""

from tests.test_cms_sheet import ID_A, post, setup_cms, sheet
from tests.test_finance import MONTH, founder, slide9  # noqa: F401


def channel_id(c, external_id: str) -> str:
    items = c.get("/api/channels?page_size=50").json()["items"]
    return next(x["id"] for x in items if x["external_id"] == external_id)


def test_month_uses_the_cms_sheet_figures_when_there_is_one(founder):  # noqa: F811
    cms_s = setup_cms(founder)
    assert post(founder, "import", cms_s, sheet()).status_code == 201
    r = founder.get(f"/api/channels/{channel_id(founder, ID_A)}/revenue")
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["base_currency"] == "INR"
    (m,) = out["months"]
    assert (m["month"], m["cms_name"], m["currency"], m["source"]) == (
        f"{MONTH}-01",
        "CMS S",
        "USD",
        "sheet",
    )
    # 1,000 gross − 30 US tax; the CMS paid 92% of 970 = 892.40, so its fee was 77.60.
    assert (m["gross"], m["tax"], m["fee"], m["net"]) == ("1000.00", "30.00", "77.60", "892.40")
    assert m["net_base"] == "85670.40"  # 892.40 at the company's 96


def test_month_without_a_sheet_uses_the_fee_slabs(founder):  # noqa: F811
    slide9(founder)
    (m,) = founder.get(f"/api/channels/{channel_id(founder, 'UCK1')}/revenue").json()["months"]
    # Kapil Comedy 01 earned 12,000 of CMS A's 25,000: its share of the 3,750 fee is 1,800.
    assert (m["gross"], m["tax"], m["fee"], m["net"], m["source"]) == (
        "12000.00",
        "0.00",
        "1800.00",
        "10200.00",
        "slabs",
    )
    assert m["views"] == 2000 and m["net_base"] is None  # no rate for the month yet


def test_revenue_is_per_company(make_founder, login, founder):  # noqa: F811
    slide9(founder)
    cid = channel_id(founder, "UCK1")
    make_founder("s@sociodoor.in", org_slug="sociodoor")
    assert login("s@sociodoor.in").get(f"/api/channels/{cid}/revenue").status_code == 404
