import asyncio
import json
from types import SimpleNamespace
from unittest.mock import Mock
from uuid import uuid4

import httpx
import pytest
from langfuse import Langfuse
from openai import AsyncOpenAI
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
from pydantic_ai.models.test import TestModel

from app import assistant, ingestion, telemetry
from app.config import settings


@pytest.fixture
def tracing(monkeypatch):
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    client = Langfuse(
        public_key=f"pk-test-local-{uuid4()}",
        secret_key="sk-test-local-tracing",
        tracer_provider=provider,
        span_exporter=exporter,
    )
    monkeypatch.setattr(telemetry, "get_langfuse", lambda: client)
    monkeypatch.setattr(assistant, "get_langfuse", lambda: client)
    monkeypatch.setattr(ingestion, "get_langfuse", lambda: client)
    monkeypatch.setattr(
        "pydantic_ai.models.instrumented.get_tracer_provider", lambda: provider
    )
    yield client, exporter
    client.flush()
    provider.shutdown()


def test_configuration_uses_dotenv_settings_and_can_disable(monkeypatch):
    factory = Mock()
    monkeypatch.setattr(telemetry, "Langfuse", factory)
    monkeypatch.setattr(telemetry, "_client", None)
    monkeypatch.setattr(settings, "langfuse_tracing_enabled", True)
    monkeypatch.setattr(settings, "langfuse_public_key", "pk-test")
    monkeypatch.setattr(settings, "langfuse_secret_key", "sk-test")
    monkeypatch.setattr(settings, "langfuse_base_url", "https://example.org")
    assert telemetry.get_langfuse() is telemetry.get_langfuse()
    factory.assert_called_once_with(
        public_key="pk-test", secret_key="sk-test", base_url="https://example.org"
    )
    monkeypatch.setattr(settings, "langfuse_tracing_enabled", False)
    assert telemetry.get_langfuse() is None
    monkeypatch.setattr(settings, "langfuse_tracing_enabled", True)
    monkeypatch.setattr(settings, "langfuse_secret_key", "")
    assert telemetry.get_langfuse() is None


def test_answer_groups_native_model_spans_under_chat(tracing, monkeypatch):
    client, exporter = tracing
    monkeypatch.setattr(settings, "openai_api_key", "test-key")
    original = assistant.build_agent

    def build_agent():
        agent = original()
        agent.model = TestModel(call_tools=[], custom_output_text="Check the hoses.")
        return agent

    async def search(deps, query):
        return []

    monkeypatch.setattr(assistant, "build_agent", build_agent)
    monkeypatch.setattr(assistant, "search", search)

    async def run():
        project = SimpleNamespace(
            id="project-1", year=1989, make="BMW", model="E30", engine="M40"
        )
        with telemetry.trace_turn("chat-1", project.id, "Rough idle") as span:
            result = await assistant.answer(None, project, [], "Rough idle", "en")
            span.update(output=result[0])

    asyncio.run(run())
    client.flush()
    spans = exporter.get_finished_spans()
    root = next(s for s in spans if s.name == "assistant-answer")
    assert root.attributes["session.id"] == "chat-1"
    assert root.attributes["langfuse.trace.metadata.project_id"] == "project-1"
    assert "Check the hoses." in root.attributes["langfuse.observation.output"]
    assert any("chat" in s.name for s in spans)
    assert all(s.context.trace_id == root.context.trace_id for s in spans)


def test_embedding_records_usage_without_vectors(tracing, monkeypatch):
    client, exporter = tracing
    monkeypatch.setattr(settings, "openai_api_key", "test-key")

    def respond(request):
        assert json.loads(request.content)["input"] == ["manual excerpt"]
        return httpx.Response(
            200,
            json={
                "object": "list",
                "model": settings.embedding_model,
                "data": [{"object": "embedding", "index": 0, "embedding": [1.0]}],
                "usage": {"prompt_tokens": 3, "total_tokens": 3},
            },
        )

    monkeypatch.setattr(
        ingestion,
        "AsyncOpenAI",
        lambda **kwargs: AsyncOpenAI(
            **kwargs,
            http_client=httpx.AsyncClient(transport=httpx.MockTransport(respond)),
        ),
    )
    assert asyncio.run(ingestion.embed(["manual excerpt"])) == [[1.0]]
    client.flush()
    span = exporter.get_finished_spans()[-1]
    assert span.name == "openai-embeddings"
    assert (
        json.loads(span.attributes["langfuse.observation.usage_details"])["input"] == 3
    )
    assert "langfuse.observation.output" not in span.attributes


def test_failures_are_traced_and_propagated(tracing):
    client, exporter = tracing

    @telemetry.trace_operation("failed-operation")
    async def fail():
        raise RuntimeError("provider unavailable")

    with pytest.raises(RuntimeError, match="provider unavailable"):
        with telemetry.trace_turn("chat-2", "project-1", "Question"):
            asyncio.run(fail())
    client.flush()
    spans = exporter.get_finished_spans()
    assert len(spans) == 2
    assert all(s.status.is_ok is False for s in spans)
