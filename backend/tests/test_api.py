"""Integration tests against migrated Postgres; each test removes only its own projects.

Provider calls are replaced with deterministic embeddings and Pydantic AI TestModel.
"""

from sqlalchemy import select

from app.config import settings
from app.db import SessionLocal
from app.models import Chunk


def test_document_rag_and_project_isolation(client):
    first, second = client.create_project(), client.create_project("Other car")
    upload = client.post(
        f"/api/projects/{first}/documents",
        files={
            "file": (
                "manual.txt",
                b"For rough idle, inspect intake hoses for vacuum leaks.",
                "text/plain",
            )
        },
    )
    assert upload.status_code == 202
    doc_id = upload.json()["id"]
    docs = client.get(f"/api/projects/{first}/documents").json()
    assert docs[0]["status"] == "ready"
    assert docs[0]["chunk_count"] == 1
    assert client.get(f"/api/projects/{second}/documents").json() == []
    chat = client.post(f"/api/projects/{first}/chats").json()
    response = client.post(
        f"/api/chats/{chat['id']}/messages",
        json={"content": "Why is the idle rough?", "language": "en"},
    )
    assert response.status_code == 200, response.text
    user, answer = response.json()
    assert user["role"] == "user"
    assert answer["sources"][0]["name"] == "manual.txt"
    assert "vacuum" in answer["sources"][0]["excerpt"]
    assert len(client.get(f"/api/chats/{chat['id']}/messages").json()) == 2
    assert client.get(f"/api/documents/{doc_id}/download").content.startswith(
        b"For rough idle"
    )
    other_chat = client.post(f"/api/projects/{second}/chats").json()
    other = client.post(
        f"/api/chats/{other_chat['id']}/messages",
        json={"content": "What about intake hoses?", "language": "pl"},
    )
    assert other.status_code == 200
    assert other.json()[1]["sources"] == []
    assert client.delete(f"/api/documents/{doc_id}").status_code == 204
    with SessionLocal() as db:
        assert db.scalars(select(Chunk).where(Chunk.document_id == doc_id)).all() == []


def test_validation_and_failed_indexing(client):
    id = client.create_project()
    assert client.post("/api/projects", json={"name": " "}).status_code == 422
    assert (
        client.post(
            f"/api/projects/{id}/documents", files={"file": ("bad.exe", b"no")}
        ).status_code
        == 415
    )
    response = client.post(
        f"/api/projects/{id}/documents", files={"file": ("empty.txt", b" ")}
    )
    assert response.status_code == 202
    doc = client.get(f"/api/projects/{id}/documents").json()[0]
    assert doc["status"] == "failed"
    assert "OCR" in doc["error"]
    assert client.get("/api/projects/missing/documents").status_code == 404


def test_no_key_returns_actionable_error(client, monkeypatch):
    id = client.create_project()
    monkeypatch.setattr(settings, "openai_api_key", "")
    assert client.get("/api/health").json()["ai_configured"] is False
    response = client.post(
        f"/api/projects/{id}/documents", files={"file": ("manual.txt", b"hello")}
    )
    assert response.status_code == 503


def test_provider_failure_does_not_save_partial_turn(client, monkeypatch):
    id = client.create_project()
    chat = client.post(f"/api/projects/{id}/chats").json()

    async def fail(*args):
        raise RuntimeError("provider unavailable")

    monkeypatch.setattr("app.main.answer", fail)
    response = client.post(
        f"/api/chats/{chat['id']}/messages", json={"content": "Help"}
    )
    assert response.status_code == 502
    assert client.get(f"/api/chats/{chat['id']}/messages").json() == []
