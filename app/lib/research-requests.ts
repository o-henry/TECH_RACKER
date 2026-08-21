import { env } from "cloudflare:workers";

export const RESEARCH_STATUSES = [
  "pending",
  "researching",
  "added",
  "rejected",
  "needs_review",
] as const;

export type ResearchStatus = (typeof RESEARCH_STATUSES)[number];

export type ResearchRequestRecord = {
  id: string;
  query: string;
  normalizedQuery: string;
  status: ResearchStatus;
  requestedBy: string;
  requestedAt: string;
  updatedAt: string;
  resolvedTechnologyId: string | null;
  resolutionNote: string | null;
  sourceCount: number;
};

type D1Row = {
  id: string;
  query: string;
  normalized_query: string;
  status: string;
  requested_by: string;
  requested_at: string;
  updated_at: string;
  resolved_technology_id: string | null;
  resolution_note: string | null;
  source_count: number;
};

let schemaReady: Promise<void> | null = null;

function database(): D1Database {
  if (!env.DB) throw new Error("D1 binding DB is unavailable");
  return env.DB;
}

export function normalizeResearchQuery(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/\s+/g, " ")
    .trim();
}

export function validateResearchQuery(value: unknown):
  | { ok: true; query: string; normalizedQuery: string }
  | { ok: false; detail: string } {
  if (typeof value !== "string") return { ok: false, detail: "검색어를 입력하십시오." };
  const query = value.normalize("NFKC").replace(/\s+/g, " ").trim();
  const normalizedQuery = normalizeResearchQuery(query);
  if (query.length < 2 || query.length > 120) {
    return { ok: false, detail: "기술명은 2자 이상 120자 이하로 입력하십시오." };
  }
  if (/\p{Cc}/u.test(query) || !/[\p{L}\p{N}]/u.test(query)) {
    return { ok: false, detail: "문자 또는 숫자가 포함된 기술명을 입력하십시오." };
  }
  return { ok: true, query, normalizedQuery };
}

export async function ensureResearchRequestSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      const db = database();
      await db.batch([
        db.prepare(`CREATE TABLE IF NOT EXISTS technology_research_requests (
          id TEXT PRIMARY KEY NOT NULL,
          query TEXT NOT NULL,
          normalized_query TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          requested_by TEXT NOT NULL,
          requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          resolved_technology_id TEXT,
          resolution_note TEXT,
          source_count INTEGER NOT NULL DEFAULT 0
        )`),
        db.prepare(
          "CREATE UNIQUE INDEX IF NOT EXISTS technology_research_requests_normalized_query_unique ON technology_research_requests (normalized_query)",
        ),
        db.prepare(
          "CREATE INDEX IF NOT EXISTS technology_research_requests_status_updated_idx ON technology_research_requests (status, updated_at DESC)",
        ),
      ]);
    })().catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  return schemaReady;
}

function record(row: D1Row): ResearchRequestRecord {
  const status = RESEARCH_STATUSES.includes(row.status as ResearchStatus)
    ? (row.status as ResearchStatus)
    : "needs_review";
  return {
    id: row.id,
    query: row.query,
    normalizedQuery: row.normalized_query,
    status,
    requestedBy: row.requested_by,
    requestedAt: row.requested_at,
    updatedAt: row.updated_at,
    resolvedTechnologyId: row.resolved_technology_id,
    resolutionNote: row.resolution_note,
    sourceCount: Number(row.source_count || 0),
  };
}

const SELECT_COLUMNS = `
  id, query, normalized_query, status, requested_by, requested_at, updated_at,
  resolved_technology_id, resolution_note, source_count
`;

export async function findResearchRequest(
  normalizedQuery: string,
): Promise<ResearchRequestRecord | null> {
  await ensureResearchRequestSchema();
  const row = await database()
    .prepare(
      `SELECT ${SELECT_COLUMNS} FROM technology_research_requests WHERE normalized_query = ? LIMIT 1`,
    )
    .bind(normalizedQuery)
    .first<D1Row>();
  return row ? record(row) : null;
}

