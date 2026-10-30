import asyncio
import json
from types import SimpleNamespace

import pytest
from pydantic_ai.messages import ModelResponse, TextPart, ToolCallPart
from pydantic_ai.models.function import FunctionModel
from pydantic_ai.models.test import TestModel

from app import assistant, web
from app.config import settings


def test_current_vehicle_is_in_instructions_on_every_model_request(monkeypatch):
    monkeypatch.setattr(settings, "openai_api_key", "test-key")
    agent = assistant.build_agent()
    observed = []

    def model(messages, info):
        observed.append(info.instructions)
        if len(observed) % 2:
            return ModelResponse(
                parts=[ToolCallPart("search_documents", {"query": "intake hose"})]
            )
        return ModelResponse(parts=[TextPart("Done")])

    async def search(deps, query):
        return []

    agent.model = FunctionModel(model)
    monkeypatch.setattr(assistant, "build_agent", lambda: agent)
    monkeypatch.setattr(assistant, "search", search)
    vehicles = [
        {"make": "BMW", "model": "E30", "year": 1989, "engine": "M40B18"},
        {"make": "Peugeot", "model": "205", "year": 1991, "engine": "TU1 1.1"},
    ]

    async def run():
        for index, vehicle in enumerate(vehicles):
            project = SimpleNamespace(id=f"project-{index}", **vehicle)
            history = [SimpleNamespace(role="user", content="Earlier car: Fiat 126p")]
            await assistant.answer(None, project, history, "Find a hose", "pl")

    asyncio.run(run())
    assert len(observed) == 4
    for index, instructions in enumerate(observed):
        assert json.dumps(vehicles[index // 2]) in instructions
        assert json.dumps(vehicles[1 - index // 2]) not in instructions
        assert 'Reply language: "pl"' in instructions
        assert "Earlier car" not in instructions


@pytest.mark.parametrize("question", ["Hello", "Find an intake hose online"])
def test_answer_can_skip_document_search(monkeypatch, question):
    monkeypatch.setattr(settings, "openai_api_key", "test-key")
    agent = assistant.build_agent()
    agent.model = TestModel(call_tools=[], custom_output_text="Response")
    monkeypatch.setattr(assistant, "build_agent", lambda: agent)

    async def unexpected_search(*args):
        pytest.fail("Document search must only run when the model requests it")

    monkeypatch.setattr(assistant, "search", unexpected_search)
    project = SimpleNamespace(
        id="project", year=1989, make="BMW", model="E30", engine="M40B18"
    )
    trace = assistant.ExecutionTrace()
    output, sources = asyncio.run(
        assistant.answer(None, project, [], question, "en", trace)
    )
    assert output == "Response"
    assert sources == []
    assert not any(e["kind"].startswith("search_") for e in trace.events)


def test_agent_can_inspect_five_pages_in_one_answer(monkeypatch):
    monkeypatch.setattr(settings, "openai_api_key", "test-key")
    calls = []

    async def read(url):
        calls.append(url)
        return {
            "url": url,
            "title": "Part",
            "text": "BMW E30 M40 intake hose",
            "retrieved_at": "2026-10-30T12:00:00+00:00",
        }

    requests = 0

    def model(messages, info):
        nonlocal requests
        requests += 1
        if requests <= 5:
            return ModelResponse(
                parts=[
                    ToolCallPart(
                        "read_webpage", {"url": f"https://example.com/part/{requests}"}
                    )
                ]
            )
        return ModelResponse(parts=[TextPart("Inspected five listings")])

    monkeypatch.setattr(web, "read_webpage", read)
    agent = assistant.build_agent()
    agent.model = FunctionModel(model)
    monkeypatch.setattr(assistant, "build_agent", lambda: agent)
    project = SimpleNamespace(
        id="project", year=1989, make="BMW", model="E30", engine="M40B18"
    )
    output, sources = asyncio.run(
        assistant.answer(None, project, [], "Check these listings", "en")
    )
    assert output == "Inspected five listings"
    assert len(calls) == len(sources) == 5
