import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/auth-guards";
import { logInfo, logWarn } from "@/lib/logger";

// Zmiana nazwy (inline, sekcja 6) i/lub przełącznik aktywna/nieaktywna.
// Zakres (scope) się nie zmienia po utworzeniu — kategoria "GENERAL" nie
// staje się "VEHICLE" (to by rozjechało istniejące powiązane Cost).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdminSession();
  if (!session) {
    return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json().catch(() => null);

  const data: { name?: string; active?: boolean } = {};
  if (typeof body?.name === "string" && body.name.trim()) data.name = body.name.trim();
  if (typeof body?.active === "boolean") data.active = body.active;

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ message: "Brak zmian do zapisania." }, { status: 400 });
  }

  try {
    const category = await prisma.costCategory.update({ where: { id }, data });
    logInfo("cost_category_updated", { userId: session.user.id, categoryId: id, fields: Object.keys(data) });
    return NextResponse.json({ category });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return NextResponse.json({ message: "Taka kategoria już istnieje w tym zakresie." }, { status: 409 });
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return NextResponse.json({ message: "Nie znaleziono kategorii." }, { status: 404 });
    }
    throw err;
  }
}

// Twarde usunięcie — TYLKO gdy kategoria nie ma żadnych powiązanych Cost
// (sekcja 6: "Nie pozwalaj na twarde usunięcie kategorii, która ma choć
// jeden powiązany Cost"). W praktyce ADMIN powinien dezaktywować (PATCH
// active:false), to jest furtka na wypadek pomyłkowo utworzonej kategorii.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdminSession();
  if (!session) {
    return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  }

  const { id } = await params;
  const usageCount = await prisma.cost.count({ where: { categoryId: id } });
  if (usageCount > 0) {
    logWarn("cost_category_delete_rejected", { userId: session.user.id, categoryId: id, usageCount });
    return NextResponse.json(
      { message: `Kategoria ma ${usageCount} powiązanych wpisów kosztowych — dezaktywuj ją zamiast usuwać.` },
      { status: 409 },
    );
  }

  try {
    await prisma.costCategory.delete({ where: { id } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return NextResponse.json({ message: "Nie znaleziono kategorii." }, { status: 404 });
    }
    throw err;
  }

  logInfo("cost_category_deleted", { userId: session.user.id, categoryId: id });
  return NextResponse.json({ ok: true });
}
