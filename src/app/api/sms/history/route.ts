import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-guards";
import { OFFICE_AND_AGENT } from "@/lib/permissions";
import { searchSmsHistory } from "@/lib/sms/history";

// Historia SMS z wyszukiwaniem po treści (wniosek 53). Biuro i agent (odczyt); KIEROWCA — 403.
export async function GET(req: NextRequest) {
  const session = await requireSession(OFFICE_AND_AGENT);
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const p = req.nextUrl.searchParams;
  const num = (k: string) => {
    const v = Number(p.get(k));
    return Number.isFinite(v) && v > 0 ? v : undefined;
  };
  return NextResponse.json(await searchSmsHistory({ q: p.get("q") ?? undefined, clientId: p.get("clientId") ?? undefined, from: p.get("from") ?? undefined, to: p.get("to") ?? undefined, limit: num("limit"), offset: num("offset") }));
}
