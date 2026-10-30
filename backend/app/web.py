"""Local, isolated Chromium browsing. No remote browser or paid search API."""

import asyncio
import base64
import hashlib
import ipaddress
import socket
import threading
import unicodedata
from datetime import UTC, datetime
from time import monotonic
from urllib.parse import parse_qs, urlencode, urljoin, urlsplit, urlunsplit

from bs4 import BeautifulSoup
from playwright.sync_api import Error as BrowserError
from playwright.sync_api import TimeoutError as BrowserTimeout
from playwright.sync_api import sync_playwright
from trafilatura import extract

MAX_TEXT = 16000
MAX_SECONDS = 30
_slots = threading.BoundedSemaphore(2)


class WebError(Exception):
    """A browsing failure that can safely be returned to the agent."""

    def __init__(self, message: str, visits: list | None = None):
        super().__init__(message)
        self.visits = visits or []


MARKETPLACES = {
    "olx": ("www.olx.pl", "/d/oferta/"),
    "allegro": ("allegro.pl", "/oferta/"),
    "ebay": ("www.ebay.com", "/itm/"),
}


def marketplace_links(query: str, marketplaces: list[str]) -> list[dict]:
    slug = "-".join(
        "".join(
            char if char.isalnum() else " "
            for char in unicodedata.normalize("NFKD", query.lower())
            if not unicodedata.combining(char)
        ).split()
    )
    urls = {
        "olx": "https://www.olx.pl/oferty/q-" + slug + "/",
        "allegro": "https://allegro.pl/listing?" + urlencode({"string": query}),
        "ebay": "https://www.ebay.com/sch/i.html?" + urlencode({"_nkw": query}),
    }
    return [
        {"marketplace": name, "url": urls[name], "kind": "search_link"}
        for name in dict.fromkeys(marketplaces)
    ]


def listing_url(url: str, marketplace: str) -> bool:
    parsed = urlsplit(url)
    host, path = MARKETPLACES[marketplace]
    domain = host.removeprefix("www.")
    return (
        parsed.scheme in {"http", "https"}
        and (
            parsed.hostname == domain or (parsed.hostname or "").endswith("." + domain)
        )
        and path in parsed.path
    )


def page_links(html: str, url: str) -> list[dict]:
    soup = BeautifulSoup(html, "html.parser")
    links, seen = [], set()
    for anchor in soup.select("a[href]"):
        href = urljoin(url, str(anchor.get("href", "")))
        title = anchor.get_text(" ", strip=True)[:300]
        if (
            len(title) < 4
            or href in seen
            or not any(listing_url(href, name) for name in MARKETPLACES)
        ):
            continue
        seen.add(href)
        links.append({"title": title, "url": href})
        if len(links) == 20:
            break
    return links


def public_url(url: str) -> str:
    """Reject local files, credentials, non-web ports and private destinations."""
    try:
        parsed = urlsplit(url)
        if (
            len(url) > 2048
            or parsed.scheme not in {"http", "https"}
            or not parsed.hostname
            or parsed.username is not None
            or parsed.password is not None
            or parsed.port not in {None, 80, 443}
        ):
            raise ValueError
        addresses = socket.getaddrinfo(
            parsed.hostname,
            parsed.port or (443 if parsed.scheme == "https" else 80),
            type=socket.SOCK_STREAM,
        )
        if not addresses or any(
            not ipaddress.ip_address(address[4][0]).is_global for address in addresses
        ):
            raise ValueError
    except (ValueError, OSError) as exc:
        raise WebError(
            "Only public HTTP(S) websites on standard ports are allowed."
        ) from exc
    return urlunsplit(parsed._replace(fragment=""))


def result_url(href: str) -> str:
    if href.startswith("//"):
        href = "https:" + href
    parsed = urlsplit(href)
    if parsed.hostname in {"duckduckgo.com", "html.duckduckgo.com"}:
        href = parse_qs(parsed.query).get("uddg", [href])[0]
    elif parsed.hostname in {"bing.com", "www.bing.com"} and parsed.path == "/ck/a":
        encoded = parse_qs(parsed.query).get("u", [""])[0]
        if encoded.startswith("a1"):
            encoded = encoded[2:]
            href = base64.urlsafe_b64decode(
                encoded + "=" * (-len(encoded) % 4)
            ).decode()
    return href


def parse_results(html: str) -> list[dict]:
    soup = BeautifulSoup(html, "html.parser")
    results, seen = [], set()
    for item in soup.select(".result, li.b_algo"):
        link = item.select_one("a.result__a, h2 a")
        if link is None:
            continue
        try:
            url = public_url(result_url(str(link.get("href", ""))))
        except (WebError, ValueError):
            continue
        if url in seen:
            continue
        seen.add(url)
        snippet = item.select_one(".result__snippet, .b_caption p, p")
        results.append(
            {
                "title": link.get_text(" ", strip=True)[:300],
                "url": url,
                "snippet": snippet.get_text(" ", strip=True)[:1000] if snippet else "",
            }
        )
        if len(results) == 5:
            break
    if not results:
        raise WebError(
            "Search returned no usable results or was blocked by the search engine. "
            "Try a different query or read a known public URL."
        )
    return results


