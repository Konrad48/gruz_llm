from uuid import uuid4

from app.db import SessionLocal
from app.models import Chat, Message


def test_rename_and_delete_chat_preserves_other_conversations(client):
    project = client.create_project()
    chat = client.post(f"/api/projects/{project}/chats").json()["id"]
    other = client.post(f"/api/projects/{project}/chats").json()["id"]
    with SessionLocal() as db:
        message = Message(chat_id=chat, role="user", content="Saved message")
        db.add(message)
        db.commit()
        message_id = message.id

    renamed = client.patch(f"/api/chats/{chat}", json={"title": "  Repair notes  "})
    assert renamed.status_code == 200
    assert renamed.json()["title"] == "Repair notes"
    saved = client.get(f"/api/projects/{project}/chats").json()
    assert next(item for item in saved if item["id"] == chat)["title"] == "Repair notes"
    for title in ["", "   ", "x" * 101]:
        assert (
            client.patch(f"/api/chats/{chat}", json={"title": title}).status_code == 422
        )

    assert client.delete(f"/api/chats/{chat}").status_code == 204
    assert client.get(f"/api/chats/{chat}/messages").status_code == 404
    assert [
        item["id"] for item in client.get(f"/api/projects/{project}/chats").json()
    ] == [other]
    with SessionLocal() as db:
        assert db.get(Message, message_id) is None
        assert db.get(Chat, other) is not None


def test_delete_rejects_running_generation(client):
    project = client.create_project()
    chat = client.post(f"/api/projects/{project}/chats").json()["id"]
    with SessionLocal() as db:
        db.add(Message(chat_id=chat, role="assistant", content="", status="generating"))
        db.commit()
    assert client.delete(f"/api/chats/{chat}").status_code == 409
    assert client.get(f"/api/chats/{chat}/messages").status_code == 200


def test_chat_management_missing_chat(client):
    missing = str(uuid4())
    assert (
        client.patch(f"/api/chats/{missing}", json={"title": "Notes"}).status_code
        == 404
    )
    assert client.delete(f"/api/chats/{missing}").status_code == 404
