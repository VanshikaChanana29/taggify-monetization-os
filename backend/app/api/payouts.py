"""Part 4B: incentive rates and runs, deal economics, installments, expenses, month close."""

import uuid
from collections import defaultdict
from dataclasses import asdict
from datetime import UTC, datetime
from decimal import Decimal

from fastapi import APIRouter, HTTPException, Query, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import Auth, AuthContext, client_ip
from app.core.database import DbSession
from app.models import (
    Channel,
    ContentDeal,
    DealExpense,
    DealInstallment,
    Employee,
    IncentiveLine,
    IncentiveRate,
    IncentiveRun,
    MonthClose,
    User,
)
from app.schemas.channels import PersonRef
from app.schemas.finance import parse_month
from app.schemas.payouts import (
    CloseCheck,
    ClosedMonth,
    CloseIn,
    CloseStatus,
    EconomicsMonth,
    EconomicsOut,
    ExpenseIn,
    ExpenseOut,
    IncentiveLineOut,
    IncentivePerson,
    IncentiveRateIn,
    IncentiveRateOut,
    IncentiveRunOut,
    InstallmentIn,
    InstallmentOut,
    InstallmentPaidIn,
    MonthIn,
    ReopenIn,
)
from app.services.audit import record_audit
from app.services.cms_fees import money
from app.services.deal_economics import deal_economics
from app.services.deals import company_today
from app.services.incentives import calculate, rate_label
from app.services.month_close import MonthClosedError, closed_months, ensure_open
from app.services.settlement import month_settlements

router = APIRouter(tags=["payouts"])


def _month(value: str):
    try:
        return parse_month(value)
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc


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


def _employee(db: Session, ctx: AuthContext, employee_id: uuid.UUID) -> Employee:
    e = db.scalar(
        select(Employee).where(
            Employee.id == employee_id, Employee.organization_id == ctx.organization.id
        )
    )
    if e is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Person not found")
    return e


def _deal(db: Session, ctx: AuthContext, deal_id: uuid.UUID) -> ContentDeal:
    d = db.scalar(
        select(ContentDeal).where(
            ContentDeal.id == deal_id, ContentDeal.organization_id == ctx.organization.id
        )
    )
    if d is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Deal not found")
    return d


def _open(db, ctx, day, what):
    try:
        ensure_open(db, ctx.organization, day, what)
    except MonthClosedError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc


# ---- Incentive rates ---------------------------------------------------------------------------


@router.get("/employees/{employee_id}/incentive-rates")
def list_rates(employee_id: uuid.UUID, ctx: Auth, db: DbSession) -> list[IncentiveRateOut]:
    e = _employee(db, ctx, employee_id)
    rows = db.scalars(
        select(IncentiveRate)
        .where(IncentiveRate.employee_id == e.id)
        .order_by(IncentiveRate.kind, IncentiveRate.effective_from.desc())
    )
    return [
        IncentiveRateOut(id=r.id, kind=r.kind, rate_pct=r.rate_pct, effective_from=r.effective_from)
        for r in rows
    ]


@router.post("/employees/{employee_id}/incentive-rates", status_code=status.HTTP_201_CREATED)
def add_rate(
    employee_id: uuid.UUID, body: IncentiveRateIn, ctx: Auth, request: Request, db: DbSession
) -> IncentiveRateOut:
    e = _employee(db, ctx, employee_id)
    if body.kind == "team_lead" and not e.role.can_lead_team:
        raise HTTPException(
            status.HTTP_409_CONFLICT, f"{e.full_name}'s role ({e.role.name}) cannot lead a team"
        )
    _open(db, ctx, body.effective_from, "This rate")
    if db.scalar(
        select(IncentiveRate.id).where(
            IncentiveRate.employee_id == e.id,
            IncentiveRate.kind == body.kind,
            IncentiveRate.effective_from == body.effective_from,
        )
    ):
        raise HTTPException(
            status.HTTP_409_CONFLICT, "A rate already starts on that date; delete it first"
        )
    rate = IncentiveRate(
        organization_id=ctx.organization.id,
        employee_id=e.id,
        kind=body.kind,
        rate_pct=body.rate_pct,
        effective_from=body.effective_from,
    )
    db.add(rate)
    db.flush()
    _audit(
        db,
        ctx,
        request,
        "incentive.rate_added",
        "employee",
        e.id,
        {
            "name": e.full_name,
            "kind": body.kind,
            "rate_pct": str(body.rate_pct),
            "from": str(body.effective_from),
        },
    )
    db.commit()
    return IncentiveRateOut(
        id=rate.id, kind=rate.kind, rate_pct=rate.rate_pct, effective_from=rate.effective_from
    )


