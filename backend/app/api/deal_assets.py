"""Deal assets (PDF slide 4 step 03): episode metadata and contract documents."""

import uuid
from typing import Annotated
from urllib.parse import quote

from fastapi import APIRouter, File, Form, HTTPException, Request, Response, UploadFile, status
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import selectinload

from app.api.deps import Auth, AuthContext, client_ip
from app.api.pagination import Page, Pagination, paginate
from app.core.database import DbSession
from app.models import ContentDeal, DealDocument, DealEpisode, User
from app.schemas.deal_assets import (
    DocumentKind,
    DocumentOut,
    EpisodeImportOut,
    EpisodeIn,
    EpisodeOut,
)
from app.services import file_store
from app.services.audit import record_audit
from app.services.episodes import TEMPLATE, import_episodes, normal_season, scope_error

router = APIRouter(tags=["deal assets"])

MAX_CSV_BYTES = 2 * 1024 * 1024
MAX_FILE_BYTES = 15 * 1024 * 1024
MAX_FILES_PER_DEAL = 20
ALLOWED_EXTENSIONS = {
    ".pdf": "application/pdf",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xls": "application/vnd.ms-excel",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".csv": "text/csv",
    ".txt": "text/plain",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".eml": "message/rfc822",
}


def _deal(db, ctx: AuthContext, deal_id: uuid.UUID) -> ContentDeal:
    deal = db.scalar(
        select(ContentDeal)
        .options(selectinload(ContentDeal.episode_ranges))
        .where(ContentDeal.id == deal_id, ContentDeal.organization_id == ctx.organization.id)
    )
    if deal is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Deal not found")
    return deal


def _audit(db, ctx, request, action, deal, details):
    record_audit(
        db,
        action,
        organization_id=ctx.organization.id,
        user_id=ctx.user.id,
        entity_type="deal",
        entity_id=deal.id,
        details={"title": deal.title, **details},
        ip=client_ip(request),
    )


def _episode_out(e: DealEpisode) -> EpisodeOut:
    return EpisodeOut(
        id=e.id,
        season=e.season,
        episode_number=e.episode_number,
        title=e.title,
        description=e.description,
        air_date=e.air_date,
        duration_minutes=e.duration_minutes,
        language=e.language,
        notes=e.notes,
        created_at=e.created_at,
    )


def _episode_label(e: DealEpisode) -> str:
    return f"S{e.season} E{e.episode_number}" if e.season else f"Ep {e.episode_number}"


# ---- Episodes ------------------------------------------------------------------------------


@router.get("/episodes/template")
def episode_template(_: Auth) -> Response:
    return Response(
        TEMPLATE,
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="episodes-template.csv"'},
    )


@router.get("/deals/{deal_id}/episodes")
def list_episodes(
    deal_id: uuid.UUID, ctx: Auth, db: DbSession, pagination: Pagination, q: str | None = None
) -> Page[EpisodeOut]:
    deal = _deal(db, ctx, deal_id)
    stmt = select(DealEpisode).where(DealEpisode.deal_id == deal.id)
    if q and q.strip():
        term = q.strip()
        conditions = [
            DealEpisode.title.ilike(f"%{term}%"),
            DealEpisode.description.ilike(f"%{term}%"),
        ]
        if term.isdigit():
            conditions.append(DealEpisode.episode_number == int(term))
        stmt = stmt.where(or_(*conditions))
    stmt = stmt.order_by(DealEpisode.season.nulls_first(), DealEpisode.episode_number)
    rows, total = paginate(db, stmt, pagination)
    return Page(
        items=[_episode_out(e) for e in rows],
        total=total,
        page=pagination.page,
        page_size=pagination.page_size,
    )


def _save_episode(db, deal: ContentDeal, episode: DealEpisode, body: EpisodeIn) -> None:
    problem = scope_error(deal, body.season, body.episode_number)
    if problem:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, problem)
    for key, value in body.model_dump().items():
        setattr(episode, key, value)
    episode.season = normal_season(deal, body.season)
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT, "This episode already has details — edit it instead"
        ) from exc


