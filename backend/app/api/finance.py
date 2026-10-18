"""Revenue import, FX rates, CMS fee schedules and the monthly CMS settlement (Part 4A)."""

import uuid
from dataclasses import asdict
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, File, HTTPException, Query, Request, Response, UploadFile, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import Auth, AuthContext, client_ip
from app.api.pagination import Page, Pagination, paginate
from app.core.database import DbSession
from app.models import (
    BankReceipt,
    CmsAdjustment,
    CmsFeeSchedule,
    CmsPartner,
    CmsStatement,
    FxRate,
    RevenueFact,
    RevenueImport,
    User,
)
from app.schemas.finance import (
    AdjustmentIn,
    AdjustmentOut,
    ChannelLineOut,
    CmsMonthDetail,
    CmsMonthOut,
    FeeScheduleIn,
    FeeScheduleOut,
    FinanceMonthOut,
    FxRateIn,
    FxRateOut,
    ReceiptIn,
    ReceiptOut,
    RevenueFactOut,
    RevenueImportOut,
    StatementIn,
    StatementOut,
    Tier,
    parse_month,
)
from app.services.audit import record_audit
from app.services.cms_fees import money
from app.services.deals import company_today
from app.services.month_close import closed_months, latest_closed
from app.services.revenue_import import TEMPLATE, import_revenue
from app.services.settlement import (
    channel_lines,
    cms_month,
    month_end,
    month_settlements,
    receipt_value,
)

router = APIRouter(tags=["finance"])

MAX_UPLOAD_BYTES = 5 * 1024 * 1024
MonthQuery = Annotated[str, Query(pattern=r"^\d{4}-\d{2}$", description="YYYY-MM")]


def _month(value: str):
    try:
        return parse_month(value)
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc


def _cms(db: Session, ctx: AuthContext, cms_id: uuid.UUID) -> CmsPartner:
    cms = db.scalar(
        select(CmsPartner).where(
            CmsPartner.id == cms_id, CmsPartner.organization_id == ctx.organization.id
        )
    )
    if cms is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "CMS partner not found")
    return cms


def _audit(db, ctx, request, action, entity_type, entity_id, details):
    record_audit(
        db,
        action,
        organization_id=ctx.organization.id,
        user_id=ctx.user.id,
        entity_type=entity_type,
        entity_id=entity_id,
        details=details,
        ip=client_ip(request),
    )


# ---- Revenue -------------------------------------------------------------------------------


def _import_out(db: Session, r: RevenueImport) -> RevenueImportOut:
    user = db.get(User, r.uploaded_by_id) if r.uploaded_by_id else None
    return RevenueImportOut(
        id=r.id,
        file_name=r.file_name,
        uploaded_by=user.full_name if user else None,
        rows_total=r.rows_total,
        rows_created=r.rows_created,
        rows_updated=r.rows_updated,
        rows_failed=r.rows_failed,
        errors=r.errors,
        created_at=r.created_at,
    )


@router.get("/revenue/template")
def revenue_template(_: Auth) -> Response:
    return Response(
        TEMPLATE,
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="revenue-template.csv"'},
    )


@router.post("/revenue/import", status_code=status.HTTP_201_CREATED)
async def upload_revenue(
    ctx: Auth, request: Request, db: DbSession, file: Annotated[UploadFile, File()]
) -> RevenueImportOut:
    content = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "File is larger than 5 MB")
    if not content.strip():
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "The file is empty")
    outcome = import_revenue(
        db,
        ctx.organization.id,
        ctx.user.id,
        (file.filename or "upload.csv")[:255],
        content,
        company_today(ctx.organization),
        closed_months(db, ctx.organization),
    )
    r = outcome.record
    _audit(
        db,
        ctx,
        request,
        "revenue.imported",
        "revenue_import",
        r.id,
        {
            "name": r.file_name,
            "created": r.rows_created,
            "updated": r.rows_updated,
            "failed": r.rows_failed,
        },
    )
    db.commit()
    db.refresh(r)
    return _import_out(db, r)


