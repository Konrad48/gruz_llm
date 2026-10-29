import asyncio
import json
import logging
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from typing import Annotated
from uuid import UUID

from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import select, text, update
from sqlalchemy.orm import Session

from .assistant import answer
from .config import settings
from .db import SessionLocal, get_db
from .execution import ExecutionTrace
from .ingestion import MAX_BYTES, SUPPORTED, index_document
from .models import Chat, Chunk, Document, Message, Project
from .preview import document_preview

running_generations: set[asyncio.Task] = set()


@asynccontextmanager
async def lifespan(app: FastAPI):
    Path(settings.upload_dir).mkdir(parents=True, exist_ok=True)
    with SessionLocal() as db:
        db.execute(
            update(Document)
            .where(Document.status == "indexing")
            .values(
                status="failed",
                error="Indexing was interrupted. Delete and upload the document again.",
            )
        )
        db.commit()
        interrupted = db.scalars(
            select(Message).where(Message.status == "generating")
        ).all()
        for message in interrupted:
            message.status = "failed"
            message.execution = [
                *message.execution,
                {
                    "id": len(message.execution) + 1,
                    "kind": "run_failed",
                    "timestamp": datetime.now().astimezone().isoformat(),
                    "elapsed_ms": message.execution[-1]["elapsed_ms"]
                    if message.execution
                    else 0,
                    "data": {"reason": "interrupted"},
                },
            ]
        db.commit()
    yield
    for task in list(running_generations):
        task.cancel()
    if running_generations:
        await asyncio.gather(*running_generations, return_exceptions=True)


app = FastAPI(title="Gruz LLM", version="0.1.0", lifespan=lifespan)
logger = logging.getLogger(__name__)
DB = Annotated[Session, Depends(get_db)]


