from __future__ import annotations

import uuid
from datetime import timedelta
from typing import Any

from sqlalchemy import case, desc, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models import (
    AnalysisCandidate,
    AutomationAudit,
    DocumentTechnologyLink,
    SourceDocument,
    SyncState,
)
from app.schemas import AnalysisPayload
from app.utils import safe_snippet, utcnow

settings = get_settings()
PRIMARY_SOURCE_CLASSES = {"official_registry", "regulatory_filing", "peer_literature"}
SOURCE_CLASS = {
    "clinicaltrials": "official_registry",
    "sec": "regulatory_filing",
    "openalex": "peer_literature",
    "rss": "reviewed_feed",
}
SOURCE_PRIORITY = {"clinicaltrials": 1.0, "sec": 0.95, "rss": 0.75, "openalex": 0.65}


async def _automation_state(session: AsyncSession) -> dict[str, Any]:
    state = await session.get(SyncState, "automation:state")
    return dict(state.value) if state else {"paused": False}


async def is_automation_paused(session: AsyncSession) -> bool:
    return bool((await _automation_state(session)).get("paused", False))


async def set_automation_paused(
    session: AsyncSession, *, paused: bool, actor: str, request_id: str
) -> dict[str, Any]:
    existing_audit = await session.scalar(
        select(AutomationAudit).where(AutomationAudit.request_id == request_id)
    )
    if existing_audit:
        return {"status": "already_processed", "paused": paused}
    state = await session.get(SyncState, "automation:state")
    payload = {"paused": paused, "updated_at": utcnow().isoformat(), "updated_by": actor}
    if state is None:
        state = SyncState(key="automation:state", source_type="automation", value=payload)
        session.add(state)
    else:
        state.value = payload
    session.add(
        AutomationAudit(
            request_id=request_id,
            actor=actor,
            action="automation_paused" if paused else "automation_resumed",
            details={"paused": paused},
        )
    )
    await session.commit()
    return {"status": "ok", "paused": paused}


async def enqueue_new_candidates(session: AsyncSession, *, limit: int = 1_000) -> int:
    priority = case(
        (SourceDocument.source_type == "clinicaltrials", 1.0),
        (SourceDocument.source_type == "sec", 0.95),
        (SourceDocument.source_type == "rss", 0.75),
        else_=0.65,
    )
    statement = (
        select(SourceDocument, func.max(DocumentTechnologyLink.relevance_score).label("relevance"))
        .join(DocumentTechnologyLink, DocumentTechnologyLink.document_id == SourceDocument.id)
        .outerjoin(AnalysisCandidate, AnalysisCandidate.document_id == SourceDocument.id)
        .where(AnalysisCandidate.id.is_(None))
        .group_by(SourceDocument.id)
        .order_by(desc(priority), desc(SourceDocument.retrieved_at))
        .limit(limit)
    )
    rows = (await session.execute(statement)).all()
    for document, relevance in rows:
        source_class = SOURCE_CLASS.get(document.source_type, "other")
        if source_class == "reviewed_feed":
            technology_ids = list(
                (
                    await session.scalars(
                        select(DocumentTechnologyLink.technology_id).where(
                            DocumentTechnologyLink.document_id == document.id
                        )
                    )
                ).all()
            )
            recent_related = None
            if technology_ids:
                recent_related = await session.scalar(
                    select(AnalysisCandidate.id)
                    .join(SourceDocument, SourceDocument.id == AnalysisCandidate.document_id)
                    .join(
                        DocumentTechnologyLink,
                        DocumentTechnologyLink.document_id == SourceDocument.id,
                    )
                    .where(
                        AnalysisCandidate.source_class == "reviewed_feed",
                        AnalysisCandidate.created_at >= utcnow() - timedelta(hours=6),
                        DocumentTechnologyLink.technology_id.in_(technology_ids),
                    )
                    .limit(1)
                )
            if recent_related:
                continue
        session.add(
            AnalysisCandidate(
                document_id=document.id,
                status="queued",
                priority=min(1.0, SOURCE_PRIORITY.get(document.source_type, 0.5) + float(relevance or 0) * 0.05),
                source_class=source_class,
            )
        )
    await session.flush()
    return len(rows)


async def _today_claim_count(session: AsyncSession) -> int:
    day_start = utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    return int(
        await session.scalar(
            select(func.count(AutomationAudit.id)).where(
                AutomationAudit.action == "analysis_batch_claimed",
                AutomationAudit.created_at >= day_start,
            )
        )
        or 0
    )


async def _hour_critical_claim_count(session: AsyncSession) -> int:
    hour_start = utcnow() - timedelta(hours=1)
    return int(
        await session.scalar(
            select(func.count(AutomationAudit.id)).where(
                AutomationAudit.action == "analysis_critical_batch_claimed",
                AutomationAudit.created_at >= hour_start,
            )
        )
        or 0
    )


