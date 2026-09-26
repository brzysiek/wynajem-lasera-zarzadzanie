import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-guards";
import { OFFICE_AND_AGENT } from "@/lib/permissions";
import { listChangeLog } from "@/lib/changelog/load";
import { changeLogFilters } from "@/lib/porzadki/http";

// Dziennik zmian — odczyt z filtrami (?klient=&paczka=&autor=&obiekt=&od=&do=&q=).
export async function GET(req: NextRequest) {
  const session = await requireSession(OFFICE_AND_AGENT);
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const limit = Number(req.nextUrl.searchParams.get("limit")) || 300;
  return NextResponse.json({ entries: await listChangeLog(changeLogFilters(req.nextUrl.searchParams), limit) });
}
