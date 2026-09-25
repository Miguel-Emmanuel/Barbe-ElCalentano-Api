import { randomBytes, timingSafeEqual } from "crypto";
import { AppError } from "../lib/errors.js";
import { hashPassword } from "../lib/password.js";
import { prisma } from "../lib/prisma.js";

export { hashPassword };

const SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12h

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export async function login(email: string, password: string) {
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() }, include: { barber: true } });
  if (!user || !user.active) {
    throw new AppError("VALIDATION_ERROR", "Correo o contraseña incorrectos.", 401);
  }
  if (!safeEqual(user.passwordHash, hashPassword(password))) {
    throw new AppError("VALIDATION_ERROR", "Correo o contraseña incorrectos.", 401);
  }

  const token = randomBytes(32).toString("hex");
  await prisma.session.create({
    data: {
      token,
      userId: user.id,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    },
  });

  return {
    token,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      isSuperAdmin: user.isSuperAdmin,
      barberId: user.barberId,
      barberName: user.barber?.name ?? null,
    },
  };
}

export async function logout(token: string | undefined) {
  if (!token) return;
  await prisma.session.deleteMany({ where: { token } });
}

export async function requireAuth(token: string | undefined) {
  if (!token) {
    throw new AppError("VALIDATION_ERROR", "Inicia sesión para continuar.", 401);
  }
  const session = await prisma.session.findUnique({ where: { token } });
  if (!session || session.expiresAt.getTime() < Date.now()) {
    if (session) await prisma.session.delete({ where: { id: session.id } });
    throw new AppError("VALIDATION_ERROR", "Tu sesión expiró. Vuelve a entrar.", 401);
  }
  return session.userId;
}

export async function getUserFromToken(token: string | undefined) {
  const userId = await requireAuth(token);
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      active: true,
      isSuperAdmin: true,
      barberId: true,
      barber: { select: { name: true } },
    },
  });
  if (!user || !user.active) {
    throw new AppError("VALIDATION_ERROR", "Usuario no válido.", 401);
  }
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    isSuperAdmin: user.isSuperAdmin,
    barberId: user.barberId,
    barberName: user.barber?.name ?? null,
  };
}

export function extractBearer(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const [type, token] = header.split(" ");
  if (type?.toLowerCase() !== "bearer" || !token) return undefined;
  return token;
}
