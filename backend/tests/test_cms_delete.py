from tests.test_channels_people import channel, cms, founder  # noqa: F401
from tests.test_finance import schedule


def test_unused_cms_is_deleted_with_its_slabs(founder):  # noqa: F811
    cms_id = cms(founder, "Added by mistake")
    schedule(founder, cms_id)

    assert founder.delete(f"/api/cms-partners/{cms_id}").status_code == 204

    assert founder.get("/api/cms-partners").json() == []
    log = founder.get("/api/audit-logs").json()["items"]
    assert any(i["action"] == "cms.deleted" for i in log)


def test_cms_with_channels_cannot_be_deleted(founder):  # noqa: F811
    cms_id = cms(founder)
    channel(founder, cms_id=cms_id)

    r = founder.delete(f"/api/cms-partners/{cms_id}")

    assert r.status_code == 409
    assert "1 channel" in r.json()["detail"]
    assert "Move its channels" in r.json()["detail"]
    assert len(founder.get("/api/cms-partners").json()) == 1


def test_other_companys_cms_is_not_found(founder, make_founder, login):  # noqa: F811
    cms_id = cms(founder)
    make_founder("b@sociodoor.in", org_slug="sociodoor")
    other = login("b@sociodoor.in")

    assert other.delete(f"/api/cms-partners/{cms_id}").status_code == 404
