"""Persist agent execution history and generation state."""

import sqlalchemy as sa
from alembic import op

revision = "002"
down_revision = "001"


def upgrade():
    op.add_column(
        "messages",
        sa.Column("status", sa.String(20), nullable=False, server_default="complete"),
    )
    op.add_column(
        "messages", sa.Column("execution", sa.JSON, nullable=False, server_default="[]")
    )


def downgrade():
    op.drop_column("messages", "execution")
    op.drop_column("messages", "status")
