from __future__ import annotations

import secrets
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.responses import ORJSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import desc, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app import __version__
from app.admin_api import router as admin_router
from app.config import get_settings
from app.db import get_session
from app.logging_config import configure_logging
from app.mcp_server import mcp
from app.models import IngestionRun, Technology
from app.schemas import HealthResponse, TechnologyListResponse
from app.services.presentation import (
    get_last_ingestion_status,
    get_live_evidence,
    serialize_technology,
)

settings = get_settings()
configure_logging(settings.log_level)


@asynccontextmanager
async def lifespan(_: FastAPI):
    async with mcp.session_manager.run():
        yield

app = FastAPI(
    title="Technology Tracker API",
    version=__version__,
    default_response_class=ORJSONResponse,
    docs_url="/api/docs",
    redoc_url=None,
    openapi_url="/api/openapi.json",
    lifespan=lifespan,
)


@app.middleware("http")
async def secure_private_mcp(request: Request, call_next):
    if request.url.path.startswith("/mcp"):
        expected = settings.mcp_internal_token
        supplied = request.headers.get("x-mcp-internal-token")
        if expected is None:
            return ORJSONResponse({"detail": "MCP connection is not configured"}, status_code=503)
        if not supplied or not secrets.compare_digest(supplied, expected):
            return ORJSONResponse({"detail": "MCP authentication required"}, status_code=401)
    return await call_next(request)


app.include_router(admin_router)
app.mount("/mcp", mcp.streamable_http_app())


@app.get("/api/v1/health", response_model=HealthResponse)
async def health(session: AsyncSession = Depends(get_session)) -> HealthResponse:
    await session.execute(text("SELECT 1"))
    return HealthResponse(status="ok", database="ok", time=datetime.now(UTC))


@app.get("/api/v1/technologies", response_model=TechnologyListResponse)
async def list_technologies(
    include_live: bool = Query(default=True),
    limit_per_type: int = Query(default=6, ge=1, le=30),
    session: AsyncSession = Depends(get_session),
) -> TechnologyListResponse:
    technologies = list(
        (
            await session.scalars(
                select(Technology).where(Technology.enabled.is_(True)).order_by(Technology.name)
            )
        ).all()
    )
    items = [
        await serialize_technology(
            session, technology, include_live=include_live, per_type=limit_per_type
        )
        for technology in technologies
    ]
    return TechnologyListResponse(
        items=items,
        count=len(items),
        ingestion=await get_last_ingestion_status(session),
    )


@app.get("/api/v1/technologies/{technology_id}")
async def get_technology(
    technology_id: str,
    include_live: bool = Query(default=True),
    limit_per_type: int = Query(default=20, ge=1, le=100),
    session: AsyncSession = Depends(get_session),
):
    technology = await session.get(Technology, technology_id)
    if technology is None or not technology.enabled:
        raise HTTPException(status_code=404, detail="Technology not found")
    return await serialize_technology(
        session, technology, include_live=include_live, per_type=limit_per_type
    )


@app.get("/api/v1/evidence")
async def list_evidence(
    technology_id: str,
    source_type: Literal["all", "rss", "openalex", "clinicaltrials", "sec"] = "all",
    limit: int = Query(default=50, ge=1, le=200),
    session: AsyncSession = Depends(get_session),
):
    technology = await session.get(Technology, technology_id)
    if technology is None:
        raise HTTPException(status_code=404, detail="Technology not found")
    items = await get_live_evidence(session, technology_id, per_type=limit)
    if source_type != "all":
        items = [item for item in items if item["sourceType"] == source_type]
    return {"items": items[:limit], "count": min(len(items), limit)}


@app.get("/api/v1/ingestion-runs")
async def list_ingestion_runs(
    limit: int = Query(default=30, ge=1, le=200),
    session: AsyncSession = Depends(get_session),
):
    runs = list(
        (
            await session.scalars(
                select(IngestionRun).order_by(desc(IngestionRun.started_at)).limit(limit)
            )
        ).all()
    )
    return {
        "items": [
            {
                "id": str(run.id),
                "sourceType": run.source_type,
                "trigger": run.trigger,
                "status": run.status,
                "startedAt": run.started_at.isoformat(),
                "finishedAt": run.finished_at.isoformat() if run.finished_at else None,
                "queriesTotal": run.queries_total,
                "queriesSucceeded": run.queries_succeeded,
                "recordsSeen": run.records_seen,
                "recordsInserted": run.records_inserted,
                "recordsUpdated": run.records_updated,
                "recordsLinked": run.records_linked,
                "recordsSkipped": run.records_skipped,
                "errorCount": run.error_count,
                "errors": run.errors,
            }
            for run in runs
        ],
        "count": len(runs),
    }


frontend_dir = settings.frontend_dir
if not frontend_dir.is_absolute():
    frontend_dir = Path.cwd() / frontend_dir
if frontend_dir.exists():
    app.mount("/", StaticFiles(directory=frontend_dir, html=True), name="frontend")