export async function listResearchRequests(
  statuses: ResearchStatus[] = ["pending", "researching", "needs_review"],
  limit = 50,
): Promise<ResearchRequestRecord[]> {
  await ensureResearchRequestSchema();
  const safeStatuses = statuses.filter((status) => RESEARCH_STATUSES.includes(status));
  if (!safeStatuses.length) return [];
  const placeholders = safeStatuses.map(() => "?").join(", ");
  const result = await database()
    .prepare(
      `SELECT ${SELECT_COLUMNS} FROM technology_research_requests
       WHERE status IN (${placeholders})
       ORDER BY requested_at ASC
       LIMIT ?`,
    )
    .bind(...safeStatuses, Math.max(1, Math.min(limit, 100)))
    .all<D1Row>();
  return (result.results || []).map(record);
}

export async function researchRequestCounts(): Promise<Record<string, number>> {
  await ensureResearchRequestSchema();
  const result = await database()
    .prepare(
      "SELECT status, COUNT(*) AS count FROM technology_research_requests GROUP BY status",
    )
    .all<{ status: string; count: number }>();
  const counts: Record<string, number> = {
    pending: 0,
    researching: 0,
    needs_review: 0,
    added: 0,
    rejected: 0,
  };
  for (const row of result.results || []) counts[row.status] = Number(row.count || 0);
  return counts;
}

export async function createResearchRequest(
  query: string,
  normalizedQuery: string,
  requestedBy: string,
): Promise<{ created: boolean; item: ResearchRequestRecord }> {
  await ensureResearchRequestSchema();
  const existing = await findResearchRequest(normalizedQuery);
  if (existing) return { created: false, item: existing };

  const db = database();
  const pending = await db
    .prepare(
      "SELECT COUNT(*) AS count FROM technology_research_requests WHERE status IN ('pending', 'researching', 'needs_review')",
    )
    .first<{ count: number }>();
  if (Number(pending?.count || 0) >= 25) {
    throw new Error("RESEARCH_QUEUE_FULL");
  }
  const recent = await db
    .prepare(
      "SELECT COUNT(*) AS count FROM technology_research_requests WHERE requested_by = ? AND requested_at >= datetime('now', '-1 hour')",
    )
    .bind(requestedBy)
    .first<{ count: number }>();
  if (Number(recent?.count || 0) >= 5) {
    throw new Error("RESEARCH_RATE_LIMIT");
  }

  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO technology_research_requests
       (id, query, normalized_query, status, requested_by)
       VALUES (?, ?, ?, 'pending', ?)`,
    )
    .bind(id, query, normalizedQuery, requestedBy)
    .run();
  const item = await findResearchRequest(normalizedQuery);
  if (!item) throw new Error("RESEARCH_INSERT_FAILED");
  return { created: true, item };
}

export async function updateResearchRequest(input: {
  id: string;
  status: ResearchStatus;
  resolvedTechnologyId?: string | null;
  resolutionNote?: string | null;
  sourceCount?: number;
}): Promise<ResearchRequestRecord | null> {
  await ensureResearchRequestSchema();
  const sourceCount = Math.max(0, Math.min(Number(input.sourceCount || 0), 100));
  await database()
    .prepare(
      `UPDATE technology_research_requests
       SET status = ?, resolved_technology_id = ?, resolution_note = ?, source_count = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    )
    .bind(
      input.status,
      input.resolvedTechnologyId || null,
      input.resolutionNote?.slice(0, 500) || null,
      sourceCount,
      input.id,
    )
    .run();
  const row = await database()
    .prepare(`SELECT ${SELECT_COLUMNS} FROM technology_research_requests WHERE id = ? LIMIT 1`)
    .bind(input.id)
    .first<D1Row>();
  return row ? record(row) : null;
}
