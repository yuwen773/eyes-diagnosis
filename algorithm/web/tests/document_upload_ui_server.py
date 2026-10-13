"""Loopback-only browser fixture; never deploy. Uses controlled service doubles."""

import pytest
import uvicorn

from web.tests.test_document_upload import controlled_pipeline


def main():
    with pytest.MonkeyPatch.context() as monkeypatch:
        with controlled_pipeline(monkeypatch) as state:
            client, _, _, _, _, collection = state
            app = client.app

            @app.get("/api/user/get/login")
            def login():
                return {"code": 0, "msg": "ok", "data": {
                    "id": "7", "userAccount": "fixture", "userName": "格式验证账号",
                    "userRole": "admin",
                }}

            @app.get("/_test/search")
            def search():
                # Controlled read adapter uses the same owner filter as Java.
                return collection.query(query_embeddings=[[1.0, 0.0, 0.0]],
                                        where={"ownerUserId": 7}, n_results=20)

            uvicorn.run(app, host="127.0.0.1", port=15180, lifespan="off")


if __name__ == "__main__":
    main()
