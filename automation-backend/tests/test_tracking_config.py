from __future__ import annotations

import json
from pathlib import Path

from app.seed import flatten_tracking_queries, load_tracking_config

ROOT = Path(__file__).resolve().parents[1]


def test_tracking_config_covers_seed_technologies() -> None:
    seed = json.loads((ROOT / "seed" / "technologies.json").read_text(encoding="utf-8"))
    config = load_tracking_config(ROOT / "config" / "tracking.yml")
    assert {item["id"] for item in seed} == {item["id"] for item in config["technologies"]}


def test_every_technology_has_a_paper_query() -> None:
    config = load_tracking_config(ROOT / "config" / "tracking.yml")
    for technology in config["technologies"]:
        assert technology.get("openalex"), technology["id"]


def test_flattened_query_keys_are_unique() -> None:
    config = load_tracking_config(ROOT / "config" / "tracking.yml")
    rows = flatten_tracking_queries(config)
    keys = [(row["technology_id"], row["source_type"], row["query_key"]) for row in rows]
    assert len(keys) == len(set(keys))
    assert any(row["source_type"] == "clinicaltrials" for row in rows)
    assert any(row["source_type"] == "sec" for row in rows)
