import { NextResponse } from "next/server";
import { requireStaffSession } from "@/lib/auth-guards";
import { countPendingGeocode, geocodeBatch } from "@/lib/clients/geocode";
import { logError, logInfo } from "@/lib/logger";

// Mapa klientek: uzupełnianie współrzędnych z Nominatim partiami (ok. 25 s
// na partię; panel woła kolejne, aż remaining = 0). Tylko biuro.
export async function GET() {
  const session = await requireStaffSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  return NextResponse.json({ remaining: await countPendingGeocode() });
}

export async function POST() {
  const session = await requireStaffSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  try {
    const result = await geocodeBatch();
    logInfo("clients_geocode_batch", { userId: session.user.id, ...result });
    return NextResponse.json(result);
  } catch (err) {
    logError("clients_geocode_failed", err, { userId: session.user.id });
    return NextResponse.json({ message: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
