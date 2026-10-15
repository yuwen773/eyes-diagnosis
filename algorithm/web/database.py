"""The FastAPI database dependency.

Why this is not in ``web/deps.py``
----------------------------------
``web/auth.py`` needs ``get_db`` so that resolving the caller can re-read
``t_user`` on every request (logout, account deletion and role changes have to
take effect immediately -- ``UserServiceImpl#getLoginUser:160-176`` does the same
``getById`` per request in Java). But ``web/deps.py`` already imports
``web.auth`` for :class:`~web.auth.LoginUserVO`, so putting the dependency in
either module makes a cycle. This third module is imported by both and depends
on neither.

It still is not ``web/db.py``: the engine layer deliberately imports no
FastAPI, so a script or a migration CLI can open a session without an app.
"""

from typing import Iterator

from sqlalchemy.orm import Session

from web.db import get_session_factory


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