def _browse(url: str, search: bool, timeout: float = MAX_SECONDS) -> dict:
    visits = []
    deadline = monotonic() + timeout
    url = public_url(url)
    # The sync driver runs in a worker thread, including on Windows Selector loops.
    if not _slots.acquire(timeout=1):
        raise WebError("Local browser is busy. Try again later.")
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(
                headless=False,
                timeout=min(10000, timeout * 1000),
            )
            try:
                context = browser.new_context(
                    accept_downloads=False, service_workers="block"
                )
                requests = 0
                redirect_target = None
                redirect_status = None

                def route_request(route):
                    nonlocal requests, redirect_target, redirect_status
                    requests += 1
                    request = route.request
                    try:
                        if (
                            requests > 80
                            or monotonic() >= deadline
                            or request.method != "GET"
                            or request.resource_type in {"image", "media", "font"}
                        ):
                            route.abort()
                            return
                        public_url(request.url)
                        # Never forward HTTP redirects to Chromium: its routing skips
                        # redirected requests, even when the redirect was fulfilled.
                        response = route.fetch(
                            max_redirects=0,
                            timeout=max(1, min(10000, (deadline - monotonic()) * 1000)),
                        )
                        if response.status in {301, 302, 303, 307, 308}:
                            destination = public_url(
                                urljoin(
                                    request.url, response.headers.get("location", "")
                                )
                            )
                            if (
                                request.is_navigation_request()
                                and request.frame == page.main_frame
                            ):
                                redirect_target = destination
                                redirect_status = response.status
                                # Finish this navigation without creating Chrome's
                                # error page, then explicitly navigate to the next hop.
                                route.fulfill(
                                    status=200,
                                    content_type="text/html",
                                    body="<html><body></body></html>",
                                )
                            else:
                                # Subresource redirects are deliberately blocked.
                                route.abort()
                        elif len(response.body()) > 3_000_000:
                            route.abort()
                        else:
                            route.fulfill(response=response)
                        response.dispose()
                    except (WebError, BrowserError):
                        route.abort()

                context.route("**/*", route_request)
                context.route_web_socket("**/*", lambda ws: ws.close())
                page = context.new_page()
                page.on("dialog", lambda dialog: dialog.dismiss())
                context.on(
                    "page", lambda popup: popup.close() if popup != page else None
                )
                for _ in range(6):
                    redirect_target = None
                    redirect_status = None
                    visit = {"url": url, "status": "attempted"}
                    visits.append(visit)
                    try:
                        response = page.goto(
                            url,
                            wait_until="domcontentloaded",
                            timeout=max(1, (deadline - monotonic()) * 1000),
                        )
                        visit["status"] = "redirected" if redirect_target else "visited"
                        visit["http_status"] = redirect_status or (
                            response.status if response else None
                        )
                    except BrowserError:
                        if redirect_target and monotonic() < deadline:
                            url = redirect_target
                            continue
                        raise
                    if redirect_target:
                        url = redirect_target
                        continue
                    break
                else:
                    raise WebError("Website redirected too many times.")
                if response is None or response.status >= 400:
                    raise WebError("Website refused the request or is unavailable.")
                try:
                    page.wait_for_load_state("load", timeout=3000)
                except BrowserTimeout:
                    pass
                # Allow a short, bounded hydration window for JavaScript pages.
                page.wait_for_timeout(750)
                final_url = public_url(page.url)
                html = page.content()
                if search:
                    try:
                        page.locator("a.result__a, li.b_algo h2 a").first.wait_for(
                            timeout=max(1, min(7000, (deadline - monotonic()) * 1000))
                        )
                    except BrowserTimeout:
                        pass
                    html = page.content()
                    return {"results": parse_results(html), "visits": visits}
                title = page.title()[:300]
                if title.strip().lower().rstrip(".!…") in {
                    "just a moment",
                    "access denied",
                    "verify you are human",
                    "security check",
                    "attention required! | cloudflare",
                }:
                    raise WebError("Website requires verification or denied access.")
                text = extract(html, include_tables=True, include_comments=False)
                links = page_links(html, final_url)
                if not text and not links:
                    raise WebError(
                        "No readable page text found; login or verification "
                        "may be required."
                    )
                return {
                    "url": final_url,
                    "title": title or final_url,
                    "text": (text or "")[:MAX_TEXT],
                    "links": links,
                    "visits": visits,
                    "truncated": len(text or "") > MAX_TEXT,
                    "retrieved_at": datetime.now(UTC).isoformat(),
                }
            finally:
                browser.close()
    except WebError as exc:
        exc.visits = visits
        raise
    except BrowserError as exc:
        if "Executable doesn't exist" in str(exc):
            raise WebError(
                "Chromium is not installed. Run: uv run playwright install chromium "
                "(or rebuild the backend Docker image).",
                visits=visits,
            ) from exc
        raise WebError(
            "Local browsing failed or timed out. The website may block automation.",
            visits=visits,
        ) from exc
    finally:
        _slots.release()


