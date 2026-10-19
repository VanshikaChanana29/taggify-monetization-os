"""A CMS's own monthly sheet, uploaded as it comes (Excel or CSV).

Every CMS lays its sheet out differently, so each column is given a role — channel ID, gross,
tax, what the CMS pays — and that mapping is saved on the CMS partner after the first
upload. The tool guesses the roles from the headers; the founder confirms or changes them.

One upload does two jobs for the month:
  * revenue — each channel's gross (and the tax the CMS withheld) becomes that month's
    revenue for the channel, which incentives and deal recovery are worked out from;
  * statement — what the CMS says it pays per channel, reconciled against our own numbers.

Amounts in the CMS's local currency (e.g. "Label Rev INR") are converted back with the
sheet's own rate, which is read from a header like "INR@95.92" or typed in. Our own INR
figures always use the company's monthly rate.
"""

import csv
import io
import re
import zipfile
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation

from app.models import Channel
from app.services.cms_fees import money

MAX_ROWS = 50_000
MAX_ISSUES = 200
HEADER_SCAN_ROWS = 20

# key: (label, required, hint)
ROLES: dict[str, tuple[str, bool, str]] = {
    "channel_id": ("Channel ID or URL", True, "The YouTube channel ID (UC…) or Facebook page ID"),
    "channel_name": ("Channel name", False, "Only for your reference"),
    "gross": ("Gross revenue", True, "The channel's total earnings, before tax and CMS fee"),
    "tax": ("Tax withheld", False, "e.g. US tax the CMS deducted"),
    "net": (
        "CMS pays you (sheet currency)",
        False,
        "What reaches you after tax and the CMS fee, in dollars",
    ),
    "net_local": (
        "CMS pays you (local currency)",
        False,
        "The same in INR, if the sheet gives it — e.g. Label Rev INR",
    ),
    "views": ("Views", False, ""),
}

UC_ID = re.compile(r"UC[\w-]{22}")
RATE_IN_HEADER = re.compile(r"(\d{1,4}(?:\.\d+)?)")


@dataclass
class Table:
    headers: list[str]
    rows: list[tuple[int, list[object]]]  # (line number in the file, cells)


@dataclass
class SheetLine:
    line_no: int
    external_id: str
    channel_name: str | None
    channel: Channel | None
    gross: Decimal
    tax: Decimal
    net: Decimal | None  # what the CMS pays, in the sheet's currency
    net_local: Decimal | None
    views: int | None

    @property
    def fee(self) -> Decimal | None:
        return None if self.net is None else self.gross - self.tax - self.net


@dataclass
class ParsedSheet:
    lines: list[SheetLine] = field(default_factory=list)
    errors: list[dict] = field(default_factory=list)
    skipped: int = 0

    @property
    def unknown(self) -> list[SheetLine]:
        return [line for line in self.lines if line.channel is None]

    @property
    def matched(self) -> list[SheetLine]:
        return [line for line in self.lines if line.channel is not None]


def _norm(header: str) -> str:
    return " ".join(re.sub(r"[^a-z0-9]+", " ", header.lower()).split())


def _text(value: object) -> str:
    if value is None:
        return ""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value).strip()


def read_table(content: bytes, file_name: str) -> Table:
    """The first sheet of an Excel file, or a CSV, as a header row and data rows."""
    if content[:2] == b"PK" or file_name.lower().endswith((".xlsx", ".xlsm")):
        raw = _excel_rows(content)
    else:
        text = content.decode("utf-8-sig", errors="replace")
        raw = [(i, list(r)) for i, r in enumerate(csv.reader(io.StringIO(text)), start=1)]

    # The header is the first row with at least two text cells (sheets often start with a
    # title or blank rows).
    header_at = None
    for idx, (_, cells) in enumerate(raw[:HEADER_SCAN_ROWS]):
        texts = [c for c in cells if isinstance(c, str) and c.strip() and not _is_number(c)]
        if len(texts) >= 2:
            header_at = idx
            break
    if header_at is None:
        raise ValueError("Could not find a header row in the first 20 rows")

    header_cells = raw[header_at][1]
    body = raw[header_at + 1 : header_at + 1 + MAX_ROWS]
    width = max([len(header_cells)] + [len(c) for _, c in body])
    used = [
        i
        for i in range(width)
        if (i < len(header_cells) and _text(header_cells[i]))
        or any(i < len(c) and _text(c[i]) for _, c in body)
    ]
    headers: list[str] = []
    for i in used:
        name = _text(header_cells[i]) if i < len(header_cells) else ""
        name = name or f"Column {_letter(i)}"
        base, n = name, 2
        while name in headers:
            name, n = f"{base} ({n})", n + 1
        headers.append(name)
    rows = [(line, [cells[i] if i < len(cells) else None for i in used]) for line, cells in body]
    return Table(headers, rows)


