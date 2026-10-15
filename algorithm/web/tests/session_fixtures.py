"""Shared fixtures for the Python-owned login session (ticket 02).

Before this ticket the tests faked Java: they pointed ``app.state.java_client``
at a mock ``GET /user/get/login`` and set a ``SESSION`` cookie to a string. That
no longer works, because authentication now reads a Redis session and then
re-reads ``t_user`` on **every** request -- there is no self-contained
``LoginUserVO`` to fake.

So a fixture has to seed two things that used to be one:

* a ``t_user`` row per identity, and
* a session key in the store, whose id is the cookie value.

Both live here so the 20-odd test modules that need a signed-in caller stay
one line each.

The session id is the identity's *name* (``"alice"``, ``"admin"``, ...) on
purpose. Real ids come from :func:`web.session.new_session_id` and are
unpredictable; a fixed readable value makes a failing assertion name the caller
instead of printing 43 random characters, and no test can be misled by it
because nothing in the app parses the id's structure.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime
from typing import Mapping

from sqlalchemy import select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from web.config import WebConfig
from web.database import get_db
from web.models.user import User
from web.security import encode

#: Cookie the app reads. ``WebConfig().session_cookie_name`` is the source of
#: truth; this is the literal most tests want in ``client.cookies.set``.
SESSION_COOKIE_NAME = WebConfig().session_cookie_name

#: Shared, hashed once per process. BCrypt at cost 12 takes ~250ms, and every
#: identity in every fixture would otherwise pay it.
_HASHED_PASSWORD = encode("fixture-password")

#: Every fixture that needs a signed-in user gets one of these four. The ids
#: are fixed so tests can build rows owned by ``alice``/``bob`` and assert on
#: ownership without threading a generated id through.
ALICE = 7
ADMIN = 9
BOB = 8
DOCTOR = 11


@dataclass(frozen=True)
class Identity:
    """One ``t_user`` row plus the session that points at it."""

    user_id: int
    account: str
    role: str = "user"
    name: str = ""
    password: str = "fixture-password"


#: ``doctor`` is an ordinary ``user`` role in every existing fixture -- the
#: doctor/patient distinction is carried by row ownership, not by ``userRole``.
#: Review-specific fixtures override this identity with the real ``doctor``
#: role; the default remains ``user`` for older ownership-only scenarios.
DEFAULT_IDENTITIES: dict[str, Identity] = {
    "alice": Identity(ALICE, "alice", "user", "Alice"),
    "admin": Identity(ADMIN, "admin", "admin", "Admin"),
    "bob": Identity(BOB, "bob", "user", "Bob"),
    "doctor": Identity(DOCTOR, "doctor", "user", "Doctor"),
}


def identities(**overrides: Identity) -> dict[str, Identity]:
    """``DEFAULT_IDENTITIES`` plus per-test additions/replacements."""
    merged = dict(DEFAULT_IDENTITIES)
    merged.update(overrides)
    return merged


class MemorySessionStore:
    """In-memory stand-in for ``app.state.redis``.

    Implements the async subset the application actually calls -- ``get``,
    ``setex``, ``delete`` -- plus ``exists``/``ttl``/``expire``/``keys``/
    ``scan_iter``/``aclose`` so a test can inspect or expire state without
    reaching for a real Redis.

    Two deliberate escape hatches:

    ``offline``
        Raise ``RedisError`` from every call, which is how the
        fail-closed behaviour is tested: a session authority that cannot answer
        must yield ``50000``, never "anonymous".
    ``freeze_time()``
        Drop every TTL, so "the session expired" is expressible without
        sleeping 30 minutes.
    """

    def __init__(self) -> None:
        self.data: dict[str, str] = {}
        self.ttls: dict[str, int] = {}
        self.offline = False

    def freeze_time(self) -> None:
        """Expire nothing: keys survive regardless of their TTL."""
        self.ttls.clear()

    def expire_now(self, key: str) -> None:
        self.data.pop(key, None)
        self.ttls.pop(key, None)

    def _check(self) -> None:
        if self.offline:
            from redis.exceptions import RedisError

            raise RedisError("simulated Redis outage")

    async def get(self, key: str) -> str | None:
        self._check()
        return self.data.get(key)

    async def setex(self, key: str, ttl: int, value: str) -> None:
        self._check()
        self.data[key] = value
        self.ttls[key] = ttl

    async def delete(self, *keys: str) -> int:
        self._check()
        removed = 0
        for key in keys:
            removed += int(self.data.pop(key, None) is not None)
            self.ttls.pop(key, None)
        return removed

    async def exists(self, *keys: str) -> int:
        self._check()
        return sum(1 for key in keys if key in self.data)

    async def ttl(self, key: str) -> int:
        self._check()
        if key not in self.data:
            return -2
        return self.ttls.get(key, -1)

    async def expire(self, key: str, ttl: int) -> bool:
        self._check()
        if key not in self.data:
            return False
        self.ttls[key] = ttl
        return True

    async def keys(self, pattern: str = "*") -> list[str]:
        self._check()
        prefix = pattern[:-1] if pattern.endswith("*") else None
        return [
            key
            for key in self.data
            if prefix is None or pattern == "*" or key.startswith(prefix)
        ]

    async def scan_iter(self, match: str = "*"):
        for key in await self.keys(match):
            yield key

    async def aclose(self) -> None:
        self.data.clear()
        self.ttls.clear()


@dataclass
class Sessions:
    """What a fixture gets back: the store, and the mapping from identity to id."""

    store: MemorySessionStore = field(default_factory=MemorySessionStore)
    identities: dict[str, Identity] = field(default_factory=lambda: dict(DEFAULT_IDENTITIES))
    config: WebConfig = field(default_factory=WebConfig)

    def key(self, name: str) -> str:
        """The Redis key backing identity ``name``."""
        return f"{self.config.session_redis_prefix}{name}"

    def sid(self, name: str) -> str:
        """The cookie value that authenticates as ``name``."""
        return name

    def user_id(self, name: str) -> int:
        return self.identities[name].user_id

    def authenticate(self, client, name: str) -> None:
        """Sign ``client`` in as ``name``."""
        client.cookies.set(self.config.session_cookie_name, self.sid(name))


def _seed_user(db: Session, identity: Identity) -> None:
    """Insert or refresh one identity's row.

    Updated, not skipped-on-conflict, because a fixture may install a second,
    differently-roled set of identities over the first (the doctor-review tests
    need the workflow owner to *be* a doctor, so the ownership guard is what
    rejects them). Re-running with the same values is still a no-op.
    """
    now = datetime.now()
    existing = db.execute(select(User).where(User.id == identity.user_id)).scalar_one_or_none()
    if existing is not None:
        existing.user_account = identity.account
        existing.user_name = identity.name
        existing.user_role = identity.role
        return
    db.add(
        User(
            id=identity.user_id,
            user_account=identity.account,
            user_password=_HASHED_PASSWORD,
            user_name=identity.name,
            user_avatar=None,
            user_profile=None,
            user_role=identity.role,
            create_time=now,
            edit_time=now,
            update_time=now,
            is_delete=0,
        )
    )


def seed_users(engine: Engine, who: Mapping[str, Identity] | None = None) -> None:
    """Insert a ``t_user`` row per identity. Idempotent."""
    with Session(engine) as db:
        for identity in (who or DEFAULT_IDENTITIES).values():
            _seed_user(db, identity)
        db.commit()


def seed_users_through_app(app, who: Mapping[str, Identity] | None = None) -> None:
    """Seed using whatever database dependency the app is already wired to.

    Lets a fixture re-role identities on an app it did not build -- a restarted
    or rebuilt app in the same test -- without having to thread the engine
    around.
    """
    provider = app.dependency_overrides.get(get_db, get_db)
    generator = provider()
    db = next(generator)
    try:
        for identity in (who or DEFAULT_IDENTITIES).values():
            _seed_user(db, identity)
        db.commit()
    finally:
        # Let the dependency's own cleanup (commit-then-close) run.
        for _ in generator:
            pass


def install_sessions(
    app,
    engine: Engine | None = None,
    who: Mapping[str, Identity] | None = None,
) -> Sessions:
    """Give ``app`` a working session store plus signed-in identities.

    ``engine`` is optional. Without it the rows are seeded through the app's
    own ``get_db`` dependency, which is the only option for an app the caller
    did not build.

    Call this **after** ``app.dependency_overrides[get_db]`` is set and after
    any ``TestClient`` context has started; a lifespan run replaces
    ``app.state.redis``, so a store installed earlier is silently discarded.
    """
    who = dict(who or DEFAULT_IDENTITIES)
    sessions = Sessions(identities=who)
    app.state.redis = sessions.store
    if engine is not None:
        seed_users(engine, who)
    else:
        seed_users_through_app(app, who)
    # Written directly rather than through ``await create_session``: the store
    # is in-process, and the point here is the *end state* (a cookie value that
    # resolves to a user), not the login flow. ``test_session.py`` exercises
    # ``create_session`` itself.
    for name, identity in who.items():
        sessions.store.data[sessions.key(name)] = json.dumps({"userId": str(identity.user_id)})
        sessions.store.ttls[sessions.key(name)] = sessions.config.session_ttl_seconds
    return sessions
