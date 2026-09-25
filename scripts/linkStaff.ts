import { PrismaClient, UserRole } from "@prisma/client";
import { createHash } from "crypto";

const prisma = new PrismaClient();

function hashPassword(password: string) {
  return createHash("sha256").update(`el-calentano:${password}`).digest("hex");
}

async function main() {
  const barbers = await prisma.barber.findMany();
  const bySlug = Object.fromEntries(barbers.map((b) => [b.slug, b]));
  const passwordHash = hashPassword("calentano123");

  const ismael = bySlug["ismael-el-calentano"];
  if (ismael) {
    await prisma.user.update({
      where: { email: "admin@elcalentano.mx" },
      data: {
        name: "Ismael",
        role: UserRole.ADMIN,
        isSuperAdmin: true,
        barberId: ismael.id,
      },
    });
  }

  const staff = [
    { email: "alex@elcalentano.mx", name: "Alex Ibarra", slug: "alex-ibarra" },
    { email: "zaira@elcalentano.mx", name: "Zaira Garduño", slug: "zaira-garduno" },
  ];

  for (const person of staff) {
    const barber = bySlug[person.slug];
    if (!barber) continue;
    await prisma.user.upsert({
      where: { email: person.email },
      update: {
        name: person.name,
        role: UserRole.BARBER,
        isSuperAdmin: false,
        barberId: barber.id,
        active: true,
      },
      create: {
        email: person.email,
        name: person.name,
        role: UserRole.BARBER,
        isSuperAdmin: false,
        passwordHash,
        barberId: barber.id,
      },
    });
  }

  console.log("Staff ligado. Super admin: admin@elcalentano.mx");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