@router.get("/revenue/imports")
def list_imports(ctx: Auth, db: DbSession, pagination: Pagination) -> Page[RevenueImportOut]:
    stmt = (
        select(RevenueImport)
        .where(RevenueImport.organization_id == ctx.organization.id)
        .order_by(RevenueImport.created_at.desc(), RevenueImport.id)
    )
    rows, total = paginate(db, stmt, pagination)
    return Page(
        items=[_import_out(db, r) for r in rows],
        total=total,
        page=pagination.page,
        page_size=pagination.page_size,
    )


@router.get("/revenue/facts")
def list_facts(
    ctx: Auth,
    db: DbSession,
    pagination: Pagination,
    month: MonthQuery | None = None,
    channel_id: uuid.UUID | None = None,
    cms_partner_id: uuid.UUID | None = None,
    sort: Annotated[str, Query(pattern="^(day|gross)$")] = "day",
    direction: Annotated[str, Query(pattern="^(asc|desc)$")] = "desc",
) -> Page[RevenueFactOut]:
    stmt = select(RevenueFact).where(RevenueFact.organization_id == ctx.organization.id)
    if month:
        m = _month(month)
        stmt = stmt.where(RevenueFact.day >= m, RevenueFact.day < month_end(m))
    if channel_id:
        stmt = stmt.where(RevenueFact.channel_id == channel_id)
    if cms_partner_id:
        stmt = stmt.where(RevenueFact.cms_partner_id == cms_partner_id)
    col = RevenueFact.day if sort == "day" else RevenueFact.gross_amount
    stmt = stmt.order_by(col.asc() if direction == "asc" else col.desc(), RevenueFact.id)
    rows, total = paginate(db, stmt, pagination)
    cms_names = dict(
        db.execute(
            select(CmsPartner.id, CmsPartner.name).where(
                CmsPartner.organization_id == ctx.organization.id
            )
        ).all()
    )
    return Page(
        items=[
            RevenueFactOut(
                id=f.id,
                day=f.day,
                channel_id=f.channel_id,
                channel_name=f.channel.name,
                platform=f.channel.platform,
                cms_name=cms_names.get(f.cms_partner_id),
                gross_amount=f.gross_amount,
                currency=f.currency,
                views=f.views,
                state=f.state,
                source=f.source,
            )
            for f in rows
        ],
        total=total,
        page=pagination.page,
        page_size=pagination.page_size,
    )


# ---- FX rates ------------------------------------------------------------------------------


@router.get("/fx-rates")
def list_fx(ctx: Auth, db: DbSession) -> list[FxRateOut]:
    rows = db.scalars(
        select(FxRate)
        .where(FxRate.organization_id == ctx.organization.id)
        .order_by(FxRate.month.desc(), FxRate.currency)
    )
    return [
        FxRateOut(id=r.id, month=f"{r.month:%Y-%m}", currency=r.currency, rate=r.rate) for r in rows
    ]


@router.put("/fx-rates")
def set_fx(body: FxRateIn, ctx: Auth, request: Request, db: DbSession) -> FxRateOut:
    if body.currency == ctx.organization.base_currency:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"{body.currency} is the company's base currency; no rate needed",
        )
    month = _month(body.month)
    rate = db.scalar(
        select(FxRate).where(
            FxRate.organization_id == ctx.organization.id,
            FxRate.month == month,
            FxRate.currency == body.currency,
        )
    )
    if month in closed_months(db, ctx.organization):
        # A closed month's revenue must not be re-priced. A first rate for a currency with
        # no revenue that month (e.g. AED to value a late receipt) changes no closed number.
        has_revenue = db.scalar(
            select(RevenueFact.id)
            .where(
                RevenueFact.organization_id == ctx.organization.id,
                RevenueFact.currency == body.currency,
                RevenueFact.day >= month,
                RevenueFact.day < month_end(month),
            )
            .limit(1)
        )
        if rate is not None or has_revenue:
            raise HTTPException(
                status.HTTP_409_CONFLICT, f"{month:%B %Y} is closed; its FX rate is locked"
            )
    before = str(rate.rate) if rate else None
    if rate is None:
        rate = FxRate(
            organization_id=ctx.organization.id, month=month, currency=body.currency, rate=body.rate
        )
        db.add(rate)
    else:
        rate.rate = body.rate
    db.flush()
    _audit(
        db,
        ctx,
        request,
        "fx.set",
        "fx_rate",
        rate.id,
        {"name": f"{body.currency} {body.month}", "changes": {"rate": [before, str(body.rate)]}},
    )
    db.commit()
    return FxRateOut(id=rate.id, month=body.month, currency=rate.currency, rate=rate.rate)