def _excel_rows(content: bytes) -> list[tuple[int, list[object]]]:
    from openpyxl import load_workbook

    try:
        wb = load_workbook(io.BytesIO(content), read_only=True, data_only=True)
    except (zipfile.BadZipFile, KeyError, OSError, ValueError) as exc:
        raise ValueError("This is not an Excel file the tool can read (.xlsx)") from exc
    try:
        # The sheet with the most rows is the data; summary tabs are usually short.
        ws = max(wb.worksheets, key=lambda w: w.max_row or 0)
        out = []
        for i, row in enumerate(ws.iter_rows(values_only=True), start=1):
            if i > MAX_ROWS + HEADER_SCAN_ROWS:
                break
            out.append((i, list(row)))
        return out
    finally:
        wb.close()


def _letter(i: int) -> str:
    s = ""
    i += 1
    while i:
        i, r = divmod(i - 1, 26)
        s = chr(65 + r) + s
    return s


def _is_number(value: str) -> bool:
    try:
        Decimal(value.replace(",", "").strip())
        return True
    except InvalidOperation:
        return False


def _amount(value: object, what: str) -> Decimal:
    if value is None or _text(value) == "":
        return Decimal("0.00")
    if isinstance(value, int | float | Decimal):
        return money(Decimal(str(value)))
    cleaned = re.sub(r"[,$₹\s]|USD|INR|Rs\.?", "", str(value))
    negative = cleaned.startswith("(") and cleaned.endswith(")")
    try:
        amount = Decimal(cleaned.strip("()"))
    except InvalidOperation as exc:
        raise ValueError(f"{what} '{value}' is not a number") from exc
    return money(-amount if negative else amount)


def guess_mapping(table: Table) -> dict[str, str]:
    """Best guess of which column plays which role, from header words and the values."""
    norm = {h: _norm(h) for h in table.headers}
    taken: set[str] = set()
    mapping: dict[str, str] = {}

    def pick(role: str, test) -> None:
        for h in table.headers:
            if h not in taken and test(norm[h], h):
                mapping[role] = h
                taken.add(h)
                return

    def has(n: str, *words: str) -> bool:
        padded = f" {n} "
        return any(f" {w} " in padded or (len(w) > 3 and w in n) for w in words)

    # Channel ID: the column whose values look like YouTube channel IDs, else by name.
    id_scores = {
        h: sum(1 for _, cells in table.rows[:200] if UC_ID.search(_text(cells[i])))
        for i, h in enumerate(table.headers)
    }
    best = max(id_scores, key=lambda h: id_scores[h]) if id_scores else None
    if best and id_scores[best] > 0:
        mapping["channel_id"] = best
        taken.add(best)
    else:
        pick(
            "channel_id",
            lambda n, _: has(n, "channel id", "channel url", "asset id", "page id", "external id")
            or n in ("id", "url", "channel link"),
        )
    pick("channel_name", lambda n, _: has(n, "name", "title") or n in ("channel", "channels"))
    pick("tax", lambda n, _: has(n, "tax", "withholding", "tds"))
    local = ("inr", "rs", "rupee", "aed")
    pick("views", lambda n, _: has(n, "views"))
    # Gross: a total/revenue column that is not US-only, local currency, tax or net.
    pick(
        "gross",
        lambda n, _: has(n, "gross", "total", "revenue", "earning", "earnings", "amount")
        and not has(n, "us", "u s", "usa", "tax", "net", "label", "payable", "payble", *local),
    )
    # What the CMS pays: in local currency, prefer "label/net/share/payout" over a plain
    # converted column; the last local-currency column is usually the final one.
    locals_ = [h for h in table.headers if h not in taken and has(norm[h], *local)]
    finals = [
        h for h in locals_ if has(norm[h], "label", "net", "share", "payout", "partner", "final")
    ]
    if finals or locals_:
        mapping["net_local"] = (finals or locals_)[-1]
        taken.add(mapping["net_local"])
    pick(
        "net",
        lambda n, _: has(n, "net", "label", "share", "payout", "partner revenue")
        and not has(n, *local),
    )
    return mapping


