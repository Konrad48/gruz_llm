import asyncio
import base64
import socket
from unittest.mock import MagicMock

import pytest
from pydantic_ai.messages import ModelResponse, TextPart, ToolCallPart
from pydantic_ai.models.function import FunctionModel

from app import assistant, web
from app.config import settings


@pytest.fixture
def public_dns(monkeypatch):
    monkeypatch.setattr(
        socket,
        "getaddrinfo",
        lambda *args, **kwargs: [
            (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", 443))
        ],
    )


@pytest.mark.parametrize(
    "url",
    [
        "file:///etc/passwd",
        "ftp://example.com",
        "http://user:pass@example.com",
        "http://example.com:8000",
        "javascript:alert(1)",
    ],
)
def test_rejects_non_public_web_urls(url, public_dns):
    with pytest.raises(web.WebError):
        web.public_url(url)


@pytest.mark.parametrize(
    "ip", ["127.0.0.1", "10.0.0.1", "169.254.169.254", "::1", "::ffff:127.0.0.1"]
)
def test_rejects_private_dns_answers(monkeypatch, ip):
    monkeypatch.setattr(
        socket, "getaddrinfo", lambda *a, **kw: [(2, 1, 6, "", (ip, 80))]
    )
    with pytest.raises(web.WebError):
        web.public_url("https://example.com")


def test_parses_search_links_deduplicates_and_limits(public_dns):
    html = "".join(
        '<div class="result"><a class="result__a" '
        f'href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2F{i}">'
        f'Manual {i}</a><span class="result__snippet">Workshop specs</span></div>'
        for i in [0, 0, 1, 2, 3, 4, 5]
    )
    results = web.parse_results(html)
    assert len(results) == 5
    assert results[0] == {
        "title": "Manual 0",
        "url": "https://example.com/0",
        "snippet": "Workshop specs",
    }
    with pytest.raises(web.WebError, match="blocked"):
        web.parse_results("<h1>Verify you are human</h1>")


def test_parses_bing_original_url(public_dns):
    encoded = base64.urlsafe_b64encode(b"https://example.com/manual").decode()
    html = (
        '<li class="b_algo"><h2><a href="https://www.bing.com/ck/a?u=a1'
        + encoded
        + '">Manual</a></h2><div class="b_caption"><p>Specifications</p></div></li>'
    )
    assert web.parse_results(html) == [
        {
            "title": "Manual",
            "url": "https://example.com/manual",
            "snippet": "Specifications",
        }
    ]


def test_search_uses_fallback_when_first_engine_fails(monkeypatch):
    attempts = []

    def browse(url, search, timeout):
        attempts.append(url)
        if len(attempts) == 1:
            raise web.WebError("Blocked")
        return {"results": [{"url": "https://example.com"}]}

    monkeypatch.setattr(web, "_browse", browse)
    result = asyncio.run(web.search_web("BMW manual"))
    assert result["provider"] == "html.duckduckgo.com"
    assert len(attempts) == 2


def test_missing_browser_does_not_retry_search(monkeypatch):
    def missing(*args):
        raise web.WebError("Chromium is not installed")

    monkeypatch.setattr(web, "_browse", missing)
    with pytest.raises(web.WebError, match="not installed"):
        asyncio.run(web.search_web("BMW manual"))


def test_browser_cleanup_extraction_and_request_guard(monkeypatch, public_dns):
    driver = MagicMock()
    browser = driver.chromium.launch.return_value
    context = browser.new_context.return_value
    page = context.new_page.return_value
    page.goto.return_value.status = 200
    page.url = "https://example.com/manual"
    page.title.return_value = "Workshop manual"
    page.content.return_value = (
        "<article><h1>Workshop manual</h1><p>Inspect the intake hoses "
        "carefully for cracks.</p></article>"
    )
    factory = MagicMock()
    factory.return_value.__enter__.return_value = driver
    monkeypatch.setattr(web, "sync_playwright", factory)
    result = web._browse("https://example.com/manual", False)
    driver.chromium.launch.assert_called_once_with(headless=False, timeout=10000)
    assert "intake hoses" in result["text"]
    assert result["retrieved_at"]
    browser.close.assert_called_once()
    handler = context.route.call_args.args[1]
    route = MagicMock()
    route.request.method = "POST"
    handler(route)
    route.abort.assert_called_once()
    route.fetch.assert_not_called()
    route = MagicMock()
    route.request.method = "GET"
    route.request.resource_type = "document"
    route.request.url = "https://example.com/manual"
    route.fetch.return_value.body.return_value = b"manual"
    handler(route)
    assert route.fetch.call_args.kwargs["max_redirects"] == 0
    route.fulfill.assert_called_once()
    # A redirected navigation is validated again, including its DNS response.
    monkeypatch.setattr(
        socket, "getaddrinfo", lambda *a, **kw: [(2, 1, 6, "", ("127.0.0.1", 80))]
    )
    route = MagicMock()
    route.request.method = "GET"
    route.request.resource_type = "document"
    route.request.url = "http://localhost/secret"
    handler(route)
    route.abort.assert_called_once()
    route.fetch.assert_not_called()


def test_tool_failure_and_budget(monkeypatch):
    async def blocked(query):
        raise web.WebError("Search blocked")

    monkeypatch.setattr(web, "search_web", blocked)
    deps = assistant.Dependencies(None, "project")
    result = asyncio.run(assistant.browse(deps, query="manual"))
    assert result == {"error": "Search blocked"}
    assert deps.trace.events[-1]["kind"] == "web_search_failed"
    deps.web_calls = 10
    assert "limit" in asyncio.run(assistant.browse(deps, query="manual"))["error"]


def test_web_tools_are_always_available(monkeypatch):
    monkeypatch.setattr(settings, "openai_api_key", "test-key")
    agent = assistant.build_agent()
    assert set(agent._function_toolset.tools) == {
        "search_documents",
        "web_search",
        "read_webpage",
        "search_marketplaces",
    }


def test_agent_web_search_read_and_streamed_source_persistence(client, monkeypatch):
    async def search(query):
        return {
            "provider": "www.bing.com",
            "visits": [
                {
                    "url": "https://www.bing.com/search?q=BMW",
                    "status": "visited",
                    "http_status": 200,
                }
            ],
            "results": [
                {
                    "title": "Manual",
                    "url": "https://example.com/manual",
                    "snippet": "Intake hoses",
                }
            ],
        }

    async def read(url):
        return {
            "title": "Manual",
            "url": url,
            "text": "Inspect intake hoses.",
            "retrieved_at": "2026-10-30T12:00:00+00:00",
            "visits": [{"url": url, "status": "visited", "http_status": 200}],
        }

    monkeypatch.setattr(web, "search_web", search)
    monkeypatch.setattr(web, "read_webpage", read)
    calls = []

    def model(messages, info):
        calls.append(messages)
        if len(calls) == 1:
            return ModelResponse(
                parts=[ToolCallPart("web_search", {"query": "BMW E30 intake hoses"})]
            )
        if len(calls) == 2:
            return ModelResponse(
                parts=[
                    ToolCallPart("read_webpage", {"url": "https://example.com/manual"})
                ]
            )
        return ModelResponse(
            parts=[TextPart("Inspect hoses. [Manual](https://example.com/manual)")]
        )

    agent = assistant.build_agent()
    agent.model = FunctionModel(model)
    monkeypatch.setattr(assistant, "build_agent", lambda: agent)
    project = client.create_project()
    chat = client.post(f"/api/projects/{project}/chats").json()
    response = client.post(
        f"/api/chats/{chat['id']}/messages/stream",
        json={"content": "Search online for intake hoses"},
    )
    assert response.status_code == 200
    saved = client.get(f"/api/chats/{chat['id']}/messages").json()[1]
    assert saved["status"] == "complete", saved
    assert saved["sources"][0]["kind"] == "web"
    assert saved["sources"][0]["url"] == "https://example.com/manual"
    assert "web_read_completed" in [e["kind"] for e in saved["execution"]]
    assert len(calls) == 3
    search_event = next(
        e for e in saved["execution"] if e["kind"] == "web_search_completed"
    )
    assert search_event["data"]["results"][0]["url"] == "https://example.com/manual"
    assert search_event["data"]["provider"] == "www.bing.com"
    visits = [e["data"] for e in saved["execution"] if e["kind"] == "web_visit"]
    assert [visit["url"] for visit in visits] == [
        "https://www.bing.com/search?q=BMW",
        "https://example.com/manual",
    ]


def test_marketplace_links_preserve_query_and_requested_sites():
    links = web.marketplace_links("silnik Peugeot 205 1.1", ["olx", "allegro", "ebay"])
    assert [link["marketplace"] for link in links] == ["olx", "allegro", "ebay"]
    assert links[0]["url"] == "https://www.olx.pl/oferty/q-silnik-peugeot-205-1-1/"
    assert "string=silnik+Peugeot+205+1.1" in links[1]["url"]
    assert "_nkw=silnik+Peugeot+205+1.1" in links[2]["url"]


def test_marketplace_extracts_individual_listing_links():
    html = """<a href="/d/oferta/silnik-peugeot-ID123.html">Silnik Peugeot 205 1.1</a>
    <a href="/help/">Pomoc</a><a href="https://evil.example/d/oferta/x">Fake</a>"""
    assert web.page_links(html, "https://www.olx.pl/oferty/") == [
        {
            "title": "Silnik Peugeot 205 1.1",
            "url": "https://www.olx.pl/d/oferta/silnik-peugeot-ID123.html",
        }
    ]


def test_marketplace_blocked_returns_no_offers_or_search_links_to_model(monkeypatch):
    def blocked(url, *args):
        raise web.WebError(
            "Website blocked", visits=[{"url": url, "status": "attempted"}]
        )

    async def irrelevant(query, timeout):
        return {
            "results": [{"title": "Peugeot homepage", "url": "https://peugeot.com"}]
        }

    monkeypatch.setattr(web, "_browse", blocked)
    monkeypatch.setattr(web, "search_web", irrelevant)
    result = asyncio.run(web.search_marketplaces("silnik Peugeot 205 1.1", ["olx"]))
    market = result["marketplaces"][0]
    assert market["marketplace"] == "olx"
    assert market["kind"] == "search_link"
    assert market["availability"] == "unverified"
    assert market["listings"] == []
    assert "q-silnik-peugeot-205-1-1" in market["url"]
    assert market["search_query"] == "site:www.olx.pl silnik Peugeot 205 1.1"
    assert market["visits"][0]["status"] == "attempted"
    deps = assistant.Dependencies(None, "project")
    model_result = asyncio.run(
        assistant.browse(deps, query="silnik Peugeot 205 1.1", marketplaces=["olx"])
    )
    assert "url" not in model_result["marketplaces"][0]
    assert "visits" not in model_result["marketplaces"][0]
    assert model_result["marketplaces"][0]["listings"] == []


def test_marketplace_offers_and_trace_do_not_invent_engine_search(monkeypatch):
    url = "https://www.olx.pl/d/oferta/silnik-ID123.html"

    def browse(url, *args):
        return {
            "url": url,
            "title": "Silnik Peugeot 205",
            "text": "Silnik Peugeot 205 1.1, engine TU1, 1500 PLN.",
            "retrieved_at": "2026-10-30T12:00:00+00:00",
            "links": [
                {
                    "title": "Silnik Peugeot 205",
                    "url": "https://www.olx.pl/d/oferta/silnik-ID123.html",
                }
            ],
            "visits": [{"url": url, "status": "visited", "http_status": 200}],
        }

    monkeypatch.setattr(web, "_browse", browse)
    deps = assistant.Dependencies(None, "project")
    result = asyncio.run(
        assistant.browse(deps, query="silnik Peugeot 205", marketplaces=["olx"])
    )
    assert result["marketplaces"][0]["listings"][0]["url"] == url
    trace = deps.trace.events
    assert [e["kind"] for e in trace] == [
        "web_marketplace_started",
        "web_visit",
        "web_visit",
        "web_marketplace_completed",
        "web_read_completed",
    ]
    assert trace[-2]["data"]["search_query"] is None
    assert trace[-2]["data"]["results"][0]["kind"] == "inspected_listing"
    assert result["marketplaces"][0]["listings"][0]["text"].startswith("Silnik")
    assert list(deps.sources.values())[0]["url"] == url


@pytest.mark.parametrize("failure", ["blocked", "redirect", "empty"])
def test_marketplace_excludes_unreadable_or_redirected_candidates(monkeypatch, failure):
    url = "https://www.olx.pl/d/oferta/part-ID123.html"

    def browse(target, *args):
        if target != url:
            return {"links": [{"title": "Part", "url": url}]}
        if failure == "blocked":
            raise web.WebError("Blocked")
        return {
            "url": "https://www.olx.pl/oferty/" if failure == "redirect" else url,
            "text": "Other offers" if failure == "redirect" else "",
        }

    monkeypatch.setattr(web, "_browse", browse)
    result = asyncio.run(web.search_marketplaces("part", ["olx"]))
    assert result["marketplaces"][0]["listings"] == []
    assert result["marketplaces"][0]["errors"]


def test_failed_read_records_attempted_url(monkeypatch):
    async def blocked(url):
        raise web.WebError("Blocked", visits=[{"url": url, "status": "attempted"}])

    monkeypatch.setattr(web, "read_webpage", blocked)
    deps = assistant.Dependencies(None, "project")
    asyncio.run(assistant.browse(deps, url="https://www.olx.pl/"))
    assert deps.trace.events[-2]["kind"] == "web_visit"
    assert deps.trace.events[-1]["data"]["url"] == "https://www.olx.pl/"
