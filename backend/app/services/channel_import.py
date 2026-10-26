"""Add many channels at once from the founder's Excel or CSV.

Only the channel ID and name are needed (as in the New channel form). Everything else is
optional and never blocks a line:
  * no platform       → guessed from the ID (UC… = YouTube, digits = Facebook page),
  * CMS / manager not found, or not allowed → the channel is still added without it, with a note,
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
]
TEMPLATE_ROWS = [
    [
        "UCxxxxxxxxxxxxxxxxxxxxxx",
        "Kapil Comedy 01",
        "YouTube",
        "Giri CMS",
        "Ananya Sharma",
        "Active",
        "",
        "",
    ],
    ["UCyyyyyyyyyyyyyyyyyyyyyy", "CID Moments 01", "", "", "", "", "", "Only ID and name needed"],
]

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


def _platform(value: str, external_id: str) -> tuple[str, str | None]:
    v = value.lower().strip()
    if v in ("youtube", "yt", "you tube"):
        return "youtube", None
    if v in ("facebook", "fb", "meta"):
        return "facebook", None
    guess = "facebook" if external_id.isdigit() else "youtube"
    if v:
        return guess, f"Platform “{value}” not understood — taken as {guess.title()}."
    return guess, None


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
    missing = [
        label
        for key, label in (("external_id", "Channel ID"), ("name", "Channel name"))
        if key not in cols
    ]
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
        if not external_id:
            out.append(
                ImportLine(
                    line_no, "", name, "", result="error", notes=["No channel ID — line skipped."]
                )
            )
            continue
        platform, note = _platform(cell(cells, "platform"), external_id)
        if not name:
            out.append(
                ImportLine(
                    line_no,
                    external_id,
                    "",
                    platform,
                    result="error",
                    notes=["No channel name — line skipped."],
                )
            )
            continue
        row = ImportLine(line_no, external_id, name, platform)
        if note:
            row.notes.append(note)

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

        status = cell(cells, "status").lower()
        if status in ("inactive", "closed", "stopped", "terminated", "demonetized", "no"):
            row.status = "inactive"

        cms = None
        cms_name = cell(cells, "cms")
        if cms_name:
            cms = cms_by_name.get(cms_name.lower())
            if cms is None:
                row.notes.append(f"CMS “{cms_name}” is not in the tool — added without a CMS.")
            elif cms.platform != platform:
                row.notes.append(
                    f"{cms.name} is a {cms.platform.title()} CMS — added without a CMS."
                )
                cms = None
            elif not cms.is_active:
                row.notes.append(f"{cms.name} is inactive — added without a CMS.")
                cms = None
            else:
                row.cms = cms.name

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

        url = cell(cells, "url") or None
        if url and not url.startswith(("http://", "https://")):
            url = None
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
