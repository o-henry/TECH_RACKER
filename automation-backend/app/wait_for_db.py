from __future__ import annotations

import asyncio
import logging

from sqlalchemy import text

from app.config import get_settings
from app.db import engine
from app.logging_config import configure_logging


async def wait_for_database(attempts: int = 60, delay_seconds: float = 2.0) -> None:
    for attempt in range(1, attempts + 1):
        try:
            async with engine.connect() as connection:
                await connection.execute(text("SELECT 1"))
            logging.getLogger(__name__).info("Database is ready")
            return
        except Exception as exc:  # noqa: BLE001
            if attempt >= attempts:
                raise
            logging.getLogger(__name__).warning(
                "Database not ready attempt=%s/%s error=%s", attempt, attempts, exc
            )
            await asyncio.sleep(delay_seconds)


if __name__ == "__main__":
    configure_logging(get_settings().log_level)
    asyncio.run(wait_for_database())
