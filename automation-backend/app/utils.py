from __future__ import annotations

import hashlib
import json
import re
from datetime import UTC, date, datetime
from typing import Any

from bs4 import BeautifulSoup

_WHITESPACE_RE = re.compile(r"\s+")


def utcnow() -> datetime:
    return datetime.now(UTC)


def normalize_space(value: Any) -> str:
    return _WHITESPACE_RE.sub(" ", str(value or "")).strip()


def normalize_for_match(value: Any) -> str:
    return normalize_space(value).casefold()


def parse_date(value: Any) -> date | None:
    text = normalize_space(value)
    if not text:
        return None
    try:
        return date.fromisoformat(text[:10])
    except ValueError:
        match = re.match(r"(20\d{2})(?:-(\d{2}))?(?:-(\d{2}))?", text)
        if not match:
            return None
        year = int(match.group(1))
        month = int(match.group(2) or 1)
        day = int(match.group(3) or 1)
        try:
            return date(year, month, day)
        except ValueError:
            return None


def parse_datetime(value: Any) -> datetime | None:
    text = normalize_space(value)
    if not text:
        return None
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        day = parse_date(text)
        return datetime.combine(day, datetime.min.time(), tzinfo=UTC) if day else None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def date_as_utc_datetime(value: date | None) -> datetime | None:
    if value is None:
        return None
    return datetime.combine(value, datetime.min.time(), tzinfo=UTC)


def stable_json_hash(value: Any) -> str:
    encoded = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def text_hash(*values: Any) -> str:
    payload = "\n".join(normalize_space(value) for value in values)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def html_to_text(value: str, max_chars: int | None = None) -> str:
    soup = BeautifulSoup(value or "", "html.parser")
    for node in soup(["script", "style", "noscript", "svg"]):
        node.decompose()
    text = normalize_space(soup.get_text(" "))
    if max_chars is not None:
        return text[:max_chars]
    return text


def reconstruct_abstract(inverted_index: dict[str, list[int]] | None) -> str | None:
    if not inverted_index:
        return None
    positioned: list[tuple[int, str]] = []
    for token, positions in inverted_index.items():
        for position in positions or []:
            positioned.append((int(position), token))
    if not positioned:
        return None
    positioned.sort(key=lambda item: item[0])
    return " ".join(token for _, token in positioned)


def match_terms(text: str, include_terms: list[str] | None, exclude_terms: list[str] | None = None) -> tuple[list[str], list[str]]:
    haystack = normalize_for_match(text)
    included = [term for term in (include_terms or []) if normalize_for_match(term) in haystack]
    excluded = [term for term in (exclude_terms or []) if normalize_for_match(term) in haystack]
    return included, excluded


def keyword_score(
    title: str,
    body: str,
    include_terms: list[str] | None,
    exclude_terms: list[str] | None = None,
) -> tuple[float, list[str], list[str]]:
    title_matches, title_excluded = match_terms(title, include_terms, exclude_terms)
    body_matches, body_excluded = match_terms(body, include_terms, exclude_terms)
    matched = list(dict.fromkeys([*title_matches, *body_matches]))
    excluded = list(dict.fromkeys([*title_excluded, *body_excluded]))
    if excluded:
        return 0.0, matched, excluded
    if not include_terms:
        return 0.5, matched, excluded
    denominator = max(len(include_terms), 1)
    score = min(1.0, (len(title_matches) * 2 + len(body_matches)) / denominator)
    return score, matched, excluded


def safe_snippet(text: str, terms: list[str], radius: int = 240) -> str | None:
    normalized = normalize_space(text)
    if not normalized:
        return None
    folded = normalized.casefold()
    indexes = [folded.find(term.casefold()) for term in terms if term and folded.find(term.casefold()) >= 0]
    center = min(indexes) if indexes else 0
    start = max(0, center - radius)
    end = min(len(normalized), center + radius)
    prefix = "…" if start > 0 else ""
    suffix = "…" if end < len(normalized) else ""
    return f"{prefix}{normalized[start:end]}{suffix}"


def advisory_lock_key(value: str) -> int:
    raw = hashlib.sha256(value.encode("utf-8")).digest()[:8]
    unsigned = int.from_bytes(raw, byteorder="big", signed=False)
    return unsigned - 2**64 if unsigned >= 2**63 else unsigned
