"""Revenue CSV import (PDF slide 16, step 1) until YouTube/Meta APIs arrive in Part 6.

Columns (header names are case-insensitive, extra columns are ignored):
    date           2026-10-01 (also 01-10-2026 or 01/10/2026)
    channel_id     YouTube channel ID or Facebook page ID, as saved on the channel
    platform       youtube / facebook — optional when the ID is unique
    gross_revenue  12000.50 (commas and currency symbols are ignored)
    currency       USD
    views          optional
    state          provisional / final — optional, default provisional

Each (channel, date) keeps one row: importing it again updates it.
"""

import csv
import io
import uuid
from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal, InvalidOperation

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Channel, RevenueFact, RevenueImport

TEMPLATE = (
    "date,channel_id,platform,gross_revenue,currency,views,state\n"
    "2026-10-01,UCkapilcomedy01,youtube,412.50,USD,1200000,provisional\n"
    "2026-10-01,1029384756,facebook,88.00,USD,350000,provisional\n"
)

MAX_ROWS = 50_000
MAX_ERRORS_KEPT = 200
DATE_FORMATS = ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y")


@dataclass
class ImportOutcome:
    record: RevenueImport
    errors: list[dict] = field(default_factory=list)


def _date(value: str) -> date:
    for fmt in DATE_FORMATS:
        try:
            return datetime.strptime(value.strip(), fmt).date()
        except ValueError:
            continue
    raise ValueError(f"'{value}' is not a date (use YYYY-MM-DD)")


def _amount(value: str) -> Decimal:
    cleaned = value.strip().replace(",", "").replace("$", "").replace("₹", "")
    try:
        amount = Decimal(cleaned)
    except InvalidOperation as exc:
        raise ValueError(f"'{value}' is not an amount") from exc
    if amount < 0:
        raise ValueError("gross_revenue cannot be negative")
    return amount.quantize(Decimal("0.01"))


def import_revenue(
    db: Session,
    organization_id: uuid.UUID,
    user_id: uuid.UUID | None,
    file_name: str,
    content: bytes,
    today: date,
) -> ImportOutcome:
    text = content.decode("utf-8-sig", errors="replace")
    reader = csv.DictReader(io.StringIO(text))
    headers = {h.strip().lower(): h for h in (reader.fieldnames or [])}
    missing = [h for h in ("date", "channel_id", "gross_revenue", "currency") if h not in headers]

    record = RevenueImport(
        organization_id=organization_id,
        uploaded_by_id=user_id,
        file_name=file_name,
        rows_total=0,
        rows_created=0,
        rows_updated=0,
        rows_failed=0,
        errors=[],
    )
    db.add(record)
    errors: list[dict] = []
    if missing:
        errors.append({"line": 1, "message": f"Missing column(s): {', '.join(missing)}"})
        record.errors = errors
        record.rows_failed = 0
        db.flush()
        return ImportOutcome(record, errors)

    channels = db.scalars(select(Channel).where(Channel.organization_id == organization_id)).all()
    by_key = {(c.platform, c.external_id): c for c in channels}
    by_id: dict[str, list[Channel]] = {}
    for c in channels:
        by_id.setdefault(c.external_id, []).append(c)

    seen: set[tuple[uuid.UUID, date]] = set()
    parsed: list[tuple[int, Channel, dict]] = []
    for line, row in enumerate(reader, start=2):
        if line - 1 > MAX_ROWS:
            errors.append({"line": line, "message": f"Only the first {MAX_ROWS} rows are imported"})
            break

        def get(name: str, row: dict = row) -> str:
            return (row.get(headers.get(name, ""), "") or "").strip()

        if not any((v or "").strip() for v in row.values() if isinstance(v, str)):
            continue
        record.rows_total += 1
        try:
            day = _date(get("date"))
            if day > today:
                raise ValueError("date is in the future")
            external_id = get("channel_id")
            if not external_id:
                raise ValueError("channel_id is empty")
            platform = get("platform").lower()
            if platform:
                if platform not in ("youtube", "facebook"):
                    raise ValueError("platform must be youtube or facebook")
                channel = by_key.get((platform, external_id))
            else:
                matches = by_id.get(external_id, [])
                if len(matches) > 1:
                    raise ValueError("this ID exists on both platforms; add a platform column")
                channel = matches[0] if matches else None
            if channel is None:
                raise ValueError(
                    f"no channel with ID '{external_id}' (add it under Channels first)"
                )
            currency = get("currency").upper()
            if len(currency) != 3 or not currency.isalpha():
                raise ValueError("currency must be a 3-letter code like USD")
            views_raw = get("views").replace(",", "")
            views = int(views_raw) if views_raw else None
            if views is not None and views < 0:
                raise ValueError("views cannot be negative")
            state = (get("state") or "provisional").lower()
            if state not in ("provisional", "final"):
                raise ValueError("state must be provisional or final")
            if (channel.id, day) in seen:
                raise ValueError("same channel and date appear twice in this file")
            seen.add((channel.id, day))
            parsed.append(
                (
                    line,
                    channel,
                    {
                        "day": day,
                        "gross_amount": _amount(get("gross_revenue")),
                        "currency": currency,
                        "views": views,
                        "state": state,
                    },
                )
            )
        except ValueError as exc:
            record.rows_failed += 1
            errors.append({"line": line, "message": str(exc)})

    existing = {
        (f.channel_id, f.day): f
        for f in db.scalars(
            select(RevenueFact).where(
                RevenueFact.channel_id.in_({c.id for _, c, _ in parsed} or {uuid.uuid4()}),
                RevenueFact.day.in_({v["day"] for _, _, v in parsed} or {today}),
            )
        )
    }
    db.flush()  # give the import record an id
    for _, channel, values in parsed:
        fact = existing.get((channel.id, values["day"]))
        if fact is None:
            db.add(
                RevenueFact(
                    organization_id=organization_id,
                    channel_id=channel.id,
                    cms_partner_id=channel.cms_partner_id,
                    source="csv",
                    import_id=record.id,
                    **values,
                )
            )
            record.rows_created += 1
        else:
            changed = any(getattr(fact, k) != v for k, v in values.items())
            if changed:
                for k, v in values.items():
                    setattr(fact, k, v)
                fact.import_id = record.id
                record.rows_updated += 1

    record.errors = errors[:MAX_ERRORS_KEPT]
    db.flush()
    return ImportOutcome(record, errors)
