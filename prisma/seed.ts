import { PrismaClient, UserRole } from "@prisma/client";
import { createHash } from "crypto";

const prisma = new PrismaClient();

function hashPassword(password: string): string {
  return createHash("sha256").update(`el-calentano:${password}`).digest("hex");
}

async function main() {
  await prisma.saleLine.deleteMany();
  await prisma.sale.deleteMany();
  await prisma.product.deleteMany();
  await prisma.commission.deleteMany();
  await prisma.tip.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.reminderJob.deleteMany();
  await prisma.notificationLog.deleteMany();
  await prisma.appointment.deleteMany();
  await prisma.waitlistEntry.deleteMany();
  await prisma.client.deleteMany();
  await prisma.service.deleteMany();
  await prisma.barber.deleteMany();
  await prisma.businessHour.deleteMany();
  await prisma.user.deleteMany();
  await prisma.branch.deleteMany();

  const branch = await prisma.branch.create({
    data: {
      name: "Barber Shop EL CALENTANO",
      address: "C. Miguel Hidalgo 4A",
      city: "Metepec",
      state: "Edomex",
      zip: "52172",
      country: "MX",
      instagram: "https://www.instagram.com/barber_elcalentano",
      timezone: "America/Mexico_City",
      cancelNoticeHours: 24,
      lateCancelFeePercent: 50,
      graceMinutes: 15,
      depositRequired: false,
      depositPercent: 0,
      loyaltyPointsPer100Mxn: 1,
    },
  });

  // Mon-Sat 10:00-20:00 (default configurable), Sunday 11:00-16:00 by appointment only
  const hours = [
    { dayOfWeek: 0, openMin: 11 * 60, closeMin: 16 * 60, byAppointmentOnly: true, closed: false },
    { dayOfWeek: 1, openMin: 10 * 60, closeMin: 20 * 60, byAppointmentOnly: false, closed: false },
    { dayOfWeek: 2, openMin: 10 * 60, closeMin: 20 * 60, byAppointmentOnly: false, closed: false },
    { dayOfWeek: 3, openMin: 10 * 60, closeMin: 20 * 60, byAppointmentOnly: false, closed: false },
    { dayOfWeek: 4, openMin: 10 * 60, closeMin: 20 * 60, byAppointmentOnly: false, closed: false },
    { dayOfWeek: 5, openMin: 10 * 60, closeMin: 20 * 60, byAppointmentOnly: false, closed: false },
    { dayOfWeek: 6, openMin: 10 * 60, closeMin: 20 * 60, byAppointmentOnly: false, closed: false },
  ];

  for (const h of hours) {
    await prisma.businessHour.create({
      data: { ...h, branchId: branch.id },
    });
  }

  await prisma.barber.createMany({
    data: [
      {
        name: "Ismael",
        slug: "ismael-el-calentano",
        nickname: "El Calentano",
        specialties: "Fades, barba, cortes clásicos",
        branchId: branch.id,
        commissionPercent: 50,
      },
      {
        name: "Alex Ibarra",
        slug: "alex-ibarra",
        specialties: "Cortes modernos, degradados",
        branchId: branch.id,
        commissionPercent: 50,
      },
      {
        name: "Zaira Garduño",
        slug: "zaira-garduno",
        specialties: "Cortes, cejas, barba",
        branchId: branch.id,
        commissionPercent: 50,
      },
    ],
  });

  await prisma.service.createMany({
    data: [
      {
        code: "corte_adulto",
        name: "Corte de cabello (adulto)",
        description: "Corte clásico o moderno",
        durationMin: 40,
        priceCents: 12000,
        category: "corte",
        sortOrder: 1,
        branchId: branch.id,
      },
      {
        code: "corte_nino",
        name: "Corte de cabello (niño)",
        description: "Corte para niños",
        durationMin: 40,
        priceCents: 12000,
        category: "corte",
        sortOrder: 2,
        branchId: branch.id,
      },
      {
        code: "ceja",
        name: "Alineado de ceja",
        description: "$25 MXN por cada ceja",
        durationMin: 15,
        priceCents: 2500,
        category: "ceja",
        sortOrder: 3,
        allowsQuantity: true,
        branchId: branch.id,
      },
      {
        code: "combo_barba_corte",
        name: "Combo barba y corte",
        description: "Corte + barba completo",
        durationMin: 60,
        priceCents: 26000,
        category: "combo",
        sortOrder: 4,
        branchId: branch.id,
      },
      {
        code: "solo_barba",
        name: "Solo barba",
        description: "Perfilado y arreglo de barba",
        durationMin: 40,
        priceCents: 14500,
        category: "barba",
        sortOrder: 5,
        branchId: branch.id,
      },
      {
        code: "facial_vaporizador",
        name: "Facial con vaporizador",
        description: "Incluye mascarilla",
        durationMin: 60,
        priceCents: 20000,
        category: "facial",
        sortOrder: 6,
        branchId: branch.id,
      },
    ],
  });

  await prisma.user.create({
    data: {
      email: "admin@elcalentano.mx",
      name: "Administrador",
      role: UserRole.ADMIN,
      passwordHash: hashPassword("calentano123"),
    },
  });

  await prisma.product.createMany({
    data: [
      {
        sku: "CERA-01",
        name: "Cera para cabello",
        description: "Fijación media",
        priceCents: 18000,
        stock: 20,
        branchId: branch.id,
      },
      {
        sku: "SHAM-01",
        name: "Shampoo premium",
        description: "250 ml",
        priceCents: 22000,
        stock: 15,
        branchId: branch.id,
      },
      {
        sku: "ACEI-01",
        name: "Aceite para barba",
        description: "30 ml",
        priceCents: 25000,
        stock: 12,
        branchId: branch.id,
      },
    ],
  });

  console.log("Seed OK — Barber Shop EL CALENTANO");
  console.log("Admin: admin@elcalentano.mx / calentano123");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
