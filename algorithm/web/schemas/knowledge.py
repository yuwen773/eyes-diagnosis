"""Knowledge-domain DTOs.

There is no VO in Java: ``listPage`` returns
``Page<KnowledgeDocument>``, the raw entity. So :class:`KnowledgeDocumentVO`
reproduces all 13 fields, including ``contentHash`` (the SHA-256 of the uploaded
bytes) and ``fileUrl`` (the COS object key, not a URL) -- the frontend's
generated client declares them, so dropping them would be a contract change
rather than a desensitisation.

Wire types:

* ``id``, ``fileSize`` are ``Long`` -> JSON **string**.
* ``createTime``/``updateTime`` are ``LocalDateTime`` -> ``"yyyy-MM-dd HH:mm:ss"``
  (the same formatter applies to both ``Date`` and ``LocalDateTime`` in
  ``JsonConfig``).
* ``status`` and ``isDelete`` are ``Integer`` -> JSON **number**.
"""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from web.constant import DESC
from web.response import DateTimeStr, EntityVO, LongStr


class DeleteRequest(BaseModel):
    """``common/DeleteRequest.java`` -- one ``Long``.

    Sent as the **body of a DELETE**. ``@DeleteMapping`` + ``@RequestBody`` is
    legal in Spring but some proxies drop DELETE bodies; the Nginx config in
    Phase 3 must forward them.
    """

    model_config = ConfigDict(extra="ignore")

    id: LongStr | None = None


class KnowledgePageQuery(BaseModel):
    """``common/PageRequest.java``.

    Only ``current`` and ``pageSize`` are read by ``listPage`` -- the
    ``sortField``/``sortOrder`` it inherits are ignored, because the query is
    hardcoded to ``orderByDesc(createTime)``. Declared anyway so a body
    carrying them is accepted rather than rejected.
    """

    model_config = ConfigDict(extra="ignore")

    current: int = 1
    pageSize: int = 10
    sortField: str | None = None
    sortOrder: str = DESC


class KnowledgeDocumentVO(EntityVO):
    """``model/entity/KnowledgeDocument.java`` -- 13 columns, all of them."""

    #: ``IdType.AUTO`` -- MySQL AUTO_INCREMENT, **not** Snowflake. The only
    #: migrated table that is not (see ``web/db.py``).
    id: LongStr
    userId: LongStr
    title: str
    fileName: str
    #: The COS object key (``{uuid}_{originalName}``), not a resolvable URL.
    fileUrl: str
    fileSize: LongStr | None = None
    fileType: str | None = None
    contentHash: str | None = None
    #: Populated only once the async ETL finishes. Null after a failure.
    chunkCount: int | None = None
    #: 0 processing / 1 completed / 2 failed.
    status: int = 0
    createTime: DateTimeStr | None = None
    updateTime: DateTimeStr | None = None
    isDelete: int = 0
    visibility: Literal["CURATED_PUBLIC", "PRIVATE_USER", "QUARANTINED"] = "PRIVATE_USER"
    reviewStatus: Literal["PENDING", "APPROVED", "REJECTED", "WITHDRAWN"] = "PENDING"
    diseaseCodes: list[str] = Field(default_factory=list)
    topicCodes: list[str] = Field(default_factory=list)
    governanceVersion: int = 0
    reviewedBy: LongStr | None = None
    reviewedAt: DateTimeStr | None = None

    @field_validator("diseaseCodes", "topicCodes", mode="before")
    @classmethod
    def legacy_codes(cls, value):
        return value or []


class GovernanceUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    visibility: Literal["CURATED_PUBLIC", "PRIVATE_USER", "QUARANTINED"]
    reviewStatus: Literal["PENDING", "APPROVED", "REJECTED", "WITHDRAWN"]
    diseaseCodes: list[str] = Field(max_length=6)
    topicCodes: list[str] = Field(max_length=6)
    expectedVersion: int = Field(ge=0)
    confirmed: Literal[True]

    @field_validator("diseaseCodes", "topicCodes")
    @classmethod
    def controlled_codes(cls, value, info):
        from web.evidence import DISEASE_TERMS, TOPIC_TERMS

        catalog = DISEASE_TERMS if info.field_name == "diseaseCodes" else TOPIC_TERMS
        if any(code not in catalog for code in value):
            raise ValueError("未知受控编码")
        return sorted(set(value))


class PrivateSearchRequest(BaseModel):
    query: str = Field(min_length=1, max_length=1000)
