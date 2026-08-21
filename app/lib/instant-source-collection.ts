import { env } from "cloudflare:workers";

export type InstantSource = {
  sourceType: "peer_literature" | "official_registry" | "public_interest";
  publisher: string;
  title: string;
  url: string;
  eventDate: string;
  publishedDate: string;
  note: string;
};

export type InstantSourceCollection = {
  technologyId: string;
  status: "completed" | "partial" | "failed";
  collectedAt: string;
  checkedSources: string[];
  sources: InstantSource[];
  errors: string[];
  cached: boolean;
};

type CollectionRow = {
  technology_id: string;
  status: string;
  collected_at: string;
  checked_sources_json: string;
  sources_json: string;
  errors_json: string;
};

type CollectionProfile = {
  query: string;
  trends: string[];
  clinical?: boolean;
};

const PROFILES: Record<string, CollectionProfile> = {
  "alzheimer-blood-test": { query: "plasma p-tau217 Alzheimer blood test", trends: ["p-tau217", "Alzheimer blood test", "알츠하이머 혈액검사"], clinical: true },
  "in-vivo-gene-editing": { query: "in vivo CRISPR gene editing therapy", trends: ["in vivo CRISPR", "gene editing therapy", "체내 유전자 편집"], clinical: true },
  "personalized-cancer-vaccine": { query: "personalized neoantigen cancer vaccine", trends: ["personalized cancer vaccine", "neoantigen vaccine", "개인 맞춤형 암 백신"], clinical: true },
  xenokidney: { query: "gene edited pig kidney xenotransplantation", trends: ["pig kidney transplant", "xenotransplantation", "돼지 신장 이식"], clinical: true },
  "stem-cell-islets": { query: "stem cell derived islet type 1 diabetes", trends: ["stem cell islet", "zimislecel", "줄기세포 췌도세포"], clinical: true },
  "perovskite-tandem": { query: "perovskite silicon tandem solar cell", trends: ["perovskite tandem solar", "페로브스카이트 탠덤"] },
  "enhanced-geothermal": { query: "enhanced geothermal systems field demonstration", trends: ["enhanced geothermal", "EGS geothermal", "향상형 지열"] },
  "direct-air-capture": { query: "direct air capture carbon dioxide removal", trends: ["direct air capture", "carbon removal", "직접공기포집"] },
  "fusion-power": { query: "fusion energy plasma confinement materials", trends: ["fusion power", "fusion energy", "핵융합 발전"] },
  "fault-tolerant-quantum": { query: "fault tolerant quantum computing logical qubit", trends: ["fault tolerant quantum", "logical qubit", "오류보정 양자컴퓨팅"] },
  robotaxi: { query: "robotaxi autonomous ride hailing safety", trends: ["robotaxi", "Waymo", "로보택시"] },
  "implantable-bci": { query: "implantable brain computer interface human clinical", trends: ["implantable BCI", "brain computer interface", "Neuralink"], clinical: true },
  "humanoid-robots": { query: "general purpose humanoid robot deployment", trends: ["humanoid robot", "Optimus robot", "휴머노이드 로봇"] },
  "cultivated-meat": { query: "cultivated meat bioreactor scale up", trends: ["cultivated meat", "cultured meat", "배양육"] },
  "sodium-ion-battery": { query: "sodium ion battery commercial manufacturing", trends: ["sodium ion battery", "나트륨이온 배터리"] },
  "ai-weather-forecasting": { query: "AI weather forecasting operational prediction", trends: ["AI weather forecasting", "GraphCast", "WeatherNext", "AI 기상예보"] },
  "commercial-space-stations": { query: "commercial low earth orbit space station", trends: ["commercial space station", "Orbital Reef", "Starlab"] },
  "agentic-coding-systems": { query: "agentic coding software engineering agent benchmark", trends: ["agentic coding", "coding agent", "에이전트 코딩"] },
  "ai-scientific-discovery": { query: "AI scientist autonomous scientific discovery", trends: ["AI scientific discovery", "AI scientist", "AI 과학 발견"] },
  "on-device-agentic-ai": { query: "on-device agentic AI edge inference", trends: ["on-device agentic AI", "on-device AI agent", "온디바이스 AI 에이전트"] },
  "vision-language-action-models": { query: "vision language action model robotics", trends: ["vision language action", "VLA model", "시각 언어 행동 모델"] },
  "high-na-euv": { query: "High NA EUV lithography yield", trends: ["High-NA EUV", "high numerical aperture EUV", "고개구수 EUV"] },
  "co-packaged-optics": { query: "co-packaged optics optical interconnect", trends: ["co-packaged optics", "CPO networking", "공동 패키징 광학"] },
  "ai-protein-design": { query: "AI protein design experimental validation", trends: ["AI protein design", "protein binder design", "AI 단백질 설계"] },
  "ai-materials-discovery": { query: "AI materials discovery autonomous laboratory", trends: ["AI materials discovery", "autonomous materials lab", "AI 소재 발견"] },
  "car-t-autoimmune": { query: "CAR T therapy autoimmune disease clinical", trends: ["CAR-T autoimmune", "CAR T autoimmune", "자가면역 CAR-T"], clinical: true },
  "grid-forming-inverters": { query: "grid forming inverter field demonstration", trends: ["grid-forming inverter", "grid forming inverter", "계통형성 인버터"] },
  "hydrogen-direct-reduced-iron": { query: "hydrogen direct reduced iron steel pilot", trends: ["hydrogen DRI", "hydrogen direct reduced iron", "수소 직접환원철"] },
  "backside-power-delivery": { query: "backside power delivery semiconductor process", trends: ["backside power delivery", "PowerVia", "반도체 후면 전력"] },
  "satellite-direct-to-device": { query: "satellite direct to device cellular smartphone", trends: ["satellite direct to device", "direct-to-device satellite", "위성 스마트폰 직접 통신"] },
};

