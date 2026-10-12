"""Shared FastAPI dependencies.

Holds the pieces every router needs: the database session, the resolved
configuration, and the current user. Kept separate from ``web.db`` so that
importing the data layer never drags in FastAPI, and vice versa.
"""

from typing import Iterator

from fastapi import Depends, Request
from sqlalchemy.orm import Session

from web.auth import LoginUser, current_user
from web.config import WebConfig
from web.db import get_session_factory


#: Set once by :func:`web.app.create_app`. Module-level rather than
#: request-scoped because ``web.files`` needs it outside a request context.
_config: WebConfig | None = None


def set_config(config: WebConfig) -> None:
    global _config
    _config = config


def get_config() -> WebConfig:
    if _config is None:
        raise RuntimeError("config not initialised; call create_app() first")
    return _config


def config_from_request(request: Request) -> WebConfig:
    """Per-request accessor, for use as a FastAPI dependency."""
    return request.app.state.config


def get_db() -> Iterator[Session]:
    """Request-scoped session.

    Rolls back on any exception so a failed request cannot leave a half-applied
    write behind -- the behaviour Spring's transaction rollback gives the Java
    side for free.
    """
    session = get_session_factory()()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def db_session() -> Session:
    """Session for callers outside the dependency graph (scripts, tests)."""
    return get_session_factory()()

async def login_user(user: LoginUser = Depends(current_user)) -> LoginUser:
    """FastAPI dependency wrapper around :func:`web.auth.current_user`."""
    return user
