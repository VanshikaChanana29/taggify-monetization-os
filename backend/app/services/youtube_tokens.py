"""Connect YouTube channels from the owners' permission files (OAuth tokens).

A file is matched to a channel only by the channel ID YouTube itself reports for the token,
never by the file name:
- the token may read channel details (youtube.readonly) → YouTube says which channel it is;
- otherwise the file name must be the channel ID (UC….json) and a YouTube Analytics request
  for that ID must succeed with the token (YouTube refuses a token of another channel).

Only channels already in the company are connected; nothing is created. Tokens are stored
encrypted and never returned.
"""

import io
import json
import os
import re
import uuid
import zipfile
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta

from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models import Channel, Organization, YouTubeConnection
from app.services import youtube_api
from app.services.audit import record_audit

UC_ID = re.compile(r"UC[\w-]{22}")
MAX_FILES = 2000
MAX_FILE_BYTES = 64 * 1024
MAX_UPLOAD_BYTES = 20 * 1024 * 1024
WORKERS = 8


class TokenSetupError(Exception):
    """The server is missing TOKEN_ENCRYPTION_KEY."""


def _fernet() -> Fernet:
    key = get_settings().token_encryption_key
    if not key:
        raise TokenSetupError("TOKEN_ENCRYPTION_KEY is not set on the server")
    return Fernet(key.encode())


def encrypt(value: str) -> str:
    return _fernet().encrypt(value.encode()).decode()


def decrypt(value: str) -> str:
    try:
        return _fernet().decrypt(value.encode()).decode()
    except InvalidToken as exc:
        raise TokenSetupError("Stored token cannot be read with this TOKEN_ENCRYPTION_KEY") from exc


# ---- Reading the upload ------------------------------------------------------------------


@dataclass
class TokenFile:
    name: str
    data: dict | None = None
    problem: str | None = None


def read_files(uploads: list[tuple[str, bytes]]) -> list[TokenFile]:
    """JSON files and .zip files of JSON files → one TokenFile each."""
    out: list[TokenFile] = []

    def add(name: str, content: bytes) -> None:
        base = os.path.basename(name.replace("\\", "/"))
        if not base.lower().endswith(".json"):
            return
        if len(content) > MAX_FILE_BYTES:
            out.append(TokenFile(base, problem="File is too large to be a token"))
            return
        try:
            data = json.loads(content.decode("utf-8-sig"))
        except (UnicodeDecodeError, ValueError):
            out.append(TokenFile(base, problem="Not a readable JSON file"))
            return
        if not isinstance(data, dict):
            out.append(TokenFile(base, problem="Not a token file"))
            return
        out.append(TokenFile(base, data=data))

    for name, content in uploads:
        if content[:2] == b"PK" or name.lower().endswith(".zip"):
            try:
                with zipfile.ZipFile(io.BytesIO(content)) as zf:
                    for info in zf.infolist():
                        if info.is_dir() or "__MACOSX" in info.filename:
                            continue
                        if len(out) >= MAX_FILES:
                            break
                        if info.file_size > MAX_FILE_BYTES:
                            add(info.filename, b"x" * (MAX_FILE_BYTES + 1))
                            continue
                        add(info.filename, zf.read(info))
            except zipfile.BadZipFile:
                out.append(TokenFile(os.path.basename(name), problem="Not a readable .zip file"))
        else:
            add(name, content)
    return out[:MAX_FILES]


# ---- Asking YouTube whose token it is -----------------------------------------------------


@dataclass
class Verified:
    file: TokenFile
    channel_id: str | None = None
    title: str | None = None
    subscribers: int | None = None
    videos: int | None = None
    problem: str | None = None


def verify(tf: TokenFile) -> Verified:
    if tf.problem:
        return Verified(tf, problem=tf.problem)
    d = tf.data or {}
    scopes = d.get("scopes") or []
    if isinstance(scopes, str):
        scopes = scopes.split()
    if not all(d.get(k) for k in ("refresh_token", "client_id", "client_secret")):
        return Verified(tf, problem="Not a Google permission file (no refresh token)")
    if youtube_api.REVENUE_SCOPE not in scopes:
        return Verified(tf, problem="This permission cannot read YouTube revenue")
    try:
        access = youtube_api.refresh(
            d.get("token_uri") or "https://oauth2.googleapis.com/token",
            d["client_id"],
            d["client_secret"],
            d["refresh_token"],
        )
        if youtube_api.CHANNEL_SCOPE in scopes:
            info = youtube_api.my_channel(access)
            if info is None:
                return Verified(tf, problem="This Google account has no YouTube channel")
            return Verified(
                tf,
                channel_id=info["id"],
                title=info["title"],
                subscribers=info["subscribers"],
                videos=info["videos"],
            )
        stem = os.path.splitext(tf.name)[0]
        if not UC_ID.fullmatch(stem):
            return Verified(
                tf,
                problem="Cannot tell which channel this is: name the file with the channel ID "
                "(UC….json) or give the permission to read channel details",
            )
        yesterday = date.today() - timedelta(days=3)
        youtube_api.channel_report(access, stem, yesterday, yesterday)
        return Verified(tf, channel_id=stem)
    except youtube_api.TokenDead:
        return Verified(
            tf, problem="Permission expired or removed: the channel owner must Allow again"
        )
    except youtube_api.GoogleError as exc:
        if exc.status == 403:
            return Verified(tf, problem="YouTube says this permission is not for that channel")
        return Verified(tf, problem=f"YouTube error: {exc}")


