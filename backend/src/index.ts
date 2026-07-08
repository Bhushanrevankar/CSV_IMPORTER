import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import importRoute from "./routes/importRoute";
import { errorHandler } from "./middleware/errorHandler";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// ─── Middleware ─────────────────────────────────────────────────────────────

app.use(cors());
app.use(express.json({ limit: "50mb" }));

// ─── Routes ─────────────────────────────────────────────────────────────────

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/api/import", importRoute);

// ─── Error Handler (must be registered last) ───────────────────────────────

app.use(errorHandler);

// ─── Start Server ───────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);
  console.log(`GEMINI_API_KEY: ${process.env.GEMINI_API_KEY ? "set" : "NOT SET"}`);
});

export default app;
