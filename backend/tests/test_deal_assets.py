from datetime import date, timedelta

from tests.test_deals import deal_body, owner
from tests.test_finance import MONTH, TODAY, day
from tests.test_payouts import founder, make_deal, revenue, setup  # noqa: F401


def new_deal(c, **overrides):
    r = c.post("/api/deals", json=deal_body(owner(c), **overrides))
    assert r.status_code == 201, r.text
    return r.json()


# ---- Deal rights fields and hybrid deals --------------------------------------------------


def test_rights_inventory_fields(founder):  # noqa: F811
    d = new_deal(
        founder,
        languages=["Hindi", " hindi ", "English"],
        exclusivity="exclusive",
        renewal_terms="Auto-renews for 2 years unless notice is given",
        notice_period_days=90,
        clip_restrictions="Max 10 minutes per clip; no full episodes",
        agreement_version="v2.1 signed",
    )
    assert (d["languages"], d["exclusivity"], d["notice_period_days"]) == (
        ["Hindi", "English"],
        "exclusive",
        90,
    )
    assert d["notice_deadline"] == str(date.fromisoformat(d["term_end"]) - timedelta(days=90))
    assert (d["episode_count"], d["document_count"]) == (0, 0)
    bad = founder.post("/api/deals", json=deal_body(owner(founder, "X"), exclusivity="sole"))
    assert bad.status_code == 422


def test_hybrid_deal_needs_guarantee_and_share(founder):  # noqa: F811
    r = founder.post(
        "/api/deals", json=deal_body(owner(founder), deal_type="hybrid", revenue_share_pct=None)
    )
    assert r.status_code == 422 and "revenue share" in r.text
    d = founder.post(
        "/api/deals",
        json=deal_body(owner(founder, "Studio B"), deal_type="hybrid", revenue_share_pct="50"),
    ).json()
    assert (d["deal_type"], d["fee_amount"], d["revenue_share_pct"]) == (
        "hybrid",
        "5000000.00",
        "50.00",
    )


def test_hybrid_minimum_guarantee_is_recouped(founder, setup):  # noqa: F811
    d = make_deal(
        founder,
        setup["channel"],
        deal_type="hybrid",
        fee_amount="20000",
        revenue_share_pct="50",
    )
    revenue(founder, [(day(2), 1000)])
    e = founder.get(f"/api/deals/{d['id']}/economics").json()
    # ₹80,000 gross; owner's 50 % = ₹40,000, of which ₹20,000 is covered by the guarantee.
    assert (e["rights_cost"], e["royalty"], e["owner_share"]) == (
        "20000.00",
        "40000.00",
        "20000.00",
    )
    assert e["net_contribution"] == "42800.00"  # 80,000 − 16,000 CMS − 1,200 incentives − 20,000
    inst = founder.post(
        f"/api/deals/{d['id']}/installments", json={"due_date": str(TODAY), "amount": "20000"}
    )
    assert inst.status_code == 201


# ---- Episodes ------------------------------------------------------------------------------


def test_episode_details_inside_the_licence(founder):  # noqa: F811
    d = new_deal(founder)  # episodes 101–180
    url = f"/api/deals/{d['id']}/episodes"
    ep = {"episode_number": 150, "title": "Kapil with the Bachchans", "duration_minutes": 52}
    created = founder.post(url, json=ep)
    assert created.status_code == 201, created.text
    assert founder.post(url, json=ep).status_code == 409
    outside = founder.post(url, json={"episode_number": 190, "title": "Too far"})
    assert outside.status_code == 422 and "outside the licensed" in outside.text

    rc = founder.post(
        f"/api/deals/{d['id']}/check-rights", json={"platform": "youtube", "episode": 150}
    ).json()
    assert rc["episode_title"] == "Kapil with the Bachchans"

    eid = created.json()["id"]
    updated = founder.put(f"/api/episodes/{eid}", json={**ep, "description": "Family special"})
    assert updated.json()["description"] == "Family special"
    assert founder.get(f"{url}?q=bachchan").json()["total"] == 1
    assert founder.delete(f"/api/episodes/{eid}").status_code == 204
    assert founder.get(url).json()["total"] == 0


def test_episode_csv_import(founder):  # noqa: F811
    d = new_deal(founder)
    csv = (
        "Season,Episode,Title,Description,Air_Date,Duration_Minutes\n"
        ",101,Opening night,Guests: A and B,05-01-2019,50\n"
        ",102,Second show,,2019-01-12,\n"
        ",250,Outside,,,\n"
        ",103,,No title,,\n"
        ",101,Opening night (dup),,,\n"
    )
    files = {"file": ("eps.csv", csv.encode(), "text/csv")}
    r = founder.post(f"/api/deals/{d['id']}/episodes/import", files=files).json()
    assert (r["created"], r["updated"]) == (2, 0)
    assert [e["line"] for e in r["errors"]] == [4, 5, 6]
    again = founder.post(f"/api/deals/{d['id']}/episodes/import", files=files).json()
    assert (again["created"], again["updated"]) == (0, 2)
    items = founder.get(f"/api/deals/{d['id']}/episodes").json()["items"]
    assert [(e["episode_number"], e["air_date"]) for e in items] == [
        (101, "2019-01-05"),
        (102, "2019-01-12"),
    ]
    assert founder.get(f"/api/deals/{d['id']}").json()["episode_count"] == 2


