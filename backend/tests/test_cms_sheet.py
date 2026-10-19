"""A CMS's own monthly sheet, uploaded as it comes (Excel), with tax withheld before the fee."""

import io
import json
from decimal import Decimal

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


# ---- Other CMS layouts (from real sheets, numbers shortened) ------------------------------------


def table_of(rows) -> "object":
    from app.services.cms_sheet import read_table

    wb = Workbook()
    for r in rows:
        wb.active.append(r)
    out = io.BytesIO()
    wb.save(out)
    return read_table(out.getvalue(), "sheet.xlsx")


def test_layout_with_two_rows_per_channel_and_a_bare_rate_header():
    """Giri-style: blank rows on top, the rate as a header ("94.25"), the label's INR under a
    header without "INR", Channel + Subscription rows per channel, a mid-sheet Total."""
    from app.services.cms_sheet import detect_rate, guess_mapping, parse_sheet

    def row(service, name, cid, total, tax):
        inr = round((total - tax) * 94.25, 2)
        fee = round(inr * 0.11, 2)
        return ["May-26", service, name, cid, total, tax, total - tax, total - tax, inr, 11, fee,
                round(inr - fee, 2)]  # fmt: skip

    t = table_of(
        [
            [],
            [],
            [
                "Month",
                "Service",
                "Channel Name",
                "Channel ID",
                "Total USD",
                "U.S Tax Deducted",
                "Subtotal USD",
                "Final USD",
                94.25,
                "Giri %",
                "Giri Revenue",
                "Billable by Label",
            ],  # fmt: skip
            row("Channel", "Desh Ka Jurm", ID_A, 249.89, 3.12),
            row("Subscription", "Desh Ka Jurm", ID_A, 1.40, 0),
            [None] * 10 + ["Total", 20817.12],
            [],
            row("Channel", "Case Khatam", ID_B, 1540.11, 17.38),
        ]
    )
    m = guess_mapping(t)
    assert m == {
        "channel_id": "Channel ID",
        "channel_name": "Channel Name",
        "gross": "Total USD",
        "tax": "U.S Tax Deducted",
        "net_local": "Billable by Label",
    }
    rate = detect_rate(t, m)
    assert rate == Decimal("94.25")
    p = parse_sheet(t, m, [], rate)
    assert [(x.external_id, x.rows, x.gross, x.tax) for x in p.lines] == [
        (ID_A, 2, Decimal("251.29"), Decimal("3.12")),
        (ID_B, 1, Decimal("1540.11"), Decimal("17.38")),
    ]
    # 11% of what is left after tax: (251.29 − 3.12) × 89% ≈ 220.87
    assert p.lines[0].net == Decimal("220.88")
    assert p.skipped == 2  # the mid-sheet Total and the blank row


def test_layout_with_swapped_headers_and_a_rate_column():
    """Taggify-report style: IDs under "Channel", names under "Asset Channel ID", a "$ Rate"
    column, an 80% "Share" (not money) and the label's INR under "Vendor"."""
    from app.services.cms_sheet import detect_rate, guess_mapping, parse_sheet

    head = ["Channel", "Asset Channel ID", "Type", "Owned Views", "Revenue", "$ Rate", "Amount",
            "Share", "Vendor"]  # fmt: skip
    rows = [head]
    for cid, name, rev in [(ID_A, "Kanoon Sena", 760.99), (ID_B, "Hero Kidz", 532.01),
                           (ID_C, "Kanha Ki Leela", 396.94), (None, None, 0)]:  # fmt: skip
        amount = round(rev * 94.26, 2)
        rows.append([cid, name, "Video", None, rev, 94.26, amount, 0.8, round(amount * 0.8, 2)])
    rows.append([None, None, None, "Total (INR)", 1689.94, None, 159293.75, None, 127435.0])
    t = table_of(rows)
    m = guess_mapping(t)
    assert (m["channel_id"], m["channel_name"], m["gross"], m["net_local"]) == (
        "Channel",
        "Asset Channel ID",
        "Revenue",
        "Vendor",
    )
    assert "net" not in m  # "Share" is a percentage, not money
    rate = detect_rate(t, m)
    assert rate == Decimal("94.26")
    p = parse_sheet(t, m, [], rate)
    assert len(p.lines) == 3 and p.skipped == 2
    assert (p.lines[0].net, p.lines[0].fee) == (Decimal("608.79"), Decimal("152.20"))  # 20%
