"""Legacy metadata is independent of Python graph and result contracts."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel


class LegacyTaskView(BaseModel):
    taskId: str
    sourceType: Literal["workflow", "upload"]
    status: str
    createdAt: datetime | None
    updatedAt: datetime | None
    sourceVersion: str | None
    question: str | None
    requiresUpload: bool = True


class LegacyTaskPage(BaseModel):
    records: list[LegacyTaskView]
    total: int


class LegacyRebuildSource(BaseModel):
    taskId: str
    sourceType: Literal["workflow", "upload"]
    createdAt: datetime | None
    status: str
    sourceVersion: str | None
    confirmedBy: str
    confirmedAt: datetime
