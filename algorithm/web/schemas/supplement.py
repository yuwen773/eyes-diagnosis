"""Only a description can resume an interaction; clients cannot select graph nodes."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class SupplementRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    workflowId: str = Field(min_length=1, max_length=64)
    idempotencyKey: str = Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9_-]+$")


class SupplementReply(BaseModel):
    model_config = ConfigDict(extra="forbid")
    sessionId: str = Field(min_length=1, max_length=64)
    workflowId: str = Field(min_length=1, max_length=64)
    expectedVersion: str = Field(pattern=r"^(0|[1-9][0-9]{0,18})$")
    text: str = Field(min_length=1, max_length=4000)

    @field_validator("text")
    @classmethod
    def nonblank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("补充说明不能为空")
        return value


class SupplementItem(BaseModel):
    key: Literal["description"]
    prompt: str


class SupplementView(BaseModel):
    requestId: str
    sessionId: str
    workflowId: str
    status: Literal["WAITING", "ANSWERED"]
    version: str
    items: list[SupplementItem]
    answer: str | None
