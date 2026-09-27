import { NextResponse } from "next/server";
import { requireStaffSession } from "@/lib/auth-guards";
import { BATCH_MS, countPendingGeocode, geocodeBatch } from "@/lib/clients/geocode";
import { countPendingDeliveryGeo, deliveryGeoBatch } from "@/lib/clients/delivery";
import { logError, logInfo } from "@/lib/logger";

// Mapa klientek: uzupełnianie współrzędnych z Nominatim partiami (ok. 25 s
// na partię; panel woła kolejne, aż remaining = 0). Najpierw adresy dostawy
// z paszportu (współrzędne + trasa OSRM od bazy), potem pozostali klienci.
// Tylko biuro.
export async function GET() {
  const session = await requireStaffSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const [clients, addresses] = await Promise.all([countPendingGeocode(), countPendingDeliveryGeo()]);
  return NextResponse.json({ remaining: clients + addresses });
}

export async function POST() {
  const session = await requireStaffSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  try {
    const deadline = Date.now() + BATCH_MS;
    const addr = await deliveryGeoBatch(deadline);
    const cl = Date.now() < deadline ? await geocodeBatch(deadline) : { done: 0, found: 0, notFound: 0, remaining: await countPendingGeocode() };
    const result = { done: addr.done + cl.done, found: addr.done + cl.found, notFound: cl.notFound, remaining: addr.remaining + cl.remaining };
    logInfo("clients_geocode_batch", { userId: session.user.id, addresses: addr.done, ...result });
    return NextResponse.json(result);
  } catch (err) {
    logError("clients_geocode_failed", err, { userId: session.user.id });
    return NextResponse.json({ message: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
