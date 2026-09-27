import { NextRequest, NextResponse } from "next/server";
import { requireStaffSession } from "@/lib/auth-guards";
import { setManualGeo } from "@/lib/clients/geocode";
import { logInfo } from "@/lib/logger";

// Ręczna poprawka pinezki na mapie ({ lat, lng }) albo { reset: true } —
// powrót do liczenia z adresu. Tylko biuro (agent nie zmienia).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireStaffSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as { lat?: unknown; lng?: unknown; reset?: unknown } | null;
  let geo: { lat: number; lng: number } | null = null;
  if (body?.reset !== true) {
    const lat = Number(body?.lat);
    const lng = Number(body?.lng);
    // Polska z zapasem.
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < 48 || lat > 55.5 || lng < 13 || lng > 25) {
      return NextResponse.json({ message: "Nieprawidłowe współrzędne." }, { status: 400 });
    }
    geo = { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 };
  }
  if (!(await setManualGeo(id, geo))) return NextResponse.json({ message: "Nie znaleziono klienta." }, { status: 404 });
  logInfo("client_geo_manual", { userId: session.user.id, clientId: id, reset: !geo });
  return NextResponse.json({ ok: true });
}
