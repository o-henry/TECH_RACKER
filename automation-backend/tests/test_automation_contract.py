from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.api import app
from app.ingestors.rss import _parse_entries
from app.schemas import AnalysisPayload


def test_rss_parser_accepts_rss_and_removes_html() -> None:
    entries = _parse_entries(
        """<?xml version="1.0"?>
        <rss><channel><item><guid>event-1</guid><title>Phase 3 result</title>
        <link>https://example.org/event-1</link><pubDate>2026-08-21T01:00:00Z</pubDate>
        <description><![CDATA[<p>Primary result published.</p><script>ignore()</script>]]></description>
        </item></channel></rss>"""
    )
    assert entries == [
        {
            "title": "Phase 3 result",
            "link": "https://example.org/event-1",
            "id": "event-1",
            "published": "2026-08-21T01:00:00Z",
            "summary": "Primary result published.",
        }
    ]


def test_analysis_schema_rejects_unbounded_or_unlabeled_output() -> None:
    with pytest.raises(ValidationError):
        AnalysisPayload.model_validate(
            {
                "event_type": "clinical",
                "materiality": "certain-success",
                "confidence": "high",
                "facts": [],
                "unknowns": [],
                "relationships": [],
                "publish_decision": "auto_publish",
                "decision_reason": "unsupported",
            }
        )


def test_private_routes_fail_closed_without_server_secrets() -> None:
    with TestClient(app) as client:
        admin = client.get("/api/v1/admin/automation/status")
        mcp = client.post("/mcp")
    assert admin.status_code in {401, 503}
    assert mcp.status_code == 503
