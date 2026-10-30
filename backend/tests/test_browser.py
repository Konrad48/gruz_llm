"""Real Chromium checks; enable with the RUN_BROWSER_TESTS=1 environment variable."""

import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from app import web


@pytest.mark.skipif(os.getenv("RUN_BROWSER_TESTS") != "1", reason="Requires Chromium")
def test_rendered_text_and_redirect_destinations(monkeypatch):
    seen = []

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            seen.append(self.path)
            if self.path.startswith("/redirect"):
                self.send_response(302)
                self.send_header(
                    "Location",
                    "/private" if self.path == "/redirect-private" else "/page",
                )
                self.end_headers()
                return
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.end_headers()
            self.wfile.write(
                b'<html><title>Workshop</title><article><p id="text">Loading</p>'
                b'</article><script>setTimeout(()=>document.querySelector("#text")'
                b'.textContent="Rendered repair instructions: inspect intake hoses '
                b'for cracks and loose clamps before adjusting idle speed.",100)'
                b"</script></html>"
            )

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base = f"http://127.0.0.1:{server.server_port}"

    def validate(url):
        # Simulate public entry points; /private must never reach the server.
        if url in {
            base + "/page",
            base + "/redirect-public",
            base + "/redirect-private",
        }:
            return url
        raise web.WebError("Blocked private destination")

    monkeypatch.setattr(web, "public_url", validate)
    try:
        page = web._browse(base + "/page", False)
        assert "Rendered repair instructions" in page["text"]
        page = web._browse(base + "/redirect-public", False)
        assert page["url"] == base + "/page"
        assert page["visits"][0]["status"] == "redirected"
        assert page["visits"][0]["http_status"] == 302
        assert "Rendered repair instructions" in page["text"]
        with pytest.raises(web.WebError):
            web._browse(base + "/redirect-private", False)
        assert "/private" not in seen
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=3)
