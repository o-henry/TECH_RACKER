from __future__ import annotations

import asyncio
import logging
import signal

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from app.config import get_settings
from app.logging_config import configure_logging
from app.services.ingestion import IngestionCoordinator

logger = logging.getLogger(__name__)


async def serve() -> None:
    settings = get_settings()
    coordinator = IngestionCoordinator(settings)
    scheduler = AsyncIOScheduler(timezone=settings.scheduler_timezone)

    async def run_openalex() -> None:
        await coordinator.run_source("openalex", trigger="schedule")

    async def run_clinical_trials() -> None:
        await coordinator.run_source("clinicaltrials", trigger="schedule")

    async def run_sec() -> None:
        await coordinator.run_source("sec", trigger="schedule")

    async def run_rss() -> None:
        await coordinator.run_source("rss", trigger="schedule")

    job_defaults = {"coalesce": True, "max_instances": 1, "misfire_grace_time": 3600}
    scheduler.add_job(
        run_rss,
        CronTrigger.from_crontab(settings.rss_cron, timezone=settings.scheduler_timezone),
        id="rss",
        replace_existing=True,
        **job_defaults,
    )
    scheduler.add_job(
        run_openalex,
        CronTrigger.from_crontab(settings.openalex_cron, timezone=settings.scheduler_timezone),
        id="openalex",
        replace_existing=True,
        **job_defaults,
    )
    scheduler.add_job(
        run_clinical_trials,
        CronTrigger.from_crontab(settings.clinical_trials_cron, timezone=settings.scheduler_timezone),
        id="clinicaltrials",
        replace_existing=True,
        **job_defaults,
    )
    scheduler.add_job(
        run_sec,
        CronTrigger.from_crontab(settings.sec_cron, timezone=settings.scheduler_timezone),
        id="sec",
        replace_existing=True,
        **job_defaults,
    )
    scheduler.start()
    logger.info(
        "Scheduler started timezone=%s rss=%s openalex=%s clinicaltrials=%s sec=%s",
        settings.scheduler_timezone,
        settings.rss_cron,
        settings.openalex_cron,
        settings.clinical_trials_cron,
        settings.sec_cron,
    )

    if settings.scheduler_run_on_startup:
        asyncio.create_task(coordinator.run_all(trigger="startup"))

    stop_event = asyncio.Event()
    loop = asyncio.get_running_loop()
    for signame in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(signame, stop_event.set)
        except NotImplementedError:
            pass
    await stop_event.wait()
    scheduler.shutdown(wait=False)


def main() -> None:
    settings = get_settings()
    configure_logging(settings.log_level)
    asyncio.run(serve())


if __name__ == "__main__":
    main()
