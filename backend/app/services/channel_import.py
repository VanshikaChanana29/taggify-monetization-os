"""Add many channels at once from the founder's Excel or CSV.

Every column of the template is required except Manager and Notes (founders' rule, as in the
New channel form): Channel ID, Channel name, Platform, CMS, Status and Link. A line missing
one of them, or with a CMS / platform / status the tool does not know, is skipped with the
reason. Optional columns never block a line:
  * manager not found, or not allowed → the channel is still added without one, with a note,
  * partner not found → added as Taggify's own channel, with a note,
  * already in the tool, or twice in the file → skipped, nothing is changed.

Columns are recognised by their header, in any order, with common spellings (see FIELDS).
"""

import re
import uuid
from dataclasses import dataclass, field
from datetime import date, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Channel, CmsPartner, DealPartner, Employee, Organization
from app.services.assignments import AssignmentError, set_manager
from app.services.cms_sheet import Table, _norm, _text
from app.services.deals import company_today
from app.services.month_close import MonthClosedError, ensure_open

FIELDS: dict[str, tuple[str, ...]] = {
    "external_id": (
        "channel id",
        "channel_id",
        "id",
        "youtube channel id",
        "youtube id",
        "page id",
        "facebook page id",
        "external id",
        "uc id",
    ),
    "name": ("channel name", "name", "channel", "title", "channel title", "page name"),
    "platform": ("platform", "type"),
    "cms": ("cms", "cms partner", "cms name", "network"),
    "manager": (
        "manager",
        "manager name",
        "manager email",
        "channel manager",
        "managed by",
        "employee",
    ),
    "manager_from": ("manager from", "manager since", "start date"),
    "status": ("status",),
    "url": ("link", "url", "channel link", "channel url"),
    "notes": ("notes", "remarks", "comment", "comments"),
    "partner": ("partner", "deal partner", "owned by", "partner name"),
}

TEMPLATE_HEADERS = [
    "Channel ID",
    "Channel name",
    "Platform",
    "CMS",
    "Manager",
    "Status",
    "Link",
    "Notes",
    "Partner",
]
TEMPLATE_ROWS = [
    [
        "UCxxxxxxxxxxxxxxxxxxxxxx",
        "Kapil Comedy 01",
        "YouTube",
        "Giri CMS",
        "Ananya Sharma",
        "Active",
        "https://www.youtube.com/channel/UCxxxxxxxxxxxxxxxxxxxxxx",
        "",
        "",
    ],
    [
        "UCyyyyyyyyyyyyyyyyyyyyyy",
        "CID Moments 01",
        "YouTube",
        "Giri CMS",
        "",
        "Active",
        "https://www.youtube.com/channel/UCyyyyyyyyyyyyyyyyyyyyyy",
        "Manager, Notes and Partner can be left empty",
        "",
    ],
]

# Required columns, in the template's order (Manager and Notes are optional).
REQUIRED: tuple[tuple[str, str], ...] = (
    ("external_id", "Channel ID"),
    ("name", "Channel name"),
    ("platform", "Platform"),
    ("cms", "CMS"),
    ("status", "Status"),
    ("url", "Link"),
)
ACTIVE = ("active", "live", "yes")
INACTIVE = ("inactive", "closed", "stopped", "terminated", "demonetized", "no")

UC_ID = re.compile(r"(UC[0-9A-Za-z_-]{22})")


@dataclass
class ImportLine:
    line: int
    external_id: str
    name: str
    platform: str
    cms: str | None = None
    manager: str | None = None
    partner: str | None = None
    status: str = "active"
    result: str = "new"  # new | exists | duplicate | error
    notes: list[str] = field(default_factory=list)
    channel_id: uuid.UUID | None = None


@dataclass
class ImportResult:
    lines: list[ImportLine]
    missing_columns: list[str]

    def count(self, result: str) -> int:
        return sum(1 for line in self.lines if line.result == result)


def _columns(table: Table) -> dict[str, int]:
    found: dict[str, int] = {}
    for i, header in enumerate(table.headers):
        h = _norm(header)
        for key, names in FIELDS.items():
            if key not in found and h in names:
                found[key] = i
    return found


def _platform(value: str) -> str | None:
    v = value.lower().strip()
    if v in ("youtube", "yt", "you tube"):
        return "youtube"
    if v in ("facebook", "fb", "meta"):
        return "facebook"
    return None


def _clean_id(value: str) -> str:
    """Accept a full channel link as well as the bare ID."""
    m = UC_ID.search(value)
    return m.group(1) if m else value.strip()


def _day(value: object) -> date | None:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    text = _text(value)
    for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y"):
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    return None


