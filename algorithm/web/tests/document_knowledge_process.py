"""Isolated ticket 03 provider/COS boundaries; production auth/ETL/vector IO."""

import argparse
import hashlib
import os
from pathlib import Path

from fastapi import FastAPI, Request


def provider():
    app = FastAPI()

    @app.get("/health")
    def health():
        return {"status": "up"}

    @app.post("/v1/embeddings")
    async def embeddings(request: Request):
        body = await request.json()
        assert body["model"] == "text-embedding-v3"
        # The provider boundary is controlled; the production model and its
        # default dimension remain unchanged. These vectors prove IO, not recall.
        return {"data": [{"index": i, "embedding": [
            (value + 1) / 256 for value in hashlib.sha256(text.encode()).digest()] * 32}
            for i, text in enumerate(body["input"])]}

    return app


def main():
    import uvicorn

    parser = argparse.ArgumentParser(__doc__)
    parser.add_argument("role", choices=["api", "provider"])
    parser.add_argument("--port", type=int, required=True)
    args = parser.parse_args()
    if args.role == "provider":
        app = provider()
    else:
        from web.app import create_app
        from web.config import WebConfig
        from web.routers import knowledge

        directory = Path(os.environ["DOC_VERIFY_OBJECTS"])
        directory.mkdir(parents=True, exist_ok=True)
        knowledge._put_object = lambda key, data: (directory / key).write_bytes(data)
        knowledge._delete_object = lambda key: (directory / key).unlink(missing_ok=True)
        app = create_app(WebConfig.from_env())
    uvicorn.run(app, host="127.0.0.1", port=args.port, access_log=False)


if __name__ == "__main__":
    main()