# ---- Documents -----------------------------------------------------------------------------


def test_contract_documents(founder, make_founder, login):  # noqa: F811
    d = new_deal(founder)
    url = f"/api/deals/{d['id']}/documents"
    files = [
        ("files", ("Sony agreement.pdf", b"%PDF-1.4 contract", "application/pdf")),
        ("files", ("Annexure A.docx", b"PK annexure", "application/octet-stream")),
    ]
    r = founder.post(url, files=files, data={"kind": "contract"})
    assert r.status_code == 201, r.text
    docs = founder.get(url).json()
    assert {x["file_name"] for x in docs} == {"Sony agreement.pdf", "Annexure A.docx"}
    pdf = next(x for x in docs if x["file_name"].endswith(".pdf"))
    assert (pdf["size_bytes"], pdf["uploaded_by"]) == (17, "Asha")

    dl = founder.get(f"/api/documents/{pdf['id']}/download")
    assert dl.content == b"%PDF-1.4 contract"
    assert "Sony%20agreement.pdf" in dl.headers["content-disposition"]

    bad = founder.post(url, files=[("files", ("run.exe", b"MZ", "application/x-msdownload"))])
    assert bad.status_code == 422

    other = make_founder("b@sociodoor.in", org_slug="sociodoor")
    assert other
    s = login("b@sociodoor.in")
    assert s.get(f"/api/documents/{pdf['id']}/download").status_code == 404

    assert founder.delete(f"/api/documents/{pdf['id']}").status_code == 204
    assert founder.get(f"/api/deals/{d['id']}").json()["document_count"] == 1


# ---- Receipts in the currency the CMS paid -------------------------------------------------


def test_receipts_in_usd_and_aed_with_fx_difference(founder, setup):  # noqa: F811
    revenue(founder, [(day(1), 1000)])  # $1,000 − 20 % = $800 net = ₹64,000 at 80
    cms = setup["cms"]

    def receipt(**body):
        return founder.post(
            "/api/finance/receipts",
            json={"cms_partner_id": cms, "month": MONTH, "received_on": str(TODAY), **body},
        )

    assert receipt(currency="USD", amount="500").status_code == 422  # credited INR needed
    assert receipt(currency="USD", amount="500", amount_base="41000").status_code == 201
    row = founder.get(f"/api/finance/settlements?month={MONTH}").json()["rows"][0]
    # $500 clears ₹40,000 of the receivable; the bank paid ₹41,000 → ₹1,000 FX gain.
    assert (row["received"], row["received_credited"], row["fx_difference"]) == (
        "40000.00",
        "41000.00",
        "1000.00",
    )
    assert row["outstanding"] == "24000.00"

    assert receipt(currency="AED", amount="100", amount_base="2250").status_code == 201
    row = founder.get(f"/api/finance/settlements?month={MONTH}").json()["rows"][0]
    assert any("No AED→INR rate" in w for w in row["warnings"])
    founder.put("/api/fx-rates", json={"month": MONTH, "currency": "AED", "rate": "22"})
    detail = founder.get(f"/api/finance/settlements/{cms}?month={MONTH}").json()
    aed = next(r for r in detail["receipts"] if r["currency"] == "AED")
    assert (aed["amount"], aed["amount_base"], aed["valued_base"]) == (
        "100.00",
        "2250.00",
        "2200.00",
    )
    assert detail["summary"]["fx_difference"] == "1050.00"

    inr = receipt(amount="1000")  # no currency → base
    assert (inr.json()["currency"], inr.json()["amount_base"]) == ("INR", "1000.00")


def test_closed_month_accepts_a_first_rate_for_a_receipt_only_currency(founder, setup):  # noqa: F811
    revenue(founder, [(day(1), 1000)])
    for step in ("compute", "approve"):
        founder.post(f"/api/finance/incentives/{step}", json={"month": MONTH})
    assert founder.post("/api/finance/close", json={"month": MONTH}).status_code == 200

    def fx(currency, rate):
        return founder.put(
            "/api/fx-rates", json={"month": MONTH, "currency": currency, "rate": rate}
        ).status_code

    assert fx("USD", "90") == 409  # revenue currency stays locked
    assert fx("AED", "22") == 200  # values late AED receipts only
    assert fx("AED", "23") == 409  # and cannot be changed once set
