"""Upload a CMS's monthly sheet as it comes: preview the column mapping, then import it as
the month's revenue and the CMS's statement in one go (services.cms_sheet)."""

import json
import uuid
from dataclasses import dataclass
from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Annotated

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile, status
from sqlalchemy import delete, func, select

from app.api.deps import Auth, AuthContext
from app.api.finance import (
    MAX_UPLOAD_BYTES,
    _audit,
    _cms,
    _import_out,
    _month,
    _statement_out,
)
from app.core.database import DbSession
from app.models import (
    Channel,
    CmsPartner,
    CmsStatement,
    CmsStatementLine,
    RevenueFact,
    RevenueImport,
)
from app.schemas.finance import (
    SheetImportOut,
    SheetLineOut,
    SheetPreviewOut,
    SheetRoleOut,
    SheetTotals,
)
from app.services.cms_fees import money
from app.services.cms_sheet import (
    MAX_ISSUES,
    ROLES,
    ParsedSheet,
    SheetLine,
    Table,
    check_mapping,
    detect_rate,
    guess_mapping,
    parse_sheet,
    read_table,
)
from app.services.deals import company_today
from app.services.month_close import MonthClosedError, ensure_open
from app.services.settlement import cms_month, fx_rate, month_end

router = APIRouter(tags=["finance"])

MonthForm = Annotated[str, Form(pattern=r"^\d{4}-\d{2}$")]


@dataclass
class _Sheet:
    cms: CmsPartner
    month: date
    file_name: str
    content: bytes
    table: Table
    mapping: dict[str, str]
    source: str
    problems: list[str]
    currency: str
    sheet_rate: Decimal | None
    parsed: ParsedSheet


async def _read(
    db: DbSession,
    ctx: AuthContext,
    cms_partner_id: uuid.UUID,
    month: str,
    file: UploadFile,
    mapping: str | None,
    sheet_rate: str | None,
) -> _Sheet:
    cms = _cms(db, ctx, cms_partner_id)
    m = _month(month)
    content = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "File is larger than 5 MB")
    if not content.strip():
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "The file is empty")
    file_name = (file.filename or "sheet.xlsx").replace("\\", "/").split("/")[-1][:255]
    try:
        table = read_table(content, file_name)
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc

    if mapping:
        try:
            chosen = json.loads(mapping)
        except json.JSONDecodeError as exc:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Bad column mapping") from exc
        if not isinstance(chosen, dict) or not all(
            isinstance(k, str) and isinstance(v, str) for k, v in chosen.items()
        ):
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Bad column mapping")
        cols, source = {k: v for k, v in chosen.items() if v}, "chosen"
    elif cms.sheet_mapping and not check_mapping(table, cms.sheet_mapping):
        cols, source = dict(cms.sheet_mapping), "saved"
    else:
        cols, source = guess_mapping(table), "guessed"

    rate = None
    if sheet_rate and sheet_rate.strip():
        try:
            rate = Decimal(sheet_rate.strip())
        except InvalidOperation as exc:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY, "The sheet's rate is not a number"
            ) from exc
        if rate <= 0:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "The rate must be above 0")
    else:
        rate = detect_rate(table, cols)

    problems = check_mapping(table, cols)
    if not problems and "net_local" in cols and "net" not in cols and rate is None:
        problems.append(
            "Enter the sheet's rate, so its local-currency amounts can be turned back into dollars"
        )
    channels = db.scalars(
        select(Channel).where(
            Channel.organization_id == ctx.organization.id, Channel.platform == cms.platform
        )
    ).all()
    parsed = ParsedSheet() if problems else parse_sheet(table, cols, list(channels), rate)
    currency = cms_month(db, ctx.organization, cms, m).currency or "USD"
    return _Sheet(cms, m, file_name, content, table, cols, source, problems, currency, rate, parsed)


def _line(line: SheetLine) -> SheetLineOut:
    return SheetLineOut(
        line=line.line_no,
        external_id=line.external_id,
        channel_name=line.channel.name if line.channel else line.channel_name,
        channel_id=line.channel.id if line.channel else None,
        gross=line.gross,
        tax=line.tax,
        fee=line.fee,
        net=line.net,
        net_local=line.net_local,
        rows=line.rows,
    )


