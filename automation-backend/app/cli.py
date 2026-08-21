from __future__ import annotations

import argparse
import asyncio
import json

from app.config import get_settings
from app.db import SessionLocal
from app.logging_config import configure_logging
from app.seed import seed_database
from app.services.ingestion import IngestionCoordinator


async def _seed() -> None:
    settings = get_settings()
    async with SessionLocal() as session:
        result = await seed_database(session, settings)
    print(json.dumps(result, ensure_ascii=False))


async def _ingest(source: str) -> None:
    coordinator = IngestionCoordinator(get_settings())
    result = (
        await coordinator.run_all(trigger="manual")
        if source == "all"
        else await coordinator.run_source(source, trigger="manual")
    )
    print(json.dumps(result, ensure_ascii=False, default=str, indent=2))


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="technology-tracker")
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("seed", help="Seed curated technologies and source queries")
    ingest = subparsers.add_parser("ingest", help="Run source ingestion")
    ingest.add_argument(
        "--source",
        choices=["all", "rss", "news", "paper", "trial", "filing", "openalex", "clinicaltrials", "sec"],
        default="all",
    )
    return parser


def main() -> None:
    settings = get_settings()
    configure_logging(settings.log_level)
    args = build_parser().parse_args()
    if args.command == "seed":
        asyncio.run(_seed())
    elif args.command == "ingest":
        asyncio.run(_ingest(args.source))


if __name__ == "__main__":
    main()
