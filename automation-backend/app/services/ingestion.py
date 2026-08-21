from __future__ import annotations

import logging
from dataclasses import asdict
from typing import Any

from sqlalchemy import text

from app.config import Settings
from app.db import SessionLocal, engine
from app.ingestors.clinicaltrials import ClinicalTrialsIngestor
from app.ingestors.common import IngestStats
from app.ingestors.openalex import OpenAlexIngestor
from app.ingestors.rss import RssIngestor
from app.ingestors.sec import SecIngestor
from app.models import IngestionRun
from app.utils import advisory_lock_key, utcnow

logger = logging.getLogger(__name__)

SOURCE_ALIASES = {
    "paper": "openalex",
    "papers": "openalex",
    "openalex": "openalex",
    "trial": "clinicaltrials",
    "trials": "clinicaltrials",
    "clinical": "clinicaltrials",
    "clinicaltrials": "clinicaltrials",
    "filing": "sec",
    "filings": "sec",
    "sec": "sec",
    "rss": "rss",
    "news": "rss",
}


class IngestionCoordinator:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def _build_ingestor(self, source_type: str):
        if source_type == "openalex":
            return OpenAlexIngestor(self.settings, SessionLocal)
        if source_type == "clinicaltrials":
            return ClinicalTrialsIngestor(self.settings, SessionLocal)
        if source_type == "sec":
            return SecIngestor(self.settings, SessionLocal)
        if source_type == "rss":
            return RssIngestor(self.settings, SessionLocal)
        raise ValueError(f"Unsupported source: {source_type}")

    async def run_source(self, source: str, *, trigger: str = "manual") -> dict[str, Any]:
        source_type = SOURCE_ALIASES.get(source.casefold(), source.casefold())
        from app.services.analysis_queue import is_automation_paused

        async with SessionLocal() as pause_session:
            if await is_automation_paused(pause_session):
                return {"source_type": source_type, "status": "skipped_paused"}
        lock_key = advisory_lock_key(f"technology-tracker:ingest:{source_type}")
        async with engine.connect() as lock_connection:
            acquired = bool(
                await lock_connection.scalar(text("SELECT pg_try_advisory_lock(:key)"), {"key": lock_key})
            )
            if not acquired:
                logger.info("Ingestion already running source=%s", source_type)
                return {"source_type": source_type, "status": "skipped_locked"}

            run_id = None
            try:
                async with SessionLocal() as session:
                    run = IngestionRun(source_type=source_type, trigger=trigger, status="running")
                    session.add(run)
                    await session.commit()
                    await session.refresh(run)
                    run_id = run.id

                ingestor = self._build_ingestor(source_type)
                stats: IngestStats = await ingestor.run()
                status = "completed" if not stats.errors else "partial"
                await self._finish_run(run_id, stats, status=status)
                from app.services.analysis_queue import enqueue_new_candidates

                async with SessionLocal() as session:
                    await enqueue_new_candidates(session)
                    await session.commit()
                return {
                    "run_id": str(run_id),
                    "source_type": source_type,
                    "status": status,
                    **asdict(stats),
                }
            except Exception as exc:  # noqa: BLE001
                logger.exception("Ingestion source failed source=%s", source_type)
                if run_id is not None:
                    failed = IngestStats(errors=[{"type": type(exc).__name__, "message": str(exc)[:2000]}])
                    await self._finish_run(run_id, failed, status="failed")
                raise
            finally:
                await lock_connection.execute(text("SELECT pg_advisory_unlock(:key)"), {"key": lock_key})

    async def run_all(self, *, trigger: str = "manual") -> list[dict[str, Any]]:
        results: list[dict[str, Any]] = []
        for source in ("rss", "openalex", "clinicaltrials", "sec"):
            try:
                results.append(await self.run_source(source, trigger=trigger))
            except Exception as exc:  # noqa: BLE001
                results.append(
                    {
                        "source_type": source,
                        "status": "failed",
                        "error": f"{type(exc).__name__}: {exc}",
                    }
                )
        return results

    @staticmethod
    async def _finish_run(run_id, stats: IngestStats, *, status: str) -> None:
        async with SessionLocal() as session:
            run = await session.get(IngestionRun, run_id)
            if run is None:
                return
            run.status = status
            run.finished_at = utcnow()
            run.queries_total = stats.queries_total
            run.queries_succeeded = stats.queries_succeeded
            run.records_seen = stats.records_seen
            run.records_inserted = stats.records_inserted
            run.records_updated = stats.records_updated
            run.records_linked = stats.records_linked
            run.records_skipped = stats.records_skipped
            run.error_count = len(stats.errors)
            run.errors = stats.errors
            run.details = stats.details
            await session.commit()
