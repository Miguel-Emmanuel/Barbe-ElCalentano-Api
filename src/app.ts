import cors from "cors";
import express from "express";
import { apiRouter } from "./routes/api.js";
import { errorHandler } from "./middleware/errorHandler.js";

export function createApp() {
  const app = express();
  app.use(
    cors({
      origin: process.env.CORS_ORIGIN?.split(",") ?? ["http://localhost:3000"],
    }),
  );
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
