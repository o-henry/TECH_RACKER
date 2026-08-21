from __future__ import annotations

import logging
from datetime import date, timedelta
from typing import Any

from sqlalchemy.ext.asyncio import async_sessionmaker

from app.config import Settings
from app.http_client import SourceHttpClient
from app.ingestors.common import IngestStats
from app.models import TechnologyQuery
from app.repository import (
    get_sync_state,
    link_document_to_technology,
    load_enabled_queries,
    set_sync_state,
    upsert_clinical_trial_record,
    upsert_source_document,
)
from app.utils import (
    date_as_utc_datetime,
    keyword_score,
    normalize_space,
    parse_date,
    stable_json_hash,
    utcnow,
)

logger = logging.getLogger(__name__)
CLINICAL_TRIALS_STUDIES_URL = "https://clinicaltrials.gov/api/v2/studies"


def _date_from_struct(value: dict[str, Any] | None) -> date | None:
    return parse_date((value or {}).get("date"))


def normalize_clinical_trial(study: dict[str, Any]) -> dict[str, Any]:
    protocol = study.get("protocolSection") or {}
    identification = protocol.get("identificationModule") or {}
    status = protocol.get("statusModule") or {}
    design = protocol.get("designModule") or {}
    conditions_module = protocol.get("conditionsModule") or {}
    interventions_module = protocol.get("armsInterventionsModule") or {}
    sponsors = protocol.get("sponsorCollaboratorsModule") or {}
    contacts = protocol.get("contactsLocationsModule") or {}
    description = protocol.get("descriptionModule") or {}

    nct_id = str(identification.get("nctId") or "").strip()
    title = str(
        identification.get("briefTitle") or identification.get("officialTitle") or nct_id or "제목 없음"
    ).strip()
    last_update = _date_from_struct(status.get("lastUpdatePostDateStruct"))
    study_first_post = _date_from_struct(status.get("studyFirstPostDateStruct"))
    lead_sponsor = (sponsors.get("leadSponsor") or {}).get("name")
    interventions = [
        {
            "type": item.get("type"),
            "name": item.get("name"),
            "description": normalize_space(item.get("description"))[:2000] or None,
        }
        for item in interventions_module.get("interventions") or []
    ]
    locations = [
        {
            "facility": location.get("facility"),
            "city": location.get("city"),
            "state": location.get("state"),
            "country": location.get("country"),
            "status": location.get("status"),
        }
        for location in (contacts.get("locations") or [])[:200]
    ]
    summary_parts = [
        description.get("briefSummary"),
        description.get("detailedDescription"),
        " ".join(conditions_module.get("conditions") or []),
        " ".join(str(item.get("name") or "") for item in interventions),
    ]
    text_content = normalize_space(" ".join(str(part or "") for part in summary_parts))
    enrollment_info = design.get("enrollmentInfo") or {}

    return {
        "external_id": nct_id,
        "canonical_url": f"https://clinicaltrials.gov/study/{nct_id}",
        "title": title,
        "publisher": lead_sponsor or "ClinicalTrials.gov",
        "published_at": date_as_utc_datetime(study_first_post),
        "source_updated_at": date_as_utc_datetime(last_update),
        "content_hash": stable_json_hash(study),
        "metadata_json": {
            "nct_id": nct_id,
            "overall_status": status.get("overallStatus"),
            "phases": design.get("phases") or [],
            "enrollment": enrollment_info.get("count"),
            "sponsor": lead_sponsor,
            "conditions": conditions_module.get("conditions") or [],
            "has_results": bool(study.get("hasResults")),
        },
        "raw_payload": study,
        "text_content": text_content,
        "trial_values": {
            "nct_id": nct_id,
            "overall_status": status.get("overallStatus"),
            "phases": design.get("phases") or [],
            "enrollment": enrollment_info.get("count"),
            "sponsor": lead_sponsor,
            "study_type": design.get("studyType"),
            "conditions": conditions_module.get("conditions") or [],
            "interventions": interventions,
            "locations": locations,
            "start_date": _date_from_struct(status.get("startDateStruct")),
            "primary_completion_date": _date_from_struct(status.get("primaryCompletionDateStruct")),
            "completion_date": _date_from_struct(status.get("completionDateStruct")),
            "last_update_post_date": last_update,
            "has_results": bool(study.get("hasResults")),
        },
    }


