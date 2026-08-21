from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(slots=True)
class IngestStats:
    queries_total: int = 0
    queries_succeeded: int = 0
    records_seen: int = 0
    records_inserted: int = 0
    records_updated: int = 0
    records_linked: int = 0
    records_skipped: int = 0
    errors: list[dict[str, Any]] = field(default_factory=list)
    details: dict[str, Any] = field(default_factory=dict)

    def add_error(self, *, query_key: str, message: str, error_type: str) -> None:
        self.errors.append({"query_key": query_key, "type": error_type, "message": message[:2000]})

    def merge(self, other: IngestStats) -> None:
        self.queries_total += other.queries_total
        self.queries_succeeded += other.queries_succeeded
        self.records_seen += other.records_seen
        self.records_inserted += other.records_inserted
        self.records_updated += other.records_updated
        self.records_linked += other.records_linked
        self.records_skipped += other.records_skipped
        self.errors.extend(other.errors)
        self.details.update(other.details)
