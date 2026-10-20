"""Where uploaded files live: Cloudflare R2 in production, the database when R2 is not set up.

Files (deal contracts, CMS statements and sheets) go to a private R2 bucket under a key that
starts with the company's id; the row keeps only that key. Downloads always pass through
the API, so a file is only ever served to someone logged in to its company.

R2 speaks the S3 API. Requests are signed with AWS Signature Version 4 using only the
standard library, so no SDK is needed.
"""

import hashlib
import hmac
import logging
import urllib.error
import urllib.request
import uuid
from datetime import UTC, datetime
from urllib.parse import quote

from app.core.config import get_settings

log = logging.getLogger(__name__)
TIMEOUT_SECONDS = 30


class FileStoreError(Exception):
    pass


def _hmac(key: bytes, msg: str) -> bytes:
    return hmac.new(key, msg.encode(), hashlib.sha256).digest()


def sign_v4(
    *,
    method: str,
    host: str,
    path: str,
    headers: dict[str, str],
    payload_hash: str,
    region: str,
    access_key: str,
    secret_key: str,
    amz_date: str,
) -> str:
    """The Authorization header for an S3 request (headers must include host, x-amz-date
    and x-amz-content-sha256)."""
    lower = {k.lower(): " ".join(v.split()) for k, v in headers.items()}
    signed = ";".join(sorted(lower))
    canonical = "\n".join(
        [
            method,
            path,
            "",
            "".join(f"{k}:{lower[k]}\n" for k in sorted(lower)),
            signed,
            payload_hash,
        ]
    )
    scope = f"{amz_date[:8]}/{region}/s3/aws4_request"
    to_sign = "\n".join(
        ["AWS4-HMAC-SHA256", amz_date, scope, hashlib.sha256(canonical.encode()).hexdigest()]
    )
    key = _hmac(("AWS4" + secret_key).encode(), amz_date[:8])
    for part in (region, "s3", "aws4_request"):
        key = _hmac(key, part)
    signature = hmac.new(key, to_sign.encode(), hashlib.sha256).hexdigest()
    return (
        f"AWS4-HMAC-SHA256 Credential={access_key}/{scope}, "
        f"SignedHeaders={signed}, Signature={signature}"
    )


class R2Store:
    def __init__(self, account_id: str, access_key: str, secret_key: str, bucket: str):
        self.host = f"{account_id}.r2.cloudflarestorage.com"
        self.access_key, self.secret_key, self.bucket = access_key, secret_key, bucket

    def _request(
        self, method: str, key: str, body: bytes = b"", content_type: str | None = None
    ) -> bytes:
        path = f"/{self.bucket}/{quote(key, safe='/-_.~')}"
        payload_hash = hashlib.sha256(body).hexdigest()
        amz_date = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
        headers = {
            "host": self.host,
            "x-amz-content-sha256": payload_hash,
            "x-amz-date": amz_date,
        }
        if content_type:
            headers["content-type"] = content_type
        headers["authorization"] = sign_v4(
            method=method,
            host=self.host,
            path=path,
            headers=headers,
            payload_hash=payload_hash,
            region="auto",
            access_key=self.access_key,
            secret_key=self.secret_key,
            amz_date=amz_date,
        )
        req = urllib.request.Request(
            f"https://{self.host}{path}",
            data=body if method == "PUT" else None,
            headers={k: v for k, v in headers.items() if k != "host"},
            method=method,
        )
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT_SECONDS) as resp:  # noqa: S310
                return resp.read()
        except urllib.error.HTTPError as exc:
            detail = exc.read()[:300].decode(errors="replace")
            raise FileStoreError(f"R2 {method} {key}: HTTP {exc.code} {detail}") from exc
        except OSError as exc:
            raise FileStoreError(f"R2 {method} {key}: {exc}") from exc

    def put(self, key: str, data: bytes, content_type: str) -> None:
        self._request("PUT", key, data, content_type)

    def get(self, key: str) -> bytes:
        return self._request("GET", key)

    def delete(self, key: str) -> None:
        self._request("DELETE", key)


_store: R2Store | None = None
_checked = False


def get_store() -> R2Store | None:
    """The R2 bucket, or None when it is not configured (files then stay in the database)."""
    global _store, _checked
    if not _checked:
        s = get_settings()
        if s.r2_account_id and s.r2_access_key_id and s.r2_secret_access_key and s.r2_bucket:
            _store = R2Store(
                s.r2_account_id, s.r2_access_key_id, s.r2_secret_access_key, s.r2_bucket
            )
        _checked = True
    return _store


def new_key(organization_id: uuid.UUID, folder: str, file_name: str) -> str:
    """e.g. "<company>/deal-documents/<random>.pdf" — no user text in the key."""
    ext = file_name.rsplit(".", 1)[-1].lower() if "." in file_name else "bin"
    ext = "".join(ch for ch in ext if ch.isalnum())[:8] or "bin"
    return f"{organization_id}/{folder}/{uuid.uuid4().hex}.{ext}"


def save(
    organization_id: uuid.UUID, folder: str, file_name: str, data: bytes, content_type: str
) -> str | None:
    """Put the file in R2 and return its key, or None to keep it in the database."""
    store = get_store()
    if store is None:
        return None
    key = new_key(organization_id, folder, file_name)
    store.put(key, data, content_type)
    return key


CONTENT_TYPES = {
    "csv": "text/csv",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "xlsm": "application/vnd.ms-excel.sheet.macroEnabled.12",
}


def content_type_for(file_name: str) -> str:
    ext = file_name.rsplit(".", 1)[-1].lower() if "." in file_name else ""
    return CONTENT_TYPES.get(ext, "application/octet-stream")


def load(key: str) -> bytes:
    store = get_store()
    if store is None:
        raise FileStoreError("This file is in R2, but R2 is not configured")
    return store.get(key)


def remove(key: str | None) -> None:
    """Delete a file that is no longer referenced; failures are logged, not raised."""
    if not key or (store := get_store()) is None:
        return
    try:
        store.delete(key)
    except FileStoreError:
        log.warning("Could not delete %s from R2", key, exc_info=True)
