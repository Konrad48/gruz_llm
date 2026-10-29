"""Initial garage schema and pgvector index."""

import sqlalchemy as sa
from alembic import op
from pgvector.sqlalchemy import Vector

revision = "001"
down_revision = None


def upgrade():
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")

    def timestamp():
        return sa.Column("created_at", sa.DateTime(timezone=True), nullable=False)

    op.create_table(
        "projects",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("make", sa.String(80), nullable=False),
        sa.Column("model", sa.String(80), nullable=False),
        sa.Column("year", sa.Integer, nullable=False),
        sa.Column("engine", sa.String(120), nullable=False),
        timestamp(),
    )
    op.create_table(
        "documents",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "project_id",
            sa.String(36),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("size", sa.Integer, nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("error", sa.Text),
        sa.Column("chunk_count", sa.Integer, nullable=False),
        timestamp(),
    )
    op.create_table(
        "chunks",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "project_id",
            sa.String(36),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "document_id",
            sa.String(36),
            sa.ForeignKey("documents.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("content", sa.Text, nullable=False),
        sa.Column("location", sa.String(100), nullable=False),
        sa.Column("embedding", Vector(1536), nullable=False),
    )
    op.create_table(
        "chats",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "project_id",
            sa.String(36),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("title", sa.String(100), nullable=False),
        timestamp(),
    )
    op.create_table(
        "messages",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "chat_id",
            sa.String(36),
            sa.ForeignKey("chats.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("role", sa.String(20), nullable=False),
        sa.Column("content", sa.Text, nullable=False),
        sa.Column("sources", sa.JSON, nullable=False),
        timestamp(),
    )
    for table, columns in {
        "documents": ["project_id"],
        "chunks": ["project_id", "document_id"],
        "chats": ["project_id"],
        "messages": ["chat_id"],
    }.items():
        for column in columns:
            op.create_index(f"ix_{table}_{column}", table, [column])
    op.create_index(
        "ix_chunks_vector",
        "chunks",
        ["embedding"],
        postgresql_using="hnsw",
        postgresql_ops={"embedding": "vector_cosine_ops"},
    )


def downgrade():
    for table in ["messages", "chats", "chunks", "documents", "projects"]:
        op.drop_table(table)