# ---- CMS fee schedules -----------------------------------------------------------------------


def _schedule_unlocked(db: Session, ctx: AuthContext, effective_from) -> None:
    """A schedule from month M re-prices M onward, so M must be after every closed month."""
    latest = latest_closed(db, ctx.organization)
    if latest is not None and effective_from <= latest:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Months up to {latest:%B %Y} are closed; fee tiers can only change from a later month",
        )


def _schedule_out(s: CmsFeeSchedule) -> FeeScheduleOut:
    return FeeScheduleOut(
        id=s.id,
        effective_from=s.effective_from,
        tier_type=s.tier_type,  # type: ignore[arg-type]
        currency=s.currency,
        tiers=[Tier(**t) for t in s.tiers],
        notes=s.notes,
    )


@router.get("/cms-partners/{cms_id}/fee-schedules")
def list_schedules(cms_id: uuid.UUID, ctx: Auth, db: DbSession) -> list[FeeScheduleOut]:
    cms = _cms(db, ctx, cms_id)
    rows = db.scalars(
        select(CmsFeeSchedule)
        .where(CmsFeeSchedule.cms_partner_id == cms.id)
        .order_by(CmsFeeSchedule.effective_from.desc())
    )
    return [_schedule_out(s) for s in rows]


@router.post("/cms-partners/{cms_id}/fee-schedules", status_code=status.HTTP_201_CREATED)
def add_schedule(
    cms_id: uuid.UUID, body: FeeScheduleIn, ctx: Auth, request: Request, db: DbSession
) -> FeeScheduleOut:
    cms = _cms(db, ctx, cms_id)
    _schedule_unlocked(db, ctx, body.effective_from)
    if db.scalar(
        select(CmsFeeSchedule.id).where(
            CmsFeeSchedule.cms_partner_id == cms.id,
            CmsFeeSchedule.effective_from == body.effective_from,
        )
    ):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"{cms.name} already has a schedule from {body.effective_from:%b %Y}. Delete it first.",
        )
    schedule = CmsFeeSchedule(
        organization_id=ctx.organization.id,
        cms_partner_id=cms.id,
        effective_from=body.effective_from,
        tier_type=body.tier_type,
        currency=body.currency,
        tiers=[
            {"from_amount": str(t.from_amount), "rate_pct": str(t.rate_pct)} for t in body.tiers
        ],
        notes=body.notes,
    )
    db.add(schedule)
    db.flush()
    _audit(
        db,
        ctx,
        request,
        "cms.fee_schedule_added",
        "cms_partner",
        cms.id,
        {
            "name": cms.name,
            "from": f"{body.effective_from:%Y-%m}",
            "tier_type": body.tier_type,
            "tiers": schedule.tiers,
        },
    )
    db.commit()
    return _schedule_out(schedule)


