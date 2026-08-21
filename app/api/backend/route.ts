import { NextRequest, NextResponse } from "next/server";

const ALLOWED_PATHS = [
  /^\/api\/v1\/health$/,
  /^\/api\/v1\/technologies(?:\/[a-z0-9-]+)?$/,
  /^\/api\/v1\/evidence$/,
  /^\/api\/v1\/ingestion-runs$/,
];

function normalizeApiBase(value: string | undefined): string {
  const raw = value?.trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    const localHttp = parsed.protocol === "http:" && (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1");
    if (parsed.protocol !== "https:" && !localHttp) return "";
    return parsed.href.replace(/\/$/, "");
  } catch {
    return "";
  }
}

export async function GET(request: NextRequest) {
  const apiBaseUrl = normalizeApiBase(process.env.PUBLIC_API_BASE_URL);
  if (!apiBaseUrl) {
    return NextResponse.json({ detail: "Data connection waiting" }, { status: 503 });
  }

  const requested = request.nextUrl.searchParams.get("path") || "";
  let parsedPath: URL;
  try {
    parsedPath = new URL(requested, "https://site-proxy.invalid");
  } catch {
    return NextResponse.json({ detail: "Invalid API path" }, { status: 400 });
  }

  if (parsedPath.origin !== "https://site-proxy.invalid" || !ALLOWED_PATHS.some(pattern => pattern.test(parsedPath.pathname))) {
    return NextResponse.json({ detail: "API path not allowed" }, { status: 403 });
  }

  const upstreamUrl = new URL(`${apiBaseUrl}${parsedPath.pathname}`);
  upstreamUrl.search = parsedPath.search;

  try {
    const upstream = await fetch(upstreamUrl, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(12_000),
    });
    const contentType = upstream.headers.get("content-type") || "";
    if (!contentType.toLowerCase().includes("application/json")) {
      return NextResponse.json({ detail: "Unexpected upstream response" }, { status: 502 });
    }
    return new Response(await upstream.text(), {
      status: upstream.status,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json({ detail: "External API unavailable" }, { status: 502 });
  }
}
