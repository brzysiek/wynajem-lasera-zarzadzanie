import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/auth-guards";
import { logInfo, logWarn } from "@/lib/logger";

// Moduł kosztów — wyłącznie ADMIN (docs/prompt-claude-code-dashboard-kosztow.md, sekcja 0).
export async function GET() {
  const session = await requireAdminSession();
  if (!session) {
    return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  }

  const vehicles = await prisma.vehicle.findMany({ orderBy: { name: "asc" } });
  return NextResponse.json({ vehicles });
}

export async function POST(req: NextRequest) {
  const session = await requireAdminSession();
  if (!session) {
    return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const plateNumber = typeof body?.plateNumber === "string" ? body.plateNumber.trim() : "";
  const fuelCostRaw = body?.fuelCostPerKm;
  const fuelCostPerKm =
    typeof fuelCostRaw === "number" ? fuelCostRaw : typeof fuelCostRaw === "string" ? Number(fuelCostRaw.replace(",", ".")) : NaN;

  if (!name || !plateNumber || !Number.isFinite(fuelCostPerKm) || fuelCostPerKm < 0) {
    logWarn("vehicle_create_rejected", { userId: session.user.id });
    return NextResponse.json(
      { message: "Uzupełnij nazwę, numer rejestracyjny i nieujemny koszt paliwa na km." },
      { status: 400 },
    );
  }

  const vehicle = await prisma.vehicle.create({
    data: { name, plateNumber, fuelCostPerKm, fuelCostUpdatedAt: new Date(), active: true },
  });

  logInfo("vehicle_created", { userId: session.user.id, vehicleId: vehicle.id });

  return NextResponse.json({ vehicle });
}
