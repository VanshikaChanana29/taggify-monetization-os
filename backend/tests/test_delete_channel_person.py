"""Deleting a channel or a person added by mistake; anything with history must stay."""

from tests.test_channels_people import channel, employee, founder, post, team  # noqa: F401
from tests.test_finance import LAST, upload


def test_unused_channel_is_deleted(founder):  # noqa: F811
    cid = channel(founder, "Added by mistake", external_id="UCMISTAKE")
    ananya = employee(founder, "Ananya")
    post(founder, f"/api/channels/{cid}/manager", employee_id=ananya, effective_date=str(LAST))

    assert founder.delete(f"/api/channels/{cid}").status_code == 204
    assert founder.get(f"/api/channels/{cid}").status_code == 404
    log = founder.get("/api/audit-logs").json()["items"]
    assert any(x["action"] == "channel.deleted" for x in log)


def test_channel_with_revenue_stays(founder):  # noqa: F811
    cid = channel(founder, "Earning", external_id="UCEARN")
    r = upload(founder, f"date,channel_id,gross_revenue,currency\n{LAST},UCEARN,10,USD")
    assert r.status_code == 201, r.text
    r = founder.delete(f"/api/channels/{cid}")
    assert r.status_code == 409 and "1 revenue row" in r.json()["detail"]
    assert founder.get(f"/api/channels/{cid}").status_code == 200


def test_unused_person_is_deleted_but_a_manager_stays(founder):  # noqa: F811
    t = team(founder, "Comedy")
    extra = employee(founder, "Added by mistake", team_id=t)
    assert founder.delete(f"/api/employees/{extra}").status_code == 204
    assert founder.get(f"/api/employees/{extra}").status_code == 404

    ananya = employee(founder, "Ananya")
    cid = channel(founder, "Hers", external_id="UCHERS")
    post(founder, f"/api/channels/{cid}/manager", employee_id=ananya, effective_date=str(LAST))
    r = founder.delete(f"/api/employees/{ananya}")
    assert r.status_code == 409 and "channel managed" in r.json()["detail"]


def test_delete_is_per_company(make_founder, login, founder):  # noqa: F811
    cid = channel(founder, "Ours", external_id="UCOURS")
    make_founder("s@sociodoor.in", org_slug="sociodoor")
    assert login("s@sociodoor.in").delete(f"/api/channels/{cid}").status_code == 404
