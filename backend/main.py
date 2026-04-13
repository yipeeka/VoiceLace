from __future__ import annotations

from contextlib import asynccontextmanager
import logging

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from backend.api import api_router
from backend.config import settings
from backend.state import create_app_state

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings.ensure_directories()
    app.state.app_state = create_app_state()
    try:
        yield
    finally:
        app.state.app_state = None


app = FastAPI(title=settings.app_name, lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_origin_regex=settings.cors_origin_regex,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(api_router, prefix=settings.api_prefix)


def _error_payload(message: str, code: str, details=None, path: str | None = None) -> dict:
    payload = {
        "message": message,
        "code": code,
    }
    if details is not None:
        payload["details"] = details
    if path is not None:
        payload["path"] = path
    return payload


@app.exception_handler(RequestValidationError)
async def handle_validation_error(request: Request, exc: RequestValidationError):
    return JSONResponse(
        status_code=422,
        content=_error_payload(
            message="请求参数校验失败",
            code="validation_error",
            details=exc.errors(),
            path=request.url.path,
        ),
    )


@app.exception_handler(HTTPException)
async def handle_http_exception(request: Request, exc: HTTPException):
    detail = exc.detail
    message = detail if isinstance(detail, str) and detail.strip() else f"HTTP {exc.status_code}"
    details = None if isinstance(detail, str) else detail
    return JSONResponse(
        status_code=exc.status_code,
        content=_error_payload(
            message=message,
            code=f"http_{exc.status_code}",
            details=details,
            path=request.url.path,
        ),
    )


@app.exception_handler(StarletteHTTPException)
async def handle_starlette_http_exception(request: Request, exc: StarletteHTTPException):
    detail = exc.detail
    message = detail if isinstance(detail, str) and detail.strip() else f"HTTP {exc.status_code}"
    details = None if isinstance(detail, str) else detail
    return JSONResponse(
        status_code=exc.status_code,
        content=_error_payload(
            message=message,
            code=f"http_{exc.status_code}",
            details=details,
            path=request.url.path,
        ),
    )


@app.exception_handler(Exception)
async def handle_unexpected_exception(request: Request, exc: Exception):
    logger.exception("Unhandled exception at %s", request.url.path, exc_info=exc)
    return JSONResponse(
        status_code=500,
        content=_error_payload(
            message="服务器内部错误",
            code="internal_error",
            path=request.url.path,
        ),
    )


@app.get("/")
async def root():
    return {"name": settings.app_name, "docs": "/docs"}