def import_channels(db: Session, org: Organization, table: Table, *, commit: bool) -> ImportResult:
    cols = _columns(table)
    missing = [label for key, label in REQUIRED if key not in cols]
    if missing:
        return ImportResult([], missing)

    partners_by_name = {
        p.name.lower(): p
        for p in db.scalars(select(DealPartner).where(DealPartner.organization_id == org.id))
    }
    cms_by_name = {
        c.name.lower(): c
        for c in db.scalars(select(CmsPartner).where(CmsPartner.organization_id == org.id))
    }
    people = list(db.scalars(select(Employee).where(Employee.organization_id == org.id)))
    existing = set(
        db.execute(
            select(Channel.platform, Channel.external_id).where(Channel.organization_id == org.id)
        ).all()
    )
    today = company_today(org)
    seen: set[tuple[str, str]] = set()
    out: list[ImportLine] = []

    def cell(cells: list[object], key: str) -> str:
        i = cols.get(key)
        return _text(cells[i]) if i is not None and i < len(cells) else ""

    for line_no, cells in table.rows:
        if not any(_text(c) for c in cells):
            continue
        external_id = _clean_id(cell(cells, "external_id"))
        name = cell(cells, "name")
        platform_text = cell(cells, "platform")
        platform = _platform(platform_text)
        row = ImportLine(line_no, external_id, name, platform or "")

        # Required columns first: a line missing any of them is skipped, with every reason.
        problems: list[str] = []
        if not external_id:
            problems.append("No channel ID.")
        if not name:
            problems.append("No channel name.")
        if not platform_text:
            problems.append("No platform (YouTube or Facebook).")
        elif platform is None:
            problems.append(f"Platform “{platform_text}” not understood — use YouTube or Facebook.")

        cms = None
        cms_name = cell(cells, "cms")
        if not cms_name:
            problems.append("No CMS.")
        else:
            cms = cms_by_name.get(cms_name.lower())
            if cms is None:
                problems.append(f"CMS “{cms_name}” is not in the tool — add it in CMS & Finance.")
            elif platform and cms.platform != platform:
                problems.append(f"{cms.name} is a {cms.platform.title()} CMS.")
            elif not cms.is_active:
                problems.append(f"{cms.name} is inactive.")
            else:
                row.cms = cms.name

        status = cell(cells, "status").lower()
        if not status:
            problems.append("No status (Active or Inactive).")
        elif status in INACTIVE:
            row.status = "inactive"
        elif status not in ACTIVE:
            problems.append(
                f"Status “{cell(cells, 'status')}” not understood — use Active or Inactive."
            )

        url = cell(cells, "url")
        if not url:
            problems.append("No link.")
        elif not url.startswith(("http://", "https://")):
            problems.append("Link must start with https://")

        if problems:
            row.result = "error"
            row.cms = None
            row.notes = [*problems, "Line skipped."]
            out.append(row)
            continue

        assert platform is not None  # checked above
        key = (platform, external_id)
        if key in existing:
            row.result = "exists"
            row.notes = ["Already in the tool — left as it is."]
            out.append(row)
            continue
        if key in seen:
            row.result = "duplicate"
            row.notes = ["Same ID earlier in the file — skipped."]
            out.append(row)
            continue
        seen.add(key)

        manager = None
        who = cell(cells, "manager")
        if who:
            w = who.lower()
            matches = [
                p for p in people if p.full_name.lower() == w or (p.email or "").lower() == w
            ]
            if len(matches) != 1:
                why = "matches more than one person" if matches else "is not in People"
                row.notes.append(f"Manager “{who}” {why} — added without a manager.")
            elif not matches[0].is_active:
                row.notes.append(f"{matches[0].full_name} is inactive — added without a manager.")
            elif not matches[0].role.can_manage(platform):
                row.notes.append(
                    f"{matches[0].full_name}'s role cannot manage {platform.title()}"
                    " — added without a manager."
                )
            else:
                manager = matches[0]
                row.manager = manager.full_name

        partner = None
        partner_name = cell(cells, "partner")
        if partner_name:
            partner = partners_by_name.get(partner_name.lower())
            if partner is None:
                row.notes.append(
                    f"Partner “{partner_name}” is not in the tool — added as a Taggify channel."
                )
            else:
                row.partner = partner.name

        notes = cell(cells, "notes") or None
        out.append(row)

        if not commit:
            continue
        channel = Channel(
            organization_id=org.id,
            platform=platform,
            name=row.name[:200],
            external_id=external_id[:100],
            url=url,
            cms_partner_id=cms.id if cms else None,
            partner_id=partner.id if partner else None,
            status=row.status,
            notes=notes,
        )
        db.add(channel)
        db.flush()
        row.channel_id = channel.id
        if manager:
            since = (
                _day(cells[cols["manager_from"]])
                if "manager_from" in cols and cols["manager_from"] < len(cells)
                else None
            )
            since = since if since and since <= today else today
            try:
                ensure_open(db, org, since, "This handover")
                set_manager(db, channel, manager, effective=since, today=today)
            except (AssignmentError, MonthClosedError) as exc:
                try:
                    set_manager(db, channel, manager, effective=today, today=today)
                    row.notes.append(f"Manager from today ({exc}).")
                except AssignmentError as again:
                    row.manager = None
                    row.notes.append(f"Added without a manager: {again}")

    return ImportResult(out, [])
