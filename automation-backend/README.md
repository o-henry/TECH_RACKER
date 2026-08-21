# Technology Tracker private automation backend

This companion service powers the owner-only `/admin` page and a private ChatGPT plugin. It does not use the OpenAI API and does not accept an `OPENAI_API_KEY`.

## What runs where

- FastAPI provides the read-only tracker data, owner control endpoints, and the MCP tool endpoint.
- PostgreSQL stores source documents, deduplication keys, analysis leases, decisions, and append-only audit records.
- APScheduler collects reviewed RSS and official Google Trends KR·US RSS every 10 minutes, SEC filings every 30 minutes, ClinicalTrials.gov updates every 4 hours, and OpenAlex daily.
- ChatGPT Scheduled Tasks connects through the private MCP endpoint and analyzes only queued compact batches.
- The Sites frontend remains separate and owner-only.

## One-time configuration

1. Copy `.env.example` to `.env`.
2. Replace `POSTGRES_PASSWORD`, `BACKEND_CONTROL_TOKEN`, and `MCP_INTERNAL_TOKEN` with different random values.
3. Set a real SEC contact identity in `SEC_USER_AGENT` and `OPENALEX_MAILTO`.
4. Review `config/rss_feeds.yml`. The official Google Trends KR·US RSS feeds are preconfigured without an API key. Add other feeds only after verifying their HTTPS origin and publisher.
5. Start the service with `docker compose up --build -d`.
6. Put `/mcp` behind an OAuth 2.1 proxy. The proxy must strip any incoming `X-MCP-Internal-Token` header and inject the configured `MCP_INTERNAL_TOKEN` only after successful owner authentication.
7. Configure the Sites runtime with this service's HTTPS origin and `BACKEND_CONTROL_TOKEN`.
8. Connect the private plugin once in ChatGPT and create the hourly Scheduled Task.

## Private endpoints

- `GET /api/v1/admin/automation/status`
- `POST /api/v1/admin/automation/run-collectors`
- `POST /api/v1/admin/automation/pause`
- `POST /api/v1/admin/automation/resume`
- `/mcp` for the four bounded ChatGPT tools

The admin endpoints require `Authorization: Bearer <BACKEND_CONTROL_TOKEN>`. Every mutation also requires an `Idempotency-Key`. The MCP route rejects requests unless the trusted OAuth proxy injects the internal token.

## ChatGPT tool limits

- `get_automation_status`: read-only health and queue counts
- `claim_analysis_batch`: leases at most 10 compact candidates, idempotent by run ID
- `publish_analysis`: stores a schema-valid result and rejects foreign source URLs
- `release_analysis_batch`: releases only the caller's lease

There is no arbitrary URL fetch, generic SQL, shell, filesystem, or generic write tool. Feed content is untrusted input, not executable instructions.

Google Trends is handled as `public_interest`, not evidence. Entries are linked only when a tracked technology alias appears, enter the queue at low priority, and cannot trigger an automatic status change. Any meaningful claim must be corroborated by a primary source before publication.

## Validation

```bash
python -m compileall -q app scripts tests
pytest -q
ruff check app tests
```

An operational connection still requires a stable HTTPS deployment, an OAuth 2.1 proxy for `/mcp`, the two server-only secrets, and a one-time ChatGPT plugin/Scheduled Task setup. Those values are intentionally not committed.
