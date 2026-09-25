import { Router } from "express";
import { z } from "zod";
import { AppError } from "../lib/errors.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import * as booking from "../services/bookingService.js";
import * as catalog from "../services/catalogService.js";
import * as auth from "../services/authService.js";
import * as notify from "../services/notifyService.js";

const AppointmentStatusEnum = z.enum([
  "SCHEDULED",
  "CONFIRMED",
  "CHECKED_IN",
  "COMPLETED",
  "CANCELLED",
  "NO_SHOW",
]);

export const apiRouter = Router();

function staffToken(req: { headers: { authorization?: string } }) {
  return auth.extractBearer(req.headers.authorization);
}

async function staff(req: { headers: { authorization?: string } }) {
  return auth.getUserFromToken(staffToken(req));
}

function superOnly(user: { isSuperAdmin: boolean }) {
  if (!user.isSuperAdmin) {
    throw new AppError("UNAUTHORIZED", "Solo el administrador puede hacer esto.", 403);
  }
}

function ownBarberId(user: { isSuperAdmin: boolean; barberId: string | null }) {
  if (user.isSuperAdmin) return undefined;
  if (!user.barberId) {
    throw new AppError("UNAUTHORIZED", "Tu usuario no está ligado a un barbero.", 403);
  }
  return user.barberId;
}

apiRouter.get(
  "/health",
  asyncHandler(async (_req, res) => {
    res.json({
      ok: true,
      service: "el-calentano-api",
      currency: "MXN",
      phases: ["mvp", "fase2", "fase3", "fase4", "fase5"],
    });
  }),
);

apiRouter.post(
  "/auth/login",
  asyncHandler(async (req, res) => {
    const schema = z.object({
      email: z.string().email(),
      password: z.string().min(4),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError("VALIDATION_ERROR", "Correo o contraseña inválidos.", 422);
    }
    const data = await auth.login(parsed.data.email, parsed.data.password);
    res.json({ ok: true, data });
  }),
);

apiRouter.post(
  "/auth/logout",
  asyncHandler(async (req, res) => {
    auth.logout(staffToken(req));
    res.json({ ok: true });
  }),
);

apiRouter.get(
  "/auth/me",
  asyncHandler(async (req, res) => {
    const user = await auth.getUserFromToken(staffToken(req));
    res.json({ ok: true, data: user });
  }),
);

apiRouter.get(
  "/branch",
  asyncHandler(async (_req, res) => {
    const branch = await booking.getBranch();
    res.json({ ok: true, data: branch });
  }),
);

apiRouter.get(
  "/services",
  asyncHandler(async (_req, res) => {
    const data = await booking.listServices();
    res.json({
      ok: true,
      currency: "MXN",
      data: data.map((s) => ({ ...s, priceMxn: s.priceCents / 100 })),
    });
  }),
);

apiRouter.get(
  "/admin/services",
  asyncHandler(async (req, res) => {
    auth.requireAuth(staffToken(req));
    const data = await catalog.listAllServices(true);
    res.json({
      ok: true,
      currency: "MXN",
      data: data.map((s) => ({ ...s, priceMxn: s.priceCents / 100 })),
    });
  }),
);

apiRouter.post(
  "/admin/services",
  asyncHandler(async (req, res) => {
    superOnly(await staff(req));
    const schema = z.object({
      id: z.string().optional(),
      code: z.string().min(2),
      name: z.string().min(2),
      description: z.string().optional(),
      durationMin: z.number().int().min(5).max(240),
      priceCents: z.number().int().min(0),
      category: z.string().min(2),
      allowsQuantity: z.boolean().optional(),
      active: z.boolean().optional(),
      sortOrder: z.number().int().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError("VALIDATION_ERROR", "Datos del servicio inválidos.", 422, parsed.error.flatten());
    }
    const data = await catalog.upsertService(parsed.data);
    res.status(parsed.data.id ? 200 : 201).json({ ok: true, data });
  }),
);

apiRouter.patch(
  "/admin/services/:id/active",
  asyncHandler(async (req, res) => {
    superOnly(await staff(req));
    const schema = z.object({ active: z.boolean() });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw new AppError("VALIDATION_ERROR", "Valor active inválido.", 422);
    const data = await catalog.setServiceActive(req.params.id, parsed.data.active);
    res.json({ ok: true, data });
  }),
);

apiRouter.get(
  "/barbers",
  asyncHandler(async (_req, res) => {
    const data = await booking.listBarbers();
    res.json({ ok: true, data });
  }),
);

apiRouter.get(
  "/availability",
  asyncHandler(async (req, res) => {
    const schema = z.object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      serviceId: z.string().min(1),
      barberId: z.string().min(1),
      quantity: z.coerce.number().int().min(1).max(2).optional(),
    });
    const parsed = schema.safeParse(req.query);
    if (!parsed.success) {
      throw new AppError("VALIDATION_ERROR", "Parámetros de disponibilidad inválidos.", 422);
    }
    const data = await booking.getAvailability(parsed.data);
    res.json({ ok: true, data });
  }),
);

