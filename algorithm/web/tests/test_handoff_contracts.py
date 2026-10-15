"""Independent frozen samples exercised at HTTP/SSE boundaries, without Java sources."""

from datetime import datetime
import json

from web.migrations.baseline import ASSETS
from web.models.news import News
from web.tests.test_contracts import engine, client, _seed  # noqa: F401 - pytest fixtures
from web.tests.test_chat_workflow import workflow_api  # noqa: F401
from web.tests.test_workflow import create_upload

CONTRACT = json.loads((ASSETS / "contracts.json").read_text(encoding="utf-8"))


def test_frozen_legacy_envelope_long_page_and_date_contract(client, _seed):
    sample = CONTRACT["legacyBusiness"]
    _seed.add(News(id=int(sample["news"]["id"]), title="Synthetic baseline", user_id=7,
                   content="Synthetic content", summary="Synthetic", cover_img="https://fixture.invalid/news.png",
                   status=1, publish_time=datetime(2026, 3, 4, 5, 6, 7), edit_time=datetime(2026, 3, 4, 5, 6, 7)))
    _seed.commit()
    response = client.get(f"/api/news/get/{sample['news']['id']}")
    assert response.status_code == sample["httpStatus"]
    body = response.json()
    assert sorted(body) == sample["envelopeKeys"]
    assert (body["code"], body["msg"]) == (sample["code"], sample["msg"])
    assert {key: body["data"][key] for key in sample["news"]} == sample["news"]
    page = client.post("/api/news/list/page/vo", json={"current": 1, "pageSize": 10}).json()["data"]
    assert {key: page[key] for key in sample["pagination"]} == sample["pagination"]


def test_frozen_login_expiry_and_workflow_transport_are_separate(workflow_api):
    client, _ = workflow_api
    legacy, workflow = CONTRACT["loginExpired"], CONTRACT["workflow"]
    client.cookies.set("SESSION", "expired")
    response = client.post("/api/diagnosis/list/page/my", json={})
    assert response.status_code == legacy["httpStatus"]
    assert response.json()["code"] == legacy["code"]
    response = create_upload(client)
    assert response.status_code == workflow["unauthenticated"]
    client.cookies.set("SESSION", "alice")
    accepted = create_upload(client)
    assert accepted.status_code == workflow["accepted"]
    row = accepted.json()["data"]
    assert row["status"] == workflow["initialStatus"]
    assert create_upload(client).json()["data"]["workflowId"] == row["workflowId"]
    assert create_upload(client, content=b"different-input").status_code == workflow["conflict"]
    response = client.get(f"/api/diagnosis/workflows/{row['workflowId']}/events")
    assert response.headers["content-type"].startswith(CONTRACT["sse"]["contentType"])
    events = [line.removeprefix("event: ") for line in response.text.splitlines() if line.startswith("event: ")]
    assert events == CONTRACT["sse"]["workflowSnapshotEvents"]
    client.cookies.set("SESSION", "bob")
    assert client.get(f"/api/diagnosis/workflows/{row['workflowId']}").status_code == workflow["forbidden"]
