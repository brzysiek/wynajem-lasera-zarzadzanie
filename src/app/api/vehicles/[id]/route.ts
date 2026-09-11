import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/auth-guards";
import { logInfo, logWarn } from "@/lib/logger";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdminSession();
  if (!session) {
    return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json().catch(() => null);

  const data: {
    name?: string;
    plateNumber?: string;
    fuelCostPerKm?: number;
    fuelCostUpdatedAt?: Date;
    active?: boolean;
  } = {};

  if (typeof body?.name === "string" && body.name.trim()) data.name = body.name.trim();
  if (typeof body?.plateNumber === "string" && body.plateNumber.trim()) data.plateNumber = body.plateNumber.trim();
  if ("fuelCostPerKm" in (body ?? {})) {
    const raw = body.fuelCostPerKm;
    const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw.replace(",", ".")) : NaN;
    if (!Number.isFinite(n) || n < 0) {
      logWarn("vehicle_update_rejected", { userId: session.user.id, vehicleId: id, reason: "invalid_fuel_cost" });
      return NextResponse.json({ message: "Koszt paliwa na km musi być nieujemną liczbą." }, { status: 400 });
    }
    data.fuelCostPerKm = n;
    // Zmiana ceny paliwa = jawna aktualizacja przez ADMINA, odśwież znacznik czasu
    // pod wskaźnik „ostatnia aktualizacja: X dni temu" (sekcja 7).
    data.fuelCostUpdatedAt = new Date();
  }
  if (typeof body?.active === "boolean") data.active = body.active;

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ message: "Brak zmian do zapisania." }, { status: 400 });
  }

  const vehicle = await prisma.vehicle.update({ where: { id }, data });
  logInfo("vehicle_updated", { userId: session.user.id, vehicleId: id, fields: Object.keys(data) });

  return NextResponse.json({ vehicle });
}