def verify_all(files: list[TokenFile]) -> list[Verified]:
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        return list(pool.map(verify, files))


# ---- Saving -------------------------------------------------------------------------------


@dataclass
class ConnectRow:
    file: str
    result: str  # connected / updated / not_in_company / elsewhere / duplicate / unusable
    channel_id: str | None = None
    channel_name: str | None = None  # name in the tool
    youtube_title: str | None = None
    tool_channel_id: uuid.UUID | None = None
    message: str | None = None


@dataclass
class ConnectResult:
    rows: list[ConnectRow] = field(default_factory=list)

    def count(self, result: str) -> int:
        return sum(r.result == result for r in self.rows)

    @property
    def synced_channel_ids(self) -> list[uuid.UUID]:
        return [
            r.tool_channel_id
            for r in self.rows
            if r.result in ("connected", "updated") and r.tool_channel_id
        ]


def save_connection(
    db: Session, org: Organization, channel: Channel, v: Verified, user_id: uuid.UUID
) -> str:
    """Create or refresh the channel's connection; 'connected' or 'updated'."""
    d = v.file.data or {}
    scopes = d.get("scopes") or []
    if isinstance(scopes, str):
        scopes = scopes.split()
    conn = db.scalar(select(YouTubeConnection).where(YouTubeConnection.channel_id == channel.id))
    created = conn is None
    if conn is None:
        conn = YouTubeConnection(organization_id=org.id, channel_id=channel.id)
        db.add(conn)
    conn.google_channel_id = v.channel_id
    conn.google_title = v.title or conn.google_title
    conn.client_id = d["client_id"]
    conn.client_secret_enc = encrypt(d["client_secret"])
    conn.refresh_token_enc = encrypt(d["refresh_token"])
    conn.token_uri = d.get("token_uri") or "https://oauth2.googleapis.com/token"
    conn.scopes = list(scopes)
    conn.status, conn.last_error = "ok", None
    conn.connected_by_id = user_id
    if v.subscribers is not None or v.videos is not None:
        conn.subscribers, conn.videos = v.subscribers, v.videos
        conn.totals_at = datetime.now(UTC)
    return "connected" if created else "updated"


def connect(
    db: Session,
    org: Organization,
    user_id: uuid.UUID,
    verified: list[Verified],
    *,
    ip: str | None,
) -> ConnectResult:
    result = ConnectResult()
    channels = {
        c.external_id: c
        for c in db.scalars(
            select(Channel).where(Channel.organization_id == org.id, Channel.platform == "youtube")
        )
    }
    seen: set[str] = set()
    for v in verified:
        row = ConnectRow(file=v.file.name, result="unusable", channel_id=v.channel_id)
        result.rows.append(row)
        row.youtube_title = v.title
        if v.problem:
            row.message = v.problem
            continue
        if v.channel_id in seen:
            row.result, row.message = (
                "duplicate",
                "Another file in this upload is for the same channel",
            )
            continue
        seen.add(v.channel_id)
        channel = channels.get(v.channel_id)
        if channel is None:
            row.result = "not_in_company"
            row.message = "No channel with this ID in this company: nothing saved"
            continue
        row.channel_name, row.tool_channel_id = channel.name, channel.id
        other = db.scalar(
            select(YouTubeConnection).where(
                YouTubeConnection.google_channel_id == v.channel_id,
                YouTubeConnection.channel_id != channel.id,
            )
        )
        if other is not None:
            row.result = "elsewhere"
            row.message = "This YouTube channel is already connected in another company"
            continue
        row.result = save_connection(db, org, channel, v, user_id)
    if result.count("connected") or result.count("updated"):
        record_audit(
            db,
            "youtube.connected",
            organization_id=org.id,
            user_id=user_id,
            entity_type="channel",
            entity_id=None,
            details={"connected": result.count("connected"), "updated": result.count("updated")},
            ip=ip,
        )
    return result
