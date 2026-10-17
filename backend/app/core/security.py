import hashlib
import secrets
from datetime import UTC, datetime

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

_hasher = PasswordHasher()

# Used to spend the same time verifying when the email does not exist,
# so response timing does not reveal which emails are registered.
_DUMMY_HASH = _hasher.hash("timing-equalizer-not-a-real-password")

MIN_PASSWORD_LENGTH = 10


def utcnow() -> datetime:
    return datetime.now(UTC)


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str | None, password: str) -> bool:
    try:
        return _hasher.verify(password_hash or _DUMMY_HASH, password) and password_hash is not None
    except (VerificationError, InvalidHashError):
        return False


def password_needs_rehash(password_hash: str) -> bool:
    return _hasher.check_needs_rehash(password_hash)


def new_session_token() -> str:
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    # Only the hash is stored, so a leaked database row cannot be used as a cookie.
    return hashlib.sha256(token.encode()).hexdigest()
