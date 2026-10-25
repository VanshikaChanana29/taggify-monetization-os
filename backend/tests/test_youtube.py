"""YouTube channels connected from owners' permission files, the daily sync and performance.

Google is replaced by a fake: tokens are matched to channels only by the channel ID that
"YouTube" reports for them.
"""

import io
import json
import zipfile
from datetime import date, timedelta

import pytest
from sqlalchemy import select

from app.models import ChannelDailyStat, RevenueFact, YouTubeConnection, YouTubeSnapshot
from app.services import youtube_api
from tests.test_channels_people import channel, cms
from tests.test_finance import TIERS
from tests.test_payouts import founder  # noqa: F401

A = "UCaaaaaaaaaaaaaaaaaaaaaa"  # named file, token may read channel details
B = "UCbbbbbbbbbbbbbbbbbbbbbb"  # UC….json file, analytics only
C = "UCcccccccccccccccccccccc"  # not in the company
REVENUE = youtube_api.REVENUE_SCOPE
DETAILS = youtube_api.CHANNEL_SCOPE
TODAY = date.today()
DAY = TODAY - timedelta(days=3)


def token(refresh: str, scopes: list[str]) -> bytes:
    return json.dumps(
        {
            "token": "short-lived",
            "refresh_token": refresh,
            "client_id": "app.apps.googleusercontent.com",
            "client_secret": "s3cret",
            "token_uri": "https://oauth2.googleapis.com/token",
            "scopes": scopes,
        }
    ).encode()


class FakeGoogle:
    """refresh token "r-<channel id>" belongs to that channel; "dead…" is expired."""

    def __init__(self):
        self.revenue = {A: 12.345, B: 3.0}
        self.calls = 0

    def refresh(self, token_uri, client_id, client_secret, refresh_token):
        assert client_secret == "s3cret"
        if refresh_token.startswith("dead"):
            raise youtube_api.TokenDead(400, "invalid_grant")
        return "acc-" + refresh_token[2:]

    def my_channel(self, access):
        cid = access[4:]
        return {"id": cid, "title": f"YT {cid[:4]}", "subscribers": 1000, "videos": 50}

    def channel_report(self, access, channel_id, start, end):
        if access[4:] != channel_id:
            raise youtube_api.GoogleError(403, "Forbidden")
        self.calls += 1
        rows, d = [], start
        while d <= end:
            rows.append([d.isoformat(), self.revenue.get(channel_id, 1.0), 1000, 600, 5, 1])
            d += timedelta(days=1)
        return {"columnHeaders": [], "rows": rows}


@pytest.fixture
def google(monkeypatch):
    fake = FakeGoogle()
    for name in ("refresh", "my_channel", "channel_report"):
        monkeypatch.setattr(youtube_api, name, getattr(fake, name))
    return fake