@router.delete("/incentive-rates/{rate_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_rate(rate_id: uuid.UUID, ctx: Auth, request: Request, db: DbSession) -> None:
    rate = db.scalar(
        select(IncentiveRate).where(
            IncentiveRate.id == rate_id, IncentiveRate.organization_id == ctx.organization.id
        )
    )
    if rate is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Rate not found")
    _open(db, ctx, rate.effective_from, "This rate")
    _audit(
        db,
        ctx,
        request,
        "incentive.rate_deleted",
        "employee",
        rate.employee_id,
        {
            "name": rate.employee.full_name,
            "kind": rate.kind,
            "rate_pct": str(rate.rate_pct),
            "from": str(rate.effective_from),
        },
    )
    db.delete(rate)
    db.commit()


# ---- Incentive runs ----------------------------------------------------------------------------


def _run_out(
    db: Session, ctx: AuthContext, month_str: str, run: IncentiveRun | None
) -> IncentiveRunOut:
    org = ctx.organization
    names = dict(
        db.execute(
            select(Employee.id, Employee.full_name).where(Employee.organization_id == org.id)
        ).all()
    )
    channels = dict(
        db.execute(select(Channel.id, Channel.name).where(Channel.organization_id == org.id)).all()
    )
    if run is None:
        calc = calculate(db, org, _month(month_str))
        lines = [
            IncentiveLineOut(
                employee=PersonRef(id=line.employee_id, name=names.get(line.employee_id, "—")),
                channel_id=line.channel_id,
                channel_name=channels.get(line.channel_id, "—"),
                kind=line.kind,
                days=line.days,
                gross=line.gross,
                currency=line.currency,
                rates=rate_label(line.rates),
                amount=line.amount,
                amount_base=calc.amount_base[
                    (line.employee_id, line.channel_id, line.kind, line.currency)
                ],
            )
            for line in calc.lines
        ]
        status_, total, warnings, computed_at, approved_by, approved_at = (
            "preview",
            calc.total_base,
            calc.warnings,
            None,
            None,
            None,
        )
    else:
        lines = [
            IncentiveLineOut(
                employee=PersonRef(id=line.employee_id, name=names.get(line.employee_id, "—")),
                channel_id=line.channel_id,
                channel_name=channels.get(line.channel_id, "—"),
                kind=line.kind,
                days=line.days,
                gross=line.gross,
                currency=line.currency,
                rates=line.rates,
                amount=line.amount,
                amount_base=line.amount_base,
            )
            for line in run.lines
        ]
        user = db.get(User, run.approved_by_id) if run.approved_by_id else None
        status_, total, warnings = run.status, run.total_base, run.warnings
        computed_at, approved_by, approved_at = (
            run.computed_at,
            user.full_name if user else None,
            run.approved_at,
        )

    people: dict[uuid.UUID, dict] = defaultdict(
        lambda: {"manager": Decimal(0), "team_lead": Decimal(0)}
    )
    for line in lines:
        people[line.employee.id][line.kind] += line.amount_base
    return IncentiveRunOut(
        month=month_str,
        base_currency=org.base_currency,
        status=status_,
        computed_at=computed_at,
        approved_by=approved_by,
        approved_at=approved_at,
        total_base=total,
        warnings=warnings,
        people=sorted(
            (
                IncentivePerson(
                    employee=PersonRef(id=e, name=names.get(e, "—")),
                    manager_base=money(v["manager"]),
                    team_lead_base=money(v["team_lead"]),
                    total_base=money(v["manager"] + v["team_lead"]),
                )
                for e, v in people.items()
            ),
            key=lambda p: -p.total_base,
        ),
        lines=sorted(lines, key=lambda line: (line.employee.name, line.kind, -line.amount_base)),
    )


def _run(db: Session, ctx: AuthContext, month) -> IncentiveRun | None:
    return db.scalar(
        select(IncentiveRun).where(
            IncentiveRun.organization_id == ctx.organization.id, IncentiveRun.month == month
        )
    )


@router.get("/finance/incentives")
def get_incentives(
    ctx: Auth, db: DbSession, month: str = Query(pattern=r"^\d{4}-\d{2}$")
) -> IncentiveRunOut:
    return _run_out(db, ctx, month, _run(db, ctx, _month(month)))


@router.post("/finance/incentives/compute")
def compute_incentives(
    body: MonthIn, ctx: Auth, request: Request, db: DbSession
) -> IncentiveRunOut:
    month = _month(body.month)
    if month in closed_months(db, ctx.organization):
        raise HTTPException(status.HTTP_409_CONFLICT, f"{month:%B %Y} is closed")
    run = _run(db, ctx, month)
    if run and run.status != "draft":
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "This month's incentives are approved; reopen them to recalculate",
        )
    calc = calculate(db, ctx.organization, month)
    if run is None:
        run = IncentiveRun(
            organization_id=ctx.organization.id,
            month=month,
            status="draft",
            computed_at=datetime.now(UTC),
        )
        db.add(run)
    run.computed_at = datetime.now(UTC)
    run.total_base = calc.total_base
    run.warnings = calc.warnings
    run.lines = [
        IncentiveLine(
            employee_id=line.employee_id,
            channel_id=line.channel_id,
            kind=line.kind,
            days=line.days,
            gross=line.gross,
            currency=line.currency,
            amount=line.amount,
            amount_base=calc.amount_base[
                (line.employee_id, line.channel_id, line.kind, line.currency)
            ],
            rates=rate_label(line.rates),
        )
        for line in calc.lines
    ]
    db.flush()
    _audit(
        db,
        ctx,
        request,
        "incentive.computed",
        "incentive_run",
        run.id,
        {"name": body.month, "total": str(calc.total_base)},
    )
    db.commit()
    db.expire_all()
    return _run_out(db, ctx, body.month, _run(db, ctx, month))


