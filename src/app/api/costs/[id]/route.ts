import { NextRequest, NextResponse } from "next/server";
import { Prisma, type CostScope } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/auth-guards";
import { logInfo, logWarn } from "@/lib/logger";
import { validateCostConsistency } from "@/lib/costs/validate";

const SCOPES: CostScope[] = ["GENERAL", "VEHICLE", "DEVICE"];

function parseDate(raw: string | null): Date | null {
  if (!raw) return null;
  const d = new Date(`${raw}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Edycja (sekcja 5.2, tryb edycji: „ten sam formularz, zapis nadpisuje
// rekord"). Waliduje spójność scope/deviceId/vehicleId/categoryId na
// EFEKTYWNYM stanie (istniejący + nadchodzące pola), nie tylko na tym, co
// przyszło w body — częściowa aktualizacja nie może zostawić rekordu w
// niespójnym stanie.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdminSession();
  if (!session) {
    return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  }

  const { id } = await params;
  const existing = await prisma.cost.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ message: "Nie znaleziono wpisu." }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ message: "Nieprawidłowe dane." }, { status: 400 });
  }

  const data: {
    amount?: Prisma.Decimal | number;
    date?: Date;
    scope?: CostScope;
    categoryId?: string;
    deviceId?: string | null;
    vehicleId?: string | null;
    description?: string | null;
  } = {};

  if ("amount" in body) {
    const raw = body.amount;
    const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw.replace(",", ".")) : NaN;
    if (!Number.isFinite(n) || n < 0) return NextResponse.json({ message: "Kwota musi być nieujemną liczbą." }, { status: 400 });
    data.amount = n;
  }
  if ("date" in body) {
    const d = parseDate(typeof body.date === "string" ? body.date : null);
    if (!d) return NextResponse.json({ message: "Nieprawidłowa data." }, { status: 400 });
    data.date = d;
  }
  if ("scope" in body) {
    if (typeof body.scope !== "string" || !(SCOPES as string[]).includes(body.scope)) {
      return NextResponse.json({ message: "Nieprawidłowy zakres." }, { status: 400 });
    }
    data.scope = body.scope as CostScope;
  }
  if ("categoryId" in body) {
    if (typeof body.categoryId !== "string" || !body.categoryId) {
      return NextResponse.json({ message: "Nieprawidłowa kategoria." }, { status: 400 });
    }
    data.categoryId = body.categoryId;
  }
  if ("deviceId" in body) data.deviceId = typeof body.deviceId === "string" && body.deviceId ? body.deviceId : null;
  if ("vehicleId" in body) data.vehicleId = typeof body.vehicleId === "string" && body.vehicleId ? body.vehicleId : null;
  if ("description" in body) data.description = typeof body.description === "string" ? body.description.trim() || null : null;

  const effective = {
    scope: data.scope ?? existing.scope,
    deviceId: "deviceId" in data ? data.deviceId! : existing.deviceId,
    vehicleId: "vehicleId" in data ? data.vehicleId! : existing.vehicleId,
    categoryId: data.categoryId ?? existing.categoryId,
  };
  const check = await validateCostConsistency(effective);
  if (!check.ok) {
    logWarn("cost_update_rejected", { userId: session.user.id, costId: id, reason: check.message });
    return NextResponse.json({ message: check.message }, { status: 400 });
  }
  // Zapisz efektywny (spójny) stan, nie tylko to, co dosłownie przyszło w body.
  data.scope = effective.scope;
  data.deviceId = effective.deviceId;
  data.vehicleId = effective.vehicleId;
  data.categoryId = effective.categoryId;

  const cost = await prisma.cost.update({ where: { id }, data });
  logInfo("cost_updated", { userId: session.user.id, costId: id, fields: Object.keys(data) });

  return NextResponse.json({ cost });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdminSession();
  if (!session) {
    return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  }

  const { id } = await params;
  try {
    await prisma.cost.delete({ where: { id } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return NextResponse.json({ message: "Nie znaleziono wpisu." }, { status: 404 });
    }
    throw err;
  }

  logInfo("cost_deleted", { userId: session.user.id, costId: id });
  return NextResponse.json({ ok: true });
}
