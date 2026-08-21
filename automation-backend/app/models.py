from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Any

from sqlalchemy import (
    BigInteger,
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class Technology(TimestampMixin, Base):
    __tablename__ = "technologies"

    id: Mapped[str] = mapped_column(String(120), primary_key=True)
    name: Mapped[str] = mapped_column(String(300), nullable=False)
    name_en: Mapped[str] = mapped_column(String(300), nullable=False)
    category: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    verified_at: Mapped[date | None] = mapped_column(Date, nullable=True, index=True)
    snapshot: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")

    queries: Mapped[list[TechnologyQuery]] = relationship(
        back_populates="technology", cascade="all, delete-orphan"
    )
    document_links: Mapped[list[DocumentTechnologyLink]] = relationship(back_populates="technology")


class TechnologyQuery(TimestampMixin, Base):
    __tablename__ = "technology_queries"
    __table_args__ = (
        UniqueConstraint("technology_id", "source_type", "query_key", name="uq_technology_query"),
        Index("ix_technology_queries_source_enabled", "source_type", "enabled"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    technology_id: Mapped[str] = mapped_column(
        ForeignKey("technologies.id", ondelete="CASCADE"), nullable=False, index=True
    )
    source_type: Mapped[str] = mapped_column(String(32), nullable=False)
    query_key: Mapped[str] = mapped_column(String(160), nullable=False)
    query_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    config: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")

    technology: Mapped[Technology] = relationship(back_populates="queries")


class SourceDocument(TimestampMixin, Base):
    __tablename__ = "source_documents"
    __table_args__ = (
        UniqueConstraint("source_type", "external_id", name="uq_source_document_external"),
        Index("ix_source_documents_type_published", "source_type", "published_at"),
        Index("ix_source_documents_retrieved", "retrieved_at"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    source_type: Mapped[str] = mapped_column(String(32), nullable=False)
    external_id: Mapped[str] = mapped_column(String(300), nullable=False)
    canonical_url: Mapped[str] = mapped_column(Text, nullable=False)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    publisher: Mapped[str | None] = mapped_column(String(300), nullable=True)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    source_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    retrieved_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), index=True
    )
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    metadata_json: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    raw_payload: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    text_content: Mapped[str | None] = mapped_column(Text, nullable=True)

    technology_links: Mapped[list[DocumentTechnologyLink]] = relationship(
        back_populates="document", cascade="all, delete-orphan"
    )
    paper: Mapped[PaperRecord | None] = relationship(back_populates="document", uselist=False)
    clinical_trial: Mapped[ClinicalTrialRecord | None] = relationship(
        back_populates="document", uselist=False
    )
    sec_filing: Mapped[SecFilingRecord | None] = relationship(back_populates="document", uselist=False)


class DocumentTechnologyLink(Base):
    __tablename__ = "document_technology_links"
    __table_args__ = (Index("ix_document_links_technology_seen", "technology_id", "last_seen_at"),)

    document_id: Mapped[int] = mapped_column(
        ForeignKey("source_documents.id", ondelete="CASCADE"), primary_key=True
    )
    technology_id: Mapped[str] = mapped_column(
        ForeignKey("technologies.id", ondelete="CASCADE"), primary_key=True
    )
    query_id: Mapped[int | None] = mapped_column(
        ForeignKey("technology_queries.id", ondelete="SET NULL"), nullable=True
    )
    relevance_score: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    matched_terms: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    link_reason: Mapped[str] = mapped_column(Text, nullable=False, default="query match")
    first_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

    document: Mapped[SourceDocument] = relationship(back_populates="technology_links")
    technology: Mapped[Technology] = relationship(back_populates="document_links")


class PaperRecord(Base):
    __tablename__ = "paper_records"

    document_id: Mapped[int] = mapped_column(
        ForeignKey("source_documents.id", ondelete="CASCADE"), primary_key=True
    )
    openalex_id: Mapped[str] = mapped_column(String(100), nullable=False, unique=True)
    doi: Mapped[str | None] = mapped_column(String(300), nullable=True, index=True)
    publication_date: Mapped[date | None] = mapped_column(Date, nullable=True, index=True)
    work_type: Mapped[str | None] = mapped_column(String(100), nullable=True)
    cited_by_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    venue: Mapped[str | None] = mapped_column(Text, nullable=True)
    authors: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, nullable=False, default=list)
    institutions: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, nullable=False, default=list)
    abstract: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_retracted: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    document: Mapped[SourceDocument] = relationship(back_populates="paper")


class ClinicalTrialRecord(Base):
    __tablename__ = "clinical_trial_records"

    document_id: Mapped[int] = mapped_column(
        ForeignKey("source_documents.id", ondelete="CASCADE"), primary_key=True
    )
    nct_id: Mapped[str] = mapped_column(String(32), nullable=False, unique=True)
    overall_status: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    phases: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    enrollment: Mapped[int | None] = mapped_column(Integer, nullable=True)
    sponsor: Mapped[str | None] = mapped_column(Text, nullable=True)
    study_type: Mapped[str | None] = mapped_column(String(100), nullable=True)
    conditions: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    interventions: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, nullable=False, default=list)
    locations: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, nullable=False, default=list)
    start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    primary_completion_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    completion_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    last_update_post_date: Mapped[date | None] = mapped_column(Date, nullable=True, index=True)
    has_results: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    document: Mapped[SourceDocument] = relationship(back_populates="clinical_trial")


