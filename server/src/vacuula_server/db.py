from __future__ import annotations
import logging

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker, Session
from contextlib import contextmanager


from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine

import typing

from vacuula_server.constants import ALEMBIC_INI, DB_PATH
if typing.TYPE_CHECKING:
    from vacuula_server.handlers.router import RouterHandler

logger = logging.getLogger(__name__)

DATABASE_URL = f"sqlite:///{DB_PATH}"

engine = create_engine(
    DATABASE_URL,
    echo=False
)

SessionLocal = sessionmaker(
    bind=engine,
    expire_on_commit=False,
    class_=Session
)

@contextmanager
def get_session() -> typing.Generator[Session, None, None]:
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()

# TODO: fix commit stuff
def db_commit2(session: Session, *instances):
    try:
        for instance in instances:
            session.add(instance)
        session.commit()
        return True
    except Exception as e:
        session.rollback()
        logger.exception("DB commit failed")
        return False

def db_commit(session: Session, req: RouterHandler, *instances):
    try:
        for instance in instances:
            session.add(instance)
        session.commit()
        return True
    except Exception as e:
        session.rollback()
        logger.exception("DB commit failed on request %s %s", req.command, req.path)
        req.send_internal_error()
        return False

class Base(DeclarativeBase):
    pass


def check_db_is_up_to_date() -> None:
    config = Config(ALEMBIC_INI)
    script = ScriptDirectory.from_config(config)
    head_revisions = set(script.get_heads())

    engine = create_engine(DATABASE_URL)
    with engine.connect() as conn:
        context = MigrationContext.configure(conn)
        current_revisions = set(context.get_current_heads())

    if current_revisions != head_revisions:
        raise RuntimeError(
            f"Database is not up to date. Current: {current_revisions or 'none'}, "
            f"expected: {head_revisions}. Run `alembic upgrade head`."
        )

