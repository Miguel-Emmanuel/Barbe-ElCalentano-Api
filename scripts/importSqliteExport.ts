import { readFileSync } from "fs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function at(value: string | null | undefined) {
  return value ? new Date(value) : null;
}

async function main() {
  const file = new URL("../prisma/sqlite-export.json", import.meta.url);
  const data = JSON.parse(readFileSync(file, "utf8"));
  const existing = await prisma.branch.count();
  if (existing > 0) {
    console.log("Postgres ya tiene datos. No se importó nada.");
    return;
  }

  await prisma.$transaction(async (tx) => {
    if (data.branches.length) {
      await tx.branch.createMany({
        data: data.branches.map((row: Record<string, string>) => ({
          ...row,
          createdAt: at(row.createdAt),
          updatedAt: at(row.updatedAt),
        })),
      });
    }
    if (data.businessHours.length) await tx.businessHour.createMany({ data: data.businessHours });
    if (data.barbers.length) {
      await tx.barber.createMany({
        data: data.barbers.map((row: Record<string, string>) => ({
          ...row,
          createdAt: at(row.createdAt),
          updatedAt: at(row.updatedAt),
        })),
      });
    }
    if (data.services.length) {
      await tx.service.createMany({
        data: data.services.map((row: Record<string, string>) => ({
          ...row,
          createdAt: at(row.createdAt),
          updatedAt: at(row.updatedAt),
        })),
      });
    }
    if (data.clients.length) {
      await tx.client.createMany({
        data: data.clients.map((row: Record<string, string>) => ({
          ...row,
          createdAt: at(row.createdAt),
          updatedAt: at(row.updatedAt),
        })),
      });
    }
    if (data.users.length) {
      await tx.user.createMany({
        data: data.users.map((row: Record<string, string>) => ({
          ...row,
          createdAt: at(row.createdAt),
          updatedAt: at(row.updatedAt),
        })),
      });
    }
    if (data.products.length) {
      await tx.product.createMany({
        data: data.products.map((row: Record<string, string>) => ({
          ...row,
          createdAt: at(row.createdAt),
          updatedAt: at(row.updatedAt),
        })),
      });
    }
    if (data.appointments.length) {
      await tx.appointment.createMany({
        data: data.appointments.map((row: Record<string, string | null>) => ({
          ...row,
          startAt: at(row.startAt),
          endAt: at(row.endAt),
          cancelledAt: at(row.cancelledAt),
          createdAt: at(row.createdAt),
          updatedAt: at(row.updatedAt),
        })),
      });
    }
    if (data.payments.length) {
      await tx.payment.createMany({
        data: data.payments.map((row: Record<string, string | null>) => ({
          ...row,
          paidAt: at(row.paidAt),
          createdAt: at(row.createdAt),
          updatedAt: at(row.updatedAt),
        })),
      });
    }
    if (data.tips.length) {
      await tx.tip.createMany({
        data: data.tips.map((row: Record<string, string>) => ({
          ...row,
          createdAt: at(row.createdAt),
        })),
      });
    }
    if (data.commissions.length) {
      await tx.commission.createMany({
        data: data.commissions.map((row: Record<string, string>) => ({
          ...row,
          createdAt: at(row.createdAt),
        })),
      });
    }
    if (data.waitlist.length) {
      await tx.waitlistEntry.createMany({
        data: data.waitlist.map((row: Record<string, string>) => ({
          ...row,
          createdAt: at(row.createdAt),
          updatedAt: at(row.updatedAt),
        })),
      });
    }
    if (data.sales.length) {
      await tx.sale.createMany({
        data: data.sales.map((row: Record<string, string>) => ({
          ...row,
          createdAt: at(row.createdAt),
        })),
      });
    }
    if (data.saleLines.length) await tx.saleLine.createMany({ data: data.saleLines });
    if (data.notifications.length) {
      await tx.notificationLog.createMany({
        data: data.notifications.map((row: Record<string, string>) => ({
          ...row,
          createdAt: at(row.createdAt),
        })),
      });
    }
    if (data.reminders.length) {
      await tx.reminderJob.createMany({
        data: data.reminders.map((row: Record<string, string | null>) => ({
          ...row,
          runAt: at(row.runAt),
          createdAt: at(row.createdAt),
          updatedAt: at(row.updatedAt),
        })),
      });
    }
  });

  console.log("Importación lista.");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