def _totals(lines: list[SheetLine]) -> SheetTotals:
    def total(values):
        values = list(values)
        return None if not values or any(v is None for v in values) else money(sum(values))

    return SheetTotals(
        gross=money(sum((x.gross for x in lines), Decimal(0))),
        tax=money(sum((x.tax for x in lines), Decimal(0))),
        fee=total(x.fee for x in lines),
        net=total(x.net for x in lines),
        net_local=total(x.net_local for x in lines),
    )


def _existing(db: DbSession, ctx: AuthContext, s: _Sheet) -> int:
    ids = [x.channel.id for x in s.parsed.matched]
    if not ids:
        return 0
    return db.scalar(
        select(func.count(func.distinct(RevenueFact.channel_id))).where(
            RevenueFact.organization_id == ctx.organization.id,
            RevenueFact.channel_id.in_(ids),
            RevenueFact.day >= s.month,
            RevenueFact.day < month_end(s.month),
        )
    )


@router.post("/finance/cms-sheet/preview")
async def preview_sheet(
    ctx: Auth,
    db: DbSession,
    cms_partner_id: Annotated[uuid.UUID, Form()],
    month: MonthForm,
    file: Annotated[UploadFile, File()],
    mapping: Annotated[str | None, Form(max_length=5000)] = None,
    sheet_rate: Annotated[str | None, Form(max_length=30)] = None,
) -> SheetPreviewOut:
    """Read the sheet and show what would be imported, without saving anything."""
    s = await _read(db, ctx, cms_partner_id, month, file, mapping, sheet_rate)
    org = ctx.organization
    company_rate = fx_rate(db, org, s.month, s.currency)
    totals = _totals(s.parsed.lines)
    return SheetPreviewOut(
        file_name=s.file_name,
        headers=s.table.headers,
        roles=[
            SheetRoleOut(key=k, label=label, required=req, hint=hint)
            for k, (label, req, hint) in ROLES.items()
        ],
        mapping=s.mapping,
        mapping_source=s.source,  # type: ignore[arg-type]
        problems=s.problems,
        currency=s.currency,
        base_currency=org.base_currency,
        sheet_rate=s.sheet_rate,
        company_rate=company_rate,
        lines=len(s.parsed.lines),
        skipped=s.parsed.skipped,
        matched=len(s.parsed.matched),
        totals=totals,
        gross_base=money(totals.gross * company_rate) if company_rate is not None else None,
        sample=[_line(x) for x in s.parsed.lines[:8]],
        unknown=[_line(x) for x in s.parsed.unknown[:MAX_ISSUES]],
        errors=s.parsed.errors,
        replaces=_existing(db, ctx, s),
    )


