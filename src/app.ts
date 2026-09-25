import cors from "cors";
import express from "express";
import { apiRouter } from "./routes/api.js";
import { errorHandler } from "./middleware/errorHandler.js";

function corsOrigin(origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) {
  if (!origin) {
    callback(null, true);
    return;
  }
  const allowed = (process.env.CORS_ORIGIN ?? "http://localhost:3000")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (allowed.includes("*") || allowed.includes(origin)) {
    callback(null, true);
    return;
  }
  try {
    if (new URL(origin).hostname.endsWith(".vercel.app")) {
      callback(null, true);
      return;
    }
  } catch {
    callback(null, false);
    return;
  }
  callback(null, false);
}

export function createApp() {
  const app = express();
  app.use(cors({ origin: corsOrigin }));
  app.use(express.json());
  app.get("/", (_req, res) => {
    res.json({
      name: "Barber Shop EL CALENTANO API",
      currency: "MXN",
      docs: "/api/health",
    });
  });
  app.use("/api", apiRouter);
  app.use(errorHandler);
  return app;
}
