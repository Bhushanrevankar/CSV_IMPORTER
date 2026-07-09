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

// ─── Helpers for AI output (Gemini may return null, undefined, or string) ───

/** Accepts string | null | undefined → always outputs string (defaults to "") */
const aiString = () =>
  z
    .union([z.string(), z.null()])
    .optional()
    .transform((v) => v ?? "");

/** Accepts a valid enum value, empty string, null, or undefined → outputs enum value or "" */
const aiEnum = <T extends readonly [string, ...string[]]>(values: T) =>
  z
    .union([z.enum(values), z.literal(""), z.null()])
    .catch("")
    .optional()
    .transform((v) => v ?? "");

// ─── CRM Record Schema (what the AI must produce per row) ───────────────────

export const crmRecordSchema = z.object({
  created_at: aiString(),
  name: aiString(),
  email: aiString(),
  country_code: aiString(),
  mobile_without_country_code: aiString(),
  company: aiString(),
  city: aiString(),
  state: aiString(),
  country: aiString(),
  lead_owner: aiString(),
  crm_status: aiEnum(CRM_STATUS_VALUES),
  crm_note: aiString(),
  data_source: aiEnum(DATA_SOURCE_VALUES),
  possession_time: aiString(),
  description: aiString(),
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
