import cors from "cors";
import express from "express";
import type { Request } from "express";
import { apiRouter } from "./routes/api.js";
import { webhookRouter, webhookYCloudRouter } from "./routes/webhook.js";
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
    const host = new URL(origin).hostname;
    if (host === "localhost" || host === "127.0.0.1" || host.startsWith("192.168.") || host.startsWith("10.")) {
      callback(null, true);
      return;
    }
  } catch {
    callback(null, false);
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
  const jsonConCuerpoCrudo = express.json({
    verify: (req, _res, buf) => {
      (req as Request & { cuerpoCrudo?: Buffer }).cuerpoCrudo = Buffer.from(buf);
    },
  });
  app.use("/webhook/whatsapp", jsonConCuerpoCrudo, webhookRouter);
  app.use("/webhook/ycloud", jsonConCuerpoCrudo, webhookYCloudRouter);
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
