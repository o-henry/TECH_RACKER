from __future__ import annotations

import asyncio
import hashlib
import ipaddress
import socket
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import httpx
import yaml
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.config import Settings
from app.ingestors.common import IngestStats
from app.repository import link_document_to_technology, upsert_source_document
from app.utils import html_to_text, keyword_score, normalize_space, parse_datetime, text_hash


def _local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1].casefold()


def _first_text(node: ET.Element, names: set[str]) -> str:
    for child in node.iter():
        if _local_name(child.tag) in names and child.text:
            value = normalize_space(child.text)
            if value:
                return value
    return ""


def _entry_link(node: ET.Element) -> str:
    for child in node.iter():
        if _local_name(child.tag) != "link":
            continue
        href = normalize_space(child.attrib.get("href"))
        if href and child.attrib.get("rel", "alternate") in {"", "alternate"}:
            return href
        if child.text:
            return normalize_space(child.text)
    return ""


def _parse_entries(xml_text: str) -> list[dict[str, str]]:
    root = ET.fromstring(xml_text)
    entries = [node for node in root.iter() if _local_name(node.tag) in {"item", "entry"}]
    parsed: list[dict[str, str]] = []
    for entry in entries:
        title = _first_text(entry, {"title"})
        link = _entry_link(entry)
        if not title or not link:
            continue
        parsed.append(
            {
                "title": title,
                "link": link,
                "id": _first_text(entry, {"guid", "id"}) or link,
                "published": _first_text(entry, {"published", "updated", "pubdate", "dc:date"}),
                "summary": html_to_text(
                    _first_text(entry, {"summary", "description", "content", "encoded"}),
                    max_chars=4_000,
                ),
            }
        )
    return parsed


