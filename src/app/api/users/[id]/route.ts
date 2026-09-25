import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/auth-guards";
import { logInfo, logWarn } from "@/lib/logger";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
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
  const data: {
    name?: string;
    email?: string;
    passwordHash?: string;
    activatedAt?: Date;
    role?: "ADMIN" | "STAFF" | "KIEROWCA";
    canActAsDriver?: boolean;
    grammaticalGender?: "M" | "F" | null;
    hourlyRate?: number | null;
    driverColor?: string | null;
  } = {};

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

  if (body?.role === "ADMIN" || body?.role === "STAFF" || body?.role === "KIEROWCA") {
    if (id === session.user.id) {
      logWarn("user_self_role_change_blocked", { userId: session.user.id });
      return NextResponse.json({ message: "Nie możesz zmienić własnej roli." }, { status: 400 });
    }
    data.role = body.role;
  }

  if (typeof body?.canActAsDriver === "boolean") {
    data.canActAsDriver = body.canActAsDriver;
  }

  if (body?.grammaticalGender === "M" || body?.grammaticalGender === "F" || body?.grammaticalGender === null) {
    data.grammaticalGender = body.grammaticalGender;
  }

  // hourlyRate ma sens wyłącznie dla roli KIEROWCA (schema.prisma, sekcja
  // bezpieczeństwa docs/prompt-claude-code-dashboard-kosztow.md 1.4) — dla
  // efektywnej roli (po tym PATCH-u) innej niż KIEROWCA zawsze wymuszamy
  // null, niezależnie co przyszło w body.
  const effectiveRole = data.role ?? target.role;
  if (effectiveRole !== "KIEROWCA") {
    if (target.hourlyRate !== null) data.hourlyRate = null;
  } else if ("hourlyRate" in (body ?? {})) {
    if (body.hourlyRate === null) {
      data.hourlyRate = null;
    } else {
      const n = Number(body.hourlyRate);
      if (!Number.isFinite(n) || n < 0) {
        return NextResponse.json({ message: "Stawka godzinowa musi być nieujemną liczbą." }, { status: 400 });
      }
      data.hourlyRate = n;
    }
  }

  // Kolor ikony kierownicy na kafelkach kalendarza (KIEROWCA) — żeby dało się
  // odróżnić przypisanego kierowcę bez najeżdżania kursorem na tooltip. Bez
  // ograniczenia do roli KIEROWCA — nieszkodliwe, jeśli ktoś ustawi kolor
  // zanim/po zmianie roli, po prostu nigdzie się nie wyświetli.
  if ("driverColor" in (body ?? {})) {
    if (body.driverColor === null) {
      data.driverColor = null;
    } else if (typeof body.driverColor === "string" && HEX_COLOR_PATTERN.test(body.driverColor)) {
      data.driverColor = body.driverColor;
    } else {
      return NextResponse.json({ message: "Kolor musi być w formacie hex, np. #2563EB." }, { status: 400 });
    }
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

  // requireAdminSession() powyżej — bezpiecznie zwraca hourlyRate (nigdy nie
  // kopiuj tego kształtu odpowiedzi do endpointu dostępnego roli KIEROWCA).
  return NextResponse.json({
    user: {
      id: updated.id,
      name: updated.name,
      email: updated.email,
      role: updated.role,
      canActAsDriver: updated.canActAsDriver,
      grammaticalGender: updated.grammaticalGender,
      hourlyRate: updated.hourlyRate !== null ? updated.hourlyRate.toString() : null,
      driverColor: updated.driverColor,
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
    logWarn("user_self_delete_blocked", { userId: session.user.id });
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