@router.post("/finance/incentives/approve")
def approve_incentives(
    body: MonthIn, ctx: Auth, request: Request, db: DbSession
) -> IncentiveRunOut:
    month = _month(body.month)
    run = _run(db, ctx, month)
    if run is None or run.status != "draft":
        raise HTTPException(status.HTTP_409_CONFLICT, "Calculate a draft for this month first")
    if any("rate for this month" in w for w in run.warnings):
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Add the missing FX rate and recalculate before approving"
        )
    run.status = "approved"
    run.approved_by_id = ctx.user.id
    run.approved_at = datetime.now(UTC)
    _audit(
        db,
        ctx,
        request,
        "incentive.approved",
        "incentive_run",
        run.id,
        {"name": body.month, "total": str(run.total_base)},
    )
    db.commit()
    return _run_out(db, ctx, body.month, run)


@router.post("/finance/incentives/reopen")
def reopen_incentives(body: MonthIn, ctx: Auth, request: Request, db: DbSession) -> IncentiveRunOut:
    month = _month(body.month)
    run = _run(db, ctx, month)
    if run is None or run.status != "approved":
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Only approved incentives can be reopened (closed months must be reopened first)",
        )
    run.status = "draft"
    run.approved_by_id = None
    run.approved_at = None
    _audit(db, ctx, request, "incentive.reopened", "incentive_run", run.id, {"name": body.month})
    db.commit()
    return _run_out(db, ctx, body.month, run)


# ---- Deal economics, installments, expenses ---------------------------------------------------


