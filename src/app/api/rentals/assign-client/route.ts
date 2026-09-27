import { NextRequest, NextResponse } from "next/server";
import { requireStaffSession } from "@/lib/auth-guards";
import { assignRentalsToClient } from "@/lib/clients/rental-match";
import { logError, logInfo } from "@/lib/logger";

// Potwierdzenie „rezerwacja → klient” na /klienci/dopasowania (wniosek 13).
// Tylko ADMIN/STAFF — agent rezerwacji nie zmienia, zgłasza propozycje.
export async function POST(req: NextRequest) {
  const session = await requireStaffSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });

  const body = (await req.json().catch(() => null)) as { rentalIds?: unknown; clientId?: unknown } | null;
  const rentalIds = Array.isArray(body?.rentalIds) ? body.rentalIds.filter((x): x is string => typeof x === "string" && x.length > 0).slice(0, 200) : [];
  const clientId = typeof body?.clientId === "string" ? body.clientId : "";
  if (rentalIds.length === 0 || !clientId) return NextResponse.json({ message: "Wybierz rezerwacje i klienta." }, { status: 400 });

  try {
    const result = await assignRentalsToClient({ rentalIds, clientId, userId: session.user.id });
    logInfo("rentals_client_assigned", { userId: session.user.id, clientId, ...result });
    return NextResponse.json(result);
  } catch (err) {
    logError("rentals_client_assign_failed", err, { userId: session.user.id, clientId });
    return NextResponse.json({ message: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
