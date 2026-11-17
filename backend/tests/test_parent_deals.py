"""Parent deals: one contract (e.g. Sony ₹1 Cr) with several shows under it."""

from datetime import timedelta

import pytest

from tests.test_deals import TODAY, deal_body, owner

START = TODAY - timedelta(days=30)
END = TODAY + timedelta(days=2 * 365)


@pytest.fixture
def founder(make_founder, login):
    make_founder("a@taggify.in", name="Asha")
    return login("a@taggify.in")


def parent_body(owner_id: str, **overrides) -> dict:
    body = {
        "owner_id": owner_id,
        "name": "Sony Package 2026",
        "deal_type": "fixed_fee",
        "amount": "10000000",  # ₹1 Cr
        "currency": "INR",
        "term_start": str(START),
        "term_end": str(END),
    }
    body.update(overrides)
    return body


def make_parent(c, owner_id: str, **overrides) -> dict:
    r = c.post("/api/parent-deals", json=parent_body(owner_id, **overrides))
    assert r.status_code == 201, r.text
    return r.json()


def show(c, parent: dict, title: str, fee: str, **overrides):
    body = deal_body(None, title=title, fee_amount=fee, term_start=str(START), term_end=str(END))
    body.update(parent_id=parent["id"], **overrides)
    return c.post("/api/deals", json=body)


def test_shows_cannot_add_up_to_more_than_the_deal(founder):
    parent = make_parent(founder, owner(founder))
    for title, fee in (("Show A", "3000000"), ("Show B", "2500000"), ("Show C", "2000000")):
        assert show(founder, parent, title, fee).status_code == 201

    p = founder.get(f"/api/parent-deals/{parent['id']}").json()
    assert (p["show_count"], p["allotted"], p["unallotted"]) == (3, "7500000.00", "2500000.00")
    assert [s["title"] for s in p["shows"]] == ["Show A", "Show B", "Show C"]

    # ₹30L does not fit in the ₹25L left; ₹20L does.
    r = show(founder, parent, "Show D", "3000000")
    assert r.status_code == 422 and "Only INR 2,500,000.00 is left" in r.json()["detail"]
    assert show(founder, parent, "Show D", "2000000").status_code == 201
    # Exactly the rest fills the deal to ₹1 Cr.
    assert show(founder, parent, "Show E", "500000").status_code == 201
    assert show(founder, parent, "Show F", "1").status_code == 422


def test_raising_a_show_or_lowering_the_deal_is_checked(founder):
    parent = make_parent(founder, owner(founder))
    a = show(founder, parent, "Show A", "6000000").json()
    show(founder, parent, "Show B", "3000000")

    body = deal_body(None, parent_id=parent["id"], title="Show A", term_start=str(START))
    body.update(term_end=str(END), owner_id=None)
    # Show A may go up to ₹70L (₹1 Cr − Show B's ₹30L), not beyond.
    assert founder.put(f"/api/deals/{a['id']}", json={**body, "fee_amount": "7000000"}).is_success
    r = founder.put(f"/api/deals/{a['id']}", json={**body, "fee_amount": "7000001"})
    assert r.status_code == 422

    # The deal cannot drop below the ₹1 Cr its shows now hold.
    r = founder.put(
        f"/api/parent-deals/{parent['id']}",
        json=parent_body(parent["owner_id"], amount="9000000"),
    )
    assert r.status_code == 422 and "cannot be less" in r.json()["detail"]
    r = founder.put(
        f"/api/parent-deals/{parent['id']}",
        json=parent_body(parent["owner_id"], amount="12000000", name="Sony 2026-27"),
    )
    assert r.status_code == 200 and r.json()["unallotted"] == "2000000.00"


