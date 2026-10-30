import pytest
from fastapi.testclient import TestClient
from pydantic_ai.models.test import TestModel

from app import assistant, ingestion
from app.config import settings
from app.db import SessionLocal
from app.main import app
from app.models import Project


@pytest.fixture(autouse=True)
def disable_external_tracing(monkeypatch):
    monkeypatch.setattr(settings, "langfuse_tracing_enabled", False)


@pytest.fixture
def client(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "upload_dir", str(tmp_path))
    monkeypatch.setattr(settings, "openai_api_key", "test-key")

    async def fake_embed(texts):
        return [[1.0] + [0.0] * 1535 for _ in texts]

    monkeypatch.setattr(ingestion, "embed", fake_embed)
    monkeypatch.setattr(assistant, "embed", fake_embed)
    original = assistant.build_agent

    def fake_agent():
        agent = original()
        agent.model = TestModel(
            call_tools=["search_documents"],
            custom_output_text="See manual.txt, text. Inspect the idle air hoses.",
        )
        return agent

    monkeypatch.setattr(assistant, "build_agent", fake_agent)
    ids = []
    with TestClient(app) as test_client:

        def create(name="Test garage"):
            response = test_client.post(
                "/api/projects",
                json={
                    "name": name,
                    "make": "BMW",
                    "model": "E30",
                    "year": 1989,
                    "engine": "M40B18",
                },
            )
            assert response.status_code == 201
            project = response.json()
            ids.append(project["id"])
            return project["id"]

        test_client.create_project = create
        yield test_client
    with SessionLocal() as db:
        for id in ids:
            project = db.get(Project, id)
            if project:
                db.delete(project)
        db.commit()
