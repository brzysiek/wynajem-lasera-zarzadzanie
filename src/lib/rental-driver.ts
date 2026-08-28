import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Validates a driverId coming from a rental create/update request. Only an
// ADMIN request ever reaches this (assignment is admin-only). Returns the
// resolved id (a real KIEROWCA user), null to clear the assignment, or a
// ready-to-return 400 response for the caller to bubble up.
export async function resolveDriverId(
  value: unknown,
): Promise<{ ok: true; driverId: string | null } | { ok: false; response: NextResponse }> {
  if (value === null || value === "" || value === undefined) {
    return { ok: true, driverId: null };
  }
  if (typeof value !== "string") {
    return { ok: false, response: NextResponse.json({ message: "Nieprawidłowy kierowca." }, { status: 400 }) };
  }
  const driver = await prisma.user.findUnique({ where: { id: value } });
  if (!driver || driver.role !== "KIEROWCA") {
    return { ok: false, response: NextResponse.json({ message: "Nie znaleziono kierowcy." }, { status: 400 }) };
  }
  return { ok: true, driverId: driver.id };
}
