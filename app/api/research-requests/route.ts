import { NextRequest, NextResponse } from "next/server";
import { getChatGPTUser } from "../../chatgpt-auth";
import {
  createResearchRequest,
  findResearchRequest,
  listResearchRequests,
  normalizeResearchQuery,
  RESEARCH_STATUSES,
  researchRequestCounts,
  updateResearchRequest,
  validateResearchQuery,
  type ResearchStatus,
} from "../../lib/research-requests";

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
    request.headers.get("x-tracker-research-request") === "1"
  );
}

export async function GET(request: NextRequest) {
  const user = await getChatGPTUser();
  if (!user) return json({ detail: "Authentication required" }, 401);

  const query = request.nextUrl.searchParams.get("query");
  if (query) {
    const item = await findResearchRequest(normalizeResearchQuery(query));
    return json({ item });
  }

  const includeItems = request.nextUrl.searchParams.get("include") === "items";
  const counts = await researchRequestCounts();
  const items = includeItems ? await listResearchRequests() : undefined;
  return json({ counts, active: counts.pending + counts.researching + counts.needs_review, items });
}

export async function POST(request: NextRequest) {
  const user = await getChatGPTUser();
  if (!user) return json({ detail: "Authentication required" }, 401);
  if (!sameOriginMutation(request)) return json({ detail: "Cross-site request rejected" }, 403);

  let body: { query?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ detail: "Invalid JSON body" }, 400);
  }
  const validated = validateResearchQuery(body.query);
  if (!validated.ok) return json({ detail: validated.detail }, 400);

  try {
    const result = await createResearchRequest(
      validated.query,
      validated.normalizedQuery,
      user.email,
    );
    return json(
      {
        created: result.created,
        item: result.item,
        detail: result.created
          ? "조사 요청이 접수되었습니다. 다음 예약 조사에서 원출처를 확인합니다."
          : "이미 접수되었거나 처리된 기술입니다.",
      },
      result.created ? 201 : 200,
    );
  } catch (error) {
    if (error instanceof Error && error.message === "RESEARCH_QUEUE_FULL") {
      return json({ detail: "조사 대기열이 가득 찼습니다. 기존 요청 처리 후 다시 시도하십시오." }, 429);
    }
    if (error instanceof Error && error.message === "RESEARCH_RATE_LIMIT") {
      return json({ detail: "한 시간에 최대 5개 기술만 조사 요청할 수 있습니다." }, 429);
    }
    return json({ detail: "조사 요청을 저장하지 못했습니다." }, 500);
  }
}

export async function PATCH(request: NextRequest) {
  const user = await getChatGPTUser();
  if (!user) return json({ detail: "Authentication required" }, 401);
  if (!sameOriginMutation(request)) return json({ detail: "Cross-site request rejected" }, 403);

  let body: {
    id?: unknown;
    status?: unknown;
    resolvedTechnologyId?: unknown;
    resolutionNote?: unknown;
    sourceCount?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return json({ detail: "Invalid JSON body" }, 400);
  }

  const id = typeof body.id === "string" ? body.id.trim() : "";
  const status = typeof body.status === "string" ? body.status : "";
  if (!/^[0-9a-f-]{36}$/i.test(id) || !RESEARCH_STATUSES.includes(status as ResearchStatus)) {
    return json({ detail: "Invalid research request update" }, 400);
  }
  const item = await updateResearchRequest({
    id,
    status: status as ResearchStatus,
    resolvedTechnologyId:
      typeof body.resolvedTechnologyId === "string" ? body.resolvedTechnologyId.trim().slice(0, 120) : null,
    resolutionNote:
      typeof body.resolutionNote === "string" ? body.resolutionNote.trim().slice(0, 500) : null,
    sourceCount: Number(body.sourceCount || 0),
  });
  return item ? json({ item }) : json({ detail: "Research request not found" }, 404);
}
