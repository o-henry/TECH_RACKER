"""Add bounded ChatGPT subscription analysis queue and audit log.

Revision ID: 20260821_0002
Revises: 20260820_0001
Create Date: 2026-08-21
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "20260821_0002"
down_revision = "20260820_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "analysis_candidates",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("document_id", sa.BigInteger(), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("priority", sa.Float(), nullable=False),
        sa.Column("source_class", sa.String(length=64), nullable=False),
        sa.Column("lease_run_id", sa.String(length=120), nullable=True),
        sa.Column("lease_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("analysis_attempts", sa.Integer(), nullable=False),
        sa.Column("analyzed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("publish_decision", sa.String(length=32), nullable=True),
        sa.Column("analysis_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["document_id"], ["source_documents.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("document_id", name="uq_analysis_candidate_document"),
    )
    op.create_index(
        "ix_analysis_candidates_status_priority",
        "analysis_candidates",
        ["status", "priority"],
        unique=False,
    )
    op.create_index(
        "ix_analysis_candidates_lease",
        "analysis_candidates",
        ["lease_run_id", "lease_expires_at"],
        unique=False,
    )

    op.create_table(
        "automation_audit",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("request_id", sa.String(length=160), nullable=False),
        sa.Column("actor", sa.String(length=120), nullable=False),
        sa.Column("action", sa.String(length=80), nullable=False),
        sa.Column("details", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("request_id", name="uq_automation_audit_request"),
    )
    op.create_index("ix_automation_audit_created", "automation_audit", ["created_at"], unique=False)
    op.create_index(
        "ix_automation_audit_action_created",
        "automation_audit",
        ["action", "created_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_automation_audit_action_created", table_name="automation_audit")
    op.drop_index("ix_automation_audit_created", table_name="automation_audit")
    op.drop_table("automation_audit")
    op.drop_index("ix_analysis_candidates_lease", table_name="analysis_candidates")
    op.drop_index("ix_analysis_candidates_status_priority", table_name="analysis_candidates")
    op.drop_table("analysis_candidates")
