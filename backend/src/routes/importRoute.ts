import { Router, Request, Response } from "express";
import {
  importRequestSchema,
  MAX_ROWS,
  ImportSuccessResponse,
} from "../schemas/importSchemas";
import { extractRecords } from "../services/aiExtractor";
import { AppError } from "../middleware/errorHandler";

const router = Router();

router.post("/", async (req: Request, res: Response) => {
  // ── 1. Check row count first → specific 413 ──────────────────────────────
  const rawRows = req.body?.rows;
  if (Array.isArray(rawRows) && rawRows.length > MAX_ROWS) {
    throw new AppError(
      413,
      "FILE_TOO_LARGE",
      `rows exceeds maximum of ${MAX_ROWS}`
    );
  }

  // ── 2. Validate full request shape with Zod ──────────────────────────────
  const parsed = importRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    const firstMessage =
      parsed.error?.issues?.[0]?.message ?? "Invalid request body";
    throw new AppError(400, "INVALID_REQUEST", firstMessage);
  }

  const { fileName, rows } = parsed.data;
  console.log(`\nImport request: "${fileName}" — ${rows.length} row(s)`);

  // ── 3. Run AI extraction ─────────────────────────────────────────────────
  let imported, skipped;
  try {
    ({ imported, skipped } = await extractRecords(rows));
  } catch (error) {
    // extractRecords only throws for fatal issues (e.g. missing API key);
    // per-batch failures are handled internally and returned as skipped rows.
    throw new AppError(
      502,
      "AI_PROVIDER_ERROR",
      error instanceof Error ? error.message : "AI extraction failed"
    );
  }

  // ── 4. Build response per spec Section 4 ─────────────────────────────────
  const response: ImportSuccessResponse = {
    success: true,
    summary: {
      totalRows: rows.length,
      totalImported: imported.length,
      totalSkipped: skipped.length,
    },
    imported,
    skipped,
  };

  res.json(response);
});

export default router;
