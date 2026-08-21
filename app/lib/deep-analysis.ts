import { env } from "cloudflare:workers";

export const DEEP_ANALYSIS_STATUSES = [
  "pending",
  "researching",
  "completed",
  "needs_review",
  "failed",
] as const;

export type DeepAnalysisStatus = (typeof DEEP_ANALYSIS_STATUSES)[number];

export type DeepAnalysisResult = {
  executiveJudgment: string;
  technicalModel: {
    systemBoundary: string;
    causalChain: Array<{
      stage: string;
      mechanism: string;
      failureMode: string;
    }>;
  };
  evidenceInterpretation: Array<{
    finding: string;
    interpretation: string;
    limitation: string;
    sourceUrls: string[];
  }>;
  bottleneckAnalysis: Array<{
    name: string;
    whyBinding: string;
    downstreamEffects: string[];
    evidenceToResolve: string[];
  }>;
  relationshipAnalysis: Array<{
    technologyId: string;
    relationship: string;
    dependency: string;
    transferLimit: string;
  }>;
  researchAgenda: Array<{
    priority: string;
    question: string;
    requiredEvidence: string;
    decisionImpact: string;
  }>;
  citations: Array<{
    publisher: string;
    title: string;
    url: string;
    eventDate: string;
    publishedDate: string;
  }>;
};

export type DeepAnalysisRequestRecord = {
  id: string;
  technologyId: string;
  technologyName: string;
  status: DeepAnalysisStatus;
  requestedBy: string;
  requestedAt: string;
  updatedAt: string;
  verifiedThrough: string | null;
  analysisModel: string | null;
  resolutionNote: string | null;
  sourceCount: number;
  result: DeepAnalysisResult | null;
};

type D1Row = {
  id: string;
  technology_id: string;
  technology_name: string;
  status: string;
  requested_by: string;
  requested_at: string;
  updated_at: string;
  verified_through: string | null;
  analysis_model: string | null;
  resolution_note: string | null;
  source_count: number;
  result_json: string | null;
};

let schemaReady: Promise<void> | null = null;

function database(): D1Database {
  if (!env.DB) throw new Error("D1 binding DB is unavailable");
  return env.DB;
}

function cleanString(value: unknown, max: number): string {
  return typeof value === "string" ? value.normalize("NFKC").trim().slice(0, max) : "";
}

function cleanStringList(value: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, maxItems)
    .map((item) => cleanString(item, maxLength))
    .filter(Boolean);
}

function cleanURL(value: unknown): string {
  const url = cleanString(value, 2_000);
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" ? parsed.href : "";
  } catch {
    return "";
  }
}

export function validateTechnologyIdentity(technologyId: unknown, technologyName: unknown):
  | { ok: true; technologyId: string; technologyName: string }
  | { ok: false; detail: string } {
  const id = cleanString(technologyId, 120).toLocaleLowerCase("en-US");
  const name = cleanString(technologyName, 160);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) || name.length < 2) {
    return { ok: false, detail: "유효한 기술 식별자가 필요합니다." };
  }
  return { ok: true, technologyId: id, technologyName: name };
}

