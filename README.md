# GrowEasy AI-Powered CSV Importer

An AI-powered CSV importer that intelligently maps arbitrary CRM lead export formats (Facebook Lead Ads, Google Ads exports, Excel sheets, real estate CRM exports, manually created spreadsheets, etc.) into GrowEasy's standardized CRM schema — without assuming any fixed column names or layout.

Built for the GrowEasy Software Developer assignment.

**Position applied for:** _[Software Developer Intern / Software Developer (Full-Time) — fill in]_

---

## Live Demo

- **Frontend:** https://csv-importer-iota.vercel.app
- **Backend API:** https://pleasing-friendship-production-7186.up.railway.app

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js (App Router) + TypeScript |
| Backend | Node.js + Express + TypeScript |
| AI | Google Gemini API (`gemini-2.5-flash`) |
| CSV Parsing | PapaParse (client-side) |
| Validation | Zod (request validation + AI response validation, both frontend and backend types derived via `z.infer`) |
| Database | None — fully stateless |

---

## How It Works

1. **Upload** — user drags & drops (or picks) a CSV file. Nothing is sent to the server yet.
2. **Parse & Preview** — the file is parsed client-side with PapaParse and shown in a scrollable, sticky-header preview table exactly as uploaded. No AI processing happens at this stage.
3. **Confirm Import** — only when the user clicks "Confirm Import" does the frontend send the parsed rows to the backend.
4. **AI Extraction** — the backend batches the rows (10 rows per batch, up to 3 batches processed concurrently) and sends each batch to Gemini with a system prompt describing the target CRM schema, the allowed enum values, and the field-mapping rules from the assignment spec.
5. **Validation** — every AI-returned record is validated against a Zod schema before being accepted. Missing/null fields default to blank; invalid enum values are rejected rather than silently accepted; malformed batch responses are retried (up to 2 retries with backoff) before being marked as failed.
6. **Results** — the frontend displays imported records, skipped records (with a human-readable reason for each), and summary counts.

---

## Key Design Decisions

- **No database.** The app is fully stateless by design — CSV in, structured JSON out, nothing persisted server-side.
- **Batching with bounded concurrency.** Rows are split into batches of 10 to stay within safe token/response limits per Gemini call, and at most 3 batches run concurrently to avoid free-tier rate limiting.
- **Strict server-side validation, not just prompt trust.** The AI is instructed to follow strict rules (allowed enum values, no null/omitted fields, no fabricated dates), but the backend independently validates every field via Zod rather than trusting the prompt alone — because LLM output can still occasionally deviate from instructions.
- **Skip logic:** any row missing both an email and a mobile number is excluded from `imported` and placed in `skipped` with an explicit reason, per the assignment's rules.
- **Multiple emails/phones:** the first value is kept in the primary field; any additional values are appended into `crm_note` rather than discarded.

---

## Known Considerations

- **Transient Gemini errors:** the Gemini API occasionally returns transient errors (e.g. `503` under high demand, or intermittent `404`/`429` responses) rather than a real, permanent failure. To handle this, each batch is retried up to 2 times with backoff (1s, then 3s) before being marked as failed. If a batch still fails after all retries, only that batch's rows are skipped with reason `"AI provider error after retries"` — the rest of the import still completes and returns partial results, rather than failing the whole request.

---

## Local Setup

### Prerequisites
- Node.js 18+
- A Gemini API key ([Google AI Studio](https://aistudio.google.com))

### 1. Clone the repo
```bash
git clone https://github.com/Bhushanrevankar/CSV_IMPORTER.git
cd CSV_IMPORTER
```

### 2. Backend setup
```bash
cd backend
npm install
cp .env.example .env
```
Edit `backend/.env` and add your real Gemini API key:
```
GEMINI_API_KEY=your_actual_key_here
PORT=3001
```
Start the backend:
```bash
npm run dev
```
The backend should log:
```
Backend running on http://localhost:3001
GEMINI_API_KEY: set
```

### 3. Frontend setup
Open a new terminal:
```bash
cd frontend
npm install
```
Create `frontend/.env.local`:
```
NEXT_PUBLIC_API_BASE=http://localhost:3001
```
Start the frontend:
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

### 4. Try it out
Upload any CSV with lead data — column names and layout can vary freely (that's the whole point). A good test file includes: a clean row with all fields present, a row with multiple emails/phones, a row with an invalid/unexpected status value, a row missing both email and phone (to test the skip logic), and a row with a non-standard date format.

---

## API Reference

### `POST /api/import`

**Request:**
```json
{
  "fileName": "leads.csv",
  "rows": [
    { "Full Name": "John Doe", "Email": "john@example.com", "Phone": "9876543210" }
  ]
}
```

**Success response:**
```json
{
  "success": true,
  "summary": { "totalRows": 1, "totalImported": 1, "totalSkipped": 0 },
  "imported": [ /* CRM-formatted records */ ],
  "skipped": [ /* { originalRow, reason } */ ]
}
```

**Error response:**
```json
{
  "success": false,
  "error": { "code": "INVALID_REQUEST", "message": "..." }
}
```
Error codes: `INVALID_REQUEST` (400), `FILE_TOO_LARGE` (413, max 5000 rows per request), `AI_PROVIDER_ERROR` (502), `INTERNAL_ERROR` (500).

---

## Project Structure
```
CSV_IMPORTER/
├── frontend/          # Next.js app (upload, preview, results UI)
│   └── src/app/page.tsx
├── backend/           # Express API
│   └── src/
│       ├── index.ts               # Express app entry point
│       ├── routes/importRoute.ts  # POST /api/import
│       ├── services/aiExtractor.ts # Gemini batching, retry, validation
│       ├── schemas/importSchemas.ts # Zod schemas + derived types
│       └── middleware/errorHandler.ts
└── README.md
```
