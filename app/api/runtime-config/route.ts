import { NextResponse } from "next/server";

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

export async function GET() {
  const apiBaseUrl = normalizeApiBase(process.env.PUBLIC_API_BASE_URL);
  return NextResponse.json(
    { apiBaseUrl, configured: Boolean(apiBaseUrl) },
    { headers: { "Cache-Control": "no-store, max-age=0", "X-Content-Type-Options": "nosniff" } },
  );
}
