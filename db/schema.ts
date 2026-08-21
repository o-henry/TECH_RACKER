import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const technologyResearchRequests = sqliteTable(
  "technology_research_requests",
  {
    id: text("id").primaryKey(),
    query: text("query").notNull(),
    normalizedQuery: text("normalized_query").notNull(),
    status: text("status").notNull().default("pending"),
    requestedBy: text("requested_by").notNull(),
    requestedAt: text("requested_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    resolvedTechnologyId: text("resolved_technology_id"),
    resolutionNote: text("resolution_note"),
    sourceCount: integer("source_count").notNull().default(0),
  },
  (table) => [
    uniqueIndex("technology_research_requests_normalized_query_unique").on(
      table.normalizedQuery,
    ),
    index("technology_research_requests_status_updated_idx").on(
      table.status,
      table.updatedAt,
    ),
  ],
);

export const technologyDeepAnalysisRequests = sqliteTable(
  "technology_deep_analysis_requests",
  {
    id: text("id").primaryKey(),
    technologyId: text("technology_id").notNull(),
    technologyName: text("technology_name").notNull(),
    status: text("status").notNull().default("pending"),
    requestedBy: text("requested_by").notNull(),
    requestedAt: text("requested_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    verifiedThrough: text("verified_through"),
    analysisModel: text("analysis_model"),
    resolutionNote: text("resolution_note"),
    sourceCount: integer("source_count").notNull().default(0),
    resultJson: text("result_json"),
  },
  (table) => [
    uniqueIndex("technology_deep_analysis_requests_technology_unique").on(
      table.technologyId,
    ),
    index("technology_deep_analysis_requests_status_updated_idx").on(
      table.status,
      table.updatedAt,
    ),
  ],
);
