from logging.config import fileConfig

from sqlalchemy import engine_from_config, pool

from alembic import context
from app.core.config import get_settings
from app.core.ipv4 import prefer_ipv4
from app.models import Base

config = context.config
config.set_main_option("sqlalchemy.url", get_settings().sqlalchemy_url)

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    context.configure(
        url=config.get_main_option("sqlalchemy.url"),
        target_metadata=target_metadata,
        literal_binds=True,
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = prefer_ipv4(
        engine_from_config(
            config.get_section(config.config_ini_section, {}),
            prefix="sqlalchemy.",
            poolclass=pool.NullPool,
            # Fail fast instead of hanging a deploy: give up connecting after 30s.
            connect_args={"connect_timeout": 30},
        )
    )
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata, compare_type=True)
        with context.begin_transaction():
            # If a table stays locked (e.g. by the running app), give up after 60s. Set here,
            # not as a startup option: Neon's pooled connections refuse those.
            connection.exec_driver_sql("SET LOCAL lock_timeout = '60s'")
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
