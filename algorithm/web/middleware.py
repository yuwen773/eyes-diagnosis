"""CORS and the global exception -> envelope mapping.

The single most important behaviour here: **every handled error is returned
with HTTP 200**, matching the Java stack.

``GlobalExceptionHandler`` is a ``@RestControllerAdvice`` with two
``@ExceptionHandler`` methods and no ``@ResponseStatus`` anywhere in the
codebase, so Spring serializes the returned ``BaseResponse`` with the default
200 status. The frontend depends on this: ``request.ts:38`` branches on
``data.code === 40100`` inside a *successful* response handler -- an HTTP 401
or 500 would fall through to the rejection branch and skip the redirect-to-login
flow entirely.

One deliberate deviation
------------------------
Java has no bean validation on request bodies (``@Valid`` appears nowhere), and
a malformed binding (missing ``@RequestParam``, unparseable body) raises a
Spring ``ServletRequestBindingException`` that falls through to the catch-all
``Exception`` handler -- surfacing as ``code=50000, msg="系统错误"``, i.e. a
client mistake reported as a server fault. Python maps those to
``ErrorCode.PARAMS_ERROR`` (40000, ``"请求参数错误"``) instead, which is what
the Java *service* layer intends via ``ThrowUtils.throwIf(..., PARAMS_ERROR)``.

This is the one place the rewrite does not reproduce Java byte-for-byte. It is
listed in ``docs/migration-decisions.md``; the frontend already renders any
non-zero ``msg`` verbatim, so the visible change is a more accurate error text
on malformed requests.
"""

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from web.config import WebConfig
from web.response import BaseResponse, BizError, ErrorCode


def register_cors(app: FastAPI, config: WebConfig) -> None:
    """Mirror ``config/CorsConfig.java:24-33`` exactly.

    With Nginx in front (Phase 3) these paths are same-origin and never trigger
    a preflight; the settings exist for local development, where Vite on :5173
    talks to this service on :8080 directly.
    """
    app.add_middleware(
        CORSMiddleware,
        allow_origins=config.cors_allowed_origins,
        allow_credentials=True,
        allow_methods=list(config.cors_allowed_methods),
        allow_headers=list(config.cors_allowed_headers),
        # Java calls exposedHeaders() with no arguments, i.e. none.
        expose_headers=[],
        max_age=config.cors_max_age,
    )


def register_exception_handlers(app: FastAPI) -> None:
    """Install the handlers that make the HTTP-200-always contract true."""

    @app.exception_handler(BizError)
    async def _biz_error(_request: Request, exc: BizError) -> JSONResponse:
        return JSONResponse(
            status_code=200,
            content=BaseResponse.error(exc.code, exc.message).model_dump(mode="json"),
        )

    @app.exception_handler(RequestValidationError)
    async def _validation_error(
        _request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        # See the module docstring: this intentionally diverges from Java's
        # catch-all, which reports malformed requests as 50000.
        first = exc.errors()[0] if exc.errors() else {}
        field = ".".join(str(p) for p in first.get("loc", ()) if p != "body")
        detail = first.get("msg", "参数校验失败")
        message = f"{field}: {detail}" if field else detail
        return JSONResponse(
            status_code=200,
            content=BaseResponse.error(ErrorCode.PARAMS_ERROR, message).model_dump(mode="json"),
        )

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(_request: Request, exc: StarletteHTTPException) -> JSONResponse:
        """Unrouted paths and method mismatches.

        Spring answers these with its own error body (``timestamp``/``status``/
        ``error``/``path``) and a real 4xx status, *not* the BaseResponse
        envelope -- that is a property of Spring's ``BasicErrorController``
        rather than of this project. Preserved deliberately: the frontend's
        error branch treats these as transport failures, which is what a
        genuinely missing route should be.
        """
        if exc.status_code == 404:
            return JSONResponse(status_code=404, content={"detail": "Not Found"})
        return JSONResponse(
            status_code=200,
            content=BaseResponse.error(
                ErrorCode.SYSTEM_ERROR, exc.detail or ""
            ).model_dump(mode="json"),
        )

    @app.exception_handler(Exception)
    async def _unhandled(_request: Request, exc: Exception) -> JSONResponse:
        """Catch-all, equivalent to ``GlobalExceptionHandler.handleException``.

        Note the message is the literal ``"系统错误"`` that
        ``GlobalExceptionHandler.java:37`` passes -- deliberately *not*
        ``ErrorCode.SYSTEM_ERROR.message`` (``"系统内部异常"``). The frontend
        surfaces ``msg`` directly in toast text, so the distinction is visible.
        """
        return JSONResponse(
            status_code=200,
            content=BaseResponse.error(ErrorCode.SYSTEM_ERROR, "系统错误").model_dump(
                mode="json"
            ),
        )
