from __future__ import annotations

from app.ingestors.clinicaltrials import normalize_clinical_trial
from app.ingestors.openalex import normalize_openalex_work
from app.ingestors.rss import _match_technology_terms
from app.ingestors.sec import iter_recent_filings, normalize_ticker_map, parse_filing_index
from app.utils import keyword_score, reconstruct_abstract


def test_reconstruct_openalex_abstract() -> None:
    abstract = reconstruct_abstract({"Quantum": [0], "error": [1], "correction": [2]})
    assert abstract == "Quantum error correction"


def test_normalize_openalex_work() -> None:
    work = {
        "id": "https://openalex.org/W123",
        "doi": "https://doi.org/10.1000/example",
        "display_name": "Logical qubit error suppression",
        "publication_date": "2026-08-10",
        "updated_date": "2026-08-12T09:00:00Z",
        "type": "article",
        "cited_by_count": 7,
        "is_retracted": False,
        "abstract_inverted_index": {"Logical": [0], "qubit": [1], "experiment": [2]},
        "primary_location": {
            "landing_page_url": "https://doi.org/10.1000/example",
            "source": {"display_name": "Example Journal"},
        },
        "authorships": [
            {
                "author_position": "first",
                "author": {"id": "https://openalex.org/A1", "display_name": "A. Researcher"},
                "institutions": [
                    {
                        "id": "https://openalex.org/I1",
                        "display_name": "Example University",
                        "country_code": "KR",
                        "type": "education",
                    }
                ],
            }
        ],
    }
    normalized = normalize_openalex_work(work)
    assert normalized["external_id"] == "W123"
    assert normalized["paper_values"]["abstract"] == "Logical qubit experiment"
    assert normalized["paper_values"]["venue"] == "Example Journal"
    assert normalized["paper_values"]["authors"][0]["name"] == "A. Researcher"


def test_normalize_clinical_trial() -> None:
    study = {
        "hasResults": True,
        "protocolSection": {
            "identificationModule": {"nctId": "NCT00000001", "briefTitle": "A CRISPR Study"},
            "statusModule": {
                "overallStatus": "RECRUITING",
                "studyFirstPostDateStruct": {"date": "2025-01-02"},
                "lastUpdatePostDateStruct": {"date": "2026-08-01"},
                "startDateStruct": {"date": "2025-02"},
                "primaryCompletionDateStruct": {"date": "2027-06"},
            },
            "designModule": {
                "studyType": "INTERVENTIONAL",
                "phases": ["PHASE2"],
                "enrollmentInfo": {"count": 120},
            },
            "conditionsModule": {"conditions": ["Transthyretin Amyloidosis"]},
            "descriptionModule": {"briefSummary": "In vivo CRISPR genome editing."},
            "armsInterventionsModule": {
                "interventions": [{"type": "GENETIC", "name": "Example editor"}]
            },
            "sponsorCollaboratorsModule": {"leadSponsor": {"name": "Example Sponsor"}},
            "contactsLocationsModule": {
                "locations": [{"facility": "Hospital", "city": "Seoul", "country": "Korea"}]
            },
        },
    }
    normalized = normalize_clinical_trial(study)
    values = normalized["trial_values"]
    assert normalized["external_id"] == "NCT00000001"
    assert values["overall_status"] == "RECRUITING"
    assert values["enrollment"] == 120
    assert values["has_results"] is True
    assert "CRISPR" in normalized["text_content"]


def test_sec_ticker_and_recent_filing_normalization() -> None:
    ticker_map = normalize_ticker_map(
        {"0": {"cik_str": 1234, "ticker": "TEST", "title": "Test Corporation"}}
    )
    assert ticker_map["TEST"]["cik"] == "0000001234"

    filings = iter_recent_filings(
        {
            "filings": {
                "recent": {
                    "accessionNumber": ["0000001234-26-000001"],
                    "filingDate": ["2026-08-19"],
                    "form": ["8-K"],
                    "primaryDocument": ["test.htm"],
                    "items": ["8.01"],
                }
            }
        }
    )
    assert filings[0]["form"] == "8-K"
    assert filings[0]["primaryDocument"] == "test.htm"


def test_parse_sec_filing_index() -> None:
    html = """
    <table class="tableFile">
      <tr><th>Seq</th><th>Description</th><th>Document</th><th>Type</th></tr>
      <tr><td>1</td><td>Press Release</td><td><a href="ex99-1.htm">ex99-1.htm</a></td><td>EX-99.1</td></tr>
    </table>
    """
    rows = parse_filing_index(html, "https://www.sec.gov/Archives/example/index.html")
    assert rows[0]["type"] == "EX-99.1"
    assert rows[0]["url"].endswith("/Archives/example/ex99-1.htm")


def test_keyword_score_blocks_excluded_terms() -> None:
    score, matched, excluded = keyword_score(
        "In vivo CRISPR treatment",
        "A murine study",
        ["in vivo", "crispr"],
        ["murine"],
    )
    assert score == 0
    assert "crispr" in matched
    assert excluded == ["murine"]


def test_google_trends_signal_links_only_matching_technology() -> None:
    matches = _match_technology_terms(
        "Waymo robotaxi service expands",
        "More people are searching for driverless ride-hailing.",
        {
            "robotaxi": ["Waymo", "robotaxi"],
            "fusion-power": ["fusion power", "tokamak"],
        },
        [],
    )
    assert set(matches) == {"robotaxi"}
    assert matches["robotaxi"][0] > 0
