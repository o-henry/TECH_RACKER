from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime
from typing import Any

from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AnalysisCandidate, DocumentTechnologyLink, IngestionRun, SourceDocument, Technology


def _iso(value: date | datetime | None) -> str | None:
    return value.isoformat() if value else None


def serialize_evidence(document: SourceDocument, link: DocumentTechnologyLink) -> dict[str, Any]:
    metadata = document.metadata_json or {}
    source_label = {
        "rss": "RSS 뉴스",
        "openalex": "논문",
        "clinicaltrials": "임상시험",
        "sec": "SEC 공시",
    }.get(document.source_type, document.source_type)
    return {
        "sourceType": document.source_type,
        "sourceLabel": source_label,
        "externalId": document.external_id,
        "title": document.title,
        "publisher": document.publisher,
        "url": document.canonical_url,
        "publishedAt": _iso(document.published_at),
        "sourceUpdatedAt": _iso(document.source_updated_at),
        "retrievedAt": _iso(document.retrieved_at),
        "matchedTerms": link.matched_terms or [],
        "relevanceScore": round(float(link.relevance_score or 0), 3),
        "linkReason": link.link_reason,
        "metadata": {
            key: metadata.get(key)
            for key in (
                "doi",
                "work_type",
                "cited_by_count",
                "venue",
                "is_retracted",
                "nct_id",
                "overall_status",
                "phases",
                "enrollment",
                "sponsor",
                "conditions",
                "has_results",
                "ticker",
                "cik",
                "form",
                "filing_date",
                "report_date",
                "items",
                "matched_keywords",
                "snippet",
            )
            if metadata.get(key) is not None
        },
    }


async def get_live_evidence(
    session: AsyncSession,
    technology_id: str,
    *,
    per_type: int = 8,
) -> list[dict[str, Any]]:
    sort_date = func.coalesce(
        SourceDocument.source_updated_at,
        SourceDocument.published_at,
        SourceDocument.retrieved_at,
    )
    result: list[dict[str, Any]] = []
    for source_type in ("rss", "openalex", "clinicaltrials", "sec"):
        statement = (
            select(SourceDocument, DocumentTechnologyLink)
            .join(DocumentTechnologyLink, DocumentTechnologyLink.document_id == SourceDocument.id)
            .where(
                DocumentTechnologyLink.technology_id == technology_id,
                SourceDocument.source_type == source_type,
            )
            .order_by(desc(sort_date), desc(SourceDocument.id))
            .limit(per_type)
        )
        rows = (await session.execute(statement)).all()
        result.extend(serialize_evidence(document, link) for document, link in rows)
    return result


async def get_last_ingestion_status(session: AsyncSession) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for source_type in ("rss", "openalex", "clinicaltrials", "sec"):
        run = await session.scalar(
            select(IngestionRun)
            .where(IngestionRun.source_type == source_type)
            .order_by(IngestionRun.started_at.desc())
            .limit(1)
        )
        if run:
            result[source_type] = {
                "status": run.status,
                "startedAt": _iso(run.started_at),
                "finishedAt": _iso(run.finished_at),
                "recordsSeen": run.records_seen,
                "recordsInserted": run.records_inserted,
                "recordsUpdated": run.records_updated,
                "errorCount": run.error_count,
            }
    return result


async def serialize_technology(
    session: AsyncSession,
    technology: Technology,
    *,
    include_live: bool,
    per_type: int,
) -> dict[str, Any]:
    payload = dict(technology.snapshot or {})
    payload.setdefault("id", technology.id)
    payload.setdefault("name", technology.name)
    payload.setdefault("nameEn", technology.name_en)
    payload.setdefault("category", technology.category)
    published_rows = (
        await session.execute(
            select(AnalysisCandidate, SourceDocument)
            .join(SourceDocument, SourceDocument.id == AnalysisCandidate.document_id)
            .join(DocumentTechnologyLink, DocumentTechnologyLink.document_id == SourceDocument.id)
            .where(
                DocumentTechnologyLink.technology_id == technology.id,
                AnalysisCandidate.status == "published",
            )
            .order_by(desc(AnalysisCandidate.analyzed_at))
            .limit(20)
        )
    ).all()
    if published_rows:
        _apply_published_analyses(payload, technology.id, published_rows)
    if include_live:
        evidence = await get_live_evidence(session, technology.id, per_type=per_type)
        counts: dict[str, int] = defaultdict(int)
        for item in evidence:
            counts[item["sourceType"]] += 1
        payload["liveEvidence"] = evidence
        payload["liveEvidenceCounts"] = dict(counts)
    return payload


def _apply_published_analyses(
    payload: dict[str, Any],
    technology_id: str,
    rows: list[tuple[AnalysisCandidate, SourceDocument]],
) -> None:
    event_labels = {
        "regulatory": "규제 변경",
        "clinical": "임상 변경",
        "research": "연구 결과",
        "operations": "운영 변경",
        "financial": "공시 변경",
        "other": "검증 변경",
    }
    events: list[dict[str, Any]] = []
    ai_relationships: list[dict[str, Any]] = []
    for candidate, document in rows:
        analysis = dict(candidate.analysis_json or {})
        facts = [item.get("claim") for item in analysis.get("facts", []) if item.get("claim")]
        decision_reason = str(analysis.get("decision_reason") or "").strip()
        event_text = " ".join(facts[:3]) or decision_reason
        event_date = document.published_at or candidate.analyzed_at
        events.append(
            {
                "date": event_date.date().isoformat() if event_date else "미확인",
                "title": document.title,
                "text": event_text,
                "kind": event_labels.get(analysis.get("event_type"), "검증 변경"),
                "url": document.canonical_url,
                "source": document.publisher or document.source_type.upper(),
                "analysisModel": "CHATGPT SUBSCRIPTION",
                "confidence": analysis.get("confidence", "low"),
            }
        )
        for relation in analysis.get("relationships", []):
            other_id = str(relation.get("technology_id") or "").strip()
            if not other_id or other_id == technology_id:
                continue
            relation_type = relation.get("type", "inferred")
            ai_relationships.append(
                {
                    "from": technology_id,
                    "to": other_id,
                    "kind": {"direct": "observed", "system": "system", "inferred": "inferred"}.get(
                        relation_type, "inferred"
                    ),
                    "strength": {"high": 3, "medium": 2, "low": 1}.get(
                        analysis.get("confidence"), 1
                    ),
                    "type": event_labels.get(analysis.get("event_type"), "자동 분석 연결"),
                    "basis": str(relation.get("reason") or ""),
                    "evidence": f"{document.publisher or document.source_type.upper()} · {events[-1]['date']}",
                    "sourceUrl": document.canonical_url,
                }
            )
    existing_timeline = list(payload.get("timeline") or [])
    new_urls = {item.get("url") for item in events}
    payload["timeline"] = [*events, *[item for item in existing_timeline if item.get("url") not in new_urls]]
    payload["aiRelationships"] = ai_relationships
    payload["verifiedUpdates"] = events

    latest_event = events[0]
    existing_latest = payload.get("latest") or {}
    if latest_event["date"] >= str(existing_latest.get("date") or ""):
        payload["latest"] = {
            "date": latest_event["date"],
            "title": latest_event["title"],
            "text": latest_event["text"],
            "source": latest_event["source"],
            "url": latest_event["url"],
        }
        payload["verifiedAt"] = max(str(payload.get("verifiedAt") or ""), latest_event["date"])
