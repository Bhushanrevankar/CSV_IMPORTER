# Project Spec: AI-Powered CSV Importer for GrowEasy CRM

## 1. Architecture (decided — do not deviate)

- **Frontend**: Next.js (App Router, TypeScript), deployed separately (e.g. Vercel)
- **Backend**: Node.js + Express (standalone REST API, TypeScript), deployed separately (e.g. Render/Railway)
- **AI Provider**: Google Gemini API — model: `gemini-2.0-flash` (free tier)
- **Database**: None. Fully stateless — no persistence layer, no ORM, no ID lookups.
- **CSV Parsing (frontend)**: PapaParse
- **Validation (backend)**: Zod, for both incoming request shape and AI response shape
- **Communication**: Frontend calls backend only via the documented REST contract below (Section 4). No direct frontend → Gemini calls.

Do not introduce a database, auth layer, or additional services beyond this. Keep the folder structure as two independent projects: `/frontend` and `/backend`.

---

## 2. User Flow

1. **Upload** — user drags/drops or picks a CSV file.
2. **Parse & Preview (client-side only, no network call)** — PapaParse reads the file in-browser, result stored in React state. Render a preview table (sticky header, horizontal + vertical scroll, responsive). No AI call happens here.
3. **Confirm** — user clicks "Confirm Import." Only now does the frontend POST the parsed rows to the backend.
4. **Backend processes** — validates request, batches rows, calls Gemini per batch, validates/repairs AI output, aggregates results.
5. **Result Display** — frontend shows a results table: parsed records, skipped records (with reason), total imported, total skipped. Clear error state if the request fails entirely (network error, backend 5xx, invalid file, etc.).

---

## 3. CRM Target Schema

```
created_at                    - Lead creation date (must satisfy `new Date(created_at)` in JS)
name                          - Lead name
email                         - Primary email
country_code                 - Country code (e.g. +91)
mobile_without_country_code  - Mobile number, no country code
company                       - Company name
city                          - City
state                         - State
country                       - Country
lead_owner                    - Lead owner
crm_status                    - Lead status (see allowed values below)
crm_note                      - Notes/remarks/extra emails/extra phones
data_source                   - Source (see allowed values below)
possession_time               - Property possession time
description                   - Additional description
```

### Allowed `crm_status` values — use ONLY one of these exact strings:
- `GOOD_LEAD_FOLLOW_UP`
- `DID_NOT_CONNECT`
- `BAD_LEAD`
- `SALE_DONE`

### Allowed `data_source` values — use ONLY one of these exact strings, or leave blank if none match confidently:
- `leads_on_demand`
- `meridian_tower`
- `eden_park`
- `varah_swamy`
- `sarjapur_plots`

### Extraction rules (must be enforced, not just prompted for — validate server-side too)
- `crm_status` and `data_source` must exactly match one of the allowed enum values listed above, or be blank. Never invent new values. If the AI returns something outside the enum, treat it as blank/unmapped and flag the record for review rather than silently accepting it.
- If multiple emails exist in a row: first one → `email`, remaining ones appended into `crm_note`.
- If multiple mobile numbers exist in a row: first one → `mobile_without_country_code`, remaining ones appended into `crm_note`.
- `crm_note` is a catch-all for remarks, follow-ups, extra contact info, anything useful that doesn't fit a named field.
- A row is **skipped** if it has neither a usable email nor a usable mobile number. Skipped records must be returned with a human-readable `reason` (e.g. `"no email or mobile number found"`).
- Each output record must remain valid as a single CSV row conceptually — no unescaped raw line breaks inside any field (use `\n` if a line break is genuinely needed within a note).

---

## 4. Backend API Contract

### `POST /api/import`

**Request body:**
```json
{
  "fileName": "leads_export.csv",
  "rows": [
    { "Full Name": "John Doe", "Email Address": "john@x.com", "Phone": "9876543210", "City": "Mumbai" },
    { "Full Name": "Sarah J", "Email Address": "sarah@x.com", "Phone": "9876543211", "City": "Pune" }
  ]
}
```
- `rows` is an array of arbitrary key-value objects — exact keys are unknown ahead of time and must not be assumed. This is the raw parsed CSV data from PapaParse (header row used as keys).
- Validate this shape with Zod on the backend: `fileName: string`, `rows: array of Record<string, string>` (min 1 row, reasonable max e.g. 5000 rows — reject larger with a clear 413/422 error).

**Success response (200):**
```json
{
  "success": true,
  "summary": {
    "totalRows": 50,
    "totalImported": 45,
    "totalSkipped": 5
  },
  "imported": [
    {
      "created_at": "2026-05-13 14:20:48",
      "name": "John Doe",
      "email": "john@x.com",
      "country_code": "+91",
      "mobile_without_country_code": "9876543210",
      "company": "",
      "city": "Mumbai",
      "state": "",
      "country": "India",
      "lead_owner": "",
      "crm_status": "GOOD_LEAD_FOLLOW_UP",
      "crm_note": "",
      "data_source": "",
      "possession_time": "",
      "description": ""
    }
  ],
  "skipped": [
    {
      "originalRow": { "Full Name": "Jane", "Notes": "no contact info given" },
      "reason": "no email or mobile number found"
    }
  ]
}
```

**Error response (4xx/5xx):**
```json
{
  "success": false,
  "error": {
    "code": "INVALID_REQUEST" ,
    "message": "rows must be a non-empty array"
  }
}
```
Error codes to implement: `INVALID_REQUEST` (400, bad shape), `FILE_TOO_LARGE` (413, exceeds row limit), `AI_PROVIDER_ERROR` (502, Gemini call failed after retries), `INTERNAL_ERROR` (500, unexpected).