apiRouter.post(
  "/appointments",
  asyncHandler(async (req, res) => {
    const schema = z.object({
      serviceId: z.string().min(1),
      barberId: z.string().min(1),
      startAt: z.string().min(1),
      clientName: z
        .string()
        .trim()
        .min(2, "Nombre muy corto")
        .max(80)
        .regex(/^[\p{L}\s.'’-]+$/u, "Nombre inválido"),
      clientPhone: z
        .string()
        .transform((v) => {
          const digits = v.replace(/\D/g, "");
          if (digits.length === 12 && digits.startsWith("52")) return digits.slice(2);
          if (digits.length === 13 && digits.startsWith("521")) return digits.slice(3);
          return digits;
        })
        .refine((v) => /^\d{10}$/.test(v), "Teléfono MX de 10 dígitos"),
      clientEmail: z.string().email().optional().or(z.literal("")),
      quantity: z.number().int().min(1).max(2).optional(),
      notes: z.string().trim().max(500).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError("VALIDATION_ERROR", "Revisa los datos de la reserva.", 422, parsed.error.flatten());
    }
    const body = parsed.data;
    const data = await booking.createAppointment({
      ...body,
      clientEmail: body.clientEmail || undefined,
      notes: body.notes || undefined,
    });
    res.status(201).json({
      ok: true,
      data,
      message: "Cita agendada. Pago en el local (MXN).",
    });
  }),
);

apiRouter.post(
  "/appointments/walk-in",
  asyncHandler(async (req, res) => {
    const user = await staff(req);
    const schema = z.object({
      serviceId: z.string().min(1),
      barberId: z.string().min(1).optional(),
      clientName: z.string().trim().min(2).max(80),
      clientPhone: z.string().optional(),
      quantity: z.number().int().min(1).max(2).optional(),
      notes: z.string().trim().max(500).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError("VALIDATION_ERROR", "Revisa el corte en local.", 422);
    }
    const barberId = user.isSuperAdmin ? parsed.data.barberId : user.barberId;
    if (!barberId) {
      throw new AppError("VALIDATION_ERROR", "Elige el barbero de este corte.", 422);
    }
    const data = await booking.createWalkIn({
      serviceId: parsed.data.serviceId,
      barberId,
      clientName: parsed.data.clientName,
      clientPhone: parsed.data.clientPhone,
      quantity: parsed.data.quantity,
      notes: parsed.data.notes,
    });
    res.status(201).json({ ok: true, data, message: data.message });
  }),
);

apiRouter.get(
  "/appointments",
  asyncHandler(async (req, res) => {
    const user = await staff(req);
    const q = typeof req.query.q === "string" ? req.query.q : undefined;
    const date = typeof req.query.date === "string" ? req.query.date : undefined;
    const dateFrom =
      typeof req.query.dateFrom === "string"
        ? req.query.dateFrom
        : date;
    const dateTo =
      typeof req.query.dateTo === "string"
        ? req.query.dateTo
        : date;
    const serviceId = typeof req.query.serviceId === "string" ? req.query.serviceId : undefined;
    const barberId = typeof req.query.barberId === "string" ? req.query.barberId : undefined;
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const hasCommissionRaw =
      typeof req.query.hasCommission === "string" ? req.query.hasCommission : undefined;
    const hasCommission =
      hasCommissionRaw === "yes" || hasCommissionRaw === "no" ? hasCommissionRaw : undefined;
    const minPrice =
      typeof req.query.minPrice === "string" && req.query.minPrice !== ""
        ? Math.round(Number(req.query.minPrice) * 100)
        : undefined;
    const maxPrice =
      typeof req.query.maxPrice === "string" && req.query.maxPrice !== ""
        ? Math.round(Number(req.query.maxPrice) * 100)
        : undefined;

    const filters = {
      dateFrom,
      dateTo,
      q,
      serviceId,
      barberId: ownBarberId(user) ?? barberId,
      status,
      minPriceCents: Number.isFinite(minPrice) ? minPrice : undefined,
      maxPriceCents: Number.isFinite(maxPrice) ? maxPrice : undefined,
      hasCommission,
    };

    // Sin filtros de rango: comportamiento agenda (un día o todo)
    const scopedBarber = ownBarberId(user);
    let data =
      date && !req.query.dateFrom && !req.query.dateTo && !q && !serviceId && !barberId && !scopedBarber && !status && !hasCommission && minPrice == null && maxPrice == null
        ? await booking.listAppointments(date)
        : await booking.searchAppointments(filters);
    if (date && !req.query.dateFrom && !req.query.dateTo) {
      data = data.slice().sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
    }

    res.json({ ok: true, currency: "MXN", data });
  }),
);

apiRouter.patch(
  "/appointments/:id/status",
  asyncHandler(async (req, res) => {
    const user = await staff(req);
    await booking.assertCanManageAppointment({
      isSuperAdmin: user.isSuperAdmin,
      barberId: user.barberId,
      appointmentId: req.params.id,
    });
    const schema = z.object({ status: AppointmentStatusEnum });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw new AppError("VALIDATION_ERROR", "Estado inválido.", 422);
    const data = await booking.updateAppointmentStatus(req.params.id, parsed.data.status);
    res.json({ ok: true, data });
  }),
);

apiRouter.post(
  "/appointments/:id/cancel",
  asyncHandler(async (req, res) => {
    const user = await staff(req);
    await booking.assertCanManageAppointment({
      isSuperAdmin: user.isSuperAdmin,
      barberId: user.barberId,
      appointmentId: req.params.id,
    });
    const data = await booking.cancelAppointment(req.params.id);
    res.json({ ok: true, data });
  }),
);

apiRouter.post(
  "/appointments/:id/reschedule",
  asyncHandler(async (req, res) => {
    const user = await staff(req);
    await booking.assertCanManageAppointment({
      isSuperAdmin: user.isSuperAdmin,
      barberId: user.barberId,
      appointmentId: req.params.id,
    });
    const schema = z.object({ startAt: z.string().min(1) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw new AppError("VALIDATION_ERROR", "Nueva hora requerida.", 422);
    const data = await booking.rescheduleAppointment(req.params.id, parsed.data.startAt);
    res.json({ ok: true, data, message: "Cita reprogramada." });
  }),
);

apiRouter.post(
  "/appointments/:id/pay",
  asyncHandler(async (req, res) => {
    const user = await staff(req);
    await booking.assertCanManageAppointment({
      isSuperAdmin: user.isSuperAdmin,
      barberId: user.barberId,
      appointmentId: req.params.id,
    });
    const schema = z.object({
      method: z.enum(["CASH", "CARD", "TRANSFER", "OTHER"]).optional(),
      tipCents: z.number().int().min(0).optional(),
    });
    const parsed = schema.safeParse(req.body ?? {});
    if (!parsed.success) throw new AppError("VALIDATION_ERROR", "Datos de pago inválidos.", 422);
    const data = await booking.markPaid({
      appointmentId: req.params.id,
      ...parsed.data,
    });
    res.json({ ok: true, data });
  }),
);

apiRouter.get(
  "/admin/stats",
  asyncHandler(async (req, res) => {
    superOnly(await staff(req));
    const date =
      typeof req.query.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)
        ? req.query.date
        : new Date().toISOString().slice(0, 10);
    const data = await catalog.dayStats(date);
    res.json({ ok: true, data });
  }),
);

apiRouter.get(
  "/admin/commissions",
  asyncHandler(async (req, res) => {
    const user = await staff(req);
    const date = typeof req.query.date === "string" ? req.query.date : undefined;
    const dateFrom =
      typeof req.query.dateFrom === "string" ? req.query.dateFrom : date;
    const dateTo = typeof req.query.dateTo === "string" ? req.query.dateTo : date;
    const data = await catalog.listCommissions({
      date,
      dateFrom,
      dateTo,
      barberId: ownBarberId(user),
    });
    res.json({ ok: true, currency: "MXN", data: data.rows, totals: data.totals });
  }),
);

apiRouter.get(
  "/admin/barbers",
  asyncHandler(async (req, res) => {
    const user = await staff(req);
    const data = await catalog.listAdminBarbers();
    const visible = user.isSuperAdmin
      ? data
      : data.filter((b) => b.id === user.barberId);
    res.json({ ok: true, data: visible });
  }),
);

apiRouter.patch(
  "/admin/barbers/:id/commission",
  asyncHandler(async (req, res) => {
    superOnly(await staff(req));
    const schema = z.object({
      commissionPercent: z.number().min(0).max(100),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError("VALIDATION_ERROR", "Porcentaje de comisión inválido.", 422);
    }
    const data = await catalog.updateBarberCommission(
      req.params.id,
      parsed.data.commissionPercent,
    );
    res.json({ ok: true, data });
  }),
);

apiRouter.post(
  "/waitlist",
  asyncHandler(async (req, res) => {
    const schema = z.object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      serviceId: z.string().min(1),
      barberId: z.string().optional(),
      clientName: z
        .string()
        .trim()
        .min(2)
        .max(80)
        .regex(/^[\p{L}\s.'’-]+$/u, "Nombre inválido"),
      clientPhone: z
        .string()
        .transform((v) => {
          const digits = v.replace(/\D/g, "");
          if (digits.length === 12 && digits.startsWith("52")) return digits.slice(2);
          if (digits.length === 13 && digits.startsWith("521")) return digits.slice(3);
          return digits;
        })
        .refine((v) => /^\d{10}$/.test(v), "Teléfono MX de 10 dígitos"),
      preferredTime: z.string().optional(),
      notes: z.string().trim().max(500).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError("VALIDATION_ERROR", "Revisa los datos de la lista de espera.", 422);
    }
    const data = await catalog.joinWaitlist({
      ...parsed.data,
      notes: parsed.data.notes || undefined,
    });
    res.status(201).json({
      ok: true,
      data,
      message: "Quedaste en lista de espera. Te contactamos si se libera un horario.",
    });
  }),
);

apiRouter.get(
  "/admin/waitlist",
  asyncHandler(async (req, res) => {
    superOnly(await staff(req));
    const date = typeof req.query.date === "string" ? req.query.date : undefined;
    const data = await catalog.listWaitlist(date);
    res.json({ ok: true, data });
  }),
);

apiRouter.patch(
  "/admin/waitlist/:id",
  asyncHandler(async (req, res) => {
    superOnly(await staff(req));
    const schema = z.object({
      status: z.enum(["WAITING", "NOTIFIED", "BOOKED", "CANCELLED"]),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw new AppError("VALIDATION_ERROR", "Estado de waitlist inválido.", 422);
    const data = await catalog.updateWaitlistStatus(req.params.id, parsed.data.status);
    res.json({ ok: true, data });
  }),
);

apiRouter.get(
  "/admin/products",
  asyncHandler(async (req, res) => {
    superOnly(await staff(req));
    const data = await catalog.listProducts();
    res.json({
      ok: true,
      currency: "MXN",
      data: data.map((p) => ({ ...p, priceMxn: p.priceCents / 100 })),
    });
  }),
);

apiRouter.post(
  "/admin/products",
  asyncHandler(async (req, res) => {
    superOnly(await staff(req));
    const schema = z.object({
      id: z.string().optional(),
      sku: z.string().min(2),
      name: z.string().min(2),
      description: z.string().optional(),
      priceCents: z.number().int().min(0),
      stock: z.number().int().min(0),
      active: z.boolean().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError("VALIDATION_ERROR", "Datos de producto inválidos.", 422);
    }
    const data = await catalog.upsertProduct(parsed.data);
    res.status(parsed.data.id ? 200 : 201).json({ ok: true, data });
  }),
);

apiRouter.post(
  "/admin/sales",
  asyncHandler(async (req, res) => {
    superOnly(await staff(req));
    const schema = z.object({
      items: z
        .array(
          z.object({
            productId: z.string().min(1),
            quantity: z.number().int().min(1),
          }),
        )
        .min(1),
      method: z.enum(["CASH", "CARD", "TRANSFER", "OTHER"]).optional(),
      clientPhone: z.string().optional(),
      notes: z.string().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError("VALIDATION_ERROR", "Venta inválida.", 422);
    }
    const data = await catalog.sellProducts(parsed.data);
    res.status(201).json({ ok: true, data });
  }),
);

apiRouter.get(
  "/loyalty/:phone",
  asyncHandler(async (req, res) => {
    const data = await catalog.getClientLoyalty(req.params.phone);
    res.json({ ok: true, data });
  }),
);

apiRouter.post(
  "/admin/reminders/process",
  asyncHandler(async (req, res) => {
    superOnly(await staff(req));
    const data = await notify.processDueReminders();
    res.json({ ok: true, data, message: `Procesados ${data.length} recordatorio(s).` });
  }),
);
