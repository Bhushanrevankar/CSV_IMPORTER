import { GoogleGenAI } from "@google/genai";
import {
  crmRecordSchema,
  CrmRecord,
  SkippedRecord,
  CRM_STATUS_VALUES,
  DATA_SOURCE_VALUES,
} from "../schemas/importSchemas";

// ─── Configuration ──────────────────────────────────────────────────────────

const BATCH_SIZE = 10;
const MAX_CONCURRENCY = 3;
const MAX_RETRIES = 2;
const RETRY_DELAYS_MS = [1000, 3000];
const MODEL_NAME = "gemini-2.5-flash";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ExtractionResult {
  imported: CrmRecord[];
  skipped: SkippedRecord[];
}

// ─── Gemini Client (lazy singleton) ─────────────────────────────────────────

let cachedClient: GoogleGenAI | null = null;

function getGeminiClient(): GoogleGenAI {
  if (cachedClient) return cachedClient;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY environment variable is not set");
  }
  cachedClient = new GoogleGenAI({ apiKey });
  return cachedClient;
}

// ─── System Prompt ──────────────────────────────────────────────────────────

function buildSystemPrompt(): string {
  const statusValues = CRM_STATUS_VALUES.map((v) => `"${v}"`).join(", ");
  const sourceValues = DATA_SOURCE_VALUES.map((v) => `"${v}"`).join(", ");

  return `You are a data extraction assistant. Your job is to map arbitrary CSV row data to the CRM schema below.

For each input row object, produce exactly one output JSON object with ALL of these fields (use empty string "" when no data is available — never use null, never omit a field):

  created_at                    — Lead creation date, in the format "YYYY-MM-DD HH:MM:SS", extracted directly from the source data (e.g. a date/timestamp column). If no date is present anywhere in the row, output empty string "" — do NOT guess, invent, or substitute today's date.
  name                          — Lead's full name.
  email                         — Primary email address.
  country_code                  — Phone country code (e.g. "+91"). Infer from context if possible.
  mobile_without_country_code   — Mobile number WITHOUT country code.
  company                       — Company / organisation name.
  city                          — City.
  state                         — State / province.
  country                       — Country.
  lead_owner                    — Lead owner (email or name of assignee).
  crm_status                    — MUST be exactly one of: ${statusValues}, or "" if uncertain.
  crm_note                      — Catch-all for remarks, follow-ups, extra emails, extra phone numbers, anything useful that doesn't fit another field.
  data_source                   — MUST be exactly one of: ${sourceValues}, or "" if none match confidently.
  possession_time               — Property possession timeframe.
  description                   — Additional description or context.

STRICT RULES:
1. crm_status and data_source MUST be one of the exact allowed values listed above, or empty string "". Never invent new values.
2. If multiple emails exist in a row: first one → email field, remaining ones appended into crm_note.
3. If multiple mobile numbers exist in a row: first one → mobile_without_country_code, remaining ones appended into crm_note.
4. If a field has no data, use empty string "". NEVER use null or omit the field.
5. No raw line breaks inside any field value. Use "\\n" if a note needs a line break.
6. Return ONLY a valid JSON array of objects — no markdown fences, no commentary, no explanation.
7. The output array MUST have exactly the same number of elements as the input array, in the same order.`;
}

// ─── Delay helper ───────────────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Single Batch Call with Retry ───────────────────────────────────────────
// JSON parsing + array shape validation happens inside the retry loop so that
// malformed responses from Gemini are retried (spec requirement).