@router.post("/deals/{deal_id}/episodes", status_code=status.HTTP_201_CREATED)
def add_episode(
    deal_id: uuid.UUID, body: EpisodeIn, ctx: Auth, request: Request, db: DbSession
) -> EpisodeOut:
    deal = _deal(db, ctx, deal_id)
    episode = DealEpisode(organization_id=ctx.organization.id, deal_id=deal.id)
    db.add(episode)
    _save_episode(db, deal, episode, body)
    _audit(
        db,
        ctx,
        request,
        "episode.added",
        deal,
        {"name": f"{_episode_label(episode)} · {episode.title}"},
    )
    db.commit()
    db.refresh(episode)
    return _episode_out(episode)


def _get_episode(db, ctx: AuthContext, episode_id: uuid.UUID) -> DealEpisode:
    e = db.scalar(
        select(DealEpisode).where(
            DealEpisode.id == episode_id, DealEpisode.organization_id == ctx.organization.id
        )
    )
    if e is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Episode not found")
    return e


@router.put("/episodes/{episode_id}")
def update_episode(
    episode_id: uuid.UUID, body: EpisodeIn, ctx: Auth, request: Request, db: DbSession
) -> EpisodeOut:
    episode = _get_episode(db, ctx, episode_id)
    deal = _deal(db, ctx, episode.deal_id)
    _save_episode(db, deal, episode, body)
    _audit(
        db,
        ctx,
        request,
        "episode.updated",
        deal,
        {"name": f"{_episode_label(episode)} · {episode.title}"},
    )
    db.commit()
    db.refresh(episode)
    return _episode_out(episode)


@router.delete("/episodes/{episode_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_episode(episode_id: uuid.UUID, ctx: Auth, request: Request, db: DbSession) -> None:
    episode = _get_episode(db, ctx, episode_id)
    deal = _deal(db, ctx, episode.deal_id)
    _audit(
        db,
        ctx,
        request,
        "episode.deleted",
        deal,
        {"name": f"{_episode_label(episode)} · {episode.title}"},
    )
    db.delete(episode)
    db.commit()


@router.post("/deals/{deal_id}/episodes/import")
async def import_episode_csv(
    deal_id: uuid.UUID,
    ctx: Auth,
    request: Request,
    db: DbSession,
    file: Annotated[UploadFile, File()],
) -> EpisodeImportOut:
    deal = _deal(db, ctx, deal_id)
    content = await file.read(MAX_CSV_BYTES + 1)
    if len(content) > MAX_CSV_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "File is larger than 2 MB")
    if not content.strip():
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "The file is empty")
    result = import_episodes(db, deal, content)
    if result.created or result.updated:
        _audit(
            db,
            ctx,
            request,
            "episode.imported",
            deal,
            {"name": file.filename, "created": result.created, "updated": result.updated},
        )
    db.commit()
    return EpisodeImportOut(created=result.created, updated=result.updated, errors=result.errors)


# ---- Documents -----------------------------------------------------------------------------


def _document_out(d: DealDocument, names: dict[uuid.UUID, str]) -> DocumentOut:
    return DocumentOut(
        id=d.id,
        file_name=d.file_name,
        content_type=d.content_type,
        size_bytes=d.size_bytes,
        kind=d.kind,  # type: ignore[arg-type]
        uploaded_by=names.get(d.uploaded_by_id) if d.uploaded_by_id else None,
        created_at=d.created_at,
    )


def _names(db, docs: list[DealDocument]) -> dict[uuid.UUID, str]:
    ids = {d.uploaded_by_id for d in docs if d.uploaded_by_id}
    if not ids:
        return {}
    return dict(db.execute(select(User.id, User.full_name).where(User.id.in_(ids))).all())


@router.get("/deals/{deal_id}/documents")
def list_documents(deal_id: uuid.UUID, ctx: Auth, db: DbSession) -> list[DocumentOut]:
    deal = _deal(db, ctx, deal_id)
    docs = db.scalars(
        select(DealDocument)
        .where(DealDocument.deal_id == deal.id)
        .order_by(DealDocument.created_at.desc())
    ).all()
    names = _names(db, list(docs))
    return [_document_out(d, names) for d in docs]


