from __future__ import annotations

import json
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.seed import flatten_tracking_queries, load_tracking_config



def main() -> None:
    seed_path = ROOT / "seed" / "technologies.json"
    config_path = ROOT / "config" / "tracking.yml"
    technologies = json.loads(seed_path.read_text(encoding="utf-8"))
    config = load_tracking_config(config_path)
    ids = [technology["id"] for technology in technologies]
    if len(ids) != len(set(ids)):
        raise SystemExit("Duplicate technology IDs in seed data")
    tracked_ids = [technology["id"] for technology in config["technologies"]]
    if set(ids) != set(tracked_ids):
        raise SystemExit(
            f"Technology IDs differ: seed_only={sorted(set(ids) - set(tracked_ids))}, "
            f"config_only={sorted(set(tracked_ids) - set(ids))}"
        )
    rows = flatten_tracking_queries(config)
    query_keys = [(row["technology_id"], row["source_type"], row["query_key"]) for row in rows]
    if len(query_keys) != len(set(query_keys)):
        raise SystemExit("Duplicate source query keys")
    source_counts = Counter(row["source_type"] for row in rows)
    report = {
        "technologies": len(technologies),
        "queries": len(rows),
        "queries_by_source": dict(source_counts),
        "curated_sources": sum(len(technology.get("sources") or []) for technology in technologies),
        "curated_events": sum(len(technology.get("timeline") or []) for technology in technologies),
    }
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
