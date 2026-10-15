"""Server-side login sessions, owned by Python.

Why this exists
---------------
Until ticket 02 the login state lived in Java: Spring Session stored the whole
``User`` entity in Redis and Python forwarded ``JSESSIONID`` to
``GET /user/get/login`` on every authenticated request (``web/auth.py``'s
previous body). That worked, but it made Java a runtime dependency of every
authenticated call in the Python service. Python owns the session from here.

Three rules make this safe to drop in
------------------------------------
1. **A separate namespace.** Keys are ``eye:py:session:{sid}``, never
   ``spring:session:sessions:{sid}``. Nothing here parses, reads or overwrites a
   JDK-serialized Spring Session value, so a half-migrated Redis cannot corrupt
   a live Java session and vice versa.
2. **A separate cookie name.** ``EYE_SESSION`` by default, not ``SESSION`` or
   ``JSESSIONID``. A browser still holding a Java cookie simply presents a name
   this service never reads, and gets 40100 -- which is exactly the required
   "old cookies do not confer login eligibility".
3. **Only the id is stored.** The payload is ``{"userId": "..."}`` -- no
   password, no hash, no role, no profile. Role and deletion status are re-read
   from ``t_user`` on every request, which is what makes a role change or a
   logical delete invalidate a live session immediately. A positive identity
   cache is deliberately absent: it would keep a revoked session authorized
   until its TTL.

Expiry is Redis' own TTL on the key. There is no lazy sweep and no second
source of truth.
"""

import json
import secrets
from dataclasses import dataclass

from redis.exceptions import RedisError

from web.config import WebConfig
from web.response import BizError, ErrorCode

#: Bytes of entropy behind each session id, base64url-encoded into 43 chars.
SID_BYTES = 32


@dataclass(frozen=True)
class SessionRecord:
    """What a session key decodes to."""

    user_id: int


def new_session_id() -> str:
    """Unpredictable session id.

    This value is the bearer credential for every authenticated request;
    token_urlsafe supplies 256 bits of cryptographic randomness.
    """
    return secrets.token_urlsafe(SID_BYTES)


def session_key(config: WebConfig, sid: str) -> str:
    return f"{config.session_redis_prefix}{sid}"


async def create_session(redis, config: WebConfig, user_id: int, ttl: int | None = None) -> str:
    """Mint a session for ``user_id`` and return its id.

    The caller is responsible for setting the cookie; ``web/routers/user.py``
    does that so the rotation rule stays in one place.

    ``async`` because ``app.state.redis`` is a ``redis.asyncio.Redis``: a
    synchronous-looking ``setex`` here would return an un-awaited coroutine,
    log a RuntimeWarning, and silently store nothing -- every login would then
    hand out a cookie that resolves to nothing.
    """
    sid = new_session_id()
    payload = json.dumps({"userId": str(user_id)}, separators=(",", ":"))
    try:
        await redis.setex(session_key(config, sid), ttl or config.session_ttl_seconds, payload)
    except RedisError as exc:
        raise BizError(ErrorCode.SYSTEM_ERROR, "登录态服务不可用") from exc
    return sid


async def load_session(redis, config: WebConfig, sid: str) -> SessionRecord | None:
    """Resolve a session id, or ``None`` if it was never issued, was revoked, or expired.

    Fails **closed** on an unreachable Redis: a session authority that cannot
    answer must not be mistaken for "nobody is signed in", because that would
    turn an outage into a silent mass logout -- and, worse, any caller that
    treated ``None`` as "unauthenticated" would be one refactor away from
    treating it as "allowed". Redis being down yields ``50000``, exactly as an
    unreachable Java session authority did before this ticket.
    """
    try:
        raw = await redis.get(session_key(config, sid))
    except RedisError as exc:
        raise BizError(ErrorCode.SYSTEM_ERROR, "登录态服务不可用") from exc
    if not raw:
        return None
    try:
        payload = json.loads(raw)
        record = SessionRecord(user_id=int(payload["userId"]))
    except (TypeError, ValueError, KeyError):
        # A key that is not ours: a truncated write, a value left by something
        # else in the same prefix. Treat it as no session rather than 500 --
        # it cannot authenticate anyone either way.
        return None
    try:
        # Spring Session used an inactivity timeout. EXPIRE refreshes only an
        # existing key: a logout/expiry racing this read cannot recreate it.
        if not await redis.expire(session_key(config, sid), config.session_ttl_seconds):
            return None
    except RedisError as exc:
        raise BizError(ErrorCode.SYSTEM_ERROR, "登录态服务不可用") from exc
    return record


async def revoke_session(redis, config: WebConfig, sid: str | None) -> None:
    """Delete a session; missing keys are harmless, Redis outages fail closed."""
    if not sid:
        return
    try:
        await redis.delete(session_key(config, sid))
    except RedisError as exc:
        raise BizError(ErrorCode.SYSTEM_ERROR, "登录态服务不可用") from exc


__all__ = [
    "SID_BYTES",
    "SessionRecord",
    "create_session",
    "load_session",
    "new_session_id",
    "revoke_session",
    "session_key",
]
