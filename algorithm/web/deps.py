"""Shared FastAPI dependencies.

Holds the pieces every router needs: the database session, the resolved
configuration, and the current user. Kept separate from ``web.db`` so that
importing the data layer never drags in FastAPI, and vice versa.
"""

from fastapi import Depends, Request

from web.auth import LoginUser, current_user
from web.config import WebConfig

# Re-exported, not redefined. ``web/auth.py`` needs ``get_db`` too (to re-read
# ``t_user`` on every request), and importing it from ``web.deps`` would close
# a cycle -- ``web.auth`` is imported above. The originals live in
# ``web.database``, which depends on neither. These are the *same function
# objects*, so every existing ``app.dependency_overrides[get_db]`` key keeps
# matching.
from web.database import db_session, get_db  # noqa: F401


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


async def login_user(user: LoginUser = Depends(current_user)) -> LoginUser:
    """FastAPI dependency wrapper around :func:`web.auth.current_user`."""
    return user
