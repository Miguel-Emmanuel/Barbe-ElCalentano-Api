import { AppError } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { getBranch } from "./bookingService.js";
import { loyaltyPointsEarned } from "../domain/moneyRules.js";

export async function listAllServices(includeInactive = false) {
  return prisma.service.findMany({
    where: includeInactive ? undefined : { active: true },
    orderBy: { sortOrder: "asc" },
  });
}

export async function upsertService(input: {
  id?: string;
  code: string;
  name: string;
  description?: string;
  durationMin: number;
  priceCents: number;
  category: string;
  allowsQuantity?: boolean;
  active?: boolean;
  sortOrder?: number;
}) {
  if (input.durationMin < 5 || input.durationMin > 240) {
    throw new AppError("VALIDATION_ERROR", "La duración debe ser entre 5 y 240 minutos.", 422);
  }
  if (input.priceCents < 0) {
    throw new AppError("VALIDATION_ERROR", "El precio no puede ser negativo.", 422);
  }

  const branch = await getBranch();

  if (input.id) {
    return prisma.service.update({
      where: { id: input.id },
      data: {
        code: input.code,
        name: input.name,
        description: input.description,
        durationMin: input.durationMin,
        priceCents: input.priceCents,
        category: input.category,
        allowsQuantity: input.allowsQuantity ?? false,
        active: input.active ?? true,
        sortOrder: input.sortOrder ?? 0,
      },
    });
  }

  return prisma.service.create({
    data: {
      code: input.code,
      name: input.name,
      description: input.description,
      durationMin: input.durationMin,
      priceCents: input.priceCents,
      category: input.category,
      allowsQuantity: input.allowsQuantity ?? false,
      active: input.active ?? true,
      sortOrder: input.sortOrder ?? 0,
      branchId: branch.id,
    },
  });
}

export async function setServiceActive(id: string, active: boolean) {
  const existing = await prisma.service.findUnique({ where: { id } });
  if (!existing) throw new AppError("NOT_FOUND", "Servicio no encontrado.", 404);
  return prisma.service.update({ where: { id }, data: { active } });
}

export async function joinWaitlist(input: {
  date: string;
  serviceId: string;
  barberId?: string;
  clientName: string;
  clientPhone: string;
  preferredTime?: string;
  notes?: string;
}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) {
    throw new AppError("VALIDATION_ERROR", "Fecha inválida.", 422);
  }

  const service = await prisma.service.findUnique({ where: { id: input.serviceId } });
  if (!service || !service.active) {
    throw new AppError("SERVICE_INACTIVE", "Ese servicio no está disponible.");
  }

  if (input.barberId) {
    const barber = await prisma.barber.findUnique({ where: { id: input.barberId } });
    if (!barber || !barber.active) {
      throw new AppError("BARBER_UNAVAILABLE", "Ese barbero no está disponible.");
    }
  }

  const branch = await getBranch();
  let client = await prisma.client.findUnique({ where: { phone: input.clientPhone } });
  if (client?.blocked) {
    throw new AppError("CLIENT_BLOCKED", "No es posible unirse a la lista con este teléfono.");
  }
  if (!client) {
    client = await prisma.client.create({
      data: { name: input.clientName, phone: input.clientPhone },
    });
  } else {
    client = await prisma.client.update({
      where: { id: client.id },
      data: { name: input.clientName },
    });
  }

  return prisma.waitlistEntry.create({
    data: {
      date: input.date,
      preferredTime: input.preferredTime,
      notes: input.notes,
      clientId: client.id,
      barberId: input.barberId,
      serviceId: service.id,
      branchId: branch.id,
    },
    include: { client: true, service: true, barber: true },
  });
}

export async function listWaitlist(date?: string) {
  return prisma.waitlistEntry.findMany({
    where: {
      ...(date ? { date } : {}),
      status: { in: ["WAITING", "NOTIFIED"] },
    },
    include: { client: true, service: true, barber: true },
    orderBy: { createdAt: "asc" },
  });
}