async function callGeminiForBatch(
  client: GoogleGenAI,
  batchRows: Record<string, string>[],
  systemPrompt: string
): Promise<unknown[]> {
  const userMessage = JSON.stringify(batchRows);
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const waitMs = RETRY_DELAYS_MS[attempt - 1] ?? 3000;
      console.log(
        `  ↻ Retrying batch (attempt ${attempt + 1}/${MAX_RETRIES + 1}) after ${waitMs}ms...`
      );
      await delay(waitMs);
    }

    try {
      const response = await client.models.generateContent({
        model: MODEL_NAME,
        contents: userMessage,
        config: {
          systemInstruction: systemPrompt,
          temperature: 0,
          responseMimeType: "application/json",
        },
      });

      const text = response.text;
      if (!text || text.trim().length === 0) {
        throw new Error("Empty response from Gemini");
      }

      // Parse JSON inside the retry loop — malformed JSON triggers retry
      let cleaned = text.trim();
      if (cleaned.startsWith("```")) {
        cleaned = cleaned
          .replace(/^```(?:json)?\n?/, "")
          .replace(/\n?```$/, "");
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(cleaned);
      } catch {
        throw new Error("Gemini returned malformed JSON");
      }

      if (!Array.isArray(parsed)) {
        throw new Error("Gemini response was not a JSON array");
      }

      return parsed;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.error(
        `  ✗ Gemini batch attempt ${attempt + 1}/${MAX_RETRIES + 1} failed:`,
        lastError.message
      );
    }
  }

  throw lastError ?? new Error("Gemini call failed after retries");
}

// ─── Process & Validate Batch Result ────────────────────────────────────────
// Receives pre-parsed unknown[] (JSON parsing + array validation already
// handled inside callGeminiForBatch's retry loop).

function processBatchResult(
  parsed: unknown[],
  originalRows: Record<string, string>[]
): ExtractionResult {
  const imported: CrmRecord[] = [];
  const skipped: SkippedRecord[] = [];

  // Zip AI output with original rows
  for (let i = 0; i < originalRows.length; i++) {
    const aiRow = parsed[i];
    const originalRow = originalRows[i];

    // AI didn't return enough rows
    if (aiRow === undefined || aiRow === null) {
      skipped.push({
        originalRow,
        reason: "AI did not return a result for this row",
      });
      continue;
    }

    // Validate through Zod (handles null→"", missing→"", bad enums→reject)
    const result = crmRecordSchema.safeParse(aiRow);

    if (!result.success) {
      skipped.push({ originalRow, reason: "AI validation failed" });
      continue;
    }

    const record = result.data;

    // Skip rule: must have at least email or mobile
    if (!record.email && !record.mobile_without_country_code) {
      skipped.push({
        originalRow,
        reason: "no email or mobile number found",
      });
      continue;
    }

    imported.push(record);
  }

  return { imported, skipped };
}

// ─── Utility: chunk an array ────────────────────────────────────────────────

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

// ─── Main Export ────────────────────────────────────────────────────────────

export async function extractRecords(
  rows: Record<string, string>[]
): Promise<ExtractionResult> {
  const client = getGeminiClient();
  const systemPrompt = buildSystemPrompt();

  // Split into batches of BATCH_SIZE rows
  const batches = chunkArray(rows, BATCH_SIZE);
  console.log(
    `Processing ${rows.length} rows in ${batches.length} batch(es)...`
  );

  const allImported: CrmRecord[] = [];
  const allSkipped: SkippedRecord[] = [];

  // Process batches in groups of MAX_CONCURRENCY
  const concurrencyGroups = chunkArray(batches, MAX_CONCURRENCY);

  for (let g = 0; g < concurrencyGroups.length; g++) {
    const group = concurrencyGroups[g];
    console.log(
      `  Concurrency group ${g + 1}/${concurrencyGroups.length} (${group.length} batch(es))...`
    );

    const batchPromises = group.map(async (batchRows, batchIndex) => {
      const globalBatchIndex =
        g * MAX_CONCURRENCY + batchIndex + 1;

      try {
        console.log(
          `    Batch ${globalBatchIndex}/${batches.length}: ${batchRows.length} rows`
        );
        const parsedBatch = await callGeminiForBatch(
          client,
          batchRows,
          systemPrompt
        );
        return processBatchResult(parsedBatch, batchRows);
      } catch {
        // All retries exhausted — mark entire batch as skipped
        console.error(
          `    ✗ Batch ${globalBatchIndex} failed after all retries`
        );
        const skipped: SkippedRecord[] = batchRows.map((row) => ({
          originalRow: row,
          reason: "AI provider error after retries",
        }));
        return { imported: [] as CrmRecord[], skipped };
      }
    });

    const results = await Promise.all(batchPromises);

    for (const result of results) {
      allImported.push(...result.imported);
      allSkipped.push(...result.skipped);
    }
  }

  console.log(
    `Done: ${allImported.length} imported, ${allSkipped.length} skipped`
  );

  return { imported: allImported, skipped: allSkipped };
}