@router.post("/deals/{deal_id}/documents", status_code=status.HTTP_201_CREATED)
async def upload_documents(
    deal_id: uuid.UUID,
    ctx: Auth,
    request: Request,
    db: DbSession,
    files: Annotated[list[UploadFile], File()],
    kind: Annotated[DocumentKind, Form()] = "contract",
) -> list[DocumentOut]:
    deal = _deal(db, ctx, deal_id)
    have = db.scalar(
        select(func.count()).select_from(DealDocument).where(DealDocument.deal_id == deal.id)
    )
    if have + len(files) > MAX_FILES_PER_DEAL:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"A deal can hold up to {MAX_FILES_PER_DEAL} files; it has {have}.",
        )
    saved = []
    stored: list[str] = []  # R2 keys written so far, removed again if the upload fails
    try:
        for f in files:
            await _save_one(db, ctx, deal, f, kind, saved, stored)
        db.flush()
        _audit(
            db,
            ctx,
            request,
            "document.uploaded",
            deal,
            {"name": ", ".join(d.file_name for d in saved), "kind": kind},
        )
        db.commit()
    except BaseException:
        db.rollback()
        for key in stored:
            file_store.remove(key)
        raise
    names = {ctx.user.id: ctx.user.full_name}
    return [_document_out(d, names) for d in saved]


async def _save_one(db, ctx: AuthContext, deal, f: UploadFile, kind, saved, stored) -> None:
    """Check one uploaded file and add it to the deal (in R2 when configured)."""
    name = (f.filename or "file").replace("\\", "/").split("/")[-1][:255]
    ext = ("." + name.rsplit(".", 1)[-1].lower()) if "." in name else ""
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"{name}: only PDF, Word, Excel, CSV, text, email and image files are allowed",
        )
    data = await f.read(MAX_FILE_BYTES + 1)
    if len(data) > MAX_FILE_BYTES:
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, f"{name} is larger than 15 MB"
        )
    if not data:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"{name} is empty")
    try:
        key = file_store.save(
            ctx.organization.id, "deal-documents", name, data, ALLOWED_EXTENSIONS[ext]
        )
    except file_store.FileStoreError as exc:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY, f"{name}: could not store the file, try again"
        ) from exc
    if key:
        stored.append(key)
    doc = DealDocument(
        organization_id=ctx.organization.id,
        deal_id=deal.id,
        file_name=name,
        content_type=ALLOWED_EXTENSIONS[ext],
        size_bytes=len(data),
        kind=kind,
        uploaded_by_id=ctx.user.id,
        data=None if key else data,
        storage_key=key,
    )
    db.add(doc)
    saved.append(doc)


def _get_document(db, ctx: AuthContext, document_id: uuid.UUID) -> DealDocument:
    doc = db.scalar(
        select(DealDocument).where(
            DealDocument.id == document_id, DealDocument.organization_id == ctx.organization.id
        )
    )
    if doc is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Document not found")
    return doc


def _file_bytes(key: str | None, data: bytes | None) -> bytes:
    if not key:
        if data is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "The file is missing")
        return data
    try:
        return file_store.load(key)
    except file_store.FileStoreError as exc:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY, "Could not fetch the file, try again"
        ) from exc


@router.get("/documents/{document_id}/download")
def download_document(document_id: uuid.UUID, ctx: Auth, db: DbSession) -> Response:
    doc = _get_document(db, ctx, document_id)
    ascii_name = (
        doc.file_name.encode("ascii", "replace").decode().replace('"', "").replace("?", "_")
    )
    return Response(
        _file_bytes(doc.storage_key, doc.data),
        media_type=doc.content_type,
        headers={
            "Content-Disposition": f'attachment; filename="{ascii_name}"; '
            f"filename*=UTF-8''{quote(doc.file_name)}",
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.delete("/documents/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_document(document_id: uuid.UUID, ctx: Auth, request: Request, db: DbSession) -> None:
    doc = _get_document(db, ctx, document_id)
    deal = _deal(db, ctx, doc.deal_id)
    _audit(db, ctx, request, "document.deleted", deal, {"name": doc.file_name})
    key = doc.storage_key
    db.delete(doc)
    db.commit()
    file_store.remove(key)
