"""Langfuse tracing shared by chat requests and background indexing."""

from contextlib import contextmanager
from functools import wraps

from langfuse import Langfuse, propagate_attributes

from .config import settings

_client: Langfuse | None = None


def get_langfuse() -> Langfuse | None:
    global _client
    if not (
        settings.langfuse_tracing_enabled
        and settings.langfuse_public_key
        and settings.langfuse_secret_key
    ):
        return None
    if _client is None:
        # Pass settings explicitly: pydantic reads .env without modifying os.environ.
        _client = Langfuse(
            public_key=settings.langfuse_public_key,
            secret_key=settings.langfuse_secret_key,
            base_url=settings.langfuse_base_url,
        )
    return _client


def flush_traces():
    if _client is not None:
        _client.flush()


@contextmanager
def trace_turn(chat_id: str, project_id: str, question: str):
    client = get_langfuse()
    if client is None:
        yield
        return
    with propagate_attributes(
        session_id=chat_id,
        trace_name="assistant-answer",
        metadata={"project_id": project_id},
    ):
        with client.start_as_current_observation(
            name="assistant-answer", input={"question": question}
        ) as span:
            yield span


def trace_operation(name: str, *, as_type: str = "span", capture_output: bool = True):
    """Trace async operations without serializing DB sessions or dependencies."""

    def decorate(function):
        @wraps(function)
        async def wrapped(*args, **kwargs):
            client = get_langfuse()
            if client is None:
                return await function(*args, **kwargs)
            with client.start_as_current_observation(
                name=name, as_type=as_type
            ) as span:
                result = await function(*args, **kwargs)
                if capture_output:
                    span.update(output=result)
                return result

        return wrapped

    return decorate
