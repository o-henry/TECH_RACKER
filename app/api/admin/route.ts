import { NextRequest, NextResponse } from "next/server";
import { getChatGPTUser } from "../../chatgpt-auth";

const ACTIONS = {
  run_collectors: "/api/v1/admin/automation/run-collectors",
  pause: "/api/v1/admin/automation/pause",
  resume: "/api/v1/admin/automation/resume",
} as const;

function automationBaseUrl(): string {
  const raw = process.env.PRIVATE_AUTOMATION_BASE_URL?.trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    const localHttp = parsed.protocol === "http:" && ["localhost", "127.0.0.1"].includes(parsed.hostname);
    if (parsed.protocol !== "https:" && !localHttp) return "";
    if (parsed.username || parsed.password) return "";
    return parsed.href.replace(/\/$/, "");
  } catch {
    return "";
  }
}

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

async function authorize() {
  return getChatGPTUser();
}

async function proxy(path: string, method: "GET" | "POST") {
  const baseUrl = automationBaseUrl();
  const controlToken = process.env.BACKEND_CONTROL_TOKEN?.trim();
  if (!baseUrl || !controlToken) {
    return json({ configured: false, status: "unconfigured", detail: "Automation backend connection waiting" }, 503);
  }

  try {
    const upstream = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${controlToken}`,
        ...(method === "POST" ? { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() } : {}),
      },
      body: method === "POST" ? "{}" : undefined,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(12_000),
    });
    const contentType = upstream.headers.get("content-type") || "";
    if (!contentType.toLowerCase().includes("application/json")) {
      return json({ configured: true, status: "error", detail: "Unexpected backend response" }, 502);
    }
    const payload = await upstream.json();
    return json({ configured: true, upstreamStatus: upstream.status, result: payload }, upstream.ok ? 200 : 502);
  } catch {
    return json({ configured: true, status: "error", detail: "Automation backend unavailable" }, 502);
  }
}

export async function GET() {
  const user = await authorize();
  if (!user) return json({ detail: "Authentication required" }, 401);
  return proxy("/api/v1/admin/automation/status", "GET");
}

export async function POST(request: NextRequest) {
  const user = await authorize();
  if (!user) return json({ detail: "Authentication required" }, 401);

  const origin = request.headers.get("origin");
  if (!origin || origin !== request.nextUrl.origin || request.headers.get("x-tracker-admin-request") !== "1") {
    return json({ detail: "Cross-site request rejected" }, 403);
  }

  let body: { action?: string };
  try {
    body = await request.json();
  } catch {
    return json({ detail: "Invalid JSON body" }, 400);
  }

  const action = body.action as keyof typeof ACTIONS;
  if (!Object.hasOwn(ACTIONS, action)) return json({ detail: "Action not allowed" }, 403);
  return proxy(ACTIONS[action], "POST");
}
