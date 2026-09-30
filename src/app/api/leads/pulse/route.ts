import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-guards";
import { OFFICE_AND_AGENT } from "@/lib/permissions";
import { loadPulseReport } from "@/lib/leads/pulse";
import type { PulsePeriod } from "@/lib/leads/pulse-rules";

// Wniosek 36: Sygnały → Raport („puls”). ?okres=week|7|14|30&osoba=<userId>.
export async function GET(req: NextRequest) {
  const session = await requireSession(OFFICE_AND_AGENT);
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const sp = req.nextUrl.searchParams;
  const okres = sp.get("okres");
  const period: PulsePeriod = okres === "7" || okres === "14" || okres === "30" ? okres : "week";
  return NextResponse.json(await loadPulseReport({ period, personId: sp.get("osoba") || null }));
}