@router.post("/finance/cms-sheet/import", status_code=status.HTTP_201_CREATED)
async def import_sheet(
    ctx: Auth,
    request: Request,
    db: DbSession,
    cms_partner_id: Annotated[uuid.UUID, Form()],
    month: MonthForm,
    file: Annotated[UploadFile, File()],
    mapping: Annotated[str | None, Form(max_length=5000)] = None,
    sheet_rate: Annotated[str | None, Form(max_length=30)] = None,
) -> SheetImportOut:
    """Book each known channel's gross and tax as the month's revenue, save the CMS's
    per-channel figures as its statement, and remember the column mapping for next time."""
    s = await _read(db, ctx, cms_partner_id, month, file, mapping, sheet_rate)
    org = ctx.organization
    if s.problems:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, s.problems[0])
    if s.month > company_today(org).replace(day=1):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "That month has not started yet")
    try:
        ensure_open(db, org, s.month, "This sheet")
    except MonthClosedError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc
    if not s.parsed.lines:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            s.parsed.errors[0]["message"] if s.parsed.errors else "No channel rows in this file",
        )

    cms, matched, unknown = s.cms, s.parsed.matched, s.parsed.unknown
    errors = list(s.parsed.errors)
    for x in unknown:
        if len(errors) < MAX_ISSUES:
            errors.append(
                {
                    "line": x.line_no,
                    "message": f"No channel with ID '{x.external_id}'"
                    + (f" ({x.channel_name})" if x.channel_name else "")
                    + " — add it under Channels, then upload again",
                }
            )
    warnings: list[str] = []
    elsewhere = [x.channel.name for x in matched if x.channel.cms_partner_id != cms.id]
    if elsewhere:
        warnings.append(
            f"{len(elsewhere)} channel(s) are set to another CMS in the tool but are on "
            f"{cms.name}'s sheet; their revenue is booked under {cms.name}: "
            + ", ".join(elsewhere[:5])
            + ("…" if len(elsewhere) > 5 else "")
        )

    # The sheet is the month's revenue for its channels: replace whatever was there.
    replaced = _existing(db, ctx, s)
    record = RevenueImport(
        organization_id=org.id,
        uploaded_by_id=ctx.user.id,
        file_name=s.file_name,
        rows_total=len(s.parsed.lines) + len(s.parsed.errors),
        rows_created=len(matched) - replaced,
        rows_updated=replaced,
        rows_failed=len(unknown) + len(s.parsed.errors),
        errors=errors,
    )
    db.add(record)
    db.flush()
    if matched:
        db.execute(
            delete(RevenueFact).where(
                RevenueFact.organization_id == org.id,
                RevenueFact.channel_id.in_([x.channel.id for x in matched]),
                RevenueFact.day >= s.month,
                RevenueFact.day < month_end(s.month),
            )
        )
    for x in matched:
        db.add(
            RevenueFact(
                organization_id=org.id,
                channel_id=x.channel.id,
                cms_partner_id=cms.id,
                day=s.month,
                gross_amount=x.gross,
                tax_amount=x.tax,
                currency=s.currency,
                views=x.views,
                state="final",
                source="cms_sheet",
                import_id=record.id,
            )
        )

    statement = None
    totals = _totals(s.parsed.lines)
    if totals.net is None:
        warnings.append(
            "The sheet has no column for what the CMS pays, so no statement was saved. "
            "Map 'CMS pays you' to reconcile channel by channel."
        )
    else:
        statement = db.scalar(
            select(CmsStatement).where(
                CmsStatement.cms_partner_id == cms.id, CmsStatement.month == s.month
            )
        )
        if statement is None:
            statement = CmsStatement(
                organization_id=org.id, cms_partner_id=cms.id, month=s.month, currency=s.currency
            )
            db.add(statement)
        else:
            statement.version += 1
        statement.currency = s.currency
        statement.gross_amount = totals.gross
        statement.tax_amount = totals.tax
        statement.fee_amount = totals.fee
        statement.net_amount = totals.net
        statement.source = "file"
        statement.file_name = s.file_name
        statement.file_data = s.content
        statement.uploaded_by_id = ctx.user.id
        statement.lines = [
            CmsStatementLine(
                id=uuid.uuid4(),
                line_no=x.line_no,
                external_id=x.external_id,
                channel_name=x.channel_name,
                channel_id=x.channel.id if x.channel else None,
                gross_amount=x.gross,
                tax_amount=x.tax,
                fee_amount=x.fee,
                net_amount=x.net,
            )
            for x in s.parsed.lines
        ]

    cms.sheet_mapping = s.mapping
    db.flush()
    _audit(
        db,
        ctx,
        request,
        "cms.sheet_imported",
        "cms_partner",
        cms.id,
        {
            "name": f"{cms.name} {s.month:%Y-%m}",
            "file": s.file_name,
            "channels": len(matched),
            "unknown": len(unknown),
            "gross": str(totals.gross),
            "tax": str(totals.tax),
            "net": str(totals.net) if totals.net is not None else None,
            "sheet_rate": str(s.sheet_rate) if s.sheet_rate else None,
        },
    )
    db.commit()
    db.refresh(record)
    return SheetImportOut(
        revenue_import=_import_out(db, record),
        statement=_statement_out(db, statement) if statement else None,
        lines_imported=len(matched),
        unknown=[_line(x) for x in unknown[:MAX_ISSUES]],
        errors=s.parsed.errors,
        warnings=warnings,
    )
