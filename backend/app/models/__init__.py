# Import every model module here so Alembic autogenerate can see all tables.
from app.models.base import Base

__all__ = ["Base"]