def rate_from_headers(headers: list[str]) -> Decimal | None:
    """A rate written into a header, e.g. "INR@95.92" or "Rate 83.10"."""
    for h in headers:
        n = _norm(h)
        if ("inr" in n or "rate" in n or "@" in h) and (m := RATE_IN_HEADER.search(h)):
            value = Decimal(m.group(1))
            if value > 1 and "%" not in h[m.end() : m.end() + 1]:
                return value
    return None


def check_mapping(table: Table, mapping: dict[str, str]) -> list[str]:
    problems = [
        f"Choose the column for {label}"
        for key, (label, required, _) in ROLES.items()
        if required and not mapping.get(key)
    ]
    for key, header in mapping.items():
        if key not in ROLES:
            problems.append(f"Unknown role '{key}'")
        elif header and header not in table.headers:
            problems.append(f"Column '{header}' is not in this file")
    used = [h for h in mapping.values() if h]
    if len(used) != len(set(used)):
        problems.append("The same column is chosen for two roles")
    return problems


def parse_sheet(
    table: Table,
    mapping: dict[str, str],
    channels: list[Channel],
    sheet_rate: Decimal | None,
) -> ParsedSheet:
    index = {key: table.headers.index(h) for key, h in mapping.items() if h}
    by_external = {c.external_id.strip().lower(): c for c in channels}
    result = ParsedSheet()
    seen: set[str] = set()

    for line_no, cells in table.rows:

        def cell(key: str, cells: list = cells) -> object:
            return cells[index[key]] if key in index else None

        raw_id = _text(cell("channel_id"))
        if not raw_id:
            # Blank rows and the totals row at the bottom have no channel.
            result.skipped += 1
            continue
        found = UC_ID.search(raw_id)
        external_id = (found.group(0) if found else raw_id.rstrip("/").split("/")[-1])[:100]
        try:
            if external_id.lower() in seen:
                raise ValueError(f"Channel {external_id} appears twice in the file")
            gross = _amount(cell("gross"), "Gross")
            tax = _amount(cell("tax"), "Tax")
            if gross < 0:
                raise ValueError("Gross cannot be negative")
            if tax < 0 or tax > gross:
                raise ValueError(f"Tax {tax} must be between 0 and the gross {gross}")
            net_local = _amount(cell("net_local"), "Local amount") if "net_local" in index else None
            if "net" in index:
                net = _amount(cell("net"), "Net")
            elif net_local is not None and sheet_rate:
                net = money(net_local / sheet_rate)
            else:
                net = None
            views_text = _text(cell("views")).replace(",", "")
            views = int(Decimal(views_text)) if views_text else None
        except (ValueError, InvalidOperation) as exc:
            if len(result.errors) < MAX_ISSUES:
                result.errors.append({"line": line_no, "message": str(exc)})
            continue
        seen.add(external_id.lower())
        name = _text(cell("channel_name")) or None
        result.lines.append(
            SheetLine(
                line_no=line_no,
                external_id=external_id,
                channel_name=name[:200] if name else None,
                channel=by_external.get(external_id.lower()),
                gross=gross,
                tax=tax,
                net=net,
                net_local=net_local,
                views=views,
            )
        )
    return result