async def claim_batch(session: AsyncSession, *, run_id: str, max_items: int) -> dict[str, Any]:
    run_id = run_id.strip()
    if not run_id or len(run_id) > 120:
        raise ValueError("run_id must be 1 to 120 characters")
    max_items = max(1, min(max_items, settings.analysis_batch_size, 10))
    if await is_automation_paused(session):
        return {"status": "paused", "items": [], "count": 0}

    existing = list(
        (
            await session.scalars(
                select(AnalysisCandidate).where(
                    AnalysisCandidate.lease_run_id == run_id,
                    AnalysisCandidate.status == "leased",
                )
            )
        ).all()
    )
    if existing:
        return await _serialize_batch(session, existing, status="replayed")

    claims_today = await _today_claim_count(session)
    critical_bypass = claims_today >= settings.analysis_daily_batch_limit
    if critical_bypass and (
        settings.analysis_critical_burst_per_hour <= 0
        or await _hour_critical_claim_count(session) >= settings.analysis_critical_burst_per_hour
    ):
        return {"status": "daily_budget_exhausted", "items": [], "count": 0}

    now = utcnow()
    await session.execute(
        update(AnalysisCandidate)
        .where(
            AnalysisCandidate.status == "leased",
            AnalysisCandidate.lease_expires_at < now,
        )
        .values(status="queued", lease_run_id=None, lease_expires_at=None)
    )
    candidate_query = (
        select(AnalysisCandidate)
        .join(SourceDocument, SourceDocument.id == AnalysisCandidate.document_id)
        .where(AnalysisCandidate.status == "queued")
    )
    if critical_bypass:
        candidate_query = candidate_query.where(
            AnalysisCandidate.source_class.in_(PRIMARY_SOURCE_CLASSES),
            or_(
                SourceDocument.title.ilike("%phase 3%"),
                SourceDocument.title.ilike("%phase iii%"),
                SourceDocument.title.ilike("%approved%"),
                SourceDocument.title.ilike("%approval%"),
                SourceDocument.title.ilike("%clinical hold%"),
                SourceDocument.title.ilike("%recall%"),
                SourceDocument.title.ilike("%3상%"),
                SourceDocument.title.ilike("%허가%"),
                SourceDocument.title.ilike("%리콜%"),
            ),
        )
    candidates = list(
        (
            await session.scalars(
                candidate_query.order_by(
                    desc(AnalysisCandidate.priority), AnalysisCandidate.created_at
                )
                .with_for_update(skip_locked=True)
                .limit(max_items)
            )
        ).all()
    )
    if not candidates:
        await session.commit()
        return {"status": "empty", "items": [], "count": 0}

    lease_until = now + timedelta(minutes=settings.analysis_lease_minutes)
    for candidate in candidates:
        candidate.status = "leased"
        candidate.lease_run_id = run_id
        candidate.lease_expires_at = lease_until
        candidate.analysis_attempts += 1
    session.add(
        AutomationAudit(
            request_id=f"claim:{run_id}",
            actor="chatgpt-scheduled-task",
            action="analysis_critical_batch_claimed" if critical_bypass else "analysis_batch_claimed",
            details={"count": len(candidates), "lease_expires_at": lease_until.isoformat()},
        )
    )
    await session.commit()
    return await _serialize_batch(session, candidates, status="claimed")


async def _serialize_batch(
    session: AsyncSession, candidates: list[AnalysisCandidate], *, status: str
) -> dict[str, Any]:
    items: list[dict[str, Any]] = []
    for candidate in candidates:
        document = await session.get(SourceDocument, candidate.document_id)
        if document is None:
            continue
        links = list(
            (
                await session.execute(
                    select(
                        DocumentTechnologyLink.technology_id,
                        DocumentTechnologyLink.relevance_score,
                        DocumentTechnologyLink.matched_terms,
                    ).where(DocumentTechnologyLink.document_id == document.id)
                )
            ).all()
        )
        matched_terms = list(dict.fromkeys(term for link in links for term in (link.matched_terms or [])))
        items.append(
            {
                "candidate_id": str(candidate.id),
                "source_id": document.external_id,
                "source_type": document.source_type,
                "source_class": candidate.source_class,
                "title": document.title,
                "publisher": document.publisher,
                "published_at": document.published_at.isoformat() if document.published_at else None,
                "canonical_url": document.canonical_url,
                "excerpt": safe_snippet(document.text_content or "", matched_terms, radius=500),
                "technology_ids": [link.technology_id for link in links],
                "matched_terms": matched_terms[:30],
                "priority": candidate.priority,
            }
        )
    return {"status": status, "items": items, "count": len(items)}