class ClinicalTrialsIngestor:
    source_type = "clinicaltrials"

    def __init__(self, settings: Settings, session_factory: async_sessionmaker) -> None:
        self.settings = settings
        self.session_factory = session_factory

    async def _from_date(self, query: TechnologyQuery) -> date:
        async with self.session_factory() as session:
            state = await get_sync_state(session, f"clinicaltrials:{query.id}")
        days = (
            self.settings.clinical_trials_lookback_days
            if state
            else self.settings.clinical_trials_initial_lookback_days
        )
        return (utcnow() - timedelta(days=days)).date()

    async def run(self) -> IngestStats:
        stats = IngestStats()
        async with self.session_factory() as session:
            queries = await load_enabled_queries(session, self.source_type)
        stats.queries_total = len(queries)

        async with SourceHttpClient(
            headers={"User-Agent": "TechnologyTracker/0.2"},
            timeout_seconds=self.settings.http_timeout_seconds,
            max_retries=self.settings.http_max_retries,
            requests_per_second=4,
        ) as client:
            for query in queries:
                try:
                    await self._run_query(client, query, stats)
                    stats.queries_succeeded += 1
                except Exception as exc:  # noqa: BLE001
                    logger.exception("ClinicalTrials.gov query failed query=%s", query.query_key)
                    stats.add_error(query_key=query.query_key, message=str(exc), error_type=type(exc).__name__)
        return stats

    async def _run_query(
        self,
        client: SourceHttpClient,
        query: TechnologyQuery,
        stats: IngestStats,
    ) -> None:
        config = query.config or {}
        search = str(config.get("query") or query.query_text or "").strip()
        if not search:
            raise ValueError("ClinicalTrials.gov query has no query text")
        include_terms = [str(value) for value in config.get("include_terms") or []]
        exclude_terms = [str(value) for value in config.get("exclude_terms") or []]
        min_score = float(config.get("min_score", 0.2))
        from_date = await self._from_date(query)
        page_token: str | None = None
        newest_update: date | None = None

        for _ in range(self.settings.clinical_trials_max_pages_per_query):
            params: dict[str, Any] = {
                "format": "json",
                "query.term": search,
                "pageSize": self.settings.clinical_trials_page_size,
                "sort": "LastUpdatePostDate:desc",
                "countTotal": "true",
            }
            if page_token:
                params["pageToken"] = page_token
            payload = await client.get_json(CLINICAL_TRIALS_STUDIES_URL, params=params)
            studies = payload.get("studies") or []
            if not isinstance(studies, list):
                raise ValueError("ClinicalTrials.gov studies is not a list")
            if not studies:
                break

            reached_old_records = False
            async with self.session_factory() as session:
                for study in studies:
                    stats.records_seen += 1
                    normalized = normalize_clinical_trial(study)
                    update_date = normalized["trial_values"]["last_update_post_date"]
                    if update_date and update_date < from_date:
                        reached_old_records = True
                        continue
                    score, matched, excluded = keyword_score(
                        normalized["title"], normalized["text_content"], include_terms, exclude_terms
                    )
                    if excluded or score < min_score:
                        stats.records_skipped += 1
                        continue
                    result = await upsert_source_document(
                        session,
                        source_type=self.source_type,
                        external_id=normalized["external_id"],
                        canonical_url=normalized["canonical_url"],
                        title=normalized["title"],
                        publisher=normalized["publisher"],
                        published_at=normalized["published_at"],
                        source_updated_at=normalized["source_updated_at"],
                        content_hash=normalized["content_hash"],
                        metadata_json=normalized["metadata_json"],
                        raw_payload=normalized["raw_payload"],
                        text_content=normalized["text_content"],
                    )
                    await upsert_clinical_trial_record(session, result.document_id, normalized["trial_values"])
                    linked = await link_document_to_technology(
                        session,
                        document_id=result.document_id,
                        technology_id=query.technology_id,
                        query_id=query.id,
                        relevance_score=score,
                        matched_terms=matched,
                        link_reason=f"ClinicalTrials.gov query: {search}",
                    )
                    stats.records_inserted += int(result.inserted)
                    stats.records_updated += int(result.updated)
                    stats.records_linked += int(linked)
                    if update_date and (newest_update is None or update_date > newest_update):
                        newest_update = update_date
                await session.commit()

            page_token = payload.get("nextPageToken")
            if reached_old_records or not page_token:
                break

        async with self.session_factory() as session:
            await set_sync_state(
                session,
                f"clinicaltrials:{query.id}",
                self.source_type,
                {
                    "last_success_at": utcnow().isoformat(),
                    "from_last_update_post_date": from_date.isoformat(),
                    "newest_last_update_post_date": newest_update.isoformat() if newest_update else None,
                },
            )
            await session.commit()
