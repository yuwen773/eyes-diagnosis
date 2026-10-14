"""Controlled reference catalog from release; patient questions never set scope."""

import asyncio
import hashlib
import logging
import math
from typing import Any

import httpx
from sqlalchemy import select

from web.models.knowledge import KnowledgeDocument
from web.vectorstore import ChromaWriter, DashScopeEmbedder

logger = logging.getLogger(__name__)

DISEASE_TERMS = {
    "amd": "age related macular degeneration", "cataract": "cataract",
    "diabetic_retinopathy": "diabetic retinopathy", "glaucoma": "glaucoma",
    "myopia": "myopia", "normal": "normal fundus",
}
TOPIC_TERMS = {
    "DISEASE_OVERVIEW": "disease overview", "COMMON_SYMPTOMS": "common symptoms",
    "RISK_FACTORS": "risk factors", "GENERAL_MANAGEMENT": "general management",
    "FOLLOW_UP_GUIDANCE": "follow up guidance", "IMAGE_FINDINGS": "image findings",
}


def eligible(document: KnowledgeDocument, disease: str, topic: str) -> bool:
    return (document.is_delete == 0 and document.status == 1 and
            document.visibility == "CURATED_PUBLIC" and document.review_status == "APPROVED" and
            disease in (document.disease_codes or []) and topic in (document.topic_codes or []))


def query_chunks(config, text: str, document_ids: list[int]) -> dict:
    """Use the existing embedding/collection contract; no external search fallback."""
    async def embed():
        async with httpx.AsyncClient(timeout=httpx.Timeout(30.0)) as client:
            return await DashScopeEmbedder(config.dashscope_api_key or "", config.dashscope_base_url,
                                           config.embedding_model, client=client).embed([text])

    vectors = asyncio.run(embed())
    return ChromaWriter(config).query(vectors, document_ids)


def citations_from_results(results: dict, documents: dict[int, KnowledgeDocument]) -> list[dict]:
    accepted = []
    seen = set()
    for chunk_id, quote, metadata, distance in zip(results["ids"][0], results["documents"][0],
                                                  results["metadatas"][0], results["distances"][0]):
        if (not isinstance(metadata, dict) or not isinstance(quote, str) or not quote.strip()
                or not isinstance(distance, (int, float)) or not math.isfinite(distance)):
            continue
        doc_id = metadata.get("documentId")
        if type(doc_id) is not int or doc_id not in documents:
            continue
        row = documents[doc_id]
        prefix = f"doc_{row.id}_chunk_"
        if (not isinstance(chunk_id, str) or chunk_id in seen or not chunk_id.startswith(prefix)
                or not chunk_id[len(prefix):].isdigit()
                or int(chunk_id[len(prefix):]) >= (row.chunk_count or 0)
                or type(metadata.get("ownerUserId")) is not int or metadata["ownerUserId"] != row.user_id
                or metadata.get("docId") != str(row.id) or metadata.get("source") != row.file_url):
            continue
        seen.add(chunk_id)
        accepted.append({"citationId": chunk_id, "documentId": str(row.id),
            "sourceRevision": row.governance_version, "title": row.title, "source": row.file_url,
            "quotedText": quote, "quotedTextDigest": hashlib.sha256(quote.encode()).hexdigest()})
    return accepted


def private_search(db, config, owner: int, query: str) -> list[dict]:
    def permitted(row):
        return (row.user_id == owner and row.is_delete == 0 and row.status == 1 and
                row.review_status not in {"WITHDRAWN", "REJECTED"} and
                (row.visibility == "PRIVATE_USER" or
                 row.visibility == "CURATED_PUBLIC" and row.review_status == "APPROVED"))

    documents = {row.id: row for row in db.scalars(select(KnowledgeDocument).where(
        KnowledgeDocument.user_id == owner, KnowledgeDocument.is_delete == 0)).all() if permitted(row)}
    if not documents:
        return []
    results = query_chunks(config, query, sorted(documents))
    # A locking current read sees revocations under MySQL REPEATABLE READ;
    # expire_all + get would still read the request's old transaction snapshot.
    current = db.scalars(select(KnowledgeDocument).where(KnowledgeDocument.id.in_(documents))
                         .with_for_update().execution_options(populate_existing=True)).all()
    documents = {row.id: row for row in current if permitted(row)}
    return citations_from_results(results, documents)


class EvidenceRetriever:
    def __init__(self, sessions, config):
        self.sessions, self.config = sessions, config

    def retrieve(self, disease: str, *, rewritten: bool = False) -> dict[str, Any]:
        topic = "DISEASE_OVERVIEW"
        batch: dict[str, Any] = {"status": "INSUFFICIENT", "reasonCode": "NO_MATCHING_EVIDENCE",
            "diseaseCode": disease, "topicCode": topic, "attempts": 2 if rewritten else 1,
            "citations": [], "policyVersion": "controlled-reference-v1"}
        # Never alias unsupported model labels to clinical diagnoses.
        if disease not in DISEASE_TERMS:
            batch["reasonCode"] = "UNSUPPORTED_EVIDENCE_CODE"
            return batch
        text = f"{DISEASE_TERMS[disease]} {TOPIC_TERMS[topic]}"
        if rewritten:
            text = f"general information about {DISEASE_TERMS[disease]} overview"
        with self.sessions() as db:
            documents = {row.id: row for row in db.scalars(select(KnowledgeDocument).where(
                KnowledgeDocument.is_delete == 0, KnowledgeDocument.status == 1,
                KnowledgeDocument.visibility == "CURATED_PUBLIC",
                KnowledgeDocument.review_status == "APPROVED")).all() if eligible(row, disease, topic)}
        if not documents:
            return batch
        try:
            results = query_chunks(self.config, text, sorted(documents))
            batch["citations"] = citations_from_results(results, documents)
        except Exception:
            logger.warning("controlled evidence retrieval unavailable", exc_info=True)
            # An unavailable tool is a technical execution failure. Let the
            # Worker retry; empty successful retrieval remains insufficient.
            raise
        return self.validate(batch)

    def validate(self, batch: dict[str, Any]) -> dict[str, Any]:
        with self.sessions() as db:
            return validate_evidence(db, batch)


def validate_evidence(db, batch: dict[str, Any]) -> dict[str, Any]:
    """MySQL is authoritative even for stale vectors and persisted task snapshots."""
    accepted = []
    ids = [int(citation["documentId"]) for citation in batch["citations"]]
    documents = {row.id: row for row in db.scalars(select(KnowledgeDocument).where(
        KnowledgeDocument.id.in_(ids)).with_for_update().execution_options(populate_existing=True)).all()} if ids else {}
    for citation in batch["citations"]:
        row = documents.get(int(citation["documentId"]))
        if (row and eligible(row, batch["diseaseCode"], batch["topicCode"]) and
                row.governance_version == citation["sourceRevision"] and row.file_url == citation["source"] and
                hashlib.sha256(citation["quotedText"].encode()).hexdigest() == citation["quotedTextDigest"]):
            accepted.append(citation)
    return {**batch, "citations": accepted, "status": "SUFFICIENT" if accepted else "INSUFFICIENT",
            "reasonCode": None if accepted else batch.get("reasonCode") or "SOURCE_NO_LONGER_APPROVED"}


def evidence_view(db, batch: dict[str, Any]) -> dict:
    current = validate_evidence(db, batch)
    return {"status": current["status"], "reasonCode": current["reasonCode"],
            "attempts": current["attempts"], "citations": [
                {key: value for key, value in citation.items() if key != "quotedText"}
                for citation in current["citations"]]}
