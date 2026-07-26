import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/auth-guards";
import { logInfo } from "@/lib/logger";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdminSession();
  if (!session) {
    return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  }

  const { id } = await params;
  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) {
    return NextResponse.json({ message: "Nie znaleziono użytkownika." }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const data: { name?: string; email?: string; passwordHash?: string; activatedAt?: Date; role?: "ADMIN" | "STAFF" } = {};

  if (typeof body?.name === "string" && body.name.trim()) {
    data.name = body.name.trim();
  }

  if (typeof body?.email === "string" && body.email.trim()) {
    const email = body.email.trim().toLowerCase();
    if (!EMAIL_PATTERN.test(email)) {
      return NextResponse.json({ message: "Podaj poprawny adres e-mail." }, { status: 400 });
    }
    if (email !== target.email) {
      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) {
        return NextResponse.json({ message: "Użytkownik z takim adresem e-mail już istnieje." }, { status: 409 });
      }
    }
    data.email = email;
  }

  if (body?.role === "ADMIN" || body?.role === "STAFF") {
    if (id === session.user.id) {
      return NextResponse.json({ message: "Nie możesz zmienić własnej roli." }, { status: 400 });
    }
    data.role = body.role;
  }

  if (typeof body?.password === "string" && body.password) {
    if (body.password.length < MIN_PASSWORD_LENGTH) {
      return NextResponse.json(
        { message: `Hasło musi mieć co najmniej ${MIN_PASSWORD_LENGTH} znaków.` },
        { status: 400 },
      );
    }
    data.passwordHash = await bcrypt.hash(body.password, 10);
    // Setting a password directly finishes an outstanding invite too.
    if (!target.activatedAt) data.activatedAt = new Date();
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ message: "Brak zmian do zapisania." }, { status: 400 });
  }

  const updated = await prisma.user.update({ where: { id }, data });
  logInfo("user_updated", { userId: session.user.id, targetUserId: id, fields: Object.keys(data) });

  return NextResponse.json({
    user: {
      id: updated.id,
      name: updated.name,
      email: updated.email,
      role: updated.role,
      invitedAt: updated.invitedAt,
      activatedAt: updated.activatedAt,
      createdAt: updated.createdAt,
    },
  });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdminSession();
  if (!session) {
    return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  }

  const { id } = await params;
  if (id === session.user.id) {
    return NextResponse.json({ message: "Nie możesz usunąć własnego konta." }, { status: 400 });
  }

  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) {
    return NextResponse.json({ message: "Nie znaleziono użytkownika." }, { status: 404 });
  }

  await prisma.user.delete({ where: { id } });
  logInfo("user_deleted", { userId: session.user.id, targetUserId: id });

  return NextResponse.json({ ok: true });
}
