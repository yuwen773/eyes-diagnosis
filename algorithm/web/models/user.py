"""``t_user`` -- user domain (Phase 2.1).

Mirrors ``model/entity/User.java`` and ``schema.sql``. ``id`` is Snowflake
(``IdType.ASSIGN_ID``), so inserts generate the key client-side via
``web.db.id_generator``.
"""

from datetime import datetime

from sqlalchemy import BigInteger, DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from web.db import Base


class User(Base):
    __tablename__ = "t_user"

    id: Mapped[int] = mapped_column("id", BigInteger, primary_key=True)

    user_account: Mapped[str] = mapped_column("userAccount", String(256), nullable=False)
    #: BCrypt hash for accounts registered after the PasswordService migration;
    #: legacy MD5 ("yuwen" + raw) for older rows -- verified and upgraded on login.
    user_password: Mapped[str] = mapped_column("userPassword", String(512), nullable=False)
    user_name: Mapped[str | None] = mapped_column("userName", String(256))
    user_avatar: Mapped[str | None] = mapped_column("userAvatar", String(1024))
    user_profile: Mapped[str | None] = mapped_column("userProfile", String(512))
    #: ``user`` or ``admin``.
    user_role: Mapped[str] = mapped_column("userRole", String(256), nullable=False, default="user")

    edit_time: Mapped[datetime] = mapped_column("editTime", DateTime, nullable=False)
    create_time: Mapped[datetime] = mapped_column("createTime", DateTime, nullable=False)
    update_time: Mapped[datetime] = mapped_column("updateTime", DateTime, nullable=False)

    #: Logical delete. ``t_user.isDelete`` is TINYINT; SmallInteger keeps the
    #: Python side honest (0/1) without a Boolean->tinyint coercion layer.
    is_delete: Mapped[int] = mapped_column("isDelete", Integer, nullable=False, default=0)