class SecCompany(TimestampMixin, Base):
    __tablename__ = "sec_companies"

    ticker: Mapped[str] = mapped_column(String(20), primary_key=True)
    cik: Mapped[str] = mapped_column(String(10), nullable=False, unique=True, index=True)
    company_name: Mapped[str] = mapped_column(Text, nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")


class SecFilingRecord(Base):
    __tablename__ = "sec_filing_records"

    document_id: Mapped[int] = mapped_column(
        ForeignKey("source_documents.id", ondelete="CASCADE"), primary_key=True
    )
    accession_number: Mapped[str] = mapped_column(String(32), nullable=False, unique=True)
    cik: Mapped[str] = mapped_column(String(10), nullable=False, index=True)
    ticker: Mapped[str | None] = mapped_column(String(20), nullable=True, index=True)
    form: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    filing_date: Mapped[date | None] = mapped_column(Date, nullable=True, index=True)
    report_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    primary_document: Mapped[str | None] = mapped_column(Text, nullable=True)
    items: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    exhibits: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, nullable=False, default=list)
    matched_keywords: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)

    document: Mapped[SourceDocument] = relationship(back_populates="sec_filing")


class IngestionRun(Base):
    __tablename__ = "ingestion_runs"
    __table_args__ = (Index("ix_ingestion_runs_source_started", "source_type", "started_at"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    source_type: Mapped[str] = mapped_column(String(32), nullable=False)
    trigger: Mapped[str] = mapped_column(String(32), nullable=False, default="manual")
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="running")
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    queries_total: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    queries_succeeded: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    records_seen: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    records_inserted: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    records_updated: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    records_linked: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    records_skipped: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    error_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    errors: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, nullable=False, default=list)
    details: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)


class SyncState(Base):
    __tablename__ = "sync_states"

    key: Mapped[str] = mapped_column(String(300), primary_key=True)
    source_type: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    value: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )


class AnalysisCandidate(TimestampMixin, Base):
    __tablename__ = "analysis_candidates"
    __table_args__ = (
        UniqueConstraint("document_id", name="uq_analysis_candidate_document"),
        Index("ix_analysis_candidates_status_priority", "status", "priority"),
        Index("ix_analysis_candidates_lease", "lease_run_id", "lease_expires_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    document_id: Mapped[int] = mapped_column(
        ForeignKey("source_documents.id", ondelete="CASCADE"), nullable=False
    )
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="queued")
    priority: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    source_class: Mapped[str] = mapped_column(String(64), nullable=False)
    lease_run_id: Mapped[str | None] = mapped_column(String(120), nullable=True)
    lease_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    analysis_attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    analyzed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    publish_decision: Mapped[str | None] = mapped_column(String(32), nullable=True)
    analysis_json: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)


class AutomationAudit(Base):
    __tablename__ = "automation_audit"
    __table_args__ = (
        UniqueConstraint("request_id", name="uq_automation_audit_request"),
        Index("ix_automation_audit_created", "created_at"),
        Index("ix_automation_audit_action_created", "action", "created_at"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    request_id: Mapped[str] = mapped_column(String(160), nullable=False)
    actor: Mapped[str] = mapped_column(String(120), nullable=False)
    action: Mapped[str] = mapped_column(String(80), nullable=False)
    details: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
