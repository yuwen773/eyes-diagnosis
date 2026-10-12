"""Password hashing -- a faithful port of ``security/PasswordService.java``.

Two stored formats coexist in ``t_user.userPassword``:

* **BCrypt**, cost 12, for anything written since the PasswordService
  migration. Recognised by the ``$2`` prefix.
* **Legacy MD5**, ``md5("yuwen" + raw)`` hex, for older rows. Recognised by
  matching ``[0-9a-fA-F]{32}``. A successful legacy check reports
  ``needs_upgrade=True`` and the caller re-hashes to BCrypt immediately, so the
  MD5 population drains one login at a time.

Java/Python hash interoperability
--------------------------------
Spring's ``BCryptPasswordEncoder`` emits ``$2a$12$...``; Python's ``bcrypt``
emits ``$2b$12$...``. Both libraries accept either prefix on read, so hashes
written by either side verify against the other. The ``$2`` prefix test in
Java is deliberately prefix-only, which is what makes the swap safe.

BCrypt truncates input at 72 bytes. Java silently truncates; Python's ``bcrypt``
raises for longer input. Passwords in this system are capped well below that
by ``PASSWORD_MIN_LENGTH``-adjacent UI limits, but the truncation is applied
explicitly here so the two never disagree on an edge case.
"""

import hashlib
import hmac
import re
from dataclasses import dataclass

import bcrypt

#: ``PasswordService.LEGACY_SALT``
LEGACY_SALT = "yuwen"

#: Matches Spring's ``new BCryptPasswordEncoder(12)``.
BCRYPT_ROUNDS = 12

#: BCrypt only considers the first 72 bytes of input.
_BCRYPT_MAX_BYTES = 72

_LEGACY_MD5_RE = re.compile(r"^[0-9a-fA-F]{32}$")


@dataclass(frozen=True)
class PasswordVerification:
    """Mirror of ``PasswordService.PasswordVerification`` record."""

    matches: bool
    needs_upgrade: bool


def _truncate(password: str) -> bytes:
    """Apply BCrypt's 72-byte limit the way Java does -- by cutting, not failing."""
    return password.encode("utf-8")[:_BCRYPT_MAX_BYTES]


def encode(raw_password: str) -> str:
    """BCrypt-hash with cost 12, matching ``PasswordService#encode``."""
    return bcrypt.hashpw(
        _truncate(raw_password), bcrypt.gensalt(rounds=BCRYPT_ROUNDS)
    ).decode("ascii")


def _legacy_md5(raw_password: str) -> str:
    return hashlib.md5(
        (LEGACY_SALT + raw_password).encode("utf-8")
    ).hexdigest()


def verify(raw_password: str, stored_hash: str | None) -> PasswordVerification:
    """Port of ``PasswordService#verify``, including its dispatch order.

    Dispatch order matters: a ``$2``-prefixed string is tried as BCrypt even if
    it is malformed, and a 32-hex-digit string is treated as legacy MD5.
    Anything else fails without a hash comparison.
    """
    if stored_hash is None:
        return PasswordVerification(matches=False, needs_upgrade=False)

    if stored_hash.startswith("$2"):
        try:
            matched = bcrypt.checkpw(_truncate(raw_password), stored_hash.encode("ascii"))
        except ValueError:
            # Malformed BCrypt string. Java would throw and fall through to the
            # generic 500 handler; treating it as "no match" keeps a corrupt row
            # from becoming a 5xx on the login path.
            return PasswordVerification(matches=False, needs_upgrade=False)
        return PasswordVerification(matches=matched, needs_upgrade=False)

    if _LEGACY_MD5_RE.match(stored_hash):
        candidate = _legacy_md5(raw_password)
        # Constant-time, mirroring MessageDigest.isEqual in PasswordService.
        matched = hmac.compare_digest(
            candidate.encode("ascii"), stored_hash.lower().encode("ascii")
        )
        return PasswordVerification(matches=matched, needs_upgrade=True)

    return PasswordVerification(matches=False, needs_upgrade=False)
