from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from time import perf_counter


class ExecutionTrace:
    """Observable execution metadata, never model reasoning or system prompts."""

    def __init__(self, publish: Callable[[dict], Awaitable[None]] | None = None):
        self.events: list[dict] = []
        self.started = perf_counter()
        self.publish = publish

    async def record(self, kind: str, **data):
        event = {
            "id": len(self.events) + 1,
            "kind": kind,
            "timestamp": datetime.now(UTC).isoformat(),
            "elapsed_ms": round((perf_counter() - self.started) * 1000),
            "data": data,
        }
        self.events.append(event)
        if self.publish is not None:
            await self.publish(event)
