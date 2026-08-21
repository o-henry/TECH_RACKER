import { NextRequest, NextResponse } from "next/server";
import { getChatGPTUser } from "../../chatgpt-auth";
import {
  createDeepAnalysisRequest,
  DEEP_ANALYSIS_STATUSES,
  deepAnalysisCounts,
  findDeepAnalysisRequest,
  listDeepAnalysisRequests,
  updateDeepAnalysisRequest,
  validateDeepAnalysisResult,
  validateTechnologyIdentity,
  type DeepAnalysisStatus,
} from "../../lib/deep-analysis";
import {
  collectAndStoreTechnologySources,
  findInstantSourceCollection,
} from "../../lib/instant-source-collection";

export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}

function sameOriginMutation(request: NextRequest): boolean {
  return (
    request.headers.get("origin") === request.nextUrl.origin &&
    request.headers.get("x-tracker-deep-analysis") === "1"
  );
}

export async function GET(request: NextRequest) {
  const user = await getChatGPTUser();
  if (!user) return json({ detail: "Authentication required" }, 401);
  const technologyId = request.nextUrl.searchParams.get("technologyId");
  if (technologyId) {
    const validated = validateTechnologyIdentity(technologyId, "조회 기술");
    if (!validated.ok) return json({ detail: validated.detail }, 400);
    const [item, collection] = await Promise.all([
      findDeepAnalysisRequest(validated.technologyId),
      findInstantSourceCollection(validated.technologyId),
    ]);
    return json({ item, collection });
  }
  const includeItems = request.nextUrl.searchParams.get("include") === "items";
  const counts = await deepAnalysisCounts();
  const items = includeItems ? await listDeepAnalysisRequests() : undefined;
  return json({ counts, active: counts.pending + counts.researching + counts.needs_review, items });
}

export async function POST(request: NextRequest) {
  const user = await getChatGPTUser();
  if (!user) return json({ detail: "Authentication required" }, 401);
  if (!sameOriginMutation(request)) return json({ detail: "Cross-site request rejected" }, 403);
  let body: { technologyId?: unknown; technologyName?: unknown; technologyNameEn?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ detail: "Invalid JSON body" }, 400);
  }
  const validated = validateTechnologyIdentity(body.technologyId, body.technologyName);
  if (!validated.ok) return json({ detail: validated.detail }, 400);
  try {
    const result = await createDeepAnalysisRequest({
      technologyId: validated.technologyId,
      technologyName: validated.technologyName,
      requestedBy: user.email,
    });
    let collection = null;
    let collectionDetail = "원출처를 즉시 확인하지 못했습니다. 저장된 분석 요청은 유지됩니다.";
    try {
      collection = await collectAndStoreTechnologySources({
        technologyId: validated.technologyId,
        technologyName: validated.technologyName,
        technologyNameEn: typeof body.technologyNameEn === "string" ? body.technologyNameEn : undefined,
      });
      collectionDetail = collection.sources.length
        ? `공식 원출처 후보 ${collection.sources.length}개를 즉시 수집했습니다.`
        : "원출처를 즉시 확인했지만 현재 표시할 새 후보를 찾지 못했습니다.";
    } catch {
      // The durable analysis request must remain available even when a public source is temporarily unavailable.
    }
    return json({
      created: result.created,
      item: result.item,
      collection,
      detail: collectionDetail,
    }, result.created ? 201 : 200);
  } catch (error) {
    if (error instanceof Error && error.message === "DEEP_ANALYSIS_QUEUE_FULL") {
      return json({ detail: "심층 분석 대기열이 가득 찼습니다." }, 429);
    }
    if (error instanceof Error && error.message === "DEEP_ANALYSIS_RATE_LIMIT") {
      return json({ detail: "심층 분석은 한 시간에 최대 3개까지 요청할 수 있습니다." }, 429);
    }
    return json({ detail: "심층 분석 요청을 저장하지 못했습니다." }, 500);
  }
}

export async function PATCH(request: NextRequest) {
  const user = await getChatGPTUser();
  if (!user) return json({ detail: "Authentication required" }, 401);
  if (!sameOriginMutation(request)) return json({ detail: "Cross-site request rejected" }, 403);
  let body: {
    id?: unknown;
    status?: unknown;
    verifiedThrough?: unknown;
    analysisModel?: unknown;
    resolutionNote?: unknown;
    result?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return json({ detail: "Invalid JSON body" }, 400);
  }
  const id = typeof body.id === "string" ? body.id.trim() : "";
  const status = typeof body.status === "string" ? body.status : "";
  if (!/^[0-9a-f-]{36}$/i.test(id) || !DEEP_ANALYSIS_STATUSES.includes(status as DeepAnalysisStatus)) {
    return json({ detail: "Invalid deep analysis update" }, 400);
  }
  let result = null;
  if (status === "completed") {
    const validated = validateDeepAnalysisResult(body.result);
    if (!validated.ok) return json({ detail: validated.detail }, 400);
    result = validated.result;
  }
  const item = await updateDeepAnalysisRequest({
    id,
    status: status as DeepAnalysisStatus,
    verifiedThrough: typeof body.verifiedThrough === "string" ? body.verifiedThrough : null,
    analysisModel: typeof body.analysisModel === "string" ? body.analysisModel : null,
    resolutionNote: typeof body.resolutionNote === "string" ? body.resolutionNote : null,
    result,
  });
  return item ? json({ item }) : json({ detail: "Deep analysis request not found" }, 404);
}
