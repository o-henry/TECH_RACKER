from __future__ import annotations

import logging
from collections import defaultdict
from datetime import date, timedelta
from typing import Any
from urllib.parse import urljoin

from bs4 import BeautifulSoup
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
    upsert_sec_company,
    upsert_sec_filing_record,
    upsert_source_document,
)
from app.utils import (
    date_as_utc_datetime,
    html_to_text,
    keyword_score,
    normalize_space,
    parse_date,
    safe_snippet,
    text_hash,
    utcnow,
)

logger = logging.getLogger(__name__)
SEC_TICKERS_URL = "https://www.sec.gov/files/company_tickers.json"
SEC_SUBMISSIONS_URL = "https://data.sec.gov/submissions/CIK{cik}.json"
SEC_ARCHIVES_BASE = "https://www.sec.gov/Archives/edgar/data/"


def normalize_ticker_map(payload: dict[str, Any]) -> dict[str, dict[str, str]]:
    mapping: dict[str, dict[str, str]] = {}
    for item in payload.values():
        ticker = str(item.get("ticker") or "").upper().strip()
        cik = str(item.get("cik_str") or "").zfill(10)
        if ticker and cik.strip("0"):
            mapping[ticker] = {
                "ticker": ticker,
                "cik": cik,
                "company_name": str(item.get("title") or ticker),
            }
    return mapping


def iter_recent_filings(submissions: dict[str, Any]) -> list[dict[str, Any]]:
    recent = ((submissions.get("filings") or {}).get("recent") or submissions)
    accession_numbers = recent.get("accessionNumber") or []
    rows: list[dict[str, Any]] = []
    for index, accession in enumerate(accession_numbers):
        row: dict[str, Any] = {}
        for key, values in recent.items():
            row[key] = values[index] if isinstance(values, list) and index < len(values) else None
        row["accessionNumber"] = accession
        rows.append(row)
    return rows


def parse_filing_index(index_html: str, base_url: str) -> list[dict[str, str]]:
    soup = BeautifulSoup(index_html, "html.parser")
    documents: list[dict[str, str]] = []
    for table in soup.select("table.tableFile"):
        for row in table.select("tr"):
            cells = row.find_all("td")
            if len(cells) < 4:
                continue
            link = cells[2].find("a", href=True)
            if not link:
                continue
            documents.append(
                {
                    "sequence": normalize_space(cells[0].get_text(" ")),
                    "description": normalize_space(cells[1].get_text(" ")),
                    "url": urljoin(base_url, link["href"]),
                    "document": normalize_space(link.get_text(" ")),
                    "type": normalize_space(cells[3].get_text(" ")),
                }
            )
    return documents