The frontend must handle all of these distinctly and show a specific, human-readable error message — not a generic "something went wrong." A plain try/catch around the fetch call, with a switch on `error.code` to pick the displayed message, is sufficient.

---

## 5. Batching Logic (backend, be specific — do not leave this to the model's judgment)

- Split `rows` into batches of **10 rows per Gemini call** (tune down to 5 if you observe truncated/invalid JSON in testing — this is a token-budget safety margin, not a hard architectural constraint).
- Process batches **sequentially with limited concurrency** (e.g. max 3 batches in flight at once via `Promise.all` chunking) — not all at once, to avoid Gemini free-tier rate limit errors (429s).
- Each batch call to Gemini must:
  1. Send the batch rows + system prompt (schema, enum values, mapping rules) in one request.
  2. Request a strict JSON array response — one object per input row, in the same order, so results can be zipped back to their original row for the skip/import decision.
  3. On response, run the result through the same Zod schema used for `imported` records. If a row fails schema validation (bad enum value, missing required shape, malformed JSON) or the AI's own judgment marks it invalid, treat as skipped with reason `"AI validation failed"` rather than crashing the whole batch.
- **Retry logic**: if a batch call fails (network error, 429, malformed JSON that can't be repaired) retry up to 2 times with a short backoff (e.g. 1s, 3s) before giving up and marking every row in that batch as skipped with reason `"AI provider error after retries"`. Never let one bad batch fail the entire import — always return partial results for the batches that succeeded.
- Keep the Gemini call and its retry/validation logic in a single isolated module (e.g. `services/aiExtractor.ts`) so it's easy to swap providers later or unit test independently of Express routing.

---

## 6. Frontend Requirements (specific)

- **Dropzone**: drag-and-drop + file picker, accept `.csv` only, show filename once selected.
- **Parsing**: use PapaParse with `header: true` to parse into an array of row objects, `skipEmptyLines: true`. Store the parsed array in React state (`useState`) — do not touch the backend yet.
- **Preview table**: render from that state — sticky header, scrollable both directions, responsive (horizontal scroll wrapper on small screens). Show all parsed rows or a reasonable cap (e.g. first 200) with an indicator if truncated for preview purposes only (the full data set is still sent on confirm).
- **Confirm button**: disabled while no file is loaded; on click, POST `{ fileName, rows }` to `/api/import`, show a loading state (spinner/progress text) for the duration of the request.
- **Result table**: after a successful response, render `imported` records in one table and `skipped` records (with reason) in a second section/table, plus the `summary` counts prominently at the top.
- **Error state**: if the POST fails or returns `success: false`, show a dismissible error banner with the specific message from `error.message`, and let the user retry without re-uploading the file (keep parsed rows in state so Confirm can be clicked again).

---

## 7. Explicit Non-Goals (do not build unless core flow is fully working first)
- No database, no auth, no user accounts.
- No dark mode, no unit tests, no Docker, no virtualized tables — only add these after steps 1–6 work end-to-end.
- No multi-file batch upload — single CSV file per import only.

---

## 8. Build Order for the Agent
1. Scaffold `/frontend` (Next.js + TypeScript) and `/backend` (Express + TypeScript) as two separate projects in the repo root.
2. Backend: Zod schemas first (request shape, CRM record shape, enum values) — these are the source of truth both API validation and the AI extraction step will use. Use `z.infer<typeof schema>` to derive TypeScript types directly from each Zod schema rather than writing separate `interface`/`type` declarations — this keeps validation and typing in sync with zero duplication.
3. Backend: `services/aiExtractor.ts` — Gemini call + batching + retry + validation, unit-testable in isolation (mock Gemini response to verify skip/validation logic before wiring real API key).
4. Backend: Express route `/api/import` wiring request validation → aiExtractor → response contract above.
5. Frontend: dropzone + PapaParse + preview table (steps 1–2 of user flow), no backend call yet.
6. Frontend: Confirm button wiring to backend contract, loading state, results table, error banner.
7. End-to-end test with the sample CSV data below.
8. README with setup instructions (env vars needed: `GEMINI_API_KEY`, backend port, frontend API base URL).

---

## 9. Sample CRM Records (target output format reference)

```csv
created_at,name,email,country_code,mobile_without_country_code,company,city,state,country,lead_owner,crm_status,crm_note,data_source,possession_time,description

2026-05-13 14:20:48,John Doe,john.doe@example.com,+91,9876543210,GrowEasy,Mumbai,Maharashtra,India,test@gmail.com,GOOD_LEAD_FOLLOW_UP,Client is asking to reschedule demo,,,

2026-05-13 14:25:30,Sarah Johnson,sarah.johnson@example.com,+91,9876543211,Tech Solutions,Bangalore,Karnataka,India,test@gmail.com,DID_NOT_CONNECT,"Person was busy, will try again next week",,,

2026-05-13 14:30:15,Rajesh Patel,rajesh.patel@example.com,+91,9876543212,Startup Inc,Delhi,Delhi,India,test@gmail.com,BAD_LEAD,Not interested in our services,,,

2026-05-13 14:35:22,Priya Singh,priya.singh@example.com,+91,9876543213,Enterprise Corp,Pune,Maharashtra,India,test@gmail.com,SALE_DONE,"Deal closed, onboarding in progress",,,
```
