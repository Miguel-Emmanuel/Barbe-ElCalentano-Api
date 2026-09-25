import { randomBytes, timingSafeEqual } from "crypto";
import { AppError } from "../lib/errors.js";
import { hashPassword } from "../lib/password.js";
import { prisma } from "../lib/prisma.js";

export { hashPassword };

const sessions = new Map<string, { userId: string; expiresAt: number }>();
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
  sessions.set(token, { userId: user.id, expiresAt: Date.now() + SESSION_TTL_MS });

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

export function logout(token: string | undefined) {
  if (token) sessions.delete(token);
}

export function requireAuth(token: string | undefined) {
  if (!token) {
    throw new AppError("VALIDATION_ERROR", "Inicia sesión para continuar.", 401);
  }
  const session = sessions.get(token);
  if (!session || session.expiresAt < Date.now()) {
    if (session) sessions.delete(token);
    throw new AppError("VALIDATION_ERROR", "Tu sesión expiró. Vuelve a entrar.", 401);
  }
  return session.userId;
}

export async function getUserFromToken(token: string | undefined) {
  const userId = requireAuth(token);
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
