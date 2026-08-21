from __future__ import annotations

import logging
from datetime import date, datetime, timedelta
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
    upsert_paper_record,
    upsert_source_document,
)
from app.utils import (
    date_as_utc_datetime,
    keyword_score,
    parse_date,
    parse_datetime,
    reconstruct_abstract,
    stable_json_hash,
    utcnow,
)

logger = logging.getLogger(__name__)
OPENALEX_WORKS_URL = "https://api.openalex.org/works"


def normalize_openalex_work(work: dict[str, Any]) -> dict[str, Any]:
    openalex_url = str(work.get("id") or "")
    openalex_id = openalex_url.rsplit("/", 1)[-1]
    title = str(work.get("display_name") or work.get("title") or "제목 없음").strip()
    abstract = reconstruct_abstract(work.get("abstract_inverted_index"))
    publication_date = parse_date(work.get("publication_date"))
    primary_location = work.get("primary_location") or {}
    source = primary_location.get("source") or {}
    venue = source.get("display_name")
    doi = work.get("doi")
    canonical_url = primary_location.get("landing_page_url") or doi or openalex_url

    authors: list[dict[str, Any]] = []
    institution_map: dict[str, dict[str, Any]] = {}
    for authorship in work.get("authorships") or []:
        author = authorship.get("author") or {}
        authors.append(
            {
                "id": author.get("id"),
                "name": author.get("display_name"),
                "position": authorship.get("author_position"),
            }
        )
        for institution in authorship.get("institutions") or []:
            key = str(institution.get("id") or institution.get("display_name") or "")
            if key:
                institution_map[key] = {
                    "id": institution.get("id"),
                    "name": institution.get("display_name"),
                    "country_code": institution.get("country_code"),
                    "type": institution.get("type"),
                }

    return {
        "external_id": openalex_id,
        "openalex_id": openalex_id,
        "canonical_url": canonical_url,
        "title": title,
        "publisher": venue or "OpenAlex",
        "published_at": date_as_utc_datetime(publication_date),
        "source_updated_at": parse_datetime(work.get("updated_date")),
        "content_hash": stable_json_hash(work),
        "metadata_json": {
            "doi": doi,
            "work_type": work.get("type"),
            "cited_by_count": int(work.get("cited_by_count") or 0),
            "venue": venue,
            "open_access": work.get("open_access") or {},
            "is_retracted": bool(work.get("is_retracted")),
            "concepts": [
                {"id": concept.get("id"), "name": concept.get("display_name"), "score": concept.get("score")}
                for concept in (work.get("concepts") or [])[:12]
            ],
        },
        "raw_payload": work,
        "text_content": abstract,
        "paper_values": {
            "openalex_id": openalex_id,
            "doi": doi,
            "publication_date": publication_date,
            "work_type": work.get("type"),
            "cited_by_count": int(work.get("cited_by_count") or 0),
            "venue": venue,
            "authors": authors,
            "institutions": list(institution_map.values()),
            "abstract": abstract,
            "is_retracted": bool(work.get("is_retracted")),
        },
    }


class OpenAlexIngestor:
    source_type = "openalex"

    def __init__(self, settings: Settings, session_factory: async_sessionmaker) -> None:
        self.settings = settings
        self.session_factory = session_factory

    async def _from_date(self, query: TechnologyQuery) -> date:
        async with self.session_factory() as session:
            state = await get_sync_state(session, f"openalex:{query.id}")
        days = self.settings.openalex_lookback_days if state else self.settings.openalex_initial_lookback_days
        return (utcnow() - timedelta(days=days)).date()

    async def run(self) -> IngestStats:
        stats = IngestStats()
        async with self.session_factory() as session:
            queries = await load_enabled_queries(session, self.source_type)
        stats.queries_total = len(queries)

        headers = {"User-Agent": f"TechnologyTracker/0.2 ({self.settings.openalex_mailto})"}
        async with SourceHttpClient(
            headers=headers,
            timeout_seconds=self.settings.http_timeout_seconds,
            max_retries=self.settings.http_max_retries,
            requests_per_second=5,
        ) as client:
            for query in queries:
                try:
                    await self._run_query(client, query, stats)
                    stats.queries_succeeded += 1
                except Exception as exc:  # noqa: BLE001
                    logger.exception("OpenAlex query failed query=%s", query.query_key)
                    stats.add_error(query_key=query.query_key, message=str(exc), error_type=type(exc).__name__)
        return stats

    async def _run_query(
        self,
        client: SourceHttpClient,
        query: TechnologyQuery,
        stats: IngestStats,
    ) -> None:
        config = query.config or {}
        search = str(config.get("search") or query.query_text or "").strip()
        if not search:
            raise ValueError("OpenAlex query has no search text")
        include_terms = [str(value) for value in config.get("include_terms") or []]
        exclude_terms = [str(value) for value in config.get("exclude_terms") or []]
        min_score = float(config.get("min_score", 0.2))
        from_date = await self._from_date(query)
        cursor = "*"
        newest_update: datetime | None = None

        for page in range(self.settings.openalex_max_pages_per_query):
            params: dict[str, Any] = {
                "search": search,
                "filter": f"from_publication_date:{from_date.isoformat()}",
                "sort": "publication_date:desc,relevance_score:desc",
                "per-page": self.settings.openalex_page_size,
                "cursor": cursor,
                "mailto": self.settings.openalex_mailto,
            }
            if self.settings.openalex_api_key:
                params["api_key"] = self.settings.openalex_api_key
            payload = await client.get_json(OPENALEX_WORKS_URL, params=params)
            results = payload.get("results") or []
            if not isinstance(results, list):
                raise ValueError("OpenAlex results is not a list")
            if not results:
                break

            async with self.session_factory() as session:
                for work in results:
                    stats.records_seen += 1
                    normalized = normalize_openalex_work(work)
                    score, matched, excluded = keyword_score(
                        normalized["title"], normalized.get("text_content") or "", include_terms, exclude_terms
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
                    await upsert_paper_record(session, result.document_id, normalized["paper_values"])
                    linked = await link_document_to_technology(
                        session,
                        document_id=result.document_id,
                        technology_id=query.technology_id,
                        query_id=query.id,
                        relevance_score=score,
                        matched_terms=matched,
                        link_reason=f"OpenAlex search: {search}",
                    )
                    stats.records_inserted += int(result.inserted)
                    stats.records_updated += int(result.updated)
                    stats.records_linked += int(linked)
                    updated = normalized["source_updated_at"]
                    if updated and (newest_update is None or updated > newest_update):
                        newest_update = updated
                await session.commit()

            next_cursor = (payload.get("meta") or {}).get("next_cursor")
            if not next_cursor or next_cursor == cursor:
                break
            cursor = str(next_cursor)

        async with self.session_factory() as session:
            await set_sync_state(
                session,
                f"openalex:{query.id}",
                self.source_type,
                {
                    "last_success_at": utcnow().isoformat(),
                    "from_publication_date": from_date.isoformat(),
                    "newest_source_update": newest_update.isoformat() if newest_update else None,
                },
            )
            await session.commit()
