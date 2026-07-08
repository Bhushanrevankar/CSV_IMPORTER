import { z } from "zod";

// ─── Enum Values (source of truth for validation + AI prompt) ───────────────

export const CRM_STATUS_VALUES = [
  "GOOD_LEAD_FOLLOW_UP",
  "DID_NOT_CONNECT",
  "BAD_LEAD",
  "SALE_DONE",
] as const;

export const DATA_SOURCE_VALUES = [
  "leads_on_demand",
  "meridian_tower",
  "eden_park",
  "varah_swamy",
  "sarjapur_plots",
] as const;

// ─── CRM Record Schema (what the AI must produce per row) ───────────────────

export const crmRecordSchema = z.object({
  created_at: z.string().default(""),
  name: z.string().default(""),
  email: z.string().default(""),
  country_code: z.string().default(""),
  mobile_without_country_code: z.string().default(""),
  company: z.string().default(""),
  city: z.string().default(""),
  state: z.string().default(""),
  country: z.string().default(""),
  lead_owner: z.string().default(""),
  crm_status: z
    .enum(CRM_STATUS_VALUES)
    .or(z.literal(""))
    .default(""),
  crm_note: z.string().default(""),
  data_source: z
    .enum(DATA_SOURCE_VALUES)
    .or(z.literal(""))
    .default(""),
  possession_time: z.string().default(""),
  description: z.string().default(""),
});

export type CrmRecord = z.infer<typeof crmRecordSchema>;

// ─── Skipped Record Schema ──────────────────────────────────────────────────

export const skippedRecordSchema = z.object({
  originalRow: z.record(z.string(), z.string()),
  reason: z.string(),
});

export type SkippedRecord = z.infer<typeof skippedRecordSchema>;

// ─── Import Request Schema (what the frontend POSTs) ────────────────────────

export const MAX_ROWS = 5000;

export const importRequestSchema = z.object({
  fileName: z.string().min(1, "fileName is required"),
  rows: z
    .array(z.record(z.string(), z.string()))
    .min(1, "rows must be a non-empty array")
    .max(MAX_ROWS, `rows exceeds maximum of ${MAX_ROWS}`),
});

export type ImportRequest = z.infer<typeof importRequestSchema>;

// ─── Import Response Schemas (what the backend returns) ─────────────────────

export const importSummarySchema = z.object({
  totalRows: z.number(),
  totalImported: z.number(),
  totalSkipped: z.number(),
});

export type ImportSummary = z.infer<typeof importSummarySchema>;

export const importSuccessResponseSchema = z.object({
  success: z.literal(true),
  summary: importSummarySchema,
  imported: z.array(crmRecordSchema),
  skipped: z.array(skippedRecordSchema),
});

export type ImportSuccessResponse = z.infer<typeof importSuccessResponseSchema>;

// ─── Error Codes ────────────────────────────────────────────────────────────

export const ERROR_CODES = [
  "INVALID_REQUEST",
  "FILE_TOO_LARGE",
  "AI_PROVIDER_ERROR",
  "INTERNAL_ERROR",
] as const;

export const importErrorResponseSchema = z.object({
  success: z.literal(false),
  error: z.object({
    code: z.enum(ERROR_CODES),
    message: z.string(),
  }),
});

export type ImportErrorResponse = z.infer<typeof importErrorResponseSchema>;

// ─── AI Batch Response Schema (what we expect from Gemini per batch) ────────
// The AI must return a JSON array of CRM records, one per input row.

export const aiBatchResponseSchema = z.array(crmRecordSchema);

export type AiBatchResponse = z.infer<typeof aiBatchResponseSchema>;
