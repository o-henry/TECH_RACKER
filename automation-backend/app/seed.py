from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import yaml
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.models import Technology, TechnologyQuery
from app.utils import parse_date


def load_tracking_config(path: Path) -> dict[str, Any]:
    payload = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    if not isinstance(payload, dict) or not isinstance(payload.get("technologies"), list):
        raise ValueError(f"Invalid tracking configuration: {path}")
    return payload


def flatten_tracking_queries(config: dict[str, Any]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for technology in config.get("technologies", []):
        technology_id = technology["id"]
        for source_key, source_type in (
            ("openalex", "openalex"),
            ("clinical_trials", "clinicaltrials"),
            ("sec", "sec"),
        ):
            for index, query in enumerate(technology.get(source_key) or []):
                query_key = str(query.get("key") or f"{source_type}-{index + 1}")
                query_text = query.get("search") or query.get("query") or query.get("ticker")
                rows.append(
                    {
                        "technology_id": technology_id,
                        "source_type": source_type,
                        "query_key": query_key,
                        "query_text": query_text,
                        "config": query,
                        "enabled": bool(query.get("enabled", True)),
                    }
                )
    return rows


async def seed_database(session: AsyncSession, settings: Settings) -> dict[str, int]:
    technologies = json.loads(settings.seed_data_path.read_text(encoding="utf-8"))
    tracking_config = load_tracking_config(settings.tracking_config_path)
    tracking_ids = {item["id"] for item in tracking_config["technologies"]}
    technology_ids = {item["id"] for item in technologies}
    missing = tracking_ids - technology_ids
    if missing:
        raise ValueError(f"Tracking configuration references missing technology IDs: {sorted(missing)}")

    for snapshot in technologies:
        statement = insert(Technology).values(
            id=snapshot["id"],
            name=snapshot["name"],
            name_en=snapshot.get("nameEn") or snapshot["name"],
            category=snapshot.get("category") or "기타",
            verified_at=parse_date(snapshot.get("verifiedAt")),
            snapshot=snapshot,
            enabled=True,
        )
        statement = statement.on_conflict_do_update(
            index_elements=[Technology.id],
            set_={
                "name": snapshot["name"],
                "name_en": snapshot.get("nameEn") or snapshot["name"],
                "category": snapshot.get("category") or "기타",
                "verified_at": parse_date(snapshot.get("verifiedAt")),
                "snapshot": snapshot,
                "enabled": True,
            },
        )
        await session.execute(statement)

    query_rows = flatten_tracking_queries(tracking_config)
    active_keys = {(row["technology_id"], row["source_type"], row["query_key"]) for row in query_rows}
    existing_queries = list((await session.scalars(select(TechnologyQuery))).all())
    for existing in existing_queries:
        key = (existing.technology_id, existing.source_type, existing.query_key)
        if key not in active_keys:
            existing.enabled = False

    for row in query_rows:
        statement = insert(TechnologyQuery).values(**row)
        statement = statement.on_conflict_do_update(
            constraint="uq_technology_query",
            set_={
                "query_text": row["query_text"],
                "config": row["config"],
                "enabled": row["enabled"],
            },
        )
        await session.execute(statement)

    await session.commit()
    return {"technologies": len(technologies), "queries": len(query_rows)}
