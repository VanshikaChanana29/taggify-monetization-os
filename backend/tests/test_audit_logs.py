from datetime import UTC, datetime

from sqlalchemy import select

from app.models import AuditLog, Organization, User


def _add_logs(db, slug: str, entries: list[tuple[str, datetime, User | None]]) -> None:
    org = db.scalar(select(Organization).where(Organization.slug == slug))
    for action, at, user in entries:
        db.add(
            AuditLog(
                organization_id=org.id,
                user_id=user.id if user else None,
                action=action,
                created_at=at,
            )
        )
    db.commit()


def _at(day: int, hour: int, minute: int = 0) -> datetime:
    return datetime(2025, 1, day, hour, minute, tzinfo=UTC)


def test_pagination_returns_one_page_and_the_total(make_founder, login, db):
    make_founder("a@taggify.in")
    c = login("a@taggify.in")  # 1 auth.login entry
    _add_logs(db, "taggify", [("user.created", _at(1, 0, i), None) for i in range(29)])

    page3 = c.get("/api/audit-logs?page=3&page_size=10").json()
    page4 = c.get("/api/audit-logs?page=4&page_size=10").json()

    assert (page3["total"], page3["page"], page3["page_size"], len(page3["items"])) == (
        30,
        3,
        10,
        10,
    )
    assert page4["items"] == [] and page4["total"] == 30


def test_pages_do_not_overlap(make_founder, login, db):
    make_founder("a@taggify.in")
    c = login("a@taggify.in")
    # Many events in the same instant: ordering must still be stable across pages.
    _add_logs(db, "taggify", [("user.created", _at(1, 0), None) for _ in range(15)])

    ids = [
        item["id"]
        for page in (1, 2, 3, 4)
        for item in c.get(f"/api/audit-logs?page={page}&page_size=4").json()["items"]
    ]

    assert len(ids) == len(set(ids)) == 16


def test_page_size_is_capped(make_founder, login):
    make_founder("a@taggify.in")
    c = login("a@taggify.in")

    assert c.get("/api/audit-logs?page_size=101").status_code == 422
    assert c.get("/api/audit-logs?page=0").status_code == 422


def test_filter_by_actions_and_person(make_founder, login, db):
    asha = make_founder("a@taggify.in", name="Asha")
    ravi = make_founder("r@taggify.in", name="Ravi")
    c = login("a@taggify.in")
    _add_logs(
        db,
        "taggify",
        [
            ("auth.logout", _at(2, 10), ravi),
            ("auth.login_failed", _at(2, 11), ravi),
            ("user.created", _at(2, 12), asha),
        ],
    )

    logins = c.get("/api/audit-logs?action=auth.login&action=auth.logout").json()["items"]
    by_ravi = c.get(f"/api/audit-logs?user_id={ravi.id}").json()["items"]

    assert sorted(i["action"] for i in logins) == ["auth.login", "auth.logout"]
    assert sorted(i["action"] for i in by_ravi) == ["auth.login_failed", "auth.logout"]


def test_date_range_uses_company_timezone(make_founder, login, db):
    make_founder("a@taggify.in")
    c = login("a@taggify.in")
    _add_logs(
        db,
        "taggify",
        [
            ("user.created", _at(14, 18, 0), None),  # 14 Jan 23:30 IST
            ("user.activated", _at(14, 19, 0), None),  # 15 Jan 00:30 IST
            ("user.deactivated", _at(15, 18, 0), None),  # 15 Jan 23:30 IST
            ("user.password_reset", _at(15, 19, 0), None),  # 16 Jan 00:30 IST
        ],
    )

    items = c.get("/api/audit-logs?date_from=2025-01-15&date_to=2025-01-15").json()["items"]

    assert sorted(i["action"] for i in items) == ["user.activated", "user.deactivated"]


def test_sort_oldest_first(make_founder, login, db):
    make_founder("a@taggify.in")
    c = login("a@taggify.in")
    _add_logs(
        db, "taggify", [("user.created", _at(3, 9), None), ("user.activated", _at(3, 8), None)]
    )

    newest = c.get("/api/audit-logs").json()["items"]
    oldest = c.get("/api/audit-logs?sort=oldest").json()["items"]

    assert newest[0]["action"] == "auth.login"
    assert [i["action"] for i in oldest] == ["user.activated", "user.created", "auth.login"]


def test_actors_only_from_own_company(make_founder, login):
    make_founder("a@taggify.in", name="Asha", org_slug="taggify")
    make_founder("b@sociodoor.in", name="Bina", org_slug="sociodoor")
    taggify = login("a@taggify.in")
    login("b@sociodoor.in")

    actors = taggify.get("/api/audit-logs/actors").json()

    assert [a["name"] for a in actors] == ["Asha"]