@router.get("/deals/{deal_id}/economics")
def get_economics(deal_id: uuid.UUID, ctx: Auth, db: DbSession) -> EconomicsOut:
    deal = _deal(db, ctx, deal_id)
    econ = deal_economics(db, ctx.organization, deal)
    today = company_today(ctx.organization)
    installments = db.scalars(
        select(DealInstallment)
        .where(DealInstallment.deal_id == deal.id)
        .order_by(DealInstallment.due_date)
    ).all()
    expenses = db.scalars(
        select(DealExpense)
        .where(DealExpense.deal_id == deal.id)
        .order_by(DealExpense.spent_on.desc())
    ).all()
    data = asdict(econ)
    data["by_month"] = [EconomicsMonth(**m) for m in data["by_month"]]
    return EconomicsOut(
        **data,
        installments=[
            InstallmentOut(
                id=i.id,
                due_date=i.due_date,
                amount=i.amount,
                paid_on=i.paid_on,
                paid_amount=i.paid_amount,
                reference=i.reference,
                notes=i.notes,
                overdue=i.paid_on is None and i.due_date < today,
            )
            for i in installments
        ],
        expense_items=[
            ExpenseOut(id=x.id, spent_on=x.spent_on, amount=x.amount, description=x.description)
            for x in expenses
        ],
    )


@router.post("/deals/{deal_id}/installments", status_code=status.HTTP_201_CREATED)
def add_installment(
    deal_id: uuid.UUID, body: InstallmentIn, ctx: Auth, request: Request, db: DbSession
) -> InstallmentOut:
    deal = _deal(db, ctx, deal_id)
    if deal.deal_type not in ("fixed_fee", "hybrid"):
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Installments are for fixed-fee and hybrid deals"
        )
    i = DealInstallment(organization_id=ctx.organization.id, deal_id=deal.id, **body.model_dump())
    db.add(i)
    db.flush()
    _audit(
        db,
        ctx,
        request,
        "deal.installment_added",
        "deal",
        deal.id,
        {"title": deal.title, "due": str(body.due_date), "amount": str(body.amount)},
    )
    db.commit()
    return InstallmentOut(
        id=i.id,
        due_date=i.due_date,
        amount=i.amount,
        paid_on=None,
        paid_amount=None,
        reference=i.reference,
        notes=i.notes,
        overdue=i.due_date < company_today(ctx.organization),
    )


@router.patch("/installments/{installment_id}")
def mark_installment(
    installment_id: uuid.UUID, body: InstallmentPaidIn, ctx: Auth, request: Request, db: DbSession
) -> InstallmentOut:
    i = db.scalar(
        select(DealInstallment).where(
            DealInstallment.id == installment_id,
            DealInstallment.organization_id == ctx.organization.id,
        )
    )
    if i is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Installment not found")
    today = company_today(ctx.organization)
    if body.paid_on and body.paid_on > today:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Paid date is in the future")
    i.paid_on = body.paid_on
    i.paid_amount = (body.paid_amount or i.amount) if body.paid_on else None
    if body.reference is not None:
        i.reference = body.reference or None
    deal = db.get(ContentDeal, i.deal_id)
    _audit(
        db,
        ctx,
        request,
        "deal.installment_paid" if body.paid_on else "deal.installment_unpaid",
        "deal",
        i.deal_id,
        {
            "title": deal.title if deal else None,
            "due": str(i.due_date),
            "amount": str(i.amount),
            "paid": str(i.paid_amount) if i.paid_amount else None,
            "paid_on": str(i.paid_on) if i.paid_on else None,
            "reference": i.reference,
        },
    )
    db.commit()
    return InstallmentOut(
        id=i.id,
        due_date=i.due_date,
        amount=i.amount,
        paid_on=i.paid_on,
        paid_amount=i.paid_amount,
        reference=i.reference,
        notes=i.notes,
        overdue=i.paid_on is None and i.due_date < today,
    )


@router.delete("/installments/{installment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_installment(
    installment_id: uuid.UUID, ctx: Auth, request: Request, db: DbSession
) -> None:
    i = db.scalar(
        select(DealInstallment).where(
            DealInstallment.id == installment_id,
            DealInstallment.organization_id == ctx.organization.id,
        )
    )
    if i is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Installment not found")
    if i.paid_on:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "A paid installment cannot be deleted; mark it unpaid first"
        )
    _audit(
        db,
        ctx,
        request,
        "deal.installment_deleted",
        "deal",
        i.deal_id,
        {"due": str(i.due_date), "amount": str(i.amount)},
    )
    db.delete(i)
    db.commit()