export function validateDeepAnalysisResult(value: unknown):
  | { ok: true; result: DeepAnalysisResult }
  | { ok: false; detail: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, detail: "심층 분석 결과 객체가 필요합니다." };
  }
  const input = value as Record<string, unknown>;
  const technicalInput = input.technicalModel as Record<string, unknown> | undefined;
  const executiveJudgment = cleanString(input.executiveJudgment, 4_000);
  const systemBoundary = cleanString(technicalInput?.systemBoundary, 3_000);
  const causalChain = Array.isArray(technicalInput?.causalChain)
    ? technicalInput.causalChain.slice(0, 10).map((item) => {
        const row = item as Record<string, unknown>;
        return {
          stage: cleanString(row.stage, 160),
          mechanism: cleanString(row.mechanism, 1_500),
          failureMode: cleanString(row.failureMode, 1_500),
        };
      }).filter((item) => item.stage && item.mechanism && item.failureMode)
    : [];
  const evidenceInterpretation = Array.isArray(input.evidenceInterpretation)
    ? input.evidenceInterpretation.slice(0, 10).map((item) => {
        const row = item as Record<string, unknown>;
        return {
          finding: cleanString(row.finding, 1_200),
          interpretation: cleanString(row.interpretation, 2_000),
          limitation: cleanString(row.limitation, 2_000),
          sourceUrls: cleanStringList(row.sourceUrls, 6, 2_000).map(cleanURL).filter(Boolean),
        };
      }).filter((item) => item.finding && item.interpretation && item.limitation && item.sourceUrls.length)
    : [];
  const bottleneckAnalysis = Array.isArray(input.bottleneckAnalysis)
    ? input.bottleneckAnalysis.slice(0, 10).map((item) => {
        const row = item as Record<string, unknown>;
        return {
          name: cleanString(row.name, 200),
          whyBinding: cleanString(row.whyBinding, 2_000),
          downstreamEffects: cleanStringList(row.downstreamEffects, 8, 1_000),
          evidenceToResolve: cleanStringList(row.evidenceToResolve, 8, 1_000),
        };
      }).filter((item) => item.name && item.whyBinding && item.evidenceToResolve.length)
    : [];
  const relationshipAnalysis = Array.isArray(input.relationshipAnalysis)
    ? input.relationshipAnalysis.slice(0, 12).map((item) => {
        const row = item as Record<string, unknown>;
        return {
          technologyId: cleanString(row.technologyId, 120),
          relationship: cleanString(row.relationship, 1_000),
          dependency: cleanString(row.dependency, 1_500),
          transferLimit: cleanString(row.transferLimit, 1_500),
        };
      }).filter((item) => item.technologyId && item.relationship && item.dependency && item.transferLimit)
    : [];
  const researchAgenda = Array.isArray(input.researchAgenda)
    ? input.researchAgenda.slice(0, 10).map((item) => {
        const row = item as Record<string, unknown>;
        return {
          priority: cleanString(row.priority, 40),
          question: cleanString(row.question, 1_500),
          requiredEvidence: cleanString(row.requiredEvidence, 2_000),
          decisionImpact: cleanString(row.decisionImpact, 2_000),
        };
      }).filter((item) => item.priority && item.question && item.requiredEvidence && item.decisionImpact)
    : [];
  const citations = Array.isArray(input.citations)
    ? input.citations.slice(0, 30).map((item) => {
        const row = item as Record<string, unknown>;
        return {
          publisher: cleanString(row.publisher, 200),
          title: cleanString(row.title, 600),
          url: cleanURL(row.url),
          eventDate: cleanString(row.eventDate, 40) || "미확인",
          publishedDate: cleanString(row.publishedDate, 40) || "미확인",
        };
      }).filter((item) => item.publisher && item.title && item.url)
    : [];

  if (
    executiveJudgment.length < 80 ||
    systemBoundary.length < 60 ||
    causalChain.length < 3 ||
    evidenceInterpretation.length < 2 ||
    bottleneckAnalysis.length < 2 ||
    researchAgenda.length < 2 ||
    citations.length < 2
  ) {
    return { ok: false, detail: "심층 분석 필수 항목과 원출처가 부족합니다." };
  }

  return {
    ok: true,
    result: {
      executiveJudgment,
      technicalModel: { systemBoundary, causalChain },
      evidenceInterpretation,
      bottleneckAnalysis,
      relationshipAnalysis,
      researchAgenda,
      citations,
    },
  };
}

export async function ensureDeepAnalysisSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      const db = database();
      await db.batch([
        db.prepare(`CREATE TABLE IF NOT EXISTS technology_deep_analysis_requests (
          id TEXT PRIMARY KEY NOT NULL,
          technology_id TEXT NOT NULL,
          technology_name TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          requested_by TEXT NOT NULL,
          requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          verified_through TEXT,
          analysis_model TEXT,
          resolution_note TEXT,
          source_count INTEGER NOT NULL DEFAULT 0,
          result_json TEXT
        )`),
        db.prepare(
          "CREATE UNIQUE INDEX IF NOT EXISTS technology_deep_analysis_requests_technology_unique ON technology_deep_analysis_requests (technology_id)",
        ),
        db.prepare(
          "CREATE INDEX IF NOT EXISTS technology_deep_analysis_requests_status_updated_idx ON technology_deep_analysis_requests (status, updated_at DESC)",
        ),
      ]);
    })().catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  return schemaReady;
}

const SELECT_COLUMNS = `
  id, technology_id, technology_name, status, requested_by, requested_at, updated_at,
  verified_through, analysis_model, resolution_note, source_count, result_json
`;

function record(row: D1Row): DeepAnalysisRequestRecord {
  const status = DEEP_ANALYSIS_STATUSES.includes(row.status as DeepAnalysisStatus)
    ? (row.status as DeepAnalysisStatus)
    : "needs_review";
  let result: DeepAnalysisResult | null = null;
  if (row.result_json) {
    try {
      const validated = validateDeepAnalysisResult(JSON.parse(row.result_json));
      if (validated.ok) result = validated.result;
    } catch {
      result = null;
    }
  }
  return {
    id: row.id,
    technologyId: row.technology_id,
    technologyName: row.technology_name,
    status,
    requestedBy: row.requested_by,
    requestedAt: row.requested_at,
    updatedAt: row.updated_at,
    verifiedThrough: row.verified_through,
    analysisModel: row.analysis_model,
    resolutionNote: row.resolution_note,
    sourceCount: Number(row.source_count || 0),
    result,
  };
}

