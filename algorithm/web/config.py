"""FastAPI Web layer configuration.

Mirrors the ``from_env()`` style of ``mcp_server/config.py`` -- explicit
constructor defaults, validation in ``__init__``, environment lookup in a
classmethod. The repository has no Python configuration framework (no
pyproject/settings module), so this stays deliberately dependency-free.

Every value here has a Java counterpart in
``src/main/resources/application-server.example.yml``; the mapping is noted on
each field so the two stacks stay diffable.
"""

import os
from urllib.parse import quote_plus

# Port allocation (see docs/migration-decisions.md):
#   5173 frontend | 8081 nginx | 8082 Java | 8080 this service
#   8000 ChromaDB | 6379 Redis | 3306 MySQL
DEFAULT_WEB_PORT = 8080

#: Mirrors ``eye_diagnosis.abstain.QUALITY_GATE_MODES``. Duplicated rather than
#: imported because that module pulls numpy at import time, and this file must
#: stay importable in a CI job with no torch/numpy installed.
QUALITY_GATE_MODES = frozenset({"observe", "enforce"})


def _split_origins(raw: str) -> list[str]:
    """Parse a comma-separated origin list.

    An empty result means "reject every cross-origin credentialed request",
    mirroring ``CorsConfig``'s empty-list default. Never returns ``["*"]`` --
    ``allow_credentials=True`` with a wildcard is rejected by the CORS spec and
    is explicitly forbidden by ``CorsConfigTest.configDoesNotUseWildcard``.
    """
    if not raw:
        return []
    return [origin.strip() for origin in raw.split(",") if origin.strip()]


