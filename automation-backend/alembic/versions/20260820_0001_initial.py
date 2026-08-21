"""Initial evidence tracking schema.

Revision ID: 20260820_0001
Revises:
Create Date: 2026-08-20
"""
from __future__ import annotations

from alembic import op

from app.models import Base

revision = "20260820_0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    Base.metadata.create_all(bind=bind, checkfirst=True)


def downgrade() -> None:
    bind = op.get_bind()
    Base.metadata.drop_all(bind=bind, checkfirst=True)