def test_show_follows_the_deal_owner_type_and_dates(founder):
    sony = owner(founder, "Sony")
    zee = owner(founder, "Zee")
    parent = make_parent(founder, sony)

    # The owner is always the parent's, whatever the form sends.
    r = show(founder, parent, "Show A", "1000000", owner_id=zee)
    assert r.status_code == 201 and r.json()["owner_id"] == sony
    assert r.json()["parent_name"] == "Sony Package 2026"

    outside = show(founder, parent, "Late", "1", term_end=str(END + timedelta(days=1)))
    assert outside.status_code == 422 and "within the deal's term" in outside.json()["detail"]
    other_type = show(founder, parent, "Share", "1", deal_type="revenue_share")
    assert other_type.status_code == 422
    usd = show(founder, parent, "USD", "1", currency="USD")
    assert usd.status_code == 422

    # The deal's dates must keep covering its shows; a new owner reaches every show.
    r = founder.put(
        f"/api/parent-deals/{parent['id']}",
        json=parent_body(sony, term_end=str(END - timedelta(days=1))),
    )
    assert r.status_code == 422
    r = founder.put(f"/api/parent-deals/{parent['id']}", json=parent_body(zee))
    assert r.status_code == 200 and r.json()["shows"][0]["owner_name"] == "Zee"


def test_move_a_show_and_delete_only_an_empty_deal(founder):
    sony = owner(founder)
    first = make_parent(founder, sony)
    second = make_parent(founder, sony, name="Sony Package B", amount="1000000")
    a = show(founder, first, "Show A", "2000000").json()

    body = deal_body(None, title="Show A", fee_amount="2000000")
    body.update(term_start=str(START), term_end=str(END))
    # ₹20L does not fit in Package B's ₹10L.
    r = founder.put(f"/api/deals/{a['id']}", json={**body, "parent_id": second["id"]})
    assert r.status_code == 422
    r = founder.put(
        f"/api/deals/{a['id']}",
        json={**body, "parent_id": second["id"], "fee_amount": "1000000"},
    )
    assert r.status_code == 200 and r.json()["parent_id"] == second["id"]

    assert founder.delete(f"/api/parent-deals/{second['id']}").status_code == 409
    assert founder.delete(f"/api/parent-deals/{first['id']}").status_code == 204


def test_a_deal_without_parent_gets_its_own_and_it_follows_the_show(founder):
    oid = owner(founder)
    d = founder.post("/api/deals", json=deal_body(oid)).json()
    p = founder.get(f"/api/parent-deals/{d['parent_id']}").json()
    assert (p["name"], p["amount"], p["show_count"]) == ("The Kapil Sharma Show", "5000000.00", 1)

    # On its own, the show's fee can go up and the parent goes with it.
    r = founder.put(f"/api/deals/{d['id']}", json=deal_body(oid, fee_amount="6000000"))
    assert r.status_code == 200
    assert founder.get(f"/api/parent-deals/{d['parent_id']}").json()["amount"] == "6000000.00"


def test_list_search_finds_a_deal_by_its_show(founder):
    sony = owner(founder)
    parent = make_parent(founder, sony)
    show(founder, parent, "Taarak Mehta", "1000000")
    make_parent(founder, sony, name="Other package")

    names = lambda q: [  # noqa: E731
        p["name"] for p in founder.get(f"/api/parent-deals?q={q}").json()["items"]
    ]
    assert names("taarak") == ["Sony Package 2026"]
    assert sorted(names("sony")) == ["Other package", "Sony Package 2026"]


def test_partners_on_the_deal_share_every_show(founder):
    parent = make_parent(founder, owner(founder))
    a = show(founder, parent, "Show A", "4000000").json()
    vanshika = founder.post("/api/partners", json={"name": "Vanshika"}).json()["id"]
    r = founder.put(
        f"/api/parent-deals/{parent['id']}/partners",
        json={"partners": [{"partner_id": vanshika, "share_pct": "50"}]},
    )
    assert r.status_code == 200

    # Taggify's rights cost: half of the show's ₹40L, and half of the whole ₹1 Cr deal.
    assert founder.get(f"/api/deals/{a['id']}/economics").json()["rights_cost"] == "2000000.00"
    e = founder.get(f"/api/parent-deals/{parent['id']}/economics").json()
    assert e["rights_cost"] == "5000000.00" and e["profit"] == "-5000000.00"

    # Installments are paid per deal, not per show.
    r = founder.post(
        f"/api/parent-deals/{parent['id']}/installments",
        json={"due_date": str(TODAY), "amount": "10000000"},
    )
    assert r.status_code == 201
    e = founder.get(f"/api/parent-deals/{parent['id']}/economics").json()
    assert (e["installments_total"], e["warnings"]) == ("10000000.00", [])