def zip_of(files: dict[str, bytes]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for name, content in files.items():
            zf.writestr(name, content)
    return buf.getvalue()


@pytest.fixture
def channels(founder):  # noqa: F811
    cms_a = cms(founder, "CMS A")
    founder.post(
        f"/api/cms-partners/{cms_a}/fee-schedules",
        json={
            "effective_from": "2020-01-01",
            "tier_type": "whole",
            "currency": "USD",
            "tiers": TIERS,
        },
    )
    return {
        "a": channel(founder, "Hasi Ki Gufa", external_id=A, cms_id=cms_a),
        "b": channel(founder, "CID Heroes", external_id=B, cms_id=cms_a),
        "cms": cms_a,
    }


def upload(c, content: bytes, name="api keys.zip", fetch_from=None):
    data = {"fetch_from": str(fetch_from)} if fetch_from else {}
    r = c.post("/api/youtube/tokens", files=[("files", (name, content))], data=data)
    assert r.status_code == 200, r.text
    return r.json()


def test_zip_connects_only_this_companys_channels(founder, channels, google, db):  # noqa: F811
    content = zip_of(
        {
            "api keys/token_Hasi_Ki_Gufa.json": token(f"r-{A}", [REVENUE, DETAILS]),
            f"api keys/{B}.json": token(f"r-{B}", [REVENUE]),
            "api keys/token_Someone_Else.json": token(f"r-{C}", [REVENUE, DETAILS]),
            "api keys/token_Dead.json": token("dead", [REVENUE, DETAILS]),
            "api keys/token_sheet.json": token(
                "r-x", ["https://www.googleapis.com/auth/spreadsheets"]
            ),
            "api keys/token_Hasi_copy.json": token(f"r-{A}", [REVENUE, DETAILS]),
            "__MACOSX/api keys/._token_Hasi_Ki_Gufa.json": b"junk",
            "api keys/readme.txt": b"not a token",
        }
    )
    out = upload(founder, content)
    by_file = {r["file"]: r for r in out["rows"]}
    assert (out["connected"], out["not_in_company"], out["unusable"], out["duplicates"]) == (
        2,
        1,
        2,
        1,
    )
    assert by_file["token_Hasi_Ki_Gufa.json"]["channel_name"] == "Hasi Ki Gufa"
    assert by_file[f"{B}.json"]["result"] == "connected"
    assert by_file["token_Someone_Else.json"]["result"] == "not_in_company"
    assert "Allow again" in by_file["token_Dead.json"]["message"]
    assert "cannot read YouTube revenue" in by_file["token_sheet.json"]["message"]
    assert out["sync_started"] is True

    conns = list(db.scalars(select(YouTubeConnection)))
    assert {c.google_channel_id for c in conns} == {A, B}  # nothing saved for C
    assert all("r-UC" not in c.refresh_token_enc and c.client_secret_enc != "s3cret" for c in conns)
    a = next(c for c in conns if c.google_channel_id == A)
    assert (a.subscribers, a.videos) == (1000, 50)

    # The upload started a sync from the 1st of this month (background task in the test client).
    first = TODAY.replace(day=1)
    if first <= TODAY - timedelta(days=1):
        facts = list(db.scalars(select(RevenueFact).where(RevenueFact.channel_id == channels["a"])))
        assert facts and all(f.source == "youtube" and f.state == "provisional" for f in facts)
        assert min(f.day for f in facts) == first


def test_same_zip_again_updates_and_never_duplicates(founder, channels, google, db):  # noqa: F811
    content = zip_of({"token_Hasi_Ki_Gufa.json": token(f"r-{A}", [REVENUE, DETAILS])})
    assert upload(founder, content)["connected"] == 1
    again = upload(founder, content)
    assert (again["connected"], again["updated"]) == (0, 1)
    assert len(list(db.scalars(select(YouTubeConnection)))) == 1


def test_uc_file_must_really_be_that_channel(founder, channels, google):  # noqa: F811
    # File named after B, but the token is A's: YouTube refuses, nothing is connected.
    out = upload(founder, token(f"r-{A}", [REVENUE]), name=f"{B}.json")
    assert out["unusable"] == 1 and "not for that channel" in out["rows"][0]["message"]
    # A token without the details permission and without the ID as its name cannot be placed.
    out = upload(founder, token(f"r-{A}", [REVENUE]), name="token_Hasi.json")
    assert "Cannot tell which channel" in out["rows"][0]["message"]


def test_one_channel_page_upload_checks_the_id(founder, channels, google):  # noqa: F811
    r = founder.post(
        f"/api/channels/{channels['b']}/youtube-token",
        files={"file": ("token_Hasi_Ki_Gufa.json", token(f"r-{A}", [REVENUE, DETAILS]))},
    )
    assert r.status_code == 422 and "not CID Heroes" in r.json()["detail"]
    r = founder.post(
        f"/api/channels/{channels['a']}/youtube-token",
        files={"file": ("token_Hasi_Ki_Gufa.json", token(f"r-{A}", [REVENUE, DETAILS]))},
    )
    assert r.status_code == 200 and r.json()["connected"] == 1
    yt = founder.get(f"/api/channels/{channels['a']}/youtube").json()
    assert yt["status"] == "ok" and yt["youtube_title"] == "YT UCaa"
    assert founder.delete(f"/api/channels/{channels['a']}/youtube-token").status_code == 204
    assert founder.get(f"/api/channels/{channels['a']}/youtube").json()["status"] == "not_connected"


def test_identify_fills_the_new_channel_form(founder, google):  # noqa: F811
    r = founder.post(
        "/api/youtube/identify",
        files={"file": ("x.json", token(f"r-{A}", [REVENUE, DETAILS]))},
    )
    assert r.json() == {"channel_id": A, "title": "YT UCaa"}


def test_sync_saves_estimates_and_never_touches_final_or_closed(founder, channels, google, db):  # noqa: F811
    upload(founder, zip_of({"token_Hasi_Ki_Gufa.json": token(f"r-{A}", [REVENUE, DETAILS])}))
    start, end = DAY - timedelta(days=2), DAY
    r = founder.post("/api/youtube/sync", json={"start": str(start), "end": str(end)})
    assert r.status_code == 202, r.text

    facts = {
        f.day: f
        for f in db.scalars(select(RevenueFact).where(RevenueFact.channel_id == channels["a"]))
    }
    assert str(facts[DAY].gross_amount) == "12.35"  # 12.345 rounded to cents
    assert facts[DAY].views == 1000 and facts[DAY].currency == "USD"
    stat = db.scalar(
        select(ChannelDailyStat).where(
            ChannelDailyStat.channel_id == channels["a"], ChannelDailyStat.day == DAY
        )
    )
    assert (stat.watch_minutes, stat.subscribers_gained, stat.subscribers_lost) == (600, 5, 1)
    assert db.scalars(select(YouTubeSnapshot)).first() is not None

    # Same days again: updated in place, still one row per day.
    google.revenue[A] = 20
    founder.post("/api/youtube/sync", json={"start": str(start), "end": str(end)})
    db.expire_all()
    rows = list(
        db.scalars(
            select(RevenueFact).where(
                RevenueFact.channel_id == channels["a"], RevenueFact.day == DAY
            )
        )
    )
    assert len(rows) == 1 and str(rows[0].gross_amount) == "20.00"

    # A final (CMS sheet) figure on the 1st of a month protects the whole month.
    month = DAY.replace(day=1)
    for f in db.scalars(
        select(RevenueFact).where(RevenueFact.channel_id == channels["a"], RevenueFact.day >= month)
    ):
        db.delete(f)
    db.commit()
    db.add(
        RevenueFact(
            organization_id=rows[0].organization_id,
            channel_id=channels["a"],
            day=month,
            gross_amount=500,
            currency="USD",
            state="final",
            source="cms_sheet",
        )
    )
    db.commit()
    founder.post("/api/youtube/sync", json={"start": str(start), "end": str(end)})
    db.expire_all()
    in_month = list(
        db.scalars(
            select(RevenueFact).where(
                RevenueFact.channel_id == channels["a"], RevenueFact.day >= month
            )
        )
    )
    assert [(f.day, f.state) for f in in_month] == [(month, "final")]


def test_expired_permission_shows_on_settings(founder, channels, google, db):  # noqa: F811
    upload(founder, zip_of({f"{B}.json": token(f"r-{B}", [REVENUE])}))
    conn = db.scalar(select(YouTubeConnection))
    from app.services.youtube_tokens import encrypt

    conn.refresh_token_enc = encrypt("dead-now")
    db.commit()
    founder.post("/api/youtube/sync", json={})
    out = founder.get("/api/youtube/connections").json()
    rows = {r["channel_name"]: r for r in out["rows"]}
    assert rows["CID Heroes"]["status"] == "expired"
    assert rows["Hasi Ki Gufa"]["status"] == "not_connected"
    assert (out["expired"], out["not_connected"]) == (1, 1)


def test_scheduler_needs_the_secret(client, google):
    assert client.post("/api/internal/youtube-sync").status_code == 401
    r = client.post("/api/internal/youtube-sync", headers={"X-Sync-Secret": "wrong"})
    assert r.status_code == 401
    r = client.post("/api/internal/youtube-sync", headers={"X-Sync-Secret": "test-sync-secret"})
    assert r.status_code == 202


def test_performance_ranks_channels(founder, channels, google):  # noqa: F811
    upload(
        founder,
        zip_of(
            {
                "token_Hasi_Ki_Gufa.json": token(f"r-{A}", [REVENUE, DETAILS]),
                f"{B}.json": token(f"r-{B}", [REVENUE]),
            }
        ),
    )
    start = DAY - timedelta(days=9)
    founder.post(
        "/api/youtube/sync", json={"start": str(start - timedelta(days=10)), "end": str(DAY)}
    )
    page = founder.get(f"/api/channels?start={start}&end={DAY}&sort=revenue&direction=desc")
    rows = page.json()["items"]
    assert [r["name"] for r in rows] == ["Hasi Ki Gufa", "CID Heroes"]  # by revenue
    hasi = rows[0]
    m = hasi["metrics"]
    assert m["views"] == 10_000 and m["watch_hours"] == "100.0"
    assert m["subscribers_net"] == 40 and hasi["subscribers"] == 1000
    assert m["rpm"] == "12.35" and m["revenue_change_pct"] == "0.0"
    assert m["estimate_share_pct"] == "100" and hasi["youtube_status"] == "ok"

    connected = founder.get("/api/channels?youtube=connected").json()["total"]
    assert connected == 2
    assert founder.get("/api/channels?youtube=not_connected").json()["total"] == 0

    dash = founder.get(f"/api/dashboard/channels?month={DAY:%Y-%m}").json()
    assert dash["top"][0]["name"] == "Hasi Ki Gufa" and dash["connected"] == 2
    assert dash["daily"] and dash["daily"][-1]["views"] == 2000  # both channels, one day
    assert {s["label"] for s in dash["share_by"]["cms"]} == {"CMS A"}
    assert dash["share_by"]["team"][0]["label"] == "No team"
    assert [r["name"] for r in dash["rows"]] == ["Hasi Ki Gufa", "CID Heroes"]
    assert sum(float(r["share_pct"]) for r in dash["rows"]) == 100.0

    ranged = founder.get(f"/api/dashboard/channels?start={start}&end={DAY}").json()
    assert (ranged["start"], ranged["end"]) == (str(start), str(DAY))
    assert ranged["rows"][0]["views"] == 10_000  # 10 days for the first channel


def test_connections_are_company_scoped(founder, channels, google, make_founder, login):  # noqa: F811
    upload(founder, zip_of({"token_Hasi_Ki_Gufa.json": token(f"r-{A}", [REVENUE, DETAILS])}))
    make_founder("b@sociodoor.in", org_slug="sociodoor")
    other = login("b@sociodoor.in")
    channel(other, "Same Channel Elsewhere", external_id=A)
    out = upload(other, zip_of({"token_Hasi_Ki_Gufa.json": token(f"r-{A}", [REVENUE, DETAILS])}))
    assert out["elsewhere"] == 1 and out["connected"] == 0
    assert other.get("/api/youtube/connections").json()["connected"] == 0
    assert other.get(f"/api/channels/{channels['a']}/youtube").status_code == 404
