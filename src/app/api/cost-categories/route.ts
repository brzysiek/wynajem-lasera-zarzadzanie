import { NextRequest, NextResponse } from "next/server";
import { Prisma, type CostScope } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/auth-guards";
import { logInfo, logWarn } from "@/lib/logger";

const SCOPES: CostScope[] = ["GENERAL", "VEHICLE", "DEVICE"];

// ?scope=GENERAL|VEHICLE|DEVICE (opcjonalnie) — bez filtra zwraca wszystkie,
// wszystkie zakresy razem, jak w formularzu „Dodaj koszt" (sekcja 5.2) i
// stronie zarządzania (sekcja 6).
export async function GET(req: NextRequest) {
  const session = await requireAdminSession();
  if (!session) {
    return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  }

  const scopeParam = req.nextUrl.searchParams.get("scope");
  const scope = scopeParam && (SCOPES as string[]).includes(scopeParam) ? (scopeParam as CostScope) : undefined;

  const categories = await prisma.costCategory.findMany({
    where: scope ? { scope } : undefined,
    orderBy: [{ scope: "asc" }, { name: "asc" }],
    include: { _count: { select: { costs: true } } },
  });

  return NextResponse.json({
    categories: categories.map((c) => ({
      id: c.id,
      name: c.name,
      scope: c.scope,
      active: c.active,
      usageCount: c._count.costs,
    })),
  });
}

export async function POST(req: NextRequest) {
  const session = await requireAdminSession();
  if (!session) {
    return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const scope = typeof body?.scope === "string" && (SCOPES as string[]).includes(body.scope) ? (body.scope as CostScope) : null;

  if (!name || !scope) {
    logWarn("cost_category_create_rejected", { userId: session.user.id });
    return NextResponse.json({ message: "Podaj nazwę i poprawny zakres kategorii." }, { status: 400 });
  }

  try {
    const category = await prisma.costCategory.create({ data: { name, scope, active: true } });
    logInfo("cost_category_created", { userId: session.user.id, categoryId: category.id });
    return NextResponse.json({ category });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return NextResponse.json({ message: "Taka kategoria już istnieje w tym zakresie." }, { status: 409 });
    }
    throw err;
  }
}