async def publish_analysis(
    session: AsyncSession,
    *,
    run_id: str,
    candidate_id: str,
    analysis: AnalysisPayload,
) -> dict[str, Any]:
    try:
        parsed_id = uuid.UUID(candidate_id)
    except ValueError as exc:
        raise ValueError("candidate_id must be a UUID") from exc
    candidate = await session.scalar(
        select(AnalysisCandidate).where(AnalysisCandidate.id == parsed_id).with_for_update()
    )
    if candidate is None:
        raise ValueError("candidate not found")
    if candidate.status in {"published", "review", "discarded"}:
        return {"status": "already_processed", "decision": candidate.publish_decision}
    if candidate.status != "leased" or candidate.lease_run_id != run_id:
        raise ValueError("candidate is not leased to this run")
    if candidate.lease_expires_at and candidate.lease_expires_at < utcnow():
        raise ValueError("candidate lease expired")

    document = await session.get(SourceDocument, candidate.document_id)
    if document is None:
        raise ValueError("source document not found")
    allowed_url = document.canonical_url
    supplied_urls = {url for fact in analysis.facts for url in fact.source_urls}
    if any(url != allowed_url for url in supplied_urls):
        raise ValueError("analysis contains a source URL outside the claimed candidate")

    requested = analysis.publish_decision
    trusted_auto_publish = (
        candidate.source_class in PRIMARY_SOURCE_CLASSES
        and analysis.materiality in {"critical", "high"}
        and analysis.confidence == "high"
        and bool(analysis.facts)
    )
    decision = requested
    if requested == "auto_publish" and not trusted_auto_publish:
        decision = "review"
    candidate.status = {"auto_publish": "published", "review": "review", "discard": "discarded"}[decision]
    candidate.publish_decision = decision
    candidate.analysis_json = analysis.model_dump(mode="json")
    candidate.analyzed_at = utcnow()
    candidate.lease_run_id = None
    candidate.lease_expires_at = None
    session.add(
        AutomationAudit(
            request_id=f"publish:{run_id}:{candidate_id}",
            actor="chatgpt-scheduled-task",
            action="analysis_published" if decision == "auto_publish" else f"analysis_{decision}",
            details={"candidate_id": candidate_id, "requested": requested, "effective": decision},
        )
    )
    await session.commit()
    return {"status": "ok", "requested_decision": requested, "effective_decision": decision}


async def release_batch(session: AsyncSession, *, run_id: str, reason: str) -> dict[str, Any]:
    existing = await session.scalar(
        select(AutomationAudit).where(AutomationAudit.request_id == f"release:{run_id}")
    )
    if existing:
        return {"status": "already_processed", "released": existing.details.get("released", 0)}
    result = await session.execute(
        update(AnalysisCandidate)
        .where(AnalysisCandidate.status == "leased", AnalysisCandidate.lease_run_id == run_id)
        .values(status="queued", lease_run_id=None, lease_expires_at=None, last_error=reason[:2_000])
    )
    session.add(
        AutomationAudit(
            request_id=f"release:{run_id}",
            actor="chatgpt-scheduled-task",
            action="analysis_batch_released",
            details={"released": result.rowcount or 0, "reason": reason[:500]},
        )
    )
    await session.commit()
    return {"status": "ok", "released": result.rowcount or 0}


async def automation_status(session: AsyncSession) -> dict[str, Any]:
    state = await _automation_state(session)
    counts = {
        row.status: int(row.count)
        for row in (
            await session.execute(
                select(AnalysisCandidate.status, func.count(AnalysisCandidate.id).label("count")).group_by(
                    AnalysisCandidate.status
                )
            )
        ).all()
    }
    day_start = utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    published_today = int(
        await session.scalar(
            select(func.count(AnalysisCandidate.id)).where(
                AnalysisCandidate.status == "published", AnalysisCandidate.analyzed_at >= day_start
            )
        )
        or 0
    )
    recent_runs = list(
        (
            await session.scalars(
                select(AutomationAudit).order_by(desc(AutomationAudit.created_at)).limit(20)
            )
        ).all()
    )
    last_mcp_check = await session.scalar(
        select(AutomationAudit)
        .where(AutomationAudit.action == "mcp_status_checked")
        .order_by(desc(AutomationAudit.created_at))
        .limit(1)
    )
    mcp_connected = bool(
        last_mcp_check and last_mcp_check.created_at >= utcnow() - timedelta(hours=2, minutes=15)
    )
    return {
        "checkedAt": utcnow().isoformat(),
        "automation": {"paused": bool(state.get("paused", False))},
        "chatgpt": {
            "mode": "chatgpt_subscription",
            "connected": mcp_connected,
            "lastCheckedAt": last_mcp_check.created_at.isoformat() if last_mcp_check else None,
            "cadenceMinutes": 60,
            "batchSize": settings.analysis_batch_size,
            "dailyBatchLimit": settings.analysis_daily_batch_limit,
            "claimsToday": await _today_claim_count(session),
            "criticalClaimsLastHour": await _hour_critical_claim_count(session),
        },
        "queue": {
            "candidates": counts.get("queued", 0),
            "analysisPending": counts.get("leased", 0),
            "reviewPending": counts.get("review", 0),
            "publishedToday": published_today,
        },
        "pipeline": {
            "collect": "paused" if state.get("paused") else "live",
            "filter": "ready",
            "analyze": "paused" if state.get("paused") else ("live" if mcp_connected else "waiting"),
            "publish": "ready",
        },
        "recentRuns": [
            {
                "action": run.action,
                "createdAt": run.created_at.isoformat(),
                "details": run.details,
            }
            for run in recent_runs
        ],
    }
