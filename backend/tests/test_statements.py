"""CMS statement files and channel-by-channel reconciliation (working document §3, scenario 05)."""

from tests.test_finance import MONTH, founder, slide9  # noqa: F401


def upload(c, cms_id, text, name="cms-a-statement.csv", reference=None):
    data = {"cms_partner_id": cms_id, "month": MONTH}
    if reference:
        data["reference"] = reference
    return c.post(
        "/api/finance/statements/import",
        data=data,
        files={"file": (name, text.encode(), "text/csv")},
    )


# CMS A's own breakdown of slide 9: Studio B is $250 lower (a chargeback), Owned Shorts is
# missing, and a channel we do not have is listed.
STATEMENT = "\n".join(
    [
        "Channel ID,Channel Name,Gross Revenue,CMS Fee,Net",
        "UCK1,Kapil Comedy 01,12000,1800,10200",
        "UCC1,CID Stories 01,6000,900,5100",
        "UCS1,Studio B Laughs,3750,562.50,3187.50",
        "UCX9,Some Other Channel,100,15,85",
        "UCBAD,Broken line,abc,1,",
        "UCK1,Kapil again,1,0,1",
    ]
)


def test_statement_file_is_matched_line_by_line(founder):  # noqa: F811
    cms_a = slide9(founder)
    r = upload(founder, cms_a, STATEMENT, reference="CMSA-2026-09").json()
    assert (r["lines_saved"], r["lines_matched"], r["lines_unknown"]) == (4, 3, 1)
    assert [e["line"] for e in r["errors"]] == [6, 7]
    st = r["statement"]
    # Totals come from the saved lines: 21,850 − 3,277.50 = 18,572.50.
    assert (st["gross_amount"], st["fee_amount"], st["net_amount"]) == (
        "21850.00",
        "3277.50",
        "18572.50",
    )
    assert (st["source"], st["file_name"], st["version"], st["uploaded_by"], st["line_count"]) == (
        "file",
        "cms-a-statement.csv",
        1,
        "Asha",
        4,
    )

    detail = founder.get(f"/api/finance/settlements/{cms_a}?month={MONTH}").json()
    recon = {line["channel_name"]: line for line in detail["reconciliation"]}
    assert recon["Kapil Comedy 01"]["status"] == "match"
    assert recon["CID Stories 01"]["status"] == "match"
    studio = recon["Studio B Laughs"]
    assert (studio["status"], studio["our_net"], studio["their_net"], studio["difference"]) == (
        "differs",
        "3400.00",
        "3187.50",
        "-212.50",
    )
    assert recon["Owned Shorts 01"]["status"] == "missing_in_statement"
    assert recon["Some Other Channel"]["status"] == "unknown_channel"
    # Problems first, matches last.
    assert [line["status"] for line in detail["reconciliation"]][-1] == "match"

    original = founder.get(f"/api/finance/statements/{st['id']}/file")
    assert original.status_code == 200 and original.content.decode() == STATEMENT


def test_new_upload_replaces_and_typed_totals_drop_the_lines(founder):  # noqa: F811
    cms_a = slide9(founder)
    upload(founder, cms_a, STATEMENT)
    fixed = "channel_id,gross,fee\nUCK1,12000,1800\nUCC1,6000,900\nUCS1,4000,600\nUCO1,3000,450\n"
    st = upload(founder, cms_a, fixed, name="cms-a-v2.csv").json()["statement"]
    assert (st["version"], st["net_amount"], st["file_name"]) == (2, "21250.00", "cms-a-v2.csv")
    detail = founder.get(f"/api/finance/settlements/{cms_a}?month={MONTH}").json()
    assert {line["status"] for line in detail["reconciliation"]} == {"match"}
    assert detail["summary"]["variance"] == "0.00"

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
    detail = founder.get(f"/api/finance/settlements/{cms_a}?month={MONTH}").json()
    assert (detail["statement"]["source"], detail["statement"]["version"]) == ("manual", 3)
    assert detail["reconciliation"] == []


def test_statement_file_problems(founder):  # noqa: F811
    cms_a = slide9(founder)
    r = upload(founder, cms_a, "channel_id,amount\nUCK1,5\n").json()
    assert r["statement"] is None and "Missing column(s): gross, fee" in r["errors"][0]["message"]
    r = upload(
        founder, cms_a, "channel_id,gross,fee,net,currency\nUCK1,10,1,5,USD\nUCC1,10,1,9,AED\n"
    ).json()
    assert r["statement"] is None
    assert [e["message"][:9] for e in r["errors"]] == ["Net 5 is ", "Currency "]
