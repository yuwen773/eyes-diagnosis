"""Installed application commands shared by local development and containers."""

import argparse
import asyncio
import json

from redis.asyncio import Redis
from sqlalchemy import create_engine, text
import uvicorn

from web.config import WebConfig


def api() -> None:
    config = WebConfig.from_env()
    uvicorn.run("web.app:app", host=config.host, port=config.port, workers=1)


def _mysql_readiness(config: WebConfig) -> None:
    engine = create_engine(config.mysql_url, connect_args={"connect_timeout": 5, "read_timeout": 5, "write_timeout": 5})
    try:
        with engine.connect() as db:
            db.execute(text("SELECT 1"))
    finally:
        engine.dispose()


async def readiness(config: WebConfig | None = None) -> dict[str, str]:
    config = config or WebConfig.from_env()
    await asyncio.to_thread(_mysql_readiness, config)
    redis = Redis.from_url(config.redis_url, socket_connect_timeout=5, socket_timeout=5, protocol=2)
    try:
        await redis.ping()
    finally:
        await redis.aclose()
    return {"status": "ready"}


def health() -> None:
    parser = argparse.ArgumentParser(description="Read-only MySQL/Redis readiness check")
    parser.parse_args()
    try:
        print(json.dumps(asyncio.run(readiness())))
    except Exception:
        print(json.dumps({"status": "unavailable"}))
        raise SystemExit(1)
