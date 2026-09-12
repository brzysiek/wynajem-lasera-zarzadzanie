import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Validates a vehicleId coming from a rental create/update request. Only an
// ADMIN request ever reaches this (assignment is admin-only, same as
// driverId — see src/lib/rental-driver.ts, which this mirrors). Returns the
// resolved id, null to clear the assignment, or a ready-to-return 400
// response for the caller to bubble up.
export async function resolveVehicleId(
  value: unknown,
): Promise<{ ok: true; vehicleId: string | null } | { ok: false; response: NextResponse }> {
  if (value === null || value === "" || value === undefined) {
    return { ok: true, vehicleId: null };
  }
  if (typeof value !== "string") {
    return { ok: false, response: NextResponse.json({ message: "Nieprawidłowy pojazd." }, { status: 400 }) };
  }
  const vehicle = await prisma.vehicle.findUnique({ where: { id: value } });
  if (!vehicle) {
    return { ok: false, response: NextResponse.json({ message: "Nie znaleziono pojazdu." }, { status: 400 }) };
  }
  return { ok: true, vehicleId: vehicle.id };
}

// contactDistanceKm — wpisywane ręcznie przez biuro (docs/prompt-claude-code-dashboard-kosztow.md
// sekcja 1.3/7). "" / null / undefined czyści pole; string liczbowy (","
// jako separator dziesiętny, jak reszta pól kwotowych w tym repo) zapisuje
// wartość; cokolwiek innego jest odrzucane.
export function resolveContactDistanceKm(
  value: unknown,
): { ok: true; distanceKm: number | null } | { ok: false; response: NextResponse } {
  if (value === null || value === "" || value === undefined) {
    return { ok: true, distanceKm: null };
  }
  if (typeof value !== "string") {
    return { ok: false, response: NextResponse.json({ message: "Nieprawidłowa odległość." }, { status: 400 }) };
  }
  const n = Number(value.replace(",", "."));
  if (!Number.isFinite(n) || n < 0) {
    return { ok: false, response: NextResponse.json({ message: "Odległość musi być nieujemną liczbą." }, { status: 400 }) };
  }
  return { ok: true, distanceKm: n };
}