export async function updateWaitlistStatus(
  id: string,
  status: "WAITING" | "NOTIFIED" | "BOOKED" | "CANCELLED",
) {
  const entry = await prisma.waitlistEntry.findUnique({ where: { id } });
  if (!entry) throw new AppError("NOT_FOUND", "Registro de lista de espera no encontrado.", 404);
  return prisma.waitlistEntry.update({
    where: { id },
    data: { status },
    include: { client: true, service: true, barber: true },
  });
}

export async function dayStats(date: string) {
  const { listAppointments } = await import("./bookingService.js");
  const appointments = await listAppointments(date);
  const active = appointments.filter((a) => !["CANCELLED", "NO_SHOW"].includes(a.status));
  const completed = appointments.filter((a) => a.status === "COMPLETED");
  const cancelled = appointments.filter((a) => a.status === "CANCELLED");
  const noShow = appointments.filter((a) => a.status === "NO_SHOW");
  const revenueCents = completed.reduce((sum, a) => sum + a.priceCents, 0);
  const tipsCents = completed.reduce((sum, a) => sum + (a.payment?.tipCents ?? 0), 0);

  const commissions = await prisma.commission.findMany({
    where: { appointmentId: { in: completed.map((c) => c.id) } },
  });
  const barberEarnCents = commissions.reduce((s, c) => s + c.barberEarnCents, 0);
  const shopEarnCents = commissions.reduce((s, c) => s + c.shopEarnCents, 0);

  return {
    date,
    currency: "MXN",
    totals: {
      appointments: appointments.length,
      active: active.length,
      completed: completed.length,
      cancelled: cancelled.length,
      noShow: noShow.length,
      revenueCents,
      tipsCents,
      barberEarnCents,
      shopEarnCents,
      revenueMxn: revenueCents / 100,
      tipsMxn: tipsCents / 100,
      barberEarnMxn: barberEarnCents / 100,
      shopEarnMxn: shopEarnCents / 100,
      occupancyHint:
        active.length === 0
          ? "Sin citas activas"
          : `${completed.length}/${active.length} completadas`,
    },
  };
}

export async function listProducts() {
  return prisma.product.findMany({
    where: { active: true },
    orderBy: { name: "asc" },
  });
}

export async function upsertProduct(input: {
  id?: string;
  sku: string;
  name: string;
  description?: string;
  priceCents: number;
  stock: number;
  active?: boolean;
}) {
  if (input.priceCents < 0 || input.stock < 0) {
    throw new AppError("VALIDATION_ERROR", "Precio o stock inválido.", 422);
  }
  const branch = await getBranch();
  if (input.id) {
    return prisma.product.update({
      where: { id: input.id },
      data: {
        sku: input.sku,
        name: input.name,
        description: input.description,
        priceCents: input.priceCents,
        stock: input.stock,
        active: input.active ?? true,
      },
    });
  }
  return prisma.product.create({
    data: {
      sku: input.sku,
      name: input.name,
      description: input.description,
      priceCents: input.priceCents,
      stock: input.stock,
      active: input.active ?? true,
      branchId: branch.id,
    },
  });
}