let schemaReady: Promise<void> | null = null;

function database(): D1Database {
  if (!env.DB) throw new Error("D1 binding DB is unavailable");
  return env.DB;
}

async function ensureCollectionSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = database().batch([
      database().prepare(`CREATE TABLE IF NOT EXISTS technology_instant_source_collections (
        technology_id TEXT PRIMARY KEY NOT NULL,
        status TEXT NOT NULL,
        collected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        checked_sources_json TEXT NOT NULL,
        sources_json TEXT NOT NULL,
        errors_json TEXT NOT NULL
      )`),
      database().prepare(
        "CREATE INDEX IF NOT EXISTS technology_instant_source_collections_collected_idx ON technology_instant_source_collections (collected_at DESC)",
      ),
    ]).then(() => undefined).catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  return schemaReady;
}

function safeParseList<T>(value: string): T[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function collectionFromRow(row: CollectionRow, cached: boolean): InstantSourceCollection {
  const status = ["completed", "partial", "failed"].includes(row.status)
    ? (row.status as InstantSourceCollection["status"])
    : "failed";
  return {
    technologyId: row.technology_id,
    status,
    collectedAt: row.collected_at,
    checkedSources: safeParseList<string>(row.checked_sources_json),
    sources: safeParseList<InstantSource>(row.sources_json),
    errors: safeParseList<string>(row.errors_json),
    cached,
  };
}

export async function findInstantSourceCollection(technologyId: string): Promise<InstantSourceCollection | null> {
  await ensureCollectionSchema();
  const row = await database()
    .prepare(`SELECT technology_id, status, collected_at, checked_sources_json, sources_json, errors_json
      FROM technology_instant_source_collections WHERE technology_id = ? LIMIT 1`)
    .bind(technologyId)
    .first<CollectionRow>();
  return row ? collectionFromRow(row, true) : null;
}

function cleanText(value: unknown, max = 700): string {
  return typeof value === "string" ? value.normalize("NFKC").replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function cleanHttps(value: unknown): string {
  const raw = cleanText(value, 2_000);
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "https:" ? parsed.href : "";
  } catch {
    return "";
  }
}

function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

async function fixedFetch(url: string, accept: string, maxBytes = 600_000): Promise<string> {
  const response = await fetch(url, {
    headers: { Accept: accept },
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(7_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > maxBytes) throw new Error("response too large");
  const text = await response.text();
  if (text.length > maxBytes) throw new Error("response too large");
  return text;
}

async function collectOpenAlex(profile: CollectionProfile): Promise<InstantSource[]> {
  const fromYear = new Date().getUTCFullYear() - 2;
  const params = new URLSearchParams({
    search: profile.query,
    filter: `from_publication_date:${fromYear}-01-01`,
    sort: "publication_date:desc",
    "per-page": "4",
    select: "id,doi,display_name,publication_date,updated_date,type,is_retracted,primary_location",
  });
  const payload = JSON.parse(await fixedFetch(`https://api.openalex.org/works?${params}`, "application/json")) as {
    results?: Array<Record<string, unknown>>;
  };
  return (payload.results || []).filter((work) => !work.is_retracted).map((work) => {
    const location = work.primary_location && typeof work.primary_location === "object"
      ? work.primary_location as Record<string, unknown>
      : {};
    const source = location.source && typeof location.source === "object"
      ? location.source as Record<string, unknown>
      : {};
    const url = cleanHttps(location.landing_page_url) || cleanHttps(work.doi) || cleanHttps(work.id);
    return {
      sourceType: "peer_literature" as const,
      publisher: cleanText(source.display_name) || "OpenAlex",
      title: cleanText(work.display_name),
      url,
      eventDate: cleanText(work.publication_date, 40) || "미확인",
      publishedDate: cleanText(work.publication_date, 40) || "미확인",
      note: cleanText(work.type) || "논문 메타데이터",
    };
  }).filter((source) => source.title && source.url);
}

async function collectClinicalTrials(profile: CollectionProfile): Promise<InstantSource[]> {
  if (!profile.clinical) return [];
  const params = new URLSearchParams({
    "query.term": profile.query,
    pageSize: "4",
    format: "json",
    sort: "LastUpdatePostDate:desc",
  });
  const payload = JSON.parse(await fixedFetch(
    `https://clinicaltrials.gov/api/v2/studies?${params}`,
    "application/json",
  )) as { studies?: Array<Record<string, unknown>> };
  return (payload.studies || []).map((study) => {
    const protocol = study.protocolSection && typeof study.protocolSection === "object"
      ? study.protocolSection as Record<string, unknown>
      : {};
    const identification = protocol.identificationModule && typeof protocol.identificationModule === "object"
      ? protocol.identificationModule as Record<string, unknown>
      : {};
    const status = protocol.statusModule && typeof protocol.statusModule === "object"
      ? protocol.statusModule as Record<string, unknown>
      : {};
    const lastUpdate = status.lastUpdatePostDateStruct && typeof status.lastUpdatePostDateStruct === "object"
      ? status.lastUpdatePostDateStruct as Record<string, unknown>
      : {};
    const start = status.startDateStruct && typeof status.startDateStruct === "object"
      ? status.startDateStruct as Record<string, unknown>
      : {};
    const nctId = cleanText(identification.nctId, 30);
    return {
      sourceType: "official_registry" as const,
      publisher: "ClinicalTrials.gov",
      title: cleanText(identification.briefTitle),
      url: nctId ? `https://clinicaltrials.gov/study/${encodeURIComponent(nctId)}` : "",
      eventDate: cleanText(start.date, 40) || "미확인",
      publishedDate: cleanText(lastUpdate.date, 40) || "미확인",
      note: `${nctId || "식별자 미확인"} · ${cleanText(status.overallStatus, 80) || "상태 미확인"}`,
    };
  }).filter((source) => source.title && source.url);
}

function xmlTag(block: string, tag: string): string {
  const match = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return cleanText(match ? decodeXml(match[1]) : "");
}

async function collectGoogleTrends(profile: CollectionProfile): Promise<InstantSource[]> {
  const aliases = profile.trends.map((value) => value.toLocaleLowerCase("en-US"));
  const feeds = await Promise.all(["KR", "US"].map(async (geo) => ({
    geo,
    xml: await fixedFetch(`https://trends.google.com/trending/rss?geo=${geo}`, "application/rss+xml, text/xml"),
  })));
  const collected: InstantSource[] = [];
  for (const feed of feeds) {
    const items = feed.xml.match(/<item>[\s\S]*?<\/item>/gi) || [];
    for (const item of items) {
      const title = xmlTag(item, "title");
      const description = xmlTag(item, "description");
      const haystack = `${title} ${description}`.toLocaleLowerCase("en-US");
      if (!aliases.some((alias) => haystack.includes(alias))) continue;
      const link = cleanHttps(xmlTag(item, "link")) || `https://trends.google.com/trending?geo=${feed.geo}`;
      const published = xmlTag(item, "pubDate") || "미확인";
      collected.push({
        sourceType: "public_interest",
        publisher: `Google Trends ${feed.geo}`,
        title,
        url: link,
        eventDate: published,
        publishedDate: published,
        note: "공적 관심 신호 · 기술 진전 근거 아님",
      });
    }
  }
  return collected.slice(0, 4);
}

function deduplicateSources(sources: InstantSource[]): InstantSource[] {
  const seen = new Set<string>();
  return sources.filter((source) => {
    const key = `${source.url}|${source.title}`.toLocaleLowerCase("en-US");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 12);
}

export async function collectAndStoreTechnologySources(input: {
  technologyId: string;
  technologyName: string;
  technologyNameEn?: string;
}): Promise<InstantSourceCollection> {
  await ensureCollectionSchema();
  const existing = await findInstantSourceCollection(input.technologyId);
  if (existing && Date.now() - Date.parse(existing.collectedAt) < 10 * 60 * 1_000) return existing;

  const profile = PROFILES[input.technologyId] || {
    query: cleanText(input.technologyNameEn, 180) || cleanText(input.technologyName, 180),
    trends: [cleanText(input.technologyNameEn, 180), cleanText(input.technologyName, 180)].filter(Boolean),
  };
  const jobs: Array<{ name: string; run: () => Promise<InstantSource[]> }> = [
    { name: "OpenAlex", run: () => collectOpenAlex(profile) },
    { name: "Google Trends KR·US", run: () => collectGoogleTrends(profile) },
  ];
  if (profile.clinical) jobs.splice(1, 0, { name: "ClinicalTrials.gov", run: () => collectClinicalTrials(profile) });

  const settled = await Promise.allSettled(jobs.map((job) => job.run()));
  const sources: InstantSource[] = [];
  const errors: string[] = [];
  settled.forEach((result, index) => {
    if (result.status === "fulfilled") sources.push(...result.value);
    else errors.push(`${jobs[index].name}: 수집 실패`);
  });
  const uniqueSources = deduplicateSources(sources);
  const status: InstantSourceCollection["status"] = uniqueSources.length
    ? errors.length ? "partial" : "completed"
    : "failed";
  await database().prepare(`INSERT INTO technology_instant_source_collections
      (technology_id, status, collected_at, checked_sources_json, sources_json, errors_json)
      VALUES (?, ?, CURRENT_TIMESTAMP, ?, ?, ?)
      ON CONFLICT(technology_id) DO UPDATE SET
        status = excluded.status,
        collected_at = CURRENT_TIMESTAMP,
        checked_sources_json = excluded.checked_sources_json,
        sources_json = excluded.sources_json,
        errors_json = excluded.errors_json`)
    .bind(
      input.technologyId,
      status,
      JSON.stringify(jobs.map((job) => job.name)),
      JSON.stringify(uniqueSources),
      JSON.stringify(errors),
    )
    .run();
  const stored = await findInstantSourceCollection(input.technologyId);
  if (!stored) throw new Error("INSTANT_SOURCE_COLLECTION_SAVE_FAILED");
  return { ...stored, cached: false };
}