@router.post("/deals/{deal_id}/expenses", status_code=status.HTTP_201_CREATED)
def add_expense(
    deal_id: uuid.UUID, body: ExpenseIn, ctx: Auth, request: Request, db: DbSession
) -> ExpenseOut:
    deal = _deal(db, ctx, deal_id)
    if body.spent_on > company_today(ctx.organization):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Date is in the future")
    x = DealExpense(organization_id=ctx.organization.id, deal_id=deal.id, **body.model_dump())
    db.add(x)
    db.flush()
    _audit(
        db,
        ctx,
        request,
        "deal.expense_added",
        "deal",
        deal.id,
        {"title": deal.title, "amount": str(body.amount), "description": body.description},
    )
    db.commit()
    return ExpenseOut(id=x.id, spent_on=x.spent_on, amount=x.amount, description=x.description)


@router.delete("/expenses/{expense_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_expense(expense_id: uuid.UUID, ctx: Auth, request: Request, db: DbSession) -> None:
    x = db.scalar(
        select(DealExpense).where(
            DealExpense.id == expense_id, DealExpense.organization_id == ctx.organization.id
        )
    )
    if x is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Expense not found")
    _audit(
        db,
        ctx,
        request,
        "deal.expense_deleted",
        "deal",
        x.deal_id,
        {"amount": str(x.amount), "description": x.description},
    )
    db.delete(x)
    db.commit()


# ---- Month close -------------------------------------------------------------------------------


def _checks(db: Session, ctx: AuthContext, month) -> list[CloseCheck]:
    rows = month_settlements(db, ctx.organization, month)
    run = _run(db, ctx, month)
    # Slide 16 step 6: cash received against what each CMS owes.
    unpaid = [r.cms_name for r in rows if r.cms_id and (r.net_base or 0) > 0 and not r.received]
    checks = [
        CloseCheck(
            key="revenue",
            ok=any(r.gross > 0 for r in rows),
            blocking=False,
            message="Revenue imported for the month"
            if any(r.gross > 0 for r in rows)
            else "No revenue imported for this month",
        ),
        CloseCheck(
            key="pricing",
            ok=not any(r.warnings for r in rows),
            blocking=True,
            message="Every CMS has fee tiers and an FX rate"
            if not any(r.warnings for r in rows)
            else "; ".join(f"{r.cms_name}: {w}" for r in rows for w in r.warnings),
        ),
        CloseCheck(
            key="statements",
            ok=all(r.statement_net is not None for r in rows if r.cms_id),
            blocking=False,
            message="Every CMS statement entered"
            if all(r.statement_net is not None for r in rows if r.cms_id)
            else "Missing CMS statement for: "
            + ", ".join(r.cms_name for r in rows if r.cms_id and r.statement_net is None),
        ),
        CloseCheck(
            key="cash",
            ok=not unpaid,
            blocking=False,
            message="Bank receipts recorded for every CMS"
            if not unpaid
            else "No bank receipt yet for: " + ", ".join(unpaid),
        ),
        CloseCheck(
            key="incentives",
            ok=run is not None and run.status in ("approved", "locked"),
            blocking=True,
            message="Incentives approved"
            if run is not None and run.status in ("approved", "locked")
            else "Calculate and approve this month's incentives",
        ),
    ]
    return checks


@router.get("/finance/close")
def close_status(
    ctx: Auth, db: DbSession, month: str = Query(pattern=r"^\d{4}-\d{2}$")
) -> CloseStatus:
    m = _month(month)
    close = db.scalar(
        select(MonthClose).where(
            MonthClose.organization_id == ctx.organization.id, MonthClose.month == m
        )
    )
    checks = _checks(db, ctx, m)
    user = db.get(User, close.closed_by_id) if close and close.closed_by_id else None
    return CloseStatus(
        month=month,
        closed=close is not None,
        closed_by=user.full_name if user else None,
        closed_at=close.closed_at if close else None,
        notes=close.notes if close else None,
        checks=checks,
        can_close=close is None and all(c.ok for c in checks if c.blocking),
    )


@router.get("/finance/closes")
def list_closes(ctx: Auth, db: DbSession) -> list[ClosedMonth]:
    rows = db.scalars(
        select(MonthClose)
        .where(MonthClose.organization_id == ctx.organization.id)
        .order_by(MonthClose.month.desc())
    ).all()
    out = []
    for c in rows:
        user = db.get(User, c.closed_by_id) if c.closed_by_id else None
        out.append(
            ClosedMonth(
                month=f"{c.month:%Y-%m}",
                closed_by=user.full_name if user else None,
                closed_at=c.closed_at,
                gross=Decimal(c.snapshot.get("gross", "0")),
                outstanding=Decimal(c.snapshot.get("outstanding", "0")),
                incentives=Decimal(c.snapshot.get("incentives", "0")),
            )
        )
    return out


@router.post("/finance/close")
def close_month(body: CloseIn, ctx: Auth, request: Request, db: DbSession) -> CloseStatus:
    m = _month(body.month)
    if m >= company_today(ctx.organization).replace(day=1):
        raise HTTPException(status.HTTP_409_CONFLICT, "Only past months can be closed")
    status_ = close_status(ctx, db, body.month)
    if status_.closed:
        raise HTTPException(status.HTTP_409_CONFLICT, f"{m:%B %Y} is already closed")
    if not status_.can_close:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Cannot close yet: "
            + "; ".join(c.message for c in status_.checks if c.blocking and not c.ok),
        )
    later = db.scalar(
        select(MonthClose.month).where(
            MonthClose.organization_id == ctx.organization.id, MonthClose.month > m
        )
    )
    if later:
        raise HTTPException(
            status.HTTP_409_CONFLICT, f"{later:%B %Y} is already closed; close months in order"
        )
    rows = month_settlements(db, ctx.organization, m)
    run = _run(db, ctx, m)
    zero = Decimal(0)
    snapshot = {
        "gross": str(money(sum((r.gross_base or zero for r in rows), zero))),
        "fee": str(money(sum((r.fee_base or zero for r in rows), zero))),
        "net_receivable": str(money(sum((r.net_base or zero for r in rows if r.cms_id), zero))),
        "received": str(money(sum((r.received for r in rows), zero))),
        "outstanding": str(money(sum((r.outstanding or zero for r in rows), zero))),
        "incentives": str(run.total_base if run else zero),
        "cms": [
            {
                k: (str(v) if isinstance(v, Decimal) else v)
                for k, v in asdict(r).items()
                if k not in ("cms_id",)
            }
            | {"cms_id": str(r.cms_id) if r.cms_id else None}
            for r in rows
        ],
    }
    run.status = "locked"
    db.add(
        MonthClose(
            organization_id=ctx.organization.id,
            month=m,
            closed_by_id=ctx.user.id,
            closed_at=datetime.now(UTC),
            snapshot=snapshot,
            notes=body.notes,
        )
    )
    _audit(
        db,
        ctx,
        request,
        "month.closed",
        "month",
        None,
        {"name": body.month, "gross": snapshot["gross"], "incentives": snapshot["incentives"]},
    )
    db.commit()
    return close_status(ctx, db, body.month)


@router.post("/finance/reopen")
def reopen_month(body: ReopenIn, ctx: Auth, request: Request, db: DbSession) -> CloseStatus:
    m = _month(body.month)
    close = db.scalar(
        select(MonthClose).where(
            MonthClose.organization_id == ctx.organization.id, MonthClose.month == m
        )
    )
    if close is None:
        raise HTTPException(status.HTTP_409_CONFLICT, f"{m:%B %Y} is not closed")
    later = db.scalar(
        select(MonthClose.month).where(
            MonthClose.organization_id == ctx.organization.id, MonthClose.month > m
        )
    )
    if later:
        raise HTTPException(
            status.HTTP_409_CONFLICT, f"Reopen {later:%B %Y} first; months reopen newest first"
        )
    run = _run(db, ctx, m)
    if run:
        run.status = "approved"
    _audit(
        db,
        ctx,
        request,
        "month.reopened",
        "month",
        None,
        {"name": body.month, "reason": body.reason, "snapshot": close.snapshot},
    )
    db.delete(close)
    db.commit()
    return close_status(ctx, db, body.month)