class ProjectInput(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    make: str = Field(min_length=1, max_length=80)
    model: str = Field(min_length=1, max_length=80)
    year: int = Field(ge=1886, le=2100)
    engine: str = Field(min_length=1, max_length=120)

    @field_validator("name", "make", "model", "engine")
    @classmethod
    def clean(cls, value):
        if not value.strip():
            raise ValueError("Must not be blank")
        return value.strip()


class ProjectOut(ProjectInput):
    model_config = ConfigDict(from_attributes=True)
    id: str
    created_at: datetime


class DocumentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    project_id: str
    name: str
    size: int
    status: str
    error: str | None
    chunk_count: int
    created_at: datetime


class ChatOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    project_id: str
    title: str
    created_at: datetime


class MessageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    role: str
    content: str
    sources: list
    status: str
    execution: list
    created_at: datetime


class Question(BaseModel):
    content: str = Field(min_length=1, max_length=12000)
    language: str = Field(default="en", pattern="^(en|pl)$")
    client_message_id: UUID | None = None


def require(db, model, id):
    value = db.get(model, id)
    if value is None:
        raise HTTPException(404, "Not found")
    return value


@app.get("/api/health")
def health(db: DB):
    db.execute(text("SELECT 1"))
    return {"status": "ok", "ai_configured": bool(settings.openai_api_key)}


@app.get("/api/projects", response_model=list[ProjectOut])
def projects(db: DB):
    return db.scalars(select(Project).order_by(Project.created_at.desc())).all()


@app.post("/api/projects", response_model=ProjectOut, status_code=201)
def create_project(body: ProjectInput, db: DB):
    project = Project(**body.model_dump())
    db.add(project)
    db.commit()
    return project


@app.delete("/api/projects/{id}", status_code=204)
def delete_project(id: str, db: DB):
    project = require(db, Project, id)
    docs = db.scalars(select(Document).where(Document.project_id == id)).all()
    db.delete(project)
    db.commit()
    for doc in docs:
        (Path(settings.upload_dir) / doc.id).unlink(missing_ok=True)


@app.get("/api/projects/{id}/documents", response_model=list[DocumentOut])
def documents(id: str, db: DB):
    require(db, Project, id)
    return db.scalars(
        select(Document)
        .where(Document.project_id == id)
        .order_by(Document.created_at.desc())
    ).all()


@app.post("/api/projects/{id}/documents", response_model=DocumentOut, status_code=202)
async def upload(id: str, file: UploadFile, tasks: BackgroundTasks, db: DB):
    require(db, Project, id)
    if not settings.openai_api_key:
        raise HTTPException(503, "Configure OPENAI_API_KEY in .env to index documents.")
    name = (file.filename or "document").replace("\\", "/").split("/")[-1][:255]
    suffix = Path(name).suffix.lower()
    if suffix not in SUPPORTED:
        raise HTTPException(415, "Supported files: PDF, TXT, MD, CSV, DOCX, XLSX.")
    doc = Document(project_id=id, name=name, size=0)
    db.add(doc)
    db.flush()
    path = Path(settings.upload_dir) / doc.id
    try:
        with path.open("wb") as output:
            while data := await file.read(1024 * 1024):
                doc.size += len(data)
                if doc.size > MAX_BYTES:
                    raise HTTPException(413, "Maximum file size is 20 MB.")
                output.write(data)
        if not doc.size:
            raise HTTPException(422, "File is empty.")
        db.commit()
    except Exception:
        db.rollback()
        path.unlink(missing_ok=True)
        raise
    finally:
        await file.close()
    tasks.add_task(index_document, doc.id, path, suffix)
    return doc


@app.get("/api/documents/{id}/download")
def download(id: str, db: DB):
    doc = require(db, Document, id)
    path = Path(settings.upload_dir) / doc.id
    if not path.exists():
        raise HTTPException(404, "Original file unavailable")
    return FileResponse(path, filename=doc.name, media_type="application/octet-stream")


@app.get("/api/documents/{id}/preview")
def preview_document(
    id: str,
    db: DB,
    source_id: str | None = None,
    sheet: str | None = None,
    row_start: int | None = Query(default=None, ge=1, le=1048576),
    column_start: int = Query(default=1, ge=1, le=16384),
):
    doc = require(db, Document, id)
    path = Path(settings.upload_dir) / doc.id
    if not path.is_file():
        raise HTTPException(404, "Original file unavailable")
    source = (
        db.scalar(select(Chunk).where(Chunk.id == source_id, Chunk.document_id == id))
        if source_id
        else None
    )
    if source_id and source is None:
        raise HTTPException(404, "Cited passage is no longer available")
    try:
        return document_preview(
            path,
            doc.name,
            excerpt=source.content if source else "",
            location=source.location if source else "",
            sheet=sheet,
            row_start=row_start,
            column_start=column_start,
        )
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    except Exception as exc:
        logger.exception("Document preview failed: %s", id)
        raise HTTPException(
            422, "Could not read this document. Download the original file."
        ) from exc


@app.get("/api/documents/{id}/content")
def preview_pdf_content(id: str, db: DB):
    doc = require(db, Document, id)
    if Path(doc.name).suffix.lower() != ".pdf":
        raise HTTPException(415, "Inline content is available for PDFs only")
    path = Path(settings.upload_dir) / doc.id
    if not path.is_file():
        raise HTTPException(404, "Original file unavailable")
    return FileResponse(
        path,
        filename=doc.name,
        media_type="application/pdf",
        content_disposition_type="inline",
        headers={"X-Content-Type-Options": "nosniff"},
    )


@app.delete("/api/documents/{id}", status_code=204)
def delete_document(id: str, db: DB):
    doc = require(db, Document, id)
    if doc.status == "indexing":
        raise HTTPException(409, "Wait for indexing to finish.")
    db.delete(doc)
    db.commit()
    (Path(settings.upload_dir) / id).unlink(missing_ok=True)


@app.get("/api/projects/{id}/chats", response_model=list[ChatOut])
def chats(id: str, db: DB):
    require(db, Project, id)
    return db.scalars(
        select(Chat).where(Chat.project_id == id).order_by(Chat.created_at.desc())
    ).all()


@app.post("/api/projects/{id}/chats", response_model=ChatOut, status_code=201)
def create_chat(id: str, db: DB):
    require(db, Project, id)
    chat = Chat(project_id=id)
    db.add(chat)
    db.commit()
    return chat


@app.get("/api/chats/{id}/messages", response_model=list[MessageOut])
def messages(id: str, db: DB):
    require(db, Chat, id)
    return db.scalars(
        select(Message)
        .where(Message.chat_id == id)
        .order_by(Message.created_at, Message.id)
    ).all()


@app.post("/api/chats/{id}/messages", response_model=list[MessageOut])
async def send(id: str, body: Question, db: DB):
    if not body.content.strip():
        raise HTTPException(422, "Question must not be blank.")
    if not settings.openai_api_key:
        raise HTTPException(
            503, "Configure OPENAI_API_KEY in .env to use the assistant."
        )
    chat = require(db, Chat, id)
    # A transaction-scoped lock rejects parallel turns across processes.
    locked = db.scalar(
        text("SELECT pg_try_advisory_xact_lock(hashtext(:id))"), {"id": id}
    )
    if not locked:
        raise HTTPException(409, "A response is already being generated for this chat.")
    if db.scalar(
        select(Message.id)
        .where(Message.chat_id == id, Message.status == "generating")
        .limit(1)
    ):
        raise HTTPException(409, "A response is already being generated for this chat.")
    project = require(db, Project, chat.project_id)
    history = list(
        db.scalars(
            select(Message)
            .where(Message.chat_id == id)
            .order_by(Message.created_at, Message.id)
        )
    )
    try:
        trace = ExecutionTrace()
        async with asyncio.timeout(120):
            content, sources = await answer(
                db, project, history, body.content.strip(), body.language, trace
            )
    except Exception as exc:
        logger.exception("Assistant failed for chat %s", id)
        db.rollback()
        raise HTTPException(
            502,
            "The AI provider could not complete this request. "
            "Check your API key and try again.",
        ) from exc
    user = Message(chat_id=id, role="user", content=body.content.strip())
    db.add(user)
    db.flush()
    assistant = Message(
        chat_id=id,
        role="assistant",
        content=content,
        sources=sources,
        execution=trace.events,
    )
    db.add(assistant)
    if not history:
        chat.title = body.content.strip()[:80]
    db.commit()
    return [user, assistant]


def serialize_message(message: Message):
    return MessageOut.model_validate(message).model_dump(mode="json")


async def generate_streamed_turn(
    chat_id: str,
    assistant_id: str,
    user_id: str,
    question: str,
    language: str,
    queue: asyncio.Queue,
):
    """Finish accepted turns even when the browser disconnects."""
    with SessionLocal() as db:
        assistant = db.get(Message, assistant_id)
        if assistant is None:
            await queue.put({"type": "error", "message": "Chat no longer exists."})
            return

        async def publish(event):
            assistant.execution = list(trace.events)
            if event["kind"] == "search_completed":
                sources = {source["id"]: source for source in assistant.sources}
                sources.update(
                    {source["id"]: source for source in event["data"]["sources"]}
                )
                assistant.sources = list(sources.values())
            db.commit()
            await queue.put(
                {"type": "activity", "message_id": assistant_id, "event": event}
            )

        trace = ExecutionTrace(publish)
        try:
            chat = require(db, Chat, chat_id)
            project = require(db, Project, chat.project_id)
            history = list(
                db.scalars(
                    select(Message)
                    .where(
                        Message.chat_id == chat_id,
                        Message.status == "complete",
                        Message.id != user_id,
                    )
                    .order_by(Message.created_at, Message.id)
                )
            )
            async with asyncio.timeout(120):
                content, sources = await answer(
                    db, project, history, question, language, trace
                )
            assistant.content, assistant.sources, assistant.status = (
                content,
                sources,
                "complete",
            )
            assistant.execution = list(trace.events)
            db.commit()
            await queue.put(
                {"type": "complete", "message": serialize_message(assistant)}
            )
        except (Exception, asyncio.CancelledError) as exc:
            logger.exception("Streamed assistant failed for chat %s", chat_id)
            db.rollback()
            # Do not expose provider responses, API keys or prompts in client errors.
            reason = (
                "interrupted"
                if isinstance(exc, asyncio.CancelledError)
                else "timeout"
                if isinstance(exc, TimeoutError)
                else "provider_error"
            )
            try:
                await trace.record("run_failed", reason=reason)
                assistant.status = "failed"
                assistant.execution = list(trace.events)
                db.commit()
                await queue.put(
                    {"type": "failed", "message": serialize_message(assistant)}
                )
            except Exception:
                db.rollback()
                logger.exception("Could not persist failed generation %s", assistant_id)
                await queue.put(
                    {
                        "type": "error",
                        "message": (
                            "Generation failed. Reload the conversation "
                            "to check its status."
                        ),
                    }
                )


@app.post("/api/chats/{id}/messages/stream")
async def send_stream(id: str, body: Question):
    if not body.content.strip():
        raise HTTPException(422, "Question must not be blank.")
    if not settings.openai_api_key:
        raise HTTPException(
            503, "Configure OPENAI_API_KEY in .env to use the assistant."
        )
    with SessionLocal() as db:
        chat = require(db, Chat, id)
        locked = db.scalar(
            text("SELECT pg_try_advisory_xact_lock(hashtext(:id))"), {"id": id}
        )
        if not locked or db.scalar(
            select(Message.id)
            .where(Message.chat_id == id, Message.status == "generating")
            .limit(1)
        ):
            raise HTTPException(
                409, "A response is already being generated for this chat."
            )
        if body.client_message_id and db.get(Message, str(body.client_message_id)):
            raise HTTPException(
                409, "This message has already been accepted. Reload the conversation."
            )
        user = Message(chat_id=id, role="user", content=body.content.strip())
        if body.client_message_id:
            user.id = str(body.client_message_id)
        db.add(user)
        db.flush()
        assistant = Message(
            chat_id=id, role="assistant", content="", status="generating"
        )
        db.add(assistant)
        if chat.title == "New conversation":
            chat.title = body.content.strip()[:80]
        db.commit()
        accepted = [serialize_message(user), serialize_message(assistant)]
        assistant_id = assistant.id

    queue: asyncio.Queue = asyncio.Queue()
    task = asyncio.create_task(
        generate_streamed_turn(
            id, assistant_id, user.id, body.content.strip(), body.language, queue
        )
    )
    running_generations.add(task)

    def generation_finished(finished: asyncio.Task):
        running_generations.discard(finished)
        if not finished.cancelled() and finished.exception() is not None:
            logger.error("Generation task failed before reporting its outcome")
            queue.put_nowait(
                {
                    "type": "error",
                    "message": (
                        "Generation failed. Reload the conversation "
                        "to check its status."
                    ),
                }
            )

    task.add_done_callback(generation_finished)

    async def stream():
        yield f"data: {json.dumps({'type': 'accepted', 'messages': accepted})}\n\n"
        while True:
            try:
                event = await asyncio.wait_for(queue.get(), timeout=10)
            except TimeoutError:
                yield ": keep-alive\n\n"
                continue
            yield f"data: {json.dumps(event)}\n\n"
            if event["type"] in {"complete", "failed", "error"}:
                break

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
