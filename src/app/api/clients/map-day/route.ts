import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-guards";
import { OFFICE_AND_AGENT } from "@/lib/permissions";
import { loadDayStops } from "@/lib/clients/day-route-load";

// Mapa klientek, etap 2: dostawy i odbiory dnia (?dzien=RRRR-MM-DD).
// Tylko odczyt — biuro i agent.
export async function GET(req: NextRequest) {
  const session = await requireSession(OFFICE_AND_AGENT);
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const day = req.nextUrl.searchParams.get("dzien") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return NextResponse.json({ message: "Podaj dzień RRRR-MM-DD." }, { status: 400 });
  return NextResponse.json({ day, stops: await loadDayStops(day) });
}