class SecIngestor:
    source_type = "sec"

    def __init__(self, settings: Settings, session_factory: async_sessionmaker) -> None:
        self.settings = settings
        self.session_factory = session_factory

    async def run(self) -> IngestStats:
        stats = IngestStats()
        async with self.session_factory() as session:
            queries = await load_enabled_queries(session, self.source_type)
        stats.queries_total = len(queries)

        identity = self.settings.sec_user_agent.strip()
        if "@" not in identity or "example.com" in identity.casefold():
            stats.add_error(
                query_key="sec-user-agent",
                message=(
                    "Set SEC_USER_AGENT to an identifiable application/organization and real contact email "
                    "before SEC ingestion."
                ),
                error_type="ConfigurationError",
            )
            return stats
        grouped: dict[str, list[TechnologyQuery]] = defaultdict(list)
        for query in queries:
            ticker = str((query.config or {}).get("ticker") or query.query_text or "").upper().strip()
            if ticker:
                grouped[ticker].append(query)
            else:
                stats.add_error(query_key=query.query_key, message="Missing ticker", error_type="ConfigurationError")

        headers = {
            "User-Agent": self.settings.sec_user_agent,
            "Accept-Encoding": "gzip, deflate",
            "Host": "www.sec.gov",
        }
        # Host is removed for data.sec.gov requests by httpx; User-Agent remains the important identity header.
        headers.pop("Host", None)
        async with SourceHttpClient(
            headers=headers,
            timeout_seconds=self.settings.http_timeout_seconds,
            max_retries=self.settings.http_max_retries,
            requests_per_second=self.settings.sec_requests_per_second,
        ) as client:
            ticker_map = normalize_ticker_map(await client.get_json(SEC_TICKERS_URL))
            for ticker, ticker_queries in grouped.items():
                company = ticker_map.get(ticker)
                if not company:
                    for query in ticker_queries:
                        stats.add_error(
                            query_key=query.query_key,
                            message=f"Ticker not present in SEC company_tickers.json: {ticker}",
                            error_type="TickerResolutionError",
                        )
                    continue
                try:
                    succeeded = await self._run_company(client, company, ticker_queries, stats)
                    stats.queries_succeeded += succeeded
                except Exception as exc:  # noqa: BLE001
                    logger.exception("SEC company ingestion failed ticker=%s", ticker)
                    for query in ticker_queries:
                        stats.add_error(query_key=query.query_key, message=str(exc), error_type=type(exc).__name__)
        return stats

    async def _company_from_date(self, ticker: str) -> date:
        async with self.session_factory() as session:
            state = await get_sync_state(session, f"sec:{ticker}")
        days = self.settings.sec_lookback_days if state else self.settings.sec_initial_lookback_days
        return (utcnow() - timedelta(days=days)).date()

    async def _run_company(
        self,
        client: SourceHttpClient,
        company: dict[str, str],
        queries: list[TechnologyQuery],
        stats: IngestStats,
    ) -> int:
        ticker = company["ticker"]
        cik = company["cik"]
        from_date = await self._company_from_date(ticker)
        submissions = await client.get_json(SEC_SUBMISSIONS_URL.format(cik=cik))
        filings = iter_recent_filings(submissions)
        additional_files = ((submissions.get("filings") or {}).get("files") or [])
        for additional in additional_files:
            filing_to = parse_date(additional.get("filingTo"))
            filing_from = parse_date(additional.get("filingFrom"))
            if filing_to and filing_to < from_date:
                continue
            name = str(additional.get("name") or "").strip()
            if not name:
                continue
            payload = await client.get_json(f"https://data.sec.gov/submissions/{name}")
            filings.extend(iter_recent_filings(payload))
            if filing_from and filing_from <= from_date:
                break

        unique_filings: dict[str, dict[str, Any]] = {}
        for filing in filings:
            accession = str(filing.get("accessionNumber") or "")
            if accession:
                unique_filings[accession] = filing
        filings = sorted(
            unique_filings.values(),
            key=lambda item: str(item.get("filingDate") or ""),
            reverse=True,
        )[: self.settings.sec_max_filings_per_company]
        latest_date: date | None = None

        async with self.session_factory() as session:
            await upsert_sec_company(
                session,
                ticker=ticker,
                cik=cik,
                company_name=company["company_name"],
            )
            await session.commit()

        for filing in filings:
            filing_date = parse_date(filing.get("filingDate"))
            if filing_date and filing_date < from_date:
                continue
            form = str(filing.get("form") or "")
            applicable = [query for query in queries if form in set((query.config or {}).get("forms") or [])]
            if not applicable:
                continue
            stats.records_seen += 1
            try:
                filing_payload = await self._fetch_filing(client, company, filing, applicable)
            except Exception as exc:  # noqa: BLE001
                for query in applicable:
                    stats.add_error(query_key=query.query_key, message=str(exc), error_type=type(exc).__name__)
                continue
            if filing_payload is None:
                stats.records_skipped += 1
                continue

            normalized, matches = filing_payload
            async with self.session_factory() as session:
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
                await upsert_sec_filing_record(session, result.document_id, normalized["filing_values"])
                for query, score, matched_terms in matches:
                    linked = await link_document_to_technology(
                        session,
                        document_id=result.document_id,
                        technology_id=query.technology_id,
                        query_id=query.id,
                        relevance_score=score,
                        matched_terms=matched_terms,
                        link_reason=f"SEC {ticker} {form} keyword match",
                    )
                    stats.records_linked += int(linked)
                await session.commit()
                stats.records_inserted += int(result.inserted)
                stats.records_updated += int(result.updated)
            if filing_date and (latest_date is None or filing_date > latest_date):
                latest_date = filing_date

        async with self.session_factory() as session:
            await set_sync_state(
                session,
                f"sec:{ticker}",
                self.source_type,
                {
                    "last_success_at": utcnow().isoformat(),
                    "from_filing_date": from_date.isoformat(),
                    "newest_filing_date": latest_date.isoformat() if latest_date else None,
                    "cik": cik,
                },
            )
            await session.commit()
        return len(queries)

    async def _fetch_filing(
        self,
        client: SourceHttpClient,
        company: dict[str, str],
        filing: dict[str, Any],
        queries: list[TechnologyQuery],
    ) -> tuple[dict[str, Any], list[tuple[TechnologyQuery, float, list[str]]]] | None:
        accession = str(filing.get("accessionNumber") or "")
        primary_document = str(filing.get("primaryDocument") or "")
        if not accession or not primary_document:
            return None
        cik_int = str(int(company["cik"]))
        accession_compact = accession.replace("-", "")
        directory_url = f"{SEC_ARCHIVES_BASE}{cik_int}/{accession_compact}/"
        primary_url = urljoin(directory_url, primary_document)
        form = str(filing.get("form") or "")
        primary_text = ""
        exhibits: list[dict[str, Any]] = []

        if self.settings.sec_fetch_documents:
            primary_html = await client.get_text(
                primary_url, max_bytes=self.settings.sec_max_document_bytes
            )
            primary_text = html_to_text(primary_html, max_chars=1_000_000)

        combined_text = primary_text
        matches = self._match_queries(filing, combined_text, queries)

        if self.settings.sec_fetch_documents and not matches and form == "8-K":
            index_url = f"{SEC_ARCHIVES_BASE}{cik_int}/{accession}-index.html"
            try:
                index_html = await client.get_text(index_url, max_bytes=1_500_000)
                documents = parse_filing_index(index_html, index_url)
                exhibit_documents = [
                    document
                    for document in documents
                    if document["type"].upper().startswith("EX-99")
                    or document["document"].lower().startswith(("ex99", "ex-99"))
                ][:3]
                for document in exhibit_documents:
                    exhibit_html = await client.get_text(
                        document["url"], max_bytes=self.settings.sec_max_document_bytes
                    )
                    exhibit_text = html_to_text(exhibit_html, max_chars=750_000)
                    exhibits.append({**document, "text_length": len(exhibit_text)})
                    combined_text = normalize_space(f"{combined_text} {exhibit_text}")
                matches = self._match_queries(filing, combined_text, queries)
            except Exception as exc:  # noqa: BLE001
                logger.warning("SEC exhibit fetch failed accession=%s error=%s", accession, exc)

        if not matches:
            return None

        all_matched = list(dict.fromkeys(term for _, _, terms in matches for term in terms))
        filing_date = parse_date(filing.get("filingDate"))
        report_date = parse_date(filing.get("reportDate"))
        title = f"{company['company_name']} {form} — {filing_date.isoformat() if filing_date else accession}"
        snippet = safe_snippet(combined_text, all_matched)
        metadata = {
            "ticker": company["ticker"],
            "cik": company["cik"],
            "form": form,
            "filing_date": filing.get("filingDate"),
            "report_date": filing.get("reportDate"),
            "items": [value.strip() for value in str(filing.get("items") or "").split(",") if value.strip()],
            "matched_keywords": all_matched,
            "snippet": snippet,
            "exhibits": exhibits,
        }
        return (
            {
                "external_id": accession,
                "canonical_url": primary_url,
                "title": title,
                "publisher": "U.S. Securities and Exchange Commission",
                "published_at": date_as_utc_datetime(filing_date),
                "source_updated_at": date_as_utc_datetime(filing_date),
                "content_hash": text_hash(accession, combined_text, metadata),
                "metadata_json": metadata,
                "raw_payload": filing,
                "text_content": combined_text[:1_000_000] or None,
                "filing_values": {
                    "accession_number": accession,
                    "cik": company["cik"],
                    "ticker": company["ticker"],
                    "form": form,
                    "filing_date": filing_date,
                    "report_date": report_date,
                    "primary_document": primary_document,
                    "items": metadata["items"],
                    "exhibits": exhibits,
                    "matched_keywords": all_matched,
                },
            },
            matches,
        )

    @staticmethod
    def _match_queries(
        filing: dict[str, Any],
        text: str,
        queries: list[TechnologyQuery],
    ) -> list[tuple[TechnologyQuery, float, list[str]]]:
        title = f"{filing.get('form') or ''} {filing.get('items') or ''}"
        matches: list[tuple[TechnologyQuery, float, list[str]]] = []
        for query in queries:
            config = query.config or {}
            include_terms = [str(value) for value in config.get("include_terms") or []]
            exclude_terms = [str(value) for value in config.get("exclude_terms") or []]
            score, matched, excluded = keyword_score(title, text, include_terms, exclude_terms)
            if not excluded and matched:
                matches.append((query, max(score, 0.25), matched))
        return matches
