from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


class HealthResponse(BaseModel):
    status: str
    database: str
    time: datetime


class TechnologyListResponse(BaseModel):
    items: list[dict[str, Any]]
    count: int
    ingestion: dict[str, Any] = Field(default_factory=dict)


class FactClaim(BaseModel):
    claim: str = Field(min_length=1, max_length=2_000)
    source_urls: list[str] = Field(min_length=1, max_length=4)


class RelationshipClaim(BaseModel):
    technology_id: str = Field(min_length=1, max_length=120)
    type: Literal["direct", "system", "inferred"]
    reason: str = Field(min_length=1, max_length=2_000)


class AnalysisPayload(BaseModel):
    event_type: Literal["regulatory", "clinical", "research", "operations", "financial", "other"]
    materiality: Literal["critical", "high", "medium", "low", "none"]
    confidence: Literal["high", "medium", "low"]
    facts: list[FactClaim] = Field(default_factory=list, max_length=20)
    unknowns: list[str] = Field(default_factory=list, max_length=20)
    relationships: list[RelationshipClaim] = Field(default_factory=list, max_length=30)
    publish_decision: Literal["auto_publish", "review", "discard"]
    decision_reason: str = Field(min_length=1, max_length=3_000)