@router.delete("/fee-schedules/{schedule_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_schedule(schedule_id: uuid.UUID, ctx: Auth, request: Request, db: DbSession) -> None:
    schedule = db.scalar(
        select(CmsFeeSchedule).where(
            CmsFeeSchedule.id == schedule_id,
            CmsFeeSchedule.organization_id == ctx.organization.id,
        )
    )
    if schedule is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Fee schedule not found")
    _schedule_unlocked(db, ctx, schedule.effective_from)
    _audit(
        db,
        ctx,
        request,
        "cms.fee_schedule_deleted",
        "cms_partner",
        schedule.cms_partner_id,
        {"from": f"{schedule.effective_from:%Y-%m}", "tiers": schedule.tiers},
    )
    db.delete(schedule)
    db.commit()


# ---- Settlement ------------------------------------------------------------------------------


@router.get("/finance/settlements")
def finance_month(ctx: Auth, db: DbSession, month: MonthQuery) -> FinanceMonthOut:
    m = _month(month)
    rows = month_settlements(db, ctx.organization, m)
    zero = Decimal("0.00")
    return FinanceMonthOut(
        month=month,
        base_currency=ctx.organization.base_currency,
        gross=money(sum((r.gross_base or zero for r in rows), zero)),
        fee=money(sum((r.fee_base or zero for r in rows), zero)),
        net_receivable=money(sum((r.net_base or zero for r in rows if r.cms_id), zero)),
        received=money(sum((r.received for r in rows), zero)),
        fx_difference=money(sum((r.fx_difference for r in rows), zero)),
        outstanding=money(sum((r.outstanding or zero for r in rows), zero)),
        incomplete=any(r.warnings for r in rows),
        rows=[CmsMonthOut(**asdict(r)) for r in rows],
    )


@router.get("/finance/settlements/{cms_id}")
def finance_cms_month(cms_id: str, ctx: Auth, db: DbSession, month: MonthQuery) -> CmsMonthDetail:
    """cms_id may be "none" for channels without a CMS."""
    m = _month(month)
    cms = None if cms_id == "none" else _cms(db, ctx, uuid.UUID(cms_id))
    summary = cms_month(db, ctx.organization, cms, m)
    statement = (
        db.scalar(
            select(CmsStatement).where(
                CmsStatement.cms_partner_id == cms.id, CmsStatement.month == m
            )
        )
        if cms
        else None
    )
    receipts = (
        db.scalars(
            select(BankReceipt)
            .where(BankReceipt.cms_partner_id == cms.id, BankReceipt.month == m)
            .order_by(BankReceipt.received_on)
        ).all()
        if cms
        else []
    )
    adjustments = (
        db.scalars(
            select(CmsAdjustment)
            .where(CmsAdjustment.cms_partner_id == cms.id, CmsAdjustment.month == m)
            .order_by(CmsAdjustment.created_at)
        ).all()
        if cms
        else []
    )
    return CmsMonthDetail(
        month=month,
        base_currency=ctx.organization.base_currency,
        summary=CmsMonthOut(**asdict(summary)),
        channels=[
            ChannelLineOut(**asdict(c))
            for c in channel_lines(db, ctx.organization, cms, m, summary)
        ],
        statement=StatementOut(
            id=statement.id,
            currency=statement.currency,
            gross_amount=statement.gross_amount,
            fee_amount=statement.fee_amount,
            net_amount=statement.net_amount,
            reference=statement.reference,
            notes=statement.notes,
        )
        if statement
        else None,
        receipts=[_receipt_out(db, ctx, r) for r in receipts],
        adjustments=[
            AdjustmentOut(id=a.id, amount=a.amount, reason=a.reason, created_at=a.created_at)
            for a in adjustments
        ],
    )


@router.put("/finance/statements")
def set_statement(body: StatementIn, ctx: Auth, request: Request, db: DbSession) -> StatementOut:
    cms = _cms(db, ctx, body.cms_partner_id)
    m = _month(body.month)
    statement = db.scalar(
        select(CmsStatement).where(CmsStatement.cms_partner_id == cms.id, CmsStatement.month == m)
    )
    values = body.model_dump(exclude={"cms_partner_id", "month"})
    before = {k: str(getattr(statement, k)) for k in values} if statement else None
    if statement is None:
        statement = CmsStatement(
            organization_id=ctx.organization.id, cms_partner_id=cms.id, month=m, **values
        )
        db.add(statement)
    else:
        for k, v in values.items():
            setattr(statement, k, v)
    db.flush()
    _audit(
        db,
        ctx,
        request,
        "cms.statement_saved",
        "cms_partner",
        cms.id,
        {"name": f"{cms.name} {body.month}", "before": before, "net": str(body.net_amount)},
    )
    db.commit()
    return StatementOut(id=statement.id, **values)


@router.post("/finance/receipts", status_code=status.HTTP_201_CREATED)
def add_receipt(body: ReceiptIn, ctx: Auth, request: Request, db: DbSession) -> ReceiptOut:
    cms = _cms(db, ctx, body.cms_partner_id)
    if body.received_on > company_today(ctx.organization):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Received date is in the future")
    base = ctx.organization.base_currency
    currency = body.currency or base
    if currency == base:
        credited = body.amount
    elif body.amount_base is None:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"Enter how much the bank credited in {base} for this {currency} payment",
        )
    else:
        credited = body.amount_base
    receipt = BankReceipt(
        organization_id=ctx.organization.id,
        cms_partner_id=cms.id,
        month=_month(body.month),
        received_on=body.received_on,
        currency=currency,
        amount=body.amount,
        amount_base=credited,
        reference=body.reference,
        notes=body.notes,
    )
    db.add(receipt)
    db.flush()
    _audit(
        db,
        ctx,
        request,
        "cms.receipt_added",
        "cms_partner",
        cms.id,
        {
            "name": f"{cms.name} {body.month}",
            "amount": f"{currency} {body.amount}",
            "credited": str(credited),
            "reference": body.reference,
        },
    )
    db.commit()
    db.refresh(receipt)
    return _receipt_out(db, ctx, receipt)


