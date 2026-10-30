import asyncio
import json
import uuid

from sqlalchemy import select

from app.db import SessionLocal
from app.models import Message


def events(response):
    return [
        json.loads(line[6:])
        for line in response.text.splitlines()
        if line.startswith("data: ")
    ]


def test_stream_saves_execution_history_and_real_tool_events(client):
    project = client.create_project()
    client.post(
        f"/api/projects/{project}/documents",
        files={"file": ("manual.txt", b"Inspect intake hoses for rough idle.")},
    )
    chat = client.post(f"/api/projects/{project}/chats").json()
    client_id = str(uuid.uuid4())
    response = client.post(
        f"/api/chats/{chat['id']}/messages/stream",
        json={"content": "Help with rough idle", "client_message_id": client_id},
    )
    assert response.status_code == 200
    log = events(response)
    assert log[0]["type"] == "accepted"
    assert log[0]["messages"][0]["id"] == client_id
    assert log[0]["messages"][1]["status"] == "generating"
    assert log[-1]["type"] == "complete", log
    saved = client.get(f"/api/chats/{chat['id']}/messages").json()
    trace = saved[1]["execution"]
    assert saved[1]["status"] == "complete"
    assert saved[1]["sources"][0]["name"] == "manual.txt"
    kinds = [event["kind"] for event in trace]
    assert kinds[0] == "run_started"
    assert kinds[-1] == "run_completed"
    assert "tool_started" in kinds and "tool_completed" in kinds
    searches = [event for event in trace if event["kind"] == "search_completed"]
    assert len(searches) == 1
    assert searches[0]["data"]["sources"][0]["name"] == "manual.txt"
    assert [event["event"] for event in log if event["type"] == "activity"] == trace
    assert [event["id"] for event in trace] == list(range(1, len(trace) + 1))
    assert (
        client.post(
            f"/api/chats/{chat['id']}/messages/stream",
            json={"content": "Help with rough idle", "client_message_id": client_id},
        ).status_code
        == 409
    )


def test_stream_accepts_message_before_generation_and_preserves_failure(
    client, monkeypatch
):
    project = client.create_project()
    chat = client.post(f"/api/projects/{project}/chats").json()

    async def fail(db, project, history, question, language, trace):
        assert history == []
        with SessionLocal() as independent:
            messages = list(
                independent.scalars(
                    select(Message)
                    .where(Message.chat_id == chat["id"])
                    .order_by(Message.created_at)
                )
            )
            assert [message.role for message in messages] == ["user", "assistant"]
            assert messages[0].content == "Already sent"
            assert messages[1].status == "generating"
        await trace.record("model_started", model="test")
        await asyncio.sleep(0)
        raise RuntimeError("SECRET_PROVIDER_DIAGNOSTIC")

    monkeypatch.setattr("app.main.answer", fail)
    response = client.post(
        f"/api/chats/{chat['id']}/messages/stream", json={"content": "Already sent"}
    )
    log = events(response)
    assert log[0]["type"] == "accepted"
    assert log[-1]["type"] == "failed"
    assert "SECRET_PROVIDER_DIAGNOSTIC" not in response.text
    messages = client.get(f"/api/chats/{chat['id']}/messages").json()
    assert messages[0]["content"] == "Already sent"
    assert messages[1]["status"] == "failed"
    assert messages[1]["execution"][-1]["kind"] == "run_failed"


def test_generation_lock_blocks_second_request(client):
    project = client.create_project()
    chat = client.post(f"/api/projects/{project}/chats").json()
    with SessionLocal() as db:
        db.add(
            Message(
                chat_id=chat["id"], role="assistant", content="", status="generating"
            )
        )
        db.commit()
    for suffix in ["", "/stream"]:
        response = client.post(
            f"/api/chats/{chat['id']}/messages{suffix}", json={"content": "Duplicate"}
        )
        assert response.status_code == 409