async def _assert_public_https(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("RSS URL must be a credential-free HTTPS URL")
    loop = asyncio.get_running_loop()
    addresses = await loop.getaddrinfo(parsed.hostname, parsed.port or 443, type=socket.SOCK_STREAM)
    if not addresses:
        raise ValueError("RSS hostname did not resolve")
    for address in addresses:
        ip = ipaddress.ip_address(address[4][0])
        if not ip.is_global:
            raise ValueError("RSS hostname resolves to a non-public IP address")


def _load_feeds(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    payload = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    feeds = payload.get("feeds", [])
    if not isinstance(feeds, list):
        raise ValueError("rss_feeds.yml feeds must be a list")
    return [item for item in feeds if isinstance(item, dict) and item.get("enabled", True)]


def _technology_terms(feed: dict[str, Any]) -> dict[str, list[str]]:
    raw = feed.get("technology_terms")
    if not isinstance(raw, dict):
        return {}
    mapped: dict[str, list[str]] = {}
    for technology_id, terms in raw.items():
        normalized_id = normalize_space(technology_id)
        if not normalized_id or not isinstance(terms, list):
            continue
        normalized_terms = [normalize_space(term) for term in terms if normalize_space(term)]
        if normalized_terms:
            mapped[normalized_id] = normalized_terms
    return mapped


def _match_technology_terms(
    title: str,
    summary: str,
    technology_terms: dict[str, list[str]],
    exclude_terms: list[str],
) -> dict[str, tuple[float, list[str]]]:
    matches: dict[str, tuple[float, list[str]]] = {}
    for technology_id, terms in technology_terms.items():
        score, matched, excluded = keyword_score(title, summary, terms, exclude_terms)
        if score > 0 and not excluded:
            matches[technology_id] = (score, matched)
    return matches


class RssIngestor:
    source_type = "rss"

    def __init__(self, settings: Settings, session_factory: async_sessionmaker[AsyncSession]) -> None:
        self.settings = settings
        self.session_factory = session_factory

    async def run(self) -> IngestStats:
        stats = IngestStats()
        feeds_path = self.settings.rss_feeds_path
        if not feeds_path.is_absolute():
            feeds_path = Path.cwd() / feeds_path
        feeds = _load_feeds(feeds_path)
        stats.queries_total = len(feeds)
        if not feeds:
            stats.details["configured_feeds"] = 0
            return stats

        headers = {"User-Agent": self.settings.sec_user_agent, "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml"}
        async with httpx.AsyncClient(
            headers=headers,
            timeout=httpx.Timeout(self.settings.http_timeout_seconds),
            follow_redirects=False,
        ) as client:
            for feed in feeds:
                feed_id = normalize_space(feed.get("id"))
                feed_url = normalize_space(feed.get("url"))
                try:
                    if not feed_id or not feed_url:
                        raise ValueError("RSS feed requires id and url")
                    await _assert_public_https(feed_url)
                    response = await client.get(feed_url)
                    if response.is_redirect:
                        raise ValueError("RSS redirects are disabled; configure the final HTTPS URL")
                    response.raise_for_status()
                    content_type = response.headers.get("content-type", "").casefold()
                    if not any(kind in content_type for kind in ("xml", "rss", "atom")):
                        raise ValueError("RSS response is not XML")
                    if len(response.content) > self.settings.rss_max_feed_bytes:
                        raise ValueError("RSS response exceeds configured size limit")
                    entries = _parse_entries(response.text)
                    await self._store_feed(feed, entries, stats)
                    stats.queries_succeeded += 1
                except Exception as exc:  # noqa: BLE001
                    stats.add_error(query_key=feed_id or "rss", message=str(exc), error_type=type(exc).__name__)
        stats.details["configured_feeds"] = len(feeds)
        return stats

    async def _store_feed(self, feed: dict[str, Any], entries: list[dict[str, str]], stats: IngestStats) -> None:
        technology_ids = [normalize_space(value) for value in feed.get("technology_ids", []) if normalize_space(value)]
        technology_terms = _technology_terms(feed)
        include_terms = [normalize_space(value) for value in feed.get("include_terms", []) if normalize_space(value)]
        exclude_terms = [normalize_space(value) for value in feed.get("exclude_terms", []) if normalize_space(value)]
        publisher = normalize_space(feed.get("publisher")) or normalize_space(feed.get("id"))
        signal_class = normalize_space(feed.get("signal_class")) or "reviewed_feed"
        feed_host = urlparse(normalize_space(feed.get("url"))).hostname
        allowed_entry_hosts = {
            normalize_space(value).casefold()
            for value in feed.get("allowed_entry_hosts", [])
            if normalize_space(value)
        }
        if feed_host:
            allowed_entry_hosts.add(feed_host.casefold())

        async with self.session_factory() as session:
            for entry in entries:
                stats.records_seen += 1
                entry_host = urlparse(entry["link"]).hostname
                if not entry_host or entry_host.casefold() not in allowed_entry_hosts:
                    stats.records_skipped += 1
                    continue
                await _assert_public_https(entry["link"])
                score, matched, excluded = keyword_score(entry["title"], entry["summary"], include_terms, exclude_terms)
                if excluded or (include_terms and score <= 0):
                    stats.records_skipped += 1
                    continue
                matched_technologies = _match_technology_terms(
                    entry["title"], entry["summary"], technology_terms, exclude_terms
                )
                if technology_terms and not matched_technologies:
                    stats.records_skipped += 1
                    continue
                if not technology_terms:
                    matched_technologies = {
                        technology_id: (max(score, 0.5 if not include_terms else 0.0), matched)
                        for technology_id in technology_ids
                    }
                all_matched_terms = list(
                    dict.fromkeys(
                        term
                        for _, technology_match in matched_technologies.values()
                        for term in technology_match
                    )
                )
                published = parse_datetime(entry["published"])
                external_id = hashlib.sha256(f"{feed['id']}\n{entry['id']}".encode()).hexdigest()
                result = await upsert_source_document(
                    session,
                    source_type="rss",
                    external_id=external_id,
                    canonical_url=entry["link"],
                    title=entry["title"],
                    publisher=publisher,
                    published_at=published,
                    source_updated_at=published,
                    content_hash=text_hash(entry["title"], entry["summary"], entry["link"]),
                    metadata_json={
                        "feed_id": feed["id"],
                        "matched_terms": all_matched_terms or matched,
                        "signal_class": signal_class,
                        "evidence_policy": "corroboration_required" if signal_class == "public_interest" else "reviewed_feed",
                    },
                    raw_payload={"title": entry["title"], "link": entry["link"], "published": entry["published"]},
                    text_content=entry["summary"],
                )
                stats.records_inserted += int(result.inserted)
                stats.records_updated += int(result.updated)
                if not result.inserted and not result.updated:
                    stats.records_skipped += 1
                for technology_id, (technology_score, technology_matched) in matched_technologies.items():
                    linked = await link_document_to_technology(
                        session,
                        document_id=result.document_id,
                        technology_id=technology_id,
                        query_id=None,
                        relevance_score=technology_score,
                        matched_terms=technology_matched,
                        link_reason=(
                            f"public-interest RSS signal: {feed['id']}"
                            if signal_class == "public_interest"
                            else f"reviewed RSS feed: {feed['id']}"
                        ),
                    )
                    stats.records_linked += int(linked)
            await session.commit()
