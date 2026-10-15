"""Loopback-only controlled browser fixture; never deploy this module."""

from contextlib import asynccontextmanager
from datetime import datetime

import httpx
from fastapi import Depends
from sqlalchemy.orm import Session

from web.chat.tool_writes import ToolConfirmation
from web.deps import get_db
from web.models.user import User
from web.tests import chat_ui_server as fixture
from web.tests.test_history_retrieval import tool_stream

app = fixture.app
app.state.config.cors_allowed_origins = ["http://127.0.0.1:15286"]
# CORS was constructed by create_app; update the middleware options before startup.
for middleware in app.user_middleware:
    if middleware.cls.__name__ == "CORSMiddleware":
        middleware.kwargs["allow_origins"] = ["http://127.0.0.1:15286"]


@app.post("/fixture/expire/{confirmation_id}")
def expire(confirmation_id: str, db: Session = Depends(get_db)):
    db.get(ToolConfirmation, confirmation_id).expires_at = datetime(2000, 1, 1)
    return {"ok": True}


@asynccontextmanager
async def lifespan(application):
    async with fixture.lifespan(application):
        generator = application.dependency_overrides[get_db]()
        db = next(generator)
        user = db.get(User, 7)  # The session fixture now creates the identity row.
        if user.user_profile is None:
            user.user_profile = "旧简介"
            db.commit()
        generator.close()
        await application.state.chat_client.aclose()
        application.state.chat_client = httpx.AsyncClient(transport=httpx.MockTransport(
            lambda request: tool_stream('{"userProfile":"眼科学生"}', name="propose_profile_update")))
        yield


app.router.lifespan_context = lifespan
