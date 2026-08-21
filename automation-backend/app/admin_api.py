from __future__ import annotations

import secrets

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db import get_session
from app.models import AutomationAudit
from app.services.analysis_queue import automation_status, set_automation_paused
from app.services.ingestion import IngestionCoordinator

router = APIRouter(prefix="/api/v1/admin/automation", tags=["private-automation"])
settings = get_settings()


def _authorize(authorization: str | None = Header(default=None)) -> str:
    expected = settings.backend_control_token
    if expected is None:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Admin control is not configured")
    prefix = "Bearer "
    if not authorization or not authorization.startswith(prefix):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")
    supplied = authorization[len(prefix) :]
    if not secrets.compare_digest(supplied, expected):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid control token")
    return "sites-owner"


def _idempotency_key(value: str | None = Header(default=None, alias="Idempotency-Key")) -> str:
    if not value or len(value) > 160:
        raise HTTPException(status_code=400, detail="Valid Idempotency-Key required")
    return value


@router.get("/status")
async def get_status(
    _: str = Depends(_authorize),
    session: AsyncSession = Depends(get_session),
):
    return await automation_status(session)


@router.post("/pause")
async def pause(
    request_id: str = Depends(_idempotency_key),
    actor: str = Depends(_authorize),
    session: AsyncSession = Depends(get_session),
):
    return await set_automation_paused(session, paused=True, actor=actor, request_id=request_id)


@router.post("/resume")
async def resume(
    request_id: str = Depends(_idempotency_key),
    actor: str = Depends(_authorize),
    session: AsyncSession = Depends(get_session),
):
    return await set_automation_paused(session, paused=False, actor=actor, request_id=request_id)


@router.post("/run-collectors", status_code=202)
async def run_collectors(
    background_tasks: BackgroundTasks,
    request_id: str = Depends(_idempotency_key),
    actor: str = Depends(_authorize),
    session: AsyncSession = Depends(get_session),
):
    existing = await session.scalar(select(AutomationAudit).where(AutomationAudit.request_id == request_id))
    if existing:
        return {"status": "already_processed"}
    session.add(
        AutomationAudit(
            request_id=request_id,
            actor=actor,
            action="collectors_requested",
            details={"trigger": "admin"},
        )
    )
    await session.commit()
    coordinator = IngestionCoordinator(settings)
    background_tasks.add_task(coordinator.run_all, trigger="admin")
    return {"status": "accepted"}
