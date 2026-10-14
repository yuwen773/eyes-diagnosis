"""FastAPI application factory.

Run with::

    cd algorithm && uvicorn web.app:app --port 8080

Path prefix
-----------
Java serves under ``server.servlet.context-path: /api`` and the frontend calls
``/api/user/login``, ``/api/news/page/vo`` and so on. Python therefore mounts
routers under ``/api`` too, keeping Nginx a plain pass-through for this service
and identical for Java.

Import-time safety
------------------
Nothing here loads torch or model weights at import time -- the inference engine
is constructed in the lifespan callback and imported lazily, so a runner with
no GPU and no weights still builds the app. ``create_app()`` must succeed on a
CI runner with no GPU, no weights and no MySQL/Redis/Chroma, so the
``python-web`` job can assert the app builds and the exception envelope is
correct without standing up infrastructure.
"""

from contextlib import asynccontextmanager
from importlib import import_module
import logging

import httpx
from fastapi import APIRouter, FastAPI
from redis.asyncio import Redis

from web.config import WebConfig
from web.db import dispose_engine, init_engine
from web.deps import set_config
from web.middleware import register_cors, register_exception_handlers

#: Mirrors ``server.servlet.context-path``.
API_PREFIX = "/api"

#: Routers added as their domains land. Each entry is (domain, import path);
#: a path that cannot be imported yet is skipped so a half-finished migration
#: phase still boots. By Phase 2.5 every entry resolves and this can be a
#: plain list of routers.
_DOMAIN_ROUTER_PATHS: tuple[str, ...] = (
    "web.routers.user",  # Phase 2.1
    "web.routers.diagnosis",  # Phase 2.2
    "web.routers.news",       # Phase 2.3
    "web.routers.knowledge",  # Phase 2.4
    "web.routers.mcp_server",  # Phase 2.5
    "web.routers.workflow",  # Durable async upload (separate from legacy diagnosis).
    "web.routers.review",  # Doctor quality review, separate from user approval.
    "web.routers.agent",  # Current-session chat; no diagnostic/business tools.
    "web.routers.tool_confirmation",  # Explicit user consent for chat business writes.
)


def _collect_routers() -> list[APIRouter]:
    routers: list[APIRouter] = []
    for path in _DOMAIN_ROUTER_PATHS:
        module = import_module(path)
        routers.append(module.router)
    return routers


def _build_inference_engine(config: WebConfig):
    """Construct the engine and try to load the weights.

    Returns the engine either way. Loading failure is **logged, not raised**:
    the app still has to serve the seven diagnosis endpoints that do not need a
    model (three list endpoints, delete, get, human review, image upload), and
    ``POST /diagnosis/diagnosis`` already fails closed on
    :class:`~web.inference.InferenceUnavailable`. Aborting startup instead would
    take the whole domain offline over a missing file -- and this repository
    checks in no weights at all, so that would be the *default* state.

    This is a deliberate difference from ``grpc_server.py``, whose
    ``__main__`` constructs the servicer and dies if the model will not load.
    That was correct for a process whose only job is inference.
    """
    from web.inference import InferenceEngine, ensure_algorithm_on_path

    ensure_algorithm_on_path()
    engine = InferenceEngine(config)
    try:
        engine.load()
    except Exception:  # noqa: BLE001 - see docstring; failure is deferred, not fatal
        logging.getLogger(__name__).warning(
            "inference engine not loaded; POST /diagnosis/diagnosis will fail "
            "closed until the weights are configured", exc_info=True
        )
    return engine


def create_app(config: WebConfig | None = None) -> FastAPI:
    """Build the application.

    Injecting ``config`` keeps tests hermetic -- the CI smoke test constructs a
    config with unreachable hosts and asserts only that construction succeeds,
    since nothing connects until the lifespan runs.
    """
    resolved = config or WebConfig.from_env()

    @asynccontextmanager
    async def lifespan(application: FastAPI):
        # Connections are opened here, not at import time, so importing this
        # module never requires infrastructure to be reachable.
        init_engine(resolved)
        application.state.redis = Redis.from_url(
            resolved.redis_url, decode_responses=True, protocol=2
        )
        application.state.java_client = httpx.AsyncClient(
            base_url=resolved.java_base_url,
            timeout=httpx.Timeout(5.0),
            follow_redirects=False,
        )
        application.state.chat_client = httpx.AsyncClient(follow_redirects=False)
        application.state.inference_engine = _build_inference_engine(resolved)
        try:
            yield
        finally:
            await application.state.chat_client.aclose()
            await application.state.java_client.aclose()
            await application.state.redis.aclose()
            dispose_engine()

    application = FastAPI(
        title="Eye Diagnosis Web API",
        version="1.0.0",
        description=(
            "Python rewrite of the non-Agent domains. Contract notes live in "
            "docs/migration-decisions.md."
        ),
        lifespan=lifespan,
    )
    application.state.config = resolved
    set_config(resolved)

    register_cors(application, resolved)
    register_exception_handlers(application)

    for router in _collect_routers():
        application.include_router(router, prefix=API_PREFIX)

    @application.get("/health", include_in_schema=False)
    async def health() -> dict:
        """Liveness probe. Deliberately outside the BaseResponse envelope and
        unauthenticated -- Nginx uses it to decide whether to route here."""
        return {"status": "up"}

    return application


app = create_app()