export async function sellProducts(input: {
  items: Array<{ productId: string; quantity: number }>;
  method?: "CASH" | "CARD" | "TRANSFER" | "OTHER";
  clientPhone?: string;
  notes?: string;
}) {
  if (!input.items.length) {
    throw new AppError("VALIDATION_ERROR", "Agrega al menos un producto.", 422);
  }

  const branch = await getBranch();
  let clientId: string | undefined;
  if (input.clientPhone) {
    const client = await prisma.client.findUnique({ where: { phone: input.clientPhone } });
    clientId = client?.id;
  }

  const lines: Array<{
    productId: string;
    quantity: number;
    unitCents: number;
    lineCents: number;
  }> = [];

  for (const item of input.items) {
    if (item.quantity < 1) {
      throw new AppError("VALIDATION_ERROR", "Cantidad inválida.", 422);
    }
    const product = await prisma.product.findUnique({ where: { id: item.productId } });
    if (!product || !product.active) {
      throw new AppError("NOT_FOUND", "Producto no disponible.", 404);
    }
    if (product.stock < item.quantity) {
      throw new AppError(
        "CONFLICT",
        `Stock insuficiente de ${product.name}. Quedan ${product.stock}.`,
        409,
      );
    }
    lines.push({
      productId: product.id,
      quantity: item.quantity,
      unitCents: product.priceCents,
      lineCents: product.priceCents * item.quantity,
    });
  }

  const totalCents = lines.reduce((s, l) => s + l.lineCents, 0);

  const sale = await prisma.$transaction(async (tx) => {
    for (const line of lines) {
      await tx.product.update({
        where: { id: line.productId },
        data: { stock: { decrement: line.quantity } },
      });
    }

    const created = await tx.sale.create({
      data: {
        totalCents,
        method: input.method ?? "CASH",
        clientId,
        branchId: branch.id,
        notes: input.notes,
        lines: {
          create: lines.map((l) => ({
            productId: l.productId,
            quantity: l.quantity,
            unitCents: l.unitCents,
            lineCents: l.lineCents,
          })),
        },
      },
      include: { lines: { include: { product: true } }, client: true },
    });

    if (clientId) {
      const points = loyaltyPointsEarned(totalCents, branch.loyaltyPointsPer100Mxn);
      if (points > 0) {
        await tx.client.update({
          where: { id: clientId },
          data: { loyaltyPoints: { increment: points } },
        });
      }
    }

    return created;
  });

  return {
    ...sale,
    currency: "MXN",
    message: "Venta registrada. Inventario actualizado.",
  };
}

export async function listCommissions(date?: string) {
  let rows;
  if (!date) {
    rows = await prisma.commission.findMany({
      include: { appointment: { include: { barber: true, service: true, client: true } } },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  } else {
    const { listAppointments } = await import("./bookingService.js");
    const appts = await listAppointments(date);
    const ids = appts.map((a) => a.id);
    rows = await prisma.commission.findMany({
      where: { appointmentId: { in: ids } },
      include: { appointment: { include: { barber: true, service: true, client: true } } },
      orderBy: { createdAt: "desc" },
    });
  }

  const byBarberMap = new Map<
    string,
    {
      barberId: string;
      barberName: string;
      count: number;
      barberEarnCents: number;
      shopEarnCents: number;
      tipCents: number;
    }
  >();

  for (const row of rows) {
    const key = row.barberId;
    const prev = byBarberMap.get(key) ?? {
      barberId: row.barberId,
      barberName: row.appointment.barber.name,
      count: 0,
      barberEarnCents: 0,
      shopEarnCents: 0,
      tipCents: 0,
    };
    prev.count += 1;
    prev.barberEarnCents += row.barberEarnCents;
    prev.shopEarnCents += row.shopEarnCents;
    prev.tipCents += row.tipCents;
    byBarberMap.set(key, prev);
  }

  const totals = {
    count: rows.length,
    barberEarnCents: rows.reduce((s, r) => s + r.barberEarnCents, 0),
    shopEarnCents: rows.reduce((s, r) => s + r.shopEarnCents, 0),
    tipCents: rows.reduce((s, r) => s + r.tipCents, 0),
    byBarber: [...byBarberMap.values()].sort((a, b) => b.barberEarnCents - a.barberEarnCents),
  };

  return { rows, totals, currency: "MXN" as const };
}

export async function listAdminBarbers() {
  return prisma.barber.findMany({
    orderBy: { name: "asc" },
  });
}

export async function updateBarberCommission(id: string, commissionPercent: number) {
  if (!Number.isFinite(commissionPercent) || commissionPercent < 0 || commissionPercent > 100) {
    throw new AppError("VALIDATION_ERROR", "El porcentaje debe estar entre 0 y 100.", 422);
  }
  const barber = await prisma.barber.findUnique({ where: { id } });
  if (!barber) throw new AppError("NOT_FOUND", "Barbero no encontrado.", 404);
  return prisma.barber.update({
    where: { id },
    data: { commissionPercent },
  });
}

export async function getClientLoyalty(phone: string) {
  const client = await prisma.client.findUnique({ where: { phone } });
  if (!client) throw new AppError("NOT_FOUND", "Cliente no encontrado.", 404);
  return {
    id: client.id,
    name: client.name,
    phone: client.phone,
    loyaltyPoints: client.loyaltyPoints,
  };
}
