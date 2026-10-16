"""Ticket 05 child: select frozen/current sources, real Redis identity, no JVM.

The production API routes and Worker are unmodified; only external model,
retrieval and explanation adapters come from the existing controlled fixture.
"""

import argparse
from contextlib import asynccontextmanager
import os
from pathlib import Path
import sys


def main():
    source = Path(os.environ["WAIT_RECOVERY_SOURCE"])
    sys.path.insert(0, str(source / "algorithm"))
    if sys.argv[1] == "worker":
        from web.tests.human_wait_process import main as worker_main

        worker_main()
        return

    import httpx
    from redis.asyncio import Redis
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    import uvicorn

    from web.app import create_app
    from web.config import WebConfig
    from web.deps import get_db

    parser = argparse.ArgumentParser(__doc__)
    parser.add_argument("role", choices=["api"])
    parser.add_argument("--port", type=int, required=True)
    args = parser.parse_args()
    engine = create_engine(os.environ["HUMAN_WAIT_DATABASE_URL"],
                           connect_args={"init_command": "SET time_zone = '+08:00'"})
    sessions = sessionmaker(engine, autoflush=False, expire_on_commit=False)
    config = WebConfig(session_redis_prefix=os.environ["WAIT_RECOVERY_SESSION_PREFIX"],
                       cors_allowed_origins=[os.environ["WAIT_RECOVERY_FRONTEND"]])
    app = create_app(config)

    def database():
        with sessions() as db:
            yield db
            db.commit()

    @asynccontextmanager
    async def lifespan(application):
        application.state.redis = Redis.from_url(os.environ["WAIT_RECOVERY_REDIS_URL"],
                                                decode_responses=True, protocol=2)
        application.state.chat_client = httpx.AsyncClient(follow_redirects=False)
        try:
            yield
        finally:
            await application.state.chat_client.aclose()
            await application.state.redis.aclose()
            engine.dispose()

    app.dependency_overrides[get_db] = database
    app.router.lifespan_context = lifespan
    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
