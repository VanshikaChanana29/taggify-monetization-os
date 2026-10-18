"""CMS statement files and channel-by-channel reconciliation (working document §3, PDF slide 16
steps 4–5): "Receive CMS monthly statement → match statement lines to channel IDs, month, gross,
fee … → discrepancies become finance review tasks".

Statement CSV columns (header names are case-insensitive, extra columns are ignored):
    channel_id     YouTube channel ID or Facebook page ID, as the CMS lists it
    channel_name   optional, for your reference
    gross          gross revenue for the month (also: gross_revenue)
    fee            the CMS's commission (also: cms_fee, commission)
    net            optional; must equal gross − fee when given (also: net_revenue, payable)
    currency       optional; must be the statement's currency when given
"""

import csv
import io
import uuid
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation

from app.models import Channel, CmsStatementLine
from app.services.cms_fees import money
from app.services.settlement import ChannelLine

TEMPLATE = (
    "channel_id,channel_name,gross,fee,net\n"
    "UCKAPIL01,Kapil Comedy 01,12000.00,1800.00,10200.00\n"
    "UCCID01,CID Stories 01,6000.00,900.00,5100.00\n"
)

ALIASES = {
    "channel_id": ("channel_id", "channel id", "asset id", "external_id"),
    "channel_name": ("channel_name", "channel name", "channel"),
    "gross": ("gross", "gross_revenue", "gross revenue", "revenue"),
    "fee": ("fee", "cms_fee", "commission", "cms fee"),
    "net": ("net", "net_revenue", "payable", "net payable"),
    "currency": ("currency",),
}
TOLERANCE = Decimal("0.01")


def _amount(value: str, what: str) -> Decimal:
    cleaned = value.replace(",", "").replace("$", "").replace("₹", "").strip()
    try:
        return money(Decimal(cleaned))
    except InvalidOperation as exc:
        raise ValueError(f"{what} '{value}' is not a number") from exc


@dataclass
class ParsedStatement:
    lines: list[CmsStatementLine] = field(default_factory=list)
    errors: list[dict] = field(default_factory=list)
    gross: Decimal = Decimal("0.00")
    fee: Decimal = Decimal("0.00")
    net: Decimal = Decimal("0.00")


def parse_statement(content: bytes, currency: str, channels: list[Channel]) -> ParsedStatement:
    """Read a CMS statement CSV into lines; lines with bad numbers are reported, not saved."""
    text = content.decode("utf-8-sig", errors="replace")
    reader = csv.DictReader(io.StringIO(text))
    found = {(h or "").strip().lower(): h for h in (reader.fieldnames or [])}
    columns = {
        key: next((found[a] for a in names if a in found), None) for key, names in ALIASES.items()
    }
    result = ParsedStatement()
    missing = [k for k in ("channel_id", "gross", "fee") if columns[k] is None]
    if missing:
        result.errors.append({"line": 1, "message": f"Missing column(s): {', '.join(missing)}"})
        return result

    by_external = {c.external_id.strip().lower(): c for c in channels}
    seen: set[str] = set()
    for line_no, raw in enumerate(reader, start=2):
        row = {k: (raw.get(col) or "").strip() if col else "" for k, col in columns.items()}
        if not any(row.values()):
            continue
        try:
            ext = row["channel_id"]
            if not ext:
                raise ValueError("Channel ID is empty")
            if ext.lower() in seen:
                raise ValueError(f"Channel {ext} appears twice in the file")
            if row["currency"] and row["currency"].upper() != currency:
                raise ValueError(
                    f"Currency {row['currency'].upper()} — this statement is in {currency}"
                )
            gross = _amount(row["gross"], "Gross")
            fee = _amount(row["fee"], "Fee")
            net = gross - fee
            if row["net"] and abs(_amount(row["net"], "Net") - net) > TOLERANCE:
                raise ValueError(f"Net {row['net']} is not gross − fee ({net})")
        except ValueError as exc:
            result.errors.append({"line": line_no, "message": str(exc)})
            continue
        seen.add(ext.lower())
        channel = by_external.get(ext.lower())
        result.lines.append(
            CmsStatementLine(
                id=uuid.uuid4(),
                line_no=line_no,
                external_id=ext[:100],
                channel_name=(row["channel_name"] or None) and row["channel_name"][:200],
                channel_id=channel.id if channel else None,
                gross_amount=gross,
                fee_amount=fee,
                net_amount=net,
            )
        )
        result.gross += gross
        result.fee += fee
        result.net += net
    return result


@dataclass
class ReconLine:
    """Our numbers for a channel next to the CMS's, for one month."""

    channel_id: uuid.UUID | None
    channel_name: str
    external_id: str | None
    our_gross: Decimal | None
    their_gross: Decimal | None
    our_fee: Decimal | None
    their_fee: Decimal | None
    our_net: Decimal | None
    their_net: Decimal | None
    difference: Decimal | None  # their net − our net
    # match | differs | missing_in_statement | not_in_our_data | unknown_channel
    status: str


def reconcile(
    ours: list[ChannelLine], theirs: list[CmsStatementLine], names: dict
) -> list[ReconLine]:
    out: list[ReconLine] = []
    by_channel = {line.channel_id: line for line in theirs if line.channel_id}
    for o in ours:
        t = by_channel.pop(o.channel_id, None)
        if t is None:
            out.append(
                ReconLine(
                    o.channel_id,
                    o.channel_name,
                    None,
                    o.gross,
                    None,
                    o.fee_share,
                    None,
                    o.net_share,
                    None,
                    None,
                    "missing_in_statement",
                )
            )
            continue
        diff = t.net_amount - o.net_share if o.net_share is not None else None
        same = (
            diff is not None
            and abs(diff) <= TOLERANCE
            and abs(t.gross_amount - o.gross) <= TOLERANCE
        )
        out.append(
            ReconLine(
                o.channel_id,
                o.channel_name,
                t.external_id,
                o.gross,
                t.gross_amount,
                o.fee_share,
                t.fee_amount,
                o.net_share,
                t.net_amount,
                diff,
                "match" if same else "differs",
            )
        )
    for t in theirs:
        if t.channel_id and t.channel_id in by_channel:
            out.append(
                ReconLine(
                    t.channel_id,
                    names.get(t.channel_id, t.channel_name or t.external_id),
                    t.external_id,
                    None,
                    t.gross_amount,
                    None,
                    t.fee_amount,
                    None,
                    t.net_amount,
                    t.net_amount,
                    "not_in_our_data",
                )
            )
        elif not t.channel_id:
            out.append(
                ReconLine(
                    None,
                    t.channel_name or t.external_id,
                    t.external_id,
                    None,
                    t.gross_amount,
                    None,
                    t.fee_amount,
                    None,
                    t.net_amount,
                    t.net_amount,
                    "unknown_channel",
                )
            )
    order = {
        "differs": 0,
        "unknown_channel": 1,
        "not_in_our_data": 2,
        "missing_in_statement": 3,
        "match": 4,
    }
    return sorted(out, key=lambda r: (order[r.status], r.channel_name))
