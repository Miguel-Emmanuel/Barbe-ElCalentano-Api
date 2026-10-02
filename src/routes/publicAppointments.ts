import { Router, type Request } from "express";
import { z } from "zod";
import { AppError } from "../lib/errors.js";
import { assertLookupAllowed } from "../lib/lookupLimit.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import * as pub from "../services/publicAppointmentService.js";

export const publicRouter = Router();

function callerKey(req: Request) {
  const forwarded = req.headers["x-forwarded-for"];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return (raw?.split(",")[0] || req.ip || "local").trim();
}

publicRouter.post(
  "/appointments/lookup",
  asyncHandler(async (req, res) => {
    assertLookupAllowed(callerKey(req));
    const schema = z.object({
      phone: z.string().min(10).max(16),
      code: z.string().min(4).max(12),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError("NOT_FOUND", "No encontramos esa cita.", 404);
    }
    const data = await pub.lookupPublicAppointment(parsed.data.phone, parsed.data.code);
    res.json({ ok: true, data });
  }),
);

publicRouter.get(
  "/appointments/:token/slots",
  asyncHandler(async (req, res) => {
    const schema = z.object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      barberId: z.string().min(1).optional(),
    });
    const parsed = schema.safeParse(req.query);
    if (!parsed.success) {
      throw new AppError("VALIDATION_ERROR", "Elige una fecha válida.", 422);
    }
    const data = await pub.publicSlots(req.params.token, parsed.data.date, parsed.data.barberId);
    res.json({ ok: true, data });
  }),
);

publicRouter.get(
  "/appointments/:token",
  asyncHandler(async (req, res) => {
    const data = await pub.getPublicAppointment(req.params.token);
    res.json({ ok: true, data });
  }),
);

publicRouter.post(
  "/appointments/:token/cancel",
  asyncHandler(async (req, res) => {
    const data = await pub.cancelPublicAppointment(req.params.token);
    res.json({
      ok: true,
      data,
      message: data.cancellation.message,
    });
  }),
);

publicRouter.post(
  "/appointments/:token/reschedule",
  asyncHandler(async (req, res) => {
    const schema = z.object({
      startAt: z.string().min(1),
      barberId: z.string().min(1),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError("VALIDATION_ERROR", "Elige barbero y horario.", 422);
    }
    const data = await pub.reschedulePublicAppointment(
      req.params.token,
      parsed.data.startAt,
      parsed.data.barberId,
    );
    res.json({ ok: true, data, message: "Tu cita quedó en el nuevo horario." });
  }),
);
