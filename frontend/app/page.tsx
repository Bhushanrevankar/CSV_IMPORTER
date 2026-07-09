"use client";

import { useState, useRef, useCallback, type DragEvent, type ChangeEvent } from "react";
import Papa from "papaparse";
import styles from "./page.module.css";

// ─── Constants ──────────────────────────────────────────────────────────────

const PREVIEW_CAP = 200;
const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:3001";

// ─── Types ──────────────────────────────────────────────────────────────────

type RowObject = Record<string, string>;

interface ImportSummary {
  totalRows: number;
  totalImported: number;
  totalSkipped: number;
}

interface CrmRecord {
  created_at: string;
  name: string;
  email: string;
  country_code: string;
  mobile_without_country_code: string;
  company: string;
  city: string;
  state: string;
  country: string;
  lead_owner: string;
  crm_status: string;
  crm_note: string;
  data_source: string;
  possession_time: string;
  description: string;
}

interface SkippedRecord {
  originalRow: RowObject;
  reason: string;
}

interface ImportSuccessResponse {
  success: true;
  summary: ImportSummary;
  imported: CrmRecord[];
  skipped: SkippedRecord[];
}

interface ImportErrorResponse {
  success: false;
  error: { code: string; message: string };
}

type ImportResponse = ImportSuccessResponse | ImportErrorResponse;

// ─── Page Component ─────────────────────────────────────────────────────────

