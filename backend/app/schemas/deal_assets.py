import uuid
from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

DocumentKind = Literal["contract", "annexure", "rights_evidence", "invoice", "other"]


class EpisodeIn(BaseModel):
    season: int | None = Field(default=None, ge=1, le=1000)
    episode_number: int = Field(ge=1, le=1_000_000)
    title: str = Field(min_length=1, max_length=300)
    description: str | None = Field(default=None, max_length=10000)
    air_date: date | None = None
    duration_minutes: int | None = Field(default=None, ge=1, le=10000)
    language: str | None = Field(default=None, max_length=60)
    notes: str | None = Field(default=None, max_length=5000)

    @field_validator("title")
    @classmethod
    def title_required(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Title is required")
        return value.strip()

    @field_validator("description", "language", "notes", mode="before")
    @classmethod
    def blank(cls, value: str | None) -> str | None:
        return value.strip() or None if isinstance(value, str) else value


class EpisodeOut(EpisodeIn):
    id: uuid.UUID
    created_at: datetime


class EpisodeImportOut(BaseModel):
    created: int
    updated: int
    errors: list[dict[str, Any]]


class DocumentOut(BaseModel):
    id: uuid.UUID
    file_name: str
    content_type: str
    size_bytes: int
    kind: DocumentKind
    uploaded_by: str | None
    created_at: datetime
