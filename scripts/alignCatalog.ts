import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const updatedHours = await prisma.businessHour.updateMany({
    data: { openMin: 9 * 60, closeMin: 20 * 60, byAppointmentOnly: false, closed: false },
  });

  const adulto = await prisma.service.findUnique({ where: { code: "corte_adulto" } });
  const nino = await prisma.service.findUnique({ where: { code: "corte_nino" } });

  if (adulto) {
    await prisma.service.update({
      where: { id: adulto.id },
      data: {
        name: "Corte de cabello",
        description: "Adulto y niño",
        durationMin: 40,
        priceCents: 12000,
        active: true,
        sortOrder: 1,
      },
    });
  }

  if (adulto && nino && nino.id !== adulto.id) {
    await prisma.appointment.updateMany({
      where: { serviceId: nino.id },
      data: { serviceId: adulto.id },
    });
    await prisma.waitlistEntry.updateMany({
      where: { serviceId: nino.id },
      data: { serviceId: adulto.id },
    });
    await prisma.service.update({
      where: { id: nino.id },
      data: { active: false },
    });
  }

  await prisma.service.update({
    where: { code: "ceja" },
    data: {
      name: "Alineado de ceja",
      description: "$25 MXN por cada ceja",
      durationMin: 15,
      priceCents: 2500,
    },
  });
  await prisma.service.update({
    where: { code: "combo_barba_corte" },
    data: {
      name: "Combo barba y corte",
      description: "Corte con barba",
      durationMin: 60,
      priceCents: 26000,
    },
  });
  await prisma.service.update({
    where: { code: "solo_barba" },
    data: {
      name: "Solo barba",
      description: "Servicio de barba",
      durationMin: 40,
      priceCents: 14500,
    },
  });
  await prisma.service.update({
    where: { code: "facial_vaporizador" },
    data: {
      name: "Facial con vaporizador",
      description: "Incluye mascarilla",
      durationMin: 60,
      priceCents: 20000,
    },
  });

  const services = await prisma.service.findMany({
    where: { active: true },
    orderBy: { sortOrder: "asc" },
    select: { name: true, priceCents: true, durationMin: true },
  });
  const hours = await prisma.businessHour.findMany({ orderBy: { dayOfWeek: "asc" } });
  console.log("hours updated", updatedHours.count);
  console.log(hours.map((h) => `${h.dayOfWeek} ${h.openMin}-${h.closeMin} cita=${h.byAppointmentOnly}`).join("\n"));
  console.log(services.map((s) => `${s.name} $${s.priceCents / 100} ${s.durationMin}min`).join("\n"));
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
