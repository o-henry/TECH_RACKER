from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    ClinicalTrialRecord,
    DocumentTechnologyLink,
    PaperRecord,
    SecCompany,
    SecFilingRecord,
    SourceDocument,
    SyncState,
    TechnologyQuery,
)
from app.utils import utcnow


@dataclass(slots=True)
class UpsertResult:
    document_id: int
    inserted: bool
    updated: bool


async def load_enabled_queries(session: AsyncSession, source_type: str) -> list[TechnologyQuery]:
    statement = (
        select(TechnologyQuery)
        .where(TechnologyQuery.source_type == source_type, TechnologyQuery.enabled.is_(True))
        .order_by(TechnologyQuery.technology_id, TechnologyQuery.query_key)
    )
    return list((await session.scalars(statement)).all())


async def upsert_source_document(
    session: AsyncSession,
    *,
    source_type: str,
    external_id: str,
    canonical_url: str,
    title: str,
    publisher: str | None,
    published_at: datetime | None,
    source_updated_at: datetime | None,
    content_hash: str,
    metadata_json: dict[str, Any],
    raw_payload: dict[str, Any],
    text_content: str | None,
) -> UpsertResult:
    existing = await session.scalar(
        select(SourceDocument).where(
            SourceDocument.source_type == source_type,
            SourceDocument.external_id == external_id,
        )
    )
    now = utcnow()
    if existing is None:
        document = SourceDocument(
            source_type=source_type,
            external_id=external_id,
            canonical_url=canonical_url,
            title=title,
            publisher=publisher,
            published_at=published_at,
            source_updated_at=source_updated_at,
            retrieved_at=now,
            content_hash=content_hash,
            metadata_json=metadata_json,
            raw_payload=raw_payload,
            text_content=text_content,
        )
        session.add(document)
        await session.flush()
        return UpsertResult(document.id, inserted=True, updated=False)

    changed = existing.content_hash != content_hash
    existing.canonical_url = canonical_url
    existing.title = title
    existing.publisher = publisher
    existing.published_at = published_at
    existing.source_updated_at = source_updated_at
    existing.retrieved_at = now
    existing.content_hash = content_hash
    existing.metadata_json = metadata_json
    existing.raw_payload = raw_payload
    existing.text_content = text_content
    await session.flush()
    return UpsertResult(existing.id, inserted=False, updated=changed)


async def link_document_to_technology(
    session: AsyncSession,
    *,
    document_id: int,
    technology_id: str,
    query_id: int | None,
    relevance_score: float,
    matched_terms: list[str],
    link_reason: str,
) -> bool:
    existing = await session.scalar(
        select(DocumentTechnologyLink).where(
            DocumentTechnologyLink.document_id == document_id,
            DocumentTechnologyLink.technology_id == technology_id,
        )
    )
    if existing is None:
        session.add(
            DocumentTechnologyLink(
                document_id=document_id,
                technology_id=technology_id,
                query_id=query_id,
                relevance_score=relevance_score,
                matched_terms=matched_terms,
                link_reason=link_reason,
            )
        )
        await session.flush()
        return True
    existing.query_id = query_id or existing.query_id
    existing.relevance_score = max(existing.relevance_score, relevance_score)
    existing.matched_terms = list(dict.fromkeys([*existing.matched_terms, *matched_terms]))
    existing.link_reason = link_reason
    existing.last_seen_at = utcnow()
    await session.flush()
    return False


async def upsert_paper_record(session: AsyncSession, document_id: int, values: dict[str, Any]) -> None:
    statement = insert(PaperRecord).values(document_id=document_id, **values)
    statement = statement.on_conflict_do_update(
        index_elements=[PaperRecord.document_id],
        set_={key: value for key, value in values.items()},
    )
    await session.execute(statement)


async def upsert_clinical_trial_record(session: AsyncSession, document_id: int, values: dict[str, Any]) -> None:
    statement = insert(ClinicalTrialRecord).values(document_id=document_id, **values)
    statement = statement.on_conflict_do_update(
        index_elements=[ClinicalTrialRecord.document_id],
        set_={key: value for key, value in values.items()},
    )
    await session.execute(statement)


async def upsert_sec_filing_record(session: AsyncSession, document_id: int, values: dict[str, Any]) -> None:
    statement = insert(SecFilingRecord).values(document_id=document_id, **values)
    statement = statement.on_conflict_do_update(
        index_elements=[SecFilingRecord.document_id],
        set_={key: value for key, value in values.items()},
    )
    await session.execute(statement)


async def upsert_sec_company(
    session: AsyncSession,
    *,
    ticker: str,
    cik: str,
    company_name: str,
) -> None:
    statement = insert(SecCompany).values(
        ticker=ticker.upper(), cik=cik.zfill(10), company_name=company_name, enabled=True
    )
    statement = statement.on_conflict_do_update(
        index_elements=[SecCompany.ticker],
        set_={"cik": cik.zfill(10), "company_name": company_name, "enabled": True},
    )
    await session.execute(statement)


async def get_sync_state(session: AsyncSession, key: str) -> dict[str, Any] | None:
    row = await session.get(SyncState, key)
    return row.value if row else None


async def set_sync_state(session: AsyncSession, key: str, source_type: str, value: dict[str, Any]) -> None:
    statement = insert(SyncState).values(key=key, source_type=source_type, value=value)
    statement = statement.on_conflict_do_update(
        index_elements=[SyncState.key],
        set_={"source_type": source_type, "value": value, "updated_at": utcnow()},
    )
    await session.execute(statement)