export default function Home() {
  // File & parse state
  const [fileName, setFileName] = useState<string>("");
  const [parsedRows, setParsedRows] = useState<RowObject[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [dragActive, setDragActive] = useState(false);

  // Import state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportSuccessResponse | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── File Handling ────────────────────────────────────────────────────────

  const handleFile = useCallback((file: File) => {
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setError("Please upload a .csv file");
      return;
    }

    setError(null);
    setResult(null);

    Papa.parse<RowObject>(file, {
      header: true,
      skipEmptyLines: true,
      complete(results) {
        const rows = results.data;
        if (rows.length === 0) {
          setError("CSV file is empty or has no data rows");
          return;
        }
        const cols = results.meta.fields ?? Object.keys(rows[0]);
        setFileName(file.name);
        setHeaders(cols);
        setParsedRows(rows);
      },
      error(err) {
        setError(`Failed to parse CSV: ${err.message}`);
      },
    });
  }, []);

  const handleDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragActive(false);
      const file = e.dataTransfer.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragActive(true);
  }, []);

  const handleDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragActive(false);
  }, []);

  const handleInputChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
      // Reset input so the same file can be re-selected
      e.target.value = "";
    },
    [handleFile]
  );

  const clearFile = useCallback(() => {
    setFileName("");
    setParsedRows([]);
    setHeaders([]);
    setResult(null);
    setError(null);
  }, []);

  // ── Import ───────────────────────────────────────────────────────────────

  const handleConfirm = useCallback(async () => {
    if (parsedRows.length === 0) return;

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch(`${API_BASE}/api/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName, rows: parsedRows }),
      });

      const data: ImportResponse = await res.json();

      if (!data.success) {
        const msg = errorMessageForCode(data.error.code, data.error.message);
        setError(msg);
      } else {
        setResult(data);
      }
    } catch {
      setError("Network error — could not reach the server. Is the backend running?");
    } finally {
      setLoading(false);
    }
  }, [parsedRows, fileName]);

  // ── Render helpers ───────────────────────────────────────────────────────

  const previewRows = parsedRows.slice(0, PREVIEW_CAP);
  const isTruncated = parsedRows.length > PREVIEW_CAP;
  const hasFile = parsedRows.length > 0;

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        {/* ── Header ── */}
        <header className={styles.header}>
          <div className={styles.logo}>
            <div className={styles.logoIcon}>⚡</div>
            <span className={styles.logoText}>GrowEasy</span>
          </div>
          <h1 className={styles.title}>AI-Powered CSV Importer</h1>
          <p className={styles.subtitle}>
            Drop your CSV file and let AI map every column to the CRM schema
            automatically.
          </p>
        </header>

        {/* ── Dropzone ── */}
        {!result && (
          <div
            className={`${styles.dropzone} ${dragActive ? styles.dropzoneActive : ""}`}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                fileInputRef.current?.click();
              }
            }}
            role="button"
            tabIndex={0}
            aria-label="Upload CSV file"
          >
            <div className={styles.dropzoneIcon}>📄</div>
            <p className={styles.dropzoneTitle}>
              Drag &amp; drop your CSV file here
            </p>
            <p className={styles.dropzoneSubtitle}>
              or{" "}
              <span className={styles.dropzoneBrowse}>browse files</span> — .csv
              only
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              className={styles.fileInput}
              onChange={handleInputChange}
            />
          </div>
        )}

        {/* ── Error Banner ── */}
        {error && (
          <div className={styles.errorBanner} role="alert">
            <span className={styles.errorIcon}>⚠️</span>
            <div className={styles.errorBody}>
              <p className={styles.errorTitle}>Import Error</p>
              <p className={styles.errorMessage}>{error}</p>
            </div>
            <button
              className={styles.errorDismiss}
              onClick={() => setError(null)}
              aria-label="Dismiss error"
            >
              ✕
            </button>
          </div>
        )}

        {/* ── File Info Bar ── */}
        {hasFile && !result && (
          <div className={styles.fileInfo}>
            <div className={styles.fileDetails}>
              <div className={styles.fileIcon}>✅</div>
              <div>
                <p className={styles.fileName}>{fileName}</p>
                <p className={styles.fileStats}>
                  {parsedRows.length.toLocaleString()} row
                  {parsedRows.length !== 1 ? "s" : ""} · {headers.length} column
                  {headers.length !== 1 ? "s" : ""}
                </p>
              </div>
            </div>
            <div className={styles.fileActions}>
              <button className={styles.removeBtn} onClick={clearFile}>
                Remove
              </button>
              <button
                className={styles.confirmBtn}
                disabled={loading}
                onClick={handleConfirm}
              >
                {loading ? (
                  <>
                    <span className={styles.spinner} />
                    Processing…
                  </>
                ) : (
                  "Confirm Import"
                )}
              </button>
            </div>
          </div>
        )}

        {/* ── Preview Table (before import) ── */}
        {hasFile && !result && (
          <section className={styles.previewSection}>
            <div className={styles.sectionHeader}>
              <h2 className={styles.sectionTitle}>
                Preview
                <span className={styles.badge}>{headers.length} columns</span>
              </h2>
              {isTruncated && (
                <p className={styles.truncationNotice}>
                  Showing first {PREVIEW_CAP} of{" "}
                  {parsedRows.length.toLocaleString()} rows — full data will be
                  sent on import
                </p>
              )}
            </div>
            <DataTable headers={["#", ...headers]} rows={previewRows} showIndex />
          </section>
        )}

        {/* ── Results (after import) ── */}
        {result && <ResultsView result={result} onReset={clearFile} />}
      </div>
    </div>
  );
}

// ─── Data Table Component ───────────────────────────────────────────────────

function DataTable({
  headers,
  rows,
  showIndex = false,
}: {
  headers: string[];
  rows: RowObject[];
  showIndex?: boolean;
}) {
  return (
    <div className={styles.tableWrapper}>
      <div className={styles.tableScroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              {headers.map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const dataHeaders = showIndex ? headers.slice(1) : headers;
              return (
                <tr key={i}>
                  {showIndex && (
                    <td className={styles.rowIndex}>{i + 1}</td>
                  )}
                  {dataHeaders.map((h) => (
                    <td key={h}>{row[h] ?? ""}</td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Results View Component ─────────────────────────────────────────────────

function ResultsView({
  result,
  onReset,
}: {
  result: ImportSuccessResponse;
  onReset: () => void;
}) {
  const { summary, imported, skipped } = result;

  const importedHeaders = imported.length > 0 ? Object.keys(imported[0]) : [];
  const skippedOriginalHeaders =
    skipped.length > 0 ? Object.keys(skipped[0].originalRow) : [];

  return (
    <div style={{ animation: `slideUp var(--duration-slow) var(--ease-out)` }}>
      {/* Summary Cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: "16px",
          marginBottom: "32px",
        }}
      >
        <SummaryCard label="Total Rows" value={summary.totalRows} icon="📊" />
        <SummaryCard
          label="Imported"
          value={summary.totalImported}
          icon="✅"
          accent="var(--accent-emerald)"
        />
        <SummaryCard
          label="Skipped"
          value={summary.totalSkipped}
          icon="⏭️"
          accent={summary.totalSkipped > 0 ? "var(--accent-amber)" : "var(--accent-emerald)"}
        />
      </div>

      {/* Imported Table */}
      {imported.length > 0 && (
        <section className={styles.previewSection}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>
              Imported Records
              <span className={styles.badge}>{imported.length}</span>
            </h2>
          </div>
          <DataTable
            headers={["#", ...importedHeaders]}
            rows={imported.map((r) => r as unknown as RowObject)}
            showIndex
          />
        </section>
      )}

      {/* Skipped Table */}
      {skipped.length > 0 && (
        <section className={styles.previewSection}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>
              Skipped Records
              <span className={styles.badge}>{skipped.length}</span>
            </h2>
          </div>
          <div className={styles.tableWrapper}>
            <div className={styles.tableScroll}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>#</th>
                    {skippedOriginalHeaders.map((h) => (
                      <th key={h}>{h}</th>
                    ))}
                    <th>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {skipped.map((s, i) => (
                    <tr key={i}>
                      <td className={styles.rowIndex}>{i + 1}</td>
                      {skippedOriginalHeaders.map((h) => (
                        <td key={h}>{s.originalRow[h] ?? ""}</td>
                      ))}
                      <td style={{ color: "var(--accent-amber)" }}>
                        {s.reason}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {/* New Import Button */}
      <div style={{ textAlign: "center", marginTop: "40px" }}>
        <button className={styles.confirmBtn} onClick={onReset}>
          Import Another File
        </button>
      </div>
    </div>
  );
}

// ─── Summary Card ───────────────────────────────────────────────────────────

function SummaryCard({
  label,
  value,
  icon,
  accent,
}: {
  label: string;
  value: number;
  icon: string;
  accent?: string;
}) {
  return (
    <div
      style={{
        background: "var(--bg-surface)",
        border: "1px solid var(--border-subtle)",
        borderRadius: "var(--radius-lg)",
        padding: "20px 24px",
        display: "flex",
        alignItems: "center",
        gap: "16px",
      }}
    >
      <span style={{ fontSize: "28px" }}>{icon}</span>
      <div>
        <p
          style={{
            fontSize: "1.6rem",
            fontWeight: 700,
            color: accent ?? "var(--text-primary)",
            lineHeight: 1.2,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {value.toLocaleString()}
        </p>
        <p
          style={{
            fontSize: "0.8rem",
            color: "var(--text-muted)",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            fontWeight: 500,
          }}
        >
          {label}
        </p>
      </div>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function errorMessageForCode(code: string, fallback: string): string {
  switch (code) {
    case "INVALID_REQUEST":
      return `Invalid request: ${fallback}`;
    case "FILE_TOO_LARGE":
      return `File too large: ${fallback}`;
    case "AI_PROVIDER_ERROR":
      return `AI processing failed: ${fallback}`;
    case "INTERNAL_ERROR":
      return `Server error: ${fallback}`;
    default:
      return fallback;
  }
}
