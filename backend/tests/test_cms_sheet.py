"""A CMS's own monthly sheet, uploaded as it comes (Excel), with tax withheld before the fee."""

import io
import json

from openpyxl import Workbook

from tests.test_channels_people import channel, cms
from tests.test_finance import MONTH, founder, schedule  # noqa: F401

ID_A = "UCaaaaaaaaaaaaaaaaaaaaa1"
ID_B = "UCbbbbbbbbbbbbbbbbbbbbb2"
ID_C = "UCccccccccccccccccccccc3"
HEADERS = [
    "Channels Name",
    "Channel URL",
    "Partner",
    "Total",
    "U.S. Rev",
    "Tax@15%",
    "Payble",
    "INR@95.92",
    "Label Rev INR",
]


def sheet() -> bytes:
    """Laid out like a real CMS sheet: a title row, then per channel gross → US tax →
    payable → INR at the CMS's rate → the label's 92% after an 8% fee; totals at the end."""
    wb = Workbook()
    ws = wb.active
    ws.append(["Sociodoor Digital - monthly report"])
    ws.append([None, *HEADERS])
    rows = [
        ("Channel A", f"https://www.youtube.com/channel/{ID_A}", 1000, 200, 30),
        ("Channel B", ID_B, 500, 0, 0),
        ("Not In Tool", ID_C, 100, 0, 0),
    ]
    for name, url, total, us, tax in rows:
        pay = total - tax
        ws.append([None, name, url, "Sociodoor Digital", total, us, tax, pay, pay * 95.92,
                   pay * 95.92 * 0.92])  # fmt: skip
    ws.append([None, None, None, None, None, None, None, None, None, 138547.85])
    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()


def post(c, path, cms_id, content, **extra):
    return c.post(
        f"/api/finance/cms-sheet/{path}",
        data={"cms_partner_id": cms_id, "month": MONTH, **extra},
        files={"file": ("Sociodoor Digital - Jun'26.xlsx", content, "application/octet-stream")},
    )


def setup_cms(c) -> str:
    cms_s = cms(c, "CMS S")
    r = c.put(
        f"/api/cms-partners/{cms_s}",
        json={"name": "CMS S", "platform": "youtube", "fee_after_tax": True},
    )
    assert r.status_code == 200 and r.json()["fee_after_tax"] is True, r.text
    schedule(c, cms_s, tiers=[{"from_amount": "0", "rate_pct": "8"}])
    channel(c, "Channel A", external_id=ID_A, cms_id=cms_s)
    channel(c, "Channel B", external_id=ID_B, cms_id=cms_s)
    assert c.put("/api/fx-rates", json={"month": MONTH, "currency": "USD", "rate": "96"}).is_success
    return cms_s


def test_preview_guesses_the_columns_and_reads_the_rate(founder):  # noqa: F811
    cms_s = setup_cms(founder)
    p = post(founder, "preview", cms_s, sheet()).json()
    assert p["mapping_source"] == "guessed" and p["problems"] == []
    assert p["mapping"] == {
        "channel_id": "Channel URL",
        "channel_name": "Channels Name",
        "gross": "Total",
        "tax": "Tax@15%",
        "net_local": "Label Rev INR",
    }
    assert (p["sheet_rate"], p["company_rate"], p["currency"]) == ("95.92", "96.000000", "USD")
    assert (p["lines"], p["matched"], p["skipped"]) == (3, 2, 1)  # the totals row is skipped
    assert [u["external_id"] for u in p["unknown"]] == [ID_C]
    # The label's INR is turned back into dollars at the sheet's rate: 970 × 92% = 892.40.
    a = p["sample"][0]
    assert (a["external_id"], a["gross"], a["tax"], a["net"], a["fee"]) == (
        ID_A,
        "1000.00",
        "30.00",
        "892.40",
        "77.60",
    )
    assert p["totals"] == {
        "gross": "1600.00",
        "tax": "30.00",
        "fee": "125.60",
        "net": "1444.40",
        "net_local": "138546.85",
    }
    assert p["gross_base"] == "153600.00"  # at the company's rate, 96


def test_import_books_revenue_and_statement_and_remembers_the_mapping(founder):  # noqa: F811
    cms_s = setup_cms(founder)
    r = post(founder, "import", cms_s, sheet())
    assert r.status_code == 201, r.text
    out = r.json()
    assert out["lines_imported"] == 2 and [u["external_id"] for u in out["unknown"]] == [ID_C]
    imp = out["revenue_import"]
    assert (imp["rows_created"], imp["rows_updated"], imp["rows_failed"]) == (2, 0, 1)
    assert "No channel with ID" in imp["errors"][0]["message"]
    st = out["statement"]
    assert (st["gross_amount"], st["tax_amount"], st["fee_amount"], st["net_amount"]) == (
        "1600.00",
        "30.00",
        "125.60",
        "1444.40",
    )

    # Our side: 8% fee on what is left after tax → 1,500 − 30 = 1,470 × 8% = 117.60.
    detail = founder.get(f"/api/finance/settlements/{cms_s}?month={MONTH}").json()
    s = detail["summary"]
    assert (s["gross"], s["tax"], s["fee"], s["net"]) == ("1500.00", "30.00", "117.60", "1352.40")
    assert s["net_base"] == "129830.40"  # 144,000 − 2,880 − 11,289.60 at 96
    recon = {line["channel_name"]: line for line in detail["reconciliation"]}
    assert recon["Channel A"]["status"] == "match" and recon["Channel A"]["their_tax"] == "30.00"
    assert recon["Channel B"]["status"] == "match"
    assert recon["Not In Tool"]["status"] == "unknown_channel"

    # Next month the same layout needs no mapping; uploading again replaces, not adds.
    again = post(founder, "preview", cms_s, sheet()).json()
    assert again["mapping_source"] == "saved" and again["replaces"] == 2
    imp2 = post(founder, "import", cms_s, sheet()).json()["revenue_import"]
    assert (imp2["rows_created"], imp2["rows_updated"]) == (0, 2)
    s2 = founder.get(f"/api/finance/settlements/{cms_s}?month={MONTH}").json()["summary"]
    assert s2["gross"] == "1500.00"
    cms_row = next(c for c in founder.get("/api/cms-partners").json() if c["id"] == cms_s)
    assert cms_row["has_sheet_mapping"] is True


def test_a_changed_mapping_and_its_problems(founder):  # noqa: F811
    cms_s = setup_cms(founder)
    bad = post(founder, "import", cms_s, sheet(), mapping=json.dumps({"channel_id": "Channel URL"}))
    assert bad.status_code == 422 and "Gross revenue" in bad.json()["detail"]
    # Without a rate, local-currency amounts cannot be turned into dollars.
    mapping = {"channel_id": "Channel URL", "gross": "Total", "net_local": "INR@95.92"}
    p = post(founder, "preview", cms_s, sheet(), mapping=json.dumps(mapping)).json()
    assert p["mapping_source"] == "chosen" and p["sheet_rate"] == "95.92"
    # Typing a different rate overrides the one in the header.
    p = post(
        founder, "preview", cms_s, sheet(), mapping=json.dumps(mapping), sheet_rate="100"
    ).json()
    assert p["sheet_rate"] == "100" and p["sample"][0]["net"] == "930.42"  # 93,042.40 ÷ 100
