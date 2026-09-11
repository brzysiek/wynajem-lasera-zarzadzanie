import { NextRequest, NextResponse } from "next/server";
import { type CostScope } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/auth-guards";
import { logInfo, logWarn } from "@/lib/logger";
import { validateCostConsistency } from "@/lib/costs/validate";
import { monthPeriod } from "@/lib/revenue/period";

const SCOPES: CostScope[] = ["GENERAL", "VEHICLE", "DEVICE"];

function parseDate(raw: string | null): Date | null {
  if (!raw) return null;
  const d = new Date(`${raw}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Strona „Wpisy kosztów" ma WŁASNY, niezależny filtr okresu (sekcja 5) — nie
// współdzielony ze stanem Przychody↔Koszty. ?from=YYYY-MM-DD&to=YYYY-MM-DD;
// bez parametrów domyślnie bieżący miesiąc kalendarzowy.
export async function GET(req: NextRequest) {
  const session = await requireAdminSession();
  if (!session) {
    return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  }

  const params = req.nextUrl.searchParams;
  const fromParam = parseDate(params.get("from"));
  const toParam = parseDate(params.get("to"));

  let from: Date;
  let to: Date;
  if (fromParam && toParam) {
    from = fromParam;
    to = new Date(toParam);
    to.setHours(23, 59, 59, 999);
  } else {
    const now = new Date();
    const p = monthPeriod(now.getFullYear(), now.getMonth() + 1);
    from = p.start;
    to = p.end;
  }

  const costs = await prisma.cost.findMany({
    where: { date: { gte: from, lte: to } },
    orderBy: { date: "desc" },
    include: {
      category: { select: { name: true, scope: true } },
      device: { select: { name: true } },
      vehicle: { select: { name: true } },
    },
  });

  return NextResponse.json({
    costs: costs.map((c) => ({
      id: c.id,
      amount: c.amount.toString(),
      date: c.date.toISOString(),
      scope: c.scope,
      categoryId: c.categoryId,
      categoryName: c.category.name,
      description: c.description,
      deviceId: c.deviceId,
      deviceName: c.device?.name ?? null,
      vehicleId: c.vehicleId,
      vehicleName: c.vehicle?.name ?? null,
    })),
  });
}

export async function POST(req: NextRequest) {
  const session = await requireAdminSession();
  if (!session) {
    return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const scope = typeof body?.scope === "string" && (SCOPES as string[]).includes(body.scope) ? (body.scope as CostScope) : null;
  const categoryId = typeof body?.categoryId === "string" ? body.categoryId : "";
  const deviceId = typeof body?.deviceId === "string" && body.deviceId ? body.deviceId : null;
  const vehicleId = typeof body?.vehicleId === "string" && body.vehicleId ? body.vehicleId : null;
  const description = typeof body?.description === "string" ? body.description.trim() || null : null;

  const amountRaw = body?.amount;
  const amount = typeof amountRaw === "number" ? amountRaw : typeof amountRaw === "string" ? Number(amountRaw.replace(",", ".")) : NaN;
  const date = parseDate(typeof body?.date === "string" ? body.date : null);

  if (!scope || !categoryId || !Number.isFinite(amount) || amount < 0 || !date) {
    logWarn("cost_create_rejected", { userId: session.user.id, reason: "missing_fields" });
    return NextResponse.json({ message: "Uzupełnij zakres, kategorię, kwotę netto (≥ 0) i datę." }, { status: 400 });
  }

  const check = await validateCostConsistency({ scope, deviceId, vehicleId, categoryId });
  if (!check.ok) {
    logWarn("cost_create_rejected", { userId: session.user.id, reason: check.message });
    return NextResponse.json({ message: check.message }, { status: 400 });
  }

  const cost = await prisma.cost.create({
    data: { amount, date, scope, categoryId, deviceId, vehicleId, description },
  });

  logInfo("cost_created", { userId: session.user.id, costId: cost.id, scope });

  return NextResponse.json({ cost });
}
