"""Chroma write side + DashScope embeddings.

Everything here is behind two lazy imports -- ``chromadb`` and the embedding
client are absent from the default interpreter, and ``create_app()`` must build
without them.

Why this module is the highest-risk one in the migration
-------------------------------------------------------
Java's **read** side (``agent/tools/DocumentSearchTool.java``) does not change.
It filters with ``filterExpression("ownerUserId == " + currentUserId)`` against
a collection it assumes already holds Python's writes. Every constant below is
load-bearing, and a mismatch produces **zero documents with no error**:

* the collection name -- Java's ``@Value`` default is ``eye-diagnosis-knowledge``
  but every real config says ``diagnosis-knowledge`` (ruling 1, finding J-9)
* tenant / database
* the embedding model **and its dimension** -- a different dimension makes
  Chroma reject the add outright, which is at least loud
* ``ownerUserId`` must be an **integer**. As a string it type-mismatches the
  filter and every search silently returns empty. This is the multi-tenant
  isolation boundary.

Vector ids are ``doc_{docId}_chunk_{i}`` -- see
:func:`web.knowledge.chunk_ids`, which the delete path also uses, so a drift
here leaves orphaned vectors that no delete can ever reach.
"""

import logging
from typing import Any, Sequence
from urllib.parse import urlsplit

from web.knowledge import ChunkPayload

logger = logging.getLogger(__name__)


class VectorStoreUnavailable(RuntimeError):
    """Chroma is not configured or not reachable.

    Distinct from a failed write: the document is still in MySQL and its
    ``status`` is updated to 2 (failed), which is exactly what Java does when
    ``vectorStore`` is null.
    """


class DashScopeEmbedder:
    """DashScope OpenAI-compatible embeddings.

    The endpoint and payload shape match Spring AI Alibaba's autoconfigured
    ``DashScopeEmbeddingModel`` for ``text-embedding-v3``. No ``dimensions``
    field is sent, so DashScope's default for that model applies -- and it must
    be the same default Java gets, or every vector is the wrong length and
    Chroma refuses the collection.

    Configured from ``WebConfig.dashscope_api_key`` /
    ``WebConfig.dashscope_base_url`` / ``WebConfig.embedding_model``, which
    default to the values in ``application-server.example.yml:43-48``.
    """

    def __init__(self, api_key: str, base_url: str, model: str, client=None):
        if not api_key:
            raise VectorStoreUnavailable(
                "DASHSCOPE_API_KEY is not set; cannot embed knowledge chunks"
            )
        self._api_key = api_key
        self._base_url = base_url.rstrip("/")
        self._model = model
        # Injected in tests; created lazily so importing this module needs no
        # httpx client and no network.
        self._client = client

    async def embed(self, texts: Sequence[str]) -> list[list[float]]:
        """Vectors for ``texts``, in order."""
        if not texts:
            return []

        import httpx

        if self._client is None:
            self._client = httpx.AsyncClient(timeout=httpx.Timeout(30.0))

        response = await self._post({"model": self._model, "input": list(texts)})
        data = response.get("data")
        if not isinstance(data, list) or len(data) != len(texts):
            raise VectorStoreUnavailable(
                f"DashScope returned {0 if data is None else len(data)} embeddings "
                f"for {len(texts)} inputs"
            )
        # DashScope does not guarantee ordering; `index` is authoritative.
        ordered = sorted(data, key=lambda item: item.get("index", 0))
        vectors = [item["embedding"] for item in ordered]
        self._assert_single_dimension(vectors)
        return vectors

    async def _post(self, payload: dict[str, Any]) -> dict[str, Any]:
        import httpx

        response = await self._client.post(
            f"{self._base_url}/embeddings",
            json=payload,
            headers={"Authorization": f"Bearer {self._api_key}"},
        )
        if response.status_code != 200:
            logger.error("DashScope embedding failed: HTTP %s", response.status_code)
            raise VectorStoreUnavailable(
                f"DashScope embedding endpoint returned HTTP {response.status_code}"
            )
        return response.json()

    @staticmethod
    def _assert_single_dimension(vectors: list[list[float]]) -> None:
        """Fail loudly on a ragged response.

        A batch that came back with mixed lengths would otherwise upload some
        chunks and reject others, leaving a document whose ``chunkCount``
        promises vectors that were never written -- invisible until a search
        quietly misses them.
        """
        lengths = {len(vector) for vector in vectors}
        if len(lengths) > 1:
            raise VectorStoreUnavailable(
                f"DashScope returned inconsistent embedding dimensions: {sorted(lengths)}"
            )


class ChromaWriter:
    """Thin wrapper over the ``chromadb`` client.

    Only the two operations the ETL needs: ``add`` for the load step and
    ``delete`` for the delete path. Retrieval stays on Java.
    """

    def __init__(self, config):
        self._host = config.chroma_host
        self._port = config.chroma_port
        # Chroma treats a URL host as complete and ignores its separate port.
        if "://" in self._host:
            address = urlsplit(self._host)
            if address.port is None:
                self._host = address._replace(netloc=f"{address.netloc}:{self._port}").geturl()
        self._collection_name = config.chroma_collection
        self._tenant = config.chroma_tenant
        self._database = config.chroma_database
        self._client = None
        self._collection = None

    def query(self, vectors: list[list[float]], document_ids: list[int]) -> dict:
        """Search only the document ids authorized by the MySQL evidence gateway."""
        return self._connect().query(query_embeddings=vectors,
            where={"documentId": {"$in": document_ids}}, n_results=5,
            include=["documents", "metadatas", "distances"])

    def _connect(self):
        if self._collection is not None:
            return self._collection
        try:
            import chromadb
        except ImportError as exc:  # pragma: no cover - environment dependent
            raise VectorStoreUnavailable(
                "chromadb is not installed; the knowledge write side needs it"
            ) from exc
        try:
            self._client = chromadb.HttpClient(
                host=self._host,
                port=self._port,
                tenant=self._tenant,
                database=self._database,
            )
            self._collection = self._client.get_or_create_collection(
                name=self._collection_name
            )
        except Exception as exc:  # noqa: BLE001
            logger.error("Chroma connect failed: %s:%s", self._host, self._port)
            raise VectorStoreUnavailable(f"cannot reach Chroma: {exc}") from exc
        return self._collection

    def add(self, payloads: Sequence[ChunkPayload], vectors: Sequence[Sequence[float]]) -> None:
        """Upsert chunks by their explicit id.

        ``ids`` is passed explicitly rather than letting Chroma generate
        ``doc_{id}_chunk_{i}``-shaped ids by chance -- the delete path rebuilds
        exactly these ids from ``chunkCount``, so they are a contract, not a
        detail.
        """
        if len(payloads) != len(vectors):
            raise ValueError(
                f"{len(payloads)} chunks but {len(vectors)} vectors"
            )
        if not payloads:
            return
        collection = self._connect()
        collection.upsert(
            ids=[payload.id for payload in payloads],
            documents=[payload.text for payload in payloads],
            embeddings=[list(vector) for vector in vectors],
            metadatas=[payload.metadata for payload in payloads],
        )

    def delete(self, ids: Sequence[str]) -> None:
        """Remove chunks by id.

        Chroma accepts an empty ``ids`` list but not an empty *string*, and a
        document with ``chunkCount`` of 0 has no vectors to remove -- callers
        guard on that already, and this guard keeps a future caller honest.
        """
        if not ids:
            return
        self._connect().delete(ids=list(ids))
