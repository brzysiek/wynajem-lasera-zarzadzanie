import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Kto może być kierowcą w rezerwacji: konto z rolą KIEROWCA albo ADMIN/STAFF z flagą driverAssignable
// (Ustawienia → Użytkownicy). Jedno miejsce prawdy dla list wyboru i walidacji zapisu.
export const DRIVER_USER_WHERE = {
  OR: [{ role: "KIEROWCA" as const }, { role: { in: ["ADMIN", "STAFF"] as ("ADMIN" | "STAFF")[] }, driverAssignable: true }],
};
export const canBeAssignedAsDriver = (u: { role: string; driverAssignable: boolean }): boolean =>
  u.role === "KIEROWCA" || ((u.role === "ADMIN" || u.role === "STAFF") && u.driverAssignable);

// Validates a driverId coming from a rental create/update request. Only an
// ADMIN request ever reaches this (assignment is admin-only). Returns the
// resolved id (a user allowed to drive — see DRIVER_USER_WHERE), null to clear the assignment, or a
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
  if (!driver || !canBeAssignedAsDriver(driver)) {
    return { ok: false, response: NextResponse.json({ message: "Nie znaleziono kierowcy." }, { status: 400 }) };
  }
  return { ok: true, driverId: driver.id };
}
