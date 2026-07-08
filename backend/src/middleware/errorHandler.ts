import { Request, Response, NextFunction } from "express";

// ─── Error Codes (matching spec Section 4) ──────────────────────────────────

type ErrorCode =
  | "INVALID_REQUEST"
  | "FILE_TOO_LARGE"
  | "AI_PROVIDER_ERROR"
  | "INTERNAL_ERROR";

// ─── Custom Error Class ─────────────────────────────────────────────────────

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: ErrorCode,
    message: string
  ) {
    super(message);
    this.name = "AppError";
  }
}

// ─── Express Error-Handling Middleware ───────────────────────────────────────

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  console.error(`[Error] ${err.name}: ${err.message}`);

  // Known application errors
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      error: { code: err.code, message: err.message },
    });
    return;
  }

  // Express body-parser "entity too large" errors
  if ("type" in err && (err as Record<string, unknown>).type === "entity.too.large") {
    res.status(413).json({
      success: false,
      error: { code: "FILE_TOO_LARGE", message: "Request payload is too large" },
    });
    return;
  }

  // Unexpected / unhandled errors — never leak internals
  res.status(500).json({
    success: false,
    error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
  });
}
