"""Server-side pagination for lists that grow without bound (activity, deals, revenue rows…).

Small, bounded lists (users of a company, companies) are returned whole and paginated
in the browser instead.
"""

from typing import Annotated, Any, Generic, TypeVar

from fastapi import Depends, Query
from pydantic import BaseModel
from sqlalchemy import Select, func, select
from sqlalchemy.orm import Session

T = TypeVar("T")

MAX_PAGE_SIZE = 100


class Page(BaseModel, Generic[T]):
    items: list[T]
    total: int
    page: int
    page_size: int


class PageParams(BaseModel):
    page: int
    page_size: int


def _page_params(
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=MAX_PAGE_SIZE)] = 25,
) -> PageParams:
    return PageParams(page=page, page_size=page_size)


Pagination = Annotated[PageParams, Depends(_page_params)]


def paginate(db: Session, stmt: Select[Any], params: PageParams) -> tuple[list[Any], int]:
    """Run `stmt` (already filtered and ordered) for one page; return (rows, total)."""
    total = db.scalar(select(func.count()).select_from(stmt.order_by(None).subquery())) or 0
    rows = db.scalars(
        stmt.limit(params.page_size).offset((params.page - 1) * params.page_size)
    ).all()
    return list(rows), total
