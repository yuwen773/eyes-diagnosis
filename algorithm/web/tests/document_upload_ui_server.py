"""Loopback-only browser fixture; never deploy. Uses controlled service doubles."""

import pytest
import uvicorn

from web.tests.test_document_upload import controlled_pipeline
from web.models.user import User
from web.deps import get_db
from web.tests.session_fixtures import Identity, install_sessions


def main():
    with pytest.MonkeyPatch.context() as monkeypatch:
        with controlled_pipeline(monkeypatch) as state:
            client, _, _, _, _, collection = state
            app = client.app

            provider = app.dependency_overrides[get_db]()
            database = next(provider)
            engine = database.get_bind()
            provider.close()
            User.__table__.create(engine)
            install_sessions(app, engine, who={
                "alice": Identity(7, "fixture", "admin", "格式验证账号"),
            })

            @app.get("/_test/search")
            def search():
                # Controlled read adapter uses the same owner filter as Java.
                return collection.query(query_embeddings=[[1.0, 0.0, 0.0]],
                                        where={"ownerUserId": 7}, n_results=20)

            uvicorn.run(app, host="127.0.0.1", port=15180, lifespan="off")


if __name__ == "__main__":
    main()