async def search_web(query: str, timeout: float = MAX_SECONDS) -> dict:
    query = query.strip()
    if not query or len(query) > 500:
        raise WebError("Search queries must contain between 1 and 500 characters.")
    # A second independent provider helps when one engine blocks automation.
    started = monotonic()
    visits = []
    for endpoint in [
        "https://www.bing.com/search?",
        "https://html.duckduckgo.com/html/?",
    ]:
        remaining = timeout - (monotonic() - started)
        if remaining <= 1:
            break
        try:
            result = await asyncio.to_thread(
                _browse, endpoint + urlencode({"q": query}), True, min(15, remaining)
            )
            result["provider"] = urlsplit(endpoint).hostname
            result["visits"] = visits + result.get("visits", [])
            return result
        except WebError as exc:
            visits.extend(exc.visits)
            if "not installed" in str(exc):
                raise
    raise WebError(
        "Search engines returned no usable results or blocked automation. "
        "Try again later or supply a public URL to read.",
        visits=visits,
    )


async def read_webpage(url: str) -> dict:
    return await asyncio.to_thread(_browse, url, False)


async def search_marketplaces(query: str, marketplaces: list[str]) -> dict:
    query = query.strip()
    if not query or len(query) > 300:
        raise WebError("Marketplace queries must contain 1 to 300 characters.")
    if not marketplaces or any(name not in MARKETPLACES for name in marketplaces):
        raise WebError("Choose olx, allegro or ebay.")
    links = marketplace_links(query, marketplaces)
    slots = asyncio.Semaphore(2)

    async def search_marketplace(link):
        async with slots:
            started = monotonic()
            deadline = started + 90
            visits, errors, listings = [], [], []
            try:
                page = await asyncio.to_thread(_browse, link["url"], False, 12)
                visits.extend(page.get("visits", []))
                listings = [
                    {**item, "kind": "listing_candidate"}
                    for item in page.get("links", [])
                    if listing_url(item["url"], link["marketplace"])
                ][:5]
            except WebError as exc:
                visits.extend(exc.visits)
                errors.append(str(exc))
            search_query = f"site:{MARKETPLACES[link['marketplace']][0]} {query}"
            searched = False
            if not listings:
                searched = True
                try:
                    found = await search_web(
                        search_query, timeout=max(1, 25 - (monotonic() - started))
                    )
                    visits.extend(found.get("visits", []))
                    listings = [
                        {**item, "kind": "listing_candidate"}
                        for item in found["results"]
                        if listing_url(item["url"], link["marketplace"])
                    ]
                except WebError as exc:
                    visits.extend(exc.visits)
                    errors.append(str(exc))
            inspected = []
            seen = set()
            for candidate in listings:
                if candidate["url"] in seen:
                    continue
                seen.add(candidate["url"])
                remaining = deadline - monotonic()
                if remaining <= 1:
                    errors.append("Listing inspection time budget reached.")
                    break
                try:
                    page = await asyncio.to_thread(
                        _browse, candidate["url"], False, min(12, remaining)
                    )
                    visits.extend(page.get("visits", []))
                    if not listing_url(page["url"], link["marketplace"]):
                        errors.append(
                            "Listing redirected away from an individual offer."
                        )
                        continue
                    if not page.get("text", "").strip():
                        errors.append("Listing had no readable description.")
                        continue
                    inspected.append(
                        {
                            "kind": "inspected_listing",
                            "url": page["url"],
                            "title": page["title"],
                            "text": page["text"][:6000],
                            "retrieved_at": page["retrieved_at"],
                            "truncated": page.get("truncated", False)
                            or len(page["text"]) > 6000,
                            "availability": "unverified",
                        }
                    )
                except WebError as exc:
                    visits.extend(exc.visits)
                    errors.append(str(exc))
            return {
                **link,
                "query": query,
                "search_query": search_query if searched else None,
                "listings": inspected,
                "visits": visits,
                "errors": errors,
                "availability": "unverified",
            }

    results = await asyncio.gather(*(search_marketplace(link) for link in links))
    return {
        "query": query,
        "marketplaces": results,
        "note": "Only individually inspected listings are included. Rank by explicit "
        "part and vehicle fitment evidence, prioritizing OEM numbers and excluding "
        "contradictions or sold offers. Reading a listing does not verify fitment "
        "or stock. Return direct listing links only; never return search-page links. "
        "If no strong matches exist, say so and separate any weaker inspected leads.",
    }


def web_source(page: dict) -> dict:
    identity = "web:" + hashlib.sha256(page["url"].encode()).hexdigest()[:24]
    return {
        "id": identity,
        "document_id": identity,
        "kind": "web",
        "url": page["url"],
        "name": page["title"],
        "location": page["url"],
        "excerpt": page["text"],
        "score": 0,
        "retrieved_at": page["retrieved_at"],
    }
