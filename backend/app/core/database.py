from collections.abc import Iterator
from typing import Annotated

from fastapi import Depends
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import get_settings
from app.core.ipv4 import prefer_ipv4

engine = prefer_ipv4(
    create_engine(
        get_settings().sqlalchemy_url,
        pool_pre_ping=True,
        connect_args={"connect_timeout": 30},
    )
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_db() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


DbSession = Annotated[Session, Depends(get_db)]