class WebConfig:
    """Runtime configuration for the Python web layer."""

    def __init__(
        self,
        host: str = "127.0.0.1",
        port: int = DEFAULT_WEB_PORT,
        # Java backend -- the authority for session/login. Python forwards
        # JSESSIONID to it rather than parsing Spring Session's Redis payload
        # (JdkSerializationRedisSerializer -- unparseable from Python).
        java_base_url: str = "http://127.0.0.1:8082/api",
        # MySQL -- shared with Java. camelCase column names are preserved
        # because the project sets map-underscore-to-camel-case: false.
        mysql_host: str = "127.0.0.1",
        mysql_port: int = 3306,
        mysql_database: str = "diagnosis",
        mysql_user: str = "eyeuser",
        mysql_password: str = "",
        # Redis -- list-page caches. Login identity is revalidated with Java.
        redis_host: str = "127.0.0.1",
        redis_port: int = 6379,
        redis_db: int = 8,
        redis_password: str | None = None,
        cors_allowed_origins: list[str] | None = None,
        # Remaining CORS knobs are fixed by CorsConfig.java:28-32, not
        # configurable there either -- same defaults apply here.
        cors_allowed_methods: tuple[str, ...] = ("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"),
        cors_allowed_headers: tuple[str, ...] = (
            "Content-Type",
            "X-Requested-With",
            "Authorization",
        ),
        cors_max_age: int = 3600,
        # Chroma -- see docs/migration-decisions.md ruling 1. Java's
        # VectorStoreConfig.java:24 default (eye-diagnosis-knowledge) is dead
        # code; every real config resolves to diagnosis-knowledge.
        chroma_host: str = "http://127.0.0.1",
        chroma_port: int = 8000,
        chroma_collection: str = "diagnosis-knowledge",
        chroma_tenant: str = "default_tenant",
        chroma_database: str = "default_database",
        # DashScope / COS
        dashscope_api_key: str | None = None,
        dashscope_base_url: str = "https://dashscope.aliyuncs.com/compatible-mode",
        embedding_model: str = "text-embedding-v3",
        chat_model: str = "qwen3-vl-plus",
        cos_secret_id: str | None = None,
        cos_secret_key: str | None = None,
        cos_region: str = "",
        cos_bucket: str = "",
        cos_host: str = "",
        # --- Inference (Phase 2.2) ---
        #
        # Every one of these is a string or bool. None may reference torch at
        # construction time: `mcp_server/config.py:2,22` does `import torch` in
        # its module scope and calls `torch.cuda.is_available()` in a default
        # argument, and that is precisely why this class had no model settings
        # until Phase 2.2. Adding a `device` field computed from torch would
        # pull torch into every CI job that imports the app.
        #
        # Mirrors the bare `os.getenv` reads in `grpc_server.py:36-83`, moved
        # here to keep one configuration idiom across the Python services.
        #
        #: Path to the EfficientNet-B4 state_dict. Empty means "not configured"
        #: -- the app still boots, and `/diagnosis/upload` fails closed at
        #: request time rather than at startup.
        model_weights_path: str = "",
        #: Optional expected SHA-256. When set, a mismatch aborts the load
        #: (grpc_server.py:47-54 uses hmac.compare_digest).
        model_weights_sha256: str = "",
        model_registry_path: str = "checkpoints/registry.json",
        model_calibration_path: str = "configs/calibration/efficientnet_b4_temperature.json",
        #: Defaulted to Java's application.yml:86-89 values so a deployment
        #: that sets neither still writes the same fingerprint tuple.
        model_version: str = "efficientnet-b4@1.0.0",
        preprocess_version: str = "v1",
        inference_policy_version: str = "medical-safety-v3-quality-observe",
        #: "observe" records quality reasons without rejecting; "enforce"
        #: rejects below the quality bar. Java reads this from
        #: ``diagnosis.quality-gate-mode``; any other value is an error
        #: (``abstain.should_reject_for_quality`` raises ValueError).
        quality_gate_mode: str = "observe",
        #: Master switch for ``t_inference_cache`` reads/writes. Java gates the
        #: cache on all four fingerprint components being non-blank, so leaving
        #: ``model_weights_sha256`` empty disables caching out of the box --
        #: this flag reproduces that without depending on the side effect.
        inference_cache_enabled: bool = True,
        # --- MCP remote connection policy (Phase 2.5) ---
        #
        #: Comma-separated allow-list of origins a user-supplied MCP server may
        #: point at, mirroring ``mcp.remote.allowed-origins``. Entries are
        #: normalised to ``scheme://authority``, so a configured path is ignored.
        #:
        #: **Empty means every remote MCP is rejected**
        #: (``McpConnectionPolicy`` compares against this list and finds
        #: nothing). That is the Java default -- the property is
        #: ``${mcp.remote.allowed-origins:}`` -- and it is deliberate
        #: fail-closed behaviour: an outbound connection to an address a user
        #: chose is exactly what an allow-list exists to prevent.
        mcp_allowed_origins: str = "",
        # Operator-approved read-only pairs: serverCode/toolName, comma separated.
        # Remote annotations and model output cannot grant this permission.
        mcp_readonly_tools: str = "",
    ):
        self.host = host
        if not isinstance(port, int) or port < 1 or port > 65535:
            raise ValueError(f"port must be an integer between 1 and 65535, got {port!r}")
        self.port = port
        self.java_base_url = java_base_url.rstrip("/")
        self.mysql_host = mysql_host
        self.mysql_port = mysql_port
        self.mysql_database = mysql_database
        self.mysql_user = mysql_user
        self.mysql_password = mysql_password
        self.redis_host = redis_host
        self.redis_port = redis_port
        self.redis_db = redis_db
        self.redis_password = redis_password
        self.cors_allowed_origins = cors_allowed_origins or []
        if "*" in self.cors_allowed_origins:
            raise ValueError(
                "cors_allowed_origins must not contain '*': credentialed CORS "
                "forbids wildcards (mirrors CorsConfigTest.configDoesNotUseWildcard)"
            )
        self.cors_allowed_methods = tuple(cors_allowed_methods)
        self.cors_allowed_headers = tuple(cors_allowed_headers)
        self.cors_max_age = cors_max_age
        self.chroma_host = chroma_host.rstrip("/")
        self.chroma_port = chroma_port
        self.chroma_collection = chroma_collection
        self.chroma_tenant = chroma_tenant
        self.chroma_database = chroma_database
        self.dashscope_api_key = dashscope_api_key
        self.dashscope_base_url = dashscope_base_url
        self.embedding_model = embedding_model
        self.chat_model = chat_model
        self.cos_secret_id = cos_secret_id
        self.cos_secret_key = cos_secret_key
        self.cos_region = cos_region
        self.cos_bucket = cos_bucket
        self.cos_host = cos_host
        self.model_weights_path = model_weights_path
        self.model_weights_sha256 = model_weights_sha256.strip().lower()
        self.model_registry_path = model_registry_path
        self.model_calibration_path = model_calibration_path
        self.model_version = model_version
        self.preprocess_version = preprocess_version
        self.inference_policy_version = inference_policy_version
        if quality_gate_mode not in QUALITY_GATE_MODES:
            raise ValueError(
                f"quality_gate_mode must be one of {sorted(QUALITY_GATE_MODES)}, "
                f"got {quality_gate_mode!r}"
            )
        self.quality_gate_mode = quality_gate_mode
        self.inference_cache_enabled = inference_cache_enabled
        self.mcp_allowed_origins = mcp_allowed_origins
        self.mcp_readonly_tools = mcp_readonly_tools

    @property
    def redis_url(self) -> str:
        auth = f":{self.redis_password}@" if self.redis_password else ""
        return f"redis://{auth}{self.redis_host}:{self.redis_port}/{self.redis_db}"

    @property
    def chroma_url(self) -> str:
        return f"{self.chroma_host}:{self.chroma_port}"

    @property
    def mysql_url(self) -> str:
        """SQLAlchemy URL.

        The schema has no timezone support, so DATETIME values must be read as
        naive local time to match Java. That happens to be the PyMySQL default,
        which is why no ``serverTimezone`` parameter is set here -- adding one
        would make Python shift timestamps that Java reads verbatim.
        """
        return (
            f"mysql+pymysql://{quote_plus(self.mysql_user)}:"
            f"{quote_plus(self.mysql_password)}@{self.mysql_host}:{self.mysql_port}/"
            f"{self.mysql_database}?charset=utf8mb4"
        )

    def __repr__(self) -> str:
        # Secrets are redacted so this is safe to log at startup.
        return (
            f"WebConfig(host={self.host!r}, port={self.port}, "
            f"java_base_url={self.java_base_url!r}, "
            f"mysql={self.mysql_host}:{self.mysql_port}/{self.mysql_database}, "
            f"redis={self.redis_host}:{self.redis_port}/{self.redis_db}, "
            f"cors_allowed_origins={self.cors_allowed_origins!r}, "
            f"cors_max_age={self.cors_max_age}, "
            f"chroma_collection={self.chroma_collection!r}, "
            f"cos_secret_id={'set' if self.cos_secret_id else None}, "
            f"model_weights_path={self.model_weights_path or None}, "
            f"model_weights_sha256="
            f"{self.model_weights_sha256[:12] + '...' if self.model_weights_sha256 else None}, "
            f"quality_gate_mode={self.quality_gate_mode!r})"
        )

    @classmethod
    def from_env(cls) -> "WebConfig":
        return cls(
            host=os.getenv("WEB_HOST", "127.0.0.1"),
            port=int(os.getenv("WEB_PORT", str(DEFAULT_WEB_PORT))),
            java_base_url=os.getenv("JAVA_BASE_URL", "http://127.0.0.1:8082/api"),
            mysql_host=os.getenv("MYSQL_HOST", "127.0.0.1"),
            mysql_port=int(os.getenv("MYSQL_PORT", "3306")),
            mysql_database=os.getenv("MYSQL_DATABASE", "diagnosis"),
            mysql_user=os.getenv("MYSQL_USER", "eyeuser"),
            mysql_password=os.getenv("MYSQL_PASSWORD", ""),
            redis_host=os.getenv("REDIS_HOST", "127.0.0.1"),
            redis_port=int(os.getenv("REDIS_PORT", "6379")),
            redis_db=int(os.getenv("REDIS_DB", "8")),
            redis_password=os.getenv("REDIS_PASSWORD") or None,
            cors_allowed_origins=_split_origins(os.getenv("CORS_ALLOWED_ORIGINS", "")),
            chroma_host=os.getenv("CHROMA_HOST", "http://127.0.0.1"),
            chroma_port=int(os.getenv("CHROMA_PORT", "8000")),
            chroma_collection=os.getenv("CHROMA_COLLECTION", "diagnosis-knowledge"),
            chroma_tenant=os.getenv("CHROMA_TENANT", "default_tenant"),
            chroma_database=os.getenv("CHROMA_DATABASE", "default_database"),
            dashscope_api_key=os.getenv("DASHSCOPE_API_KEY") or None,
            dashscope_base_url=os.getenv(
                "DASHSCOPE_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode"
            ),
            embedding_model=os.getenv("EMBEDDING_MODEL", "text-embedding-v3"),
            chat_model=os.getenv("CHAT_MODEL", "qwen3-vl-plus"),
            cos_secret_id=os.getenv("COS_SECRET_ID") or None,
            cos_secret_key=os.getenv("COS_SECRET_KEY") or None,
            cos_region=os.getenv("COS_REGION", ""),
            cos_bucket=os.getenv("COS_BUCKET", ""),
            cos_host=os.getenv("COS_HOST", ""),
            # Same names grpc_server.py already reads, so a deployment that was
            # tuned for the gRPC service works unchanged.
            model_weights_path=os.getenv("MODEL_WEIGHTS_PATH", ""),
            model_weights_sha256=os.getenv("MODEL_WEIGHTS_SHA256", ""),
            model_registry_path=os.getenv("MODEL_REGISTRY_PATH", "checkpoints/registry.json"),
            model_calibration_path=os.getenv(
                "MODEL_CALIBRATION_PATH",
                "configs/calibration/efficientnet_b4_temperature.json",
            ),
            model_version=os.getenv("MODEL_VERSION", "efficientnet-b4@1.0.0"),
            preprocess_version=os.getenv("PREPROCESS_VERSION", "v1"),
            inference_policy_version=os.getenv(
                "INFERENCE_POLICY_VERSION", "medical-safety-v3-quality-observe"
            ),
            quality_gate_mode=os.getenv("QUALITY_GATE_MODE", "observe"),
            inference_cache_enabled=os.getenv("INFERENCE_CACHE_ENABLED", "true").lower()
            not in ("0", "false", "no", "off"),
            mcp_allowed_origins=os.getenv("MCP_ALLOWED_ORIGINS", ""),
            mcp_readonly_tools=os.getenv("MCP_READONLY_TOOLS", ""),
        )