export async function findDeepAnalysisRequest(technologyId: string): Promise<DeepAnalysisRequestRecord | null> {
  await ensureDeepAnalysisSchema();
  const row = await database()
    .prepare(`SELECT ${SELECT_COLUMNS} FROM technology_deep_analysis_requests WHERE technology_id = ? LIMIT 1`)
    .bind(technologyId)
    .first<D1Row>();
  return row ? record(row) : null;
}

export async function listDeepAnalysisRequests(
  statuses: DeepAnalysisStatus[] = ["pending", "researching", "needs_review"],
  limit = 30,
): Promise<DeepAnalysisRequestRecord[]> {
  await ensureDeepAnalysisSchema();
  const safeStatuses = statuses.filter((status) => DEEP_ANALYSIS_STATUSES.includes(status));
  if (!safeStatuses.length) return [];
  const placeholders = safeStatuses.map(() => "?").join(", ");
  const result = await database()
    .prepare(`SELECT ${SELECT_COLUMNS} FROM technology_deep_analysis_requests
      WHERE status IN (${placeholders}) ORDER BY requested_at ASC LIMIT ?`)
    .bind(...safeStatuses, Math.max(1, Math.min(limit, 100)))
    .all<D1Row>();
  return (result.results || []).map(record);
}

export async function deepAnalysisCounts(): Promise<Record<DeepAnalysisStatus, number>> {
  await ensureDeepAnalysisSchema();
  const result = await database()
    .prepare("SELECT status, COUNT(*) AS count FROM technology_deep_analysis_requests GROUP BY status")
    .all<{ status: string; count: number }>();
  const counts: Record<DeepAnalysisStatus, number> = {
    pending: 0,
    researching: 0,
    completed: 0,
    needs_review: 0,
    failed: 0,
  };
  for (const row of result.results || []) {
    if (DEEP_ANALYSIS_STATUSES.includes(row.status as DeepAnalysisStatus)) {
      counts[row.status as DeepAnalysisStatus] = Number(row.count || 0);
    }
  }
  return counts;
}

export async function createDeepAnalysisRequest(input: {
  technologyId: string;
  technologyName: string;
  requestedBy: string;
}): Promise<{ created: boolean; item: DeepAnalysisRequestRecord }> {
  await ensureDeepAnalysisSchema();
  const existing = await findDeepAnalysisRequest(input.technologyId);
  if (existing) return { created: false, item: existing };
  const pending = await database()
    .prepare("SELECT COUNT(*) AS count FROM technology_deep_analysis_requests WHERE status IN ('pending', 'researching', 'needs_review')")
    .first<{ count: number }>();
  if (Number(pending?.count || 0) >= 12) throw new Error("DEEP_ANALYSIS_QUEUE_FULL");
  const recent = await database()
    .prepare("SELECT COUNT(*) AS count FROM technology_deep_analysis_requests WHERE requested_by = ? AND requested_at >= datetime('now', '-1 hour')")
    .bind(input.requestedBy)
    .first<{ count: number }>();
  if (Number(recent?.count || 0) >= 3) throw new Error("DEEP_ANALYSIS_RATE_LIMIT");

  const id = crypto.randomUUID();
  await database()
    .prepare(`INSERT INTO technology_deep_analysis_requests
      (id, technology_id, technology_name, requested_by) VALUES (?, ?, ?, ?)`) 
    .bind(id, input.technologyId, input.technologyName, input.requestedBy)
    .run();
  const item = await findDeepAnalysisRequest(input.technologyId);
  if (!item) throw new Error("DEEP_ANALYSIS_INSERT_FAILED");
  return { created: true, item };
}

export async function updateDeepAnalysisRequest(input: {
  id: string;
  status: DeepAnalysisStatus;
  verifiedThrough?: string | null;
  analysisModel?: string | null;
  resolutionNote?: string | null;
  result?: DeepAnalysisResult | null;
}): Promise<DeepAnalysisRequestRecord | null> {
  await ensureDeepAnalysisSchema();
  const resultJson = input.result ? JSON.stringify(input.result) : null;
  const sourceCount = input.result?.citations.length || 0;
  await database()
    .prepare(`UPDATE technology_deep_analysis_requests SET
      status = ?, verified_through = ?, analysis_model = ?, resolution_note = ?,
      source_count = ?, result_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .bind(
      input.status,
      cleanString(input.verifiedThrough, 40) || null,
      cleanString(input.analysisModel, 120) || null,
      cleanString(input.resolutionNote, 1_000) || null,
      sourceCount,
      resultJson,
      input.id,
    )
    .run();
  const row = await database()
    .prepare(`SELECT ${SELECT_COLUMNS} FROM technology_deep_analysis_requests WHERE id = ? LIMIT 1`)
    .bind(input.id)
    .first<D1Row>();
  return row ? record(row) : null;
}
