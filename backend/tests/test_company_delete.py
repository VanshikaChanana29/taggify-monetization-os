from datetime import timedelta

import pytest
from fastapi.testclient import TestClient

from app.main import app
from tests.conftest import PASSWORD
from tests.test_channels_people import channel, employee, post
from tests.test_finance import LAST, MONTH, TODAY
from tests.test_partners import (
    setup,  # noqa: F401  (a company with a deal, partner, channels, revenue)
)


@pytest.fixture
def founder(make_founder, login):
    make_founder("a@taggify.in", name="Asha")
    return login("a@taggify.in")


def test_super_admin_deletes_a_whole_company_after_typing_its_name(
    founder,
    setup,  # noqa: F811
    make_founder,
    make_superadmin,
    login,
):
    # Give the company an approved incentive run too (its lines block deleting people/channels).
    ananya = employee(founder, "Ananya")
    post(
        founder,
        f"/api/channels/{setup['ours']}/manager",
        employee_id=ananya,
        effective_date=str(LAST),
    )
    founder.post(
        f"/api/employees/{ananya}/incentive-rates",
        json={"kind": "manager", "rate_pct": "1", "effective_from": str(LAST)},
    )
    assert founder.post("/api/finance/incentives/compute", json={"month": MONTH}).status_code == 200
    founder.post(
        f"/api/partners/{setup['vanshika']}/payouts",
        json={"month": MONTH, "amount": "1", "paid_on": str(TODAY - timedelta(days=1))},
    )

    make_founder("s@sociodoor.in", org_slug="sociodoor")
    other = login("s@sociodoor.in")
    keep = channel(other, "Socio channel")

    make_superadmin()
    admin = login("admin@taggify.in")
    org = next(o for o in admin.get("/api/admin/organizations").json() if o["slug"] == "taggify")

    check = admin.get(f"/api/admin/organizations/{org['id']}/delete-check").json()
    assert check["counts"]["channels"] == 2 and check["counts"]["deals"] == 1
    assert check["counts"]["founders"] == 1 and check["is_current"] is False

    url = f"/api/admin/organizations/{org['id']}"
    assert admin.request("DELETE", url, json={"confirm_name": "taggify"}).status_code == 422
    assert admin.request("DELETE", url, json={"confirm_name": org["name"]}).status_code == 204

    slugs = {o["slug"] for o in admin.get("/api/admin/organizations").json()}
    assert slugs == {"sociodoor"}
    # The other company is untouched; the deleted company's founder can no longer log in.
    assert other.get(f"/api/channels/{keep}").status_code == 200
    r = TestClient(app).post(
        "/api/auth/login", json={"email": "a@taggify.in", "password": PASSWORD}
    )
    assert r.status_code == 401


def test_founders_cannot_delete_companies(founder):
    org_id = founder.get("/api/auth/me").json()["organization"]["id"]
    r = founder.request(
        "DELETE", f"/api/admin/organizations/{org_id}", json={"confirm_name": "Taggify"}
    )
    assert r.status_code == 403