def _receipt_out(db, ctx: AuthContext, r: BankReceipt) -> ReceiptOut:
    return ReceiptOut(
        id=r.id,
        received_on=r.received_on,
        currency=r.currency,
        amount=r.amount,
        amount_base=r.amount_base,
        valued_base=receipt_value(db, ctx.organization, r),
        reference=r.reference,
        notes=r.notes,
    )


@router.delete("/finance/receipts/{receipt_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_receipt(receipt_id: uuid.UUID, ctx: Auth, request: Request, db: DbSession) -> None:
    receipt = db.scalar(
        select(BankReceipt).where(
            BankReceipt.id == receipt_id, BankReceipt.organization_id == ctx.organization.id
        )
    )
    if receipt is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Receipt not found")
    _audit(
        db,
        ctx,
        request,
        "cms.receipt_deleted",
        "cms_partner",
        receipt.cms_partner_id,
        {
            "name": f"{receipt.cms_partner.name} {receipt.month:%Y-%m}",
            "amount": str(receipt.amount),
        },
    )
    db.delete(receipt)
    db.commit()


@router.post("/finance/adjustments", status_code=status.HTTP_201_CREATED)
def add_adjustment(body: AdjustmentIn, ctx: Auth, request: Request, db: DbSession) -> AdjustmentOut:
    cms = _cms(db, ctx, body.cms_partner_id)
    adjustment = CmsAdjustment(
        organization_id=ctx.organization.id,
        cms_partner_id=cms.id,
        month=_month(body.month),
        amount=body.amount,
        reason=body.reason.strip(),
    )
    db.add(adjustment)
    db.flush()
    _audit(
        db,
        ctx,
        request,
        "cms.adjustment_added",
        "cms_partner",
        cms.id,
        {
            "name": f"{cms.name} {body.month}",
            "amount": str(body.amount),
            "reason": adjustment.reason,
        },
    )
    db.commit()
    db.refresh(adjustment)
    return AdjustmentOut(
        id=adjustment.id,
        amount=adjustment.amount,
        reason=adjustment.reason,
        created_at=adjustment.created_at,
    )


@router.delete("/finance/adjustments/{adjustment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_adjustment(adjustment_id: uuid.UUID, ctx: Auth, request: Request, db: DbSession) -> None:
    adjustment = db.scalar(
        select(CmsAdjustment).where(
            CmsAdjustment.id == adjustment_id, CmsAdjustment.organization_id == ctx.organization.id
        )
    )
    if adjustment is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Adjustment not found")
    _audit(
        db,
        ctx,
        request,
        "cms.adjustment_deleted",
        "cms_partner",
        adjustment.cms_partner_id,
        {"amount": str(adjustment.amount), "reason": adjustment.reason},
    )
    db.delete(adjustment)
    db.commit()
