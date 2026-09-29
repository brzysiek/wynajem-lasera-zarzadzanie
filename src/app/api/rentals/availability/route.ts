import { NextRequest, NextResponse } from "next/server";
import { requireStaffSession } from "@/lib/auth-guards";
import { checkAvailability, checkSpans } from "@/lib/rentals/availability";
import { seriesSpans, ymdToIdx } from "@/lib/rentals/availability-rules";

// Wniosek 29: dostępność urządzenia w formularzu rezerwacji.
// GET ?urzadzenie=&od=RRRR-MM-DD&do=RRRR-MM-DD&bez= — kolizje + najbliższe wolne.
// POST { urzadzenie, od, do, co_tyg, do_dnia, bez } — terminy serii z zajętością.
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const at = (ymd: string) => new Date(`${ymd}T00:00:00`);

export async function GET(req: NextRequest) {
  const session = await requireStaffSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const sp = req.nextUrl.searchParams;
  const device = sp.get("urzadzenie") ?? "";
  const od = sp.get("od") ?? "";
  const doDnia = sp.get("do") ?? od;
  if (!device || !DAY.test(od) || !DAY.test(doDnia)) return NextResponse.json({ message: "Podaj urządzenie i daty." }, { status: 400 });
  return NextResponse.json(await checkAvailability(device, at(od), at(doDnia), sp.get("bez")));
}

export async function POST(req: NextRequest) {
  const session = await requireStaffSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const device = typeof b?.urzadzenie === "string" ? b.urzadzenie : "";
  const od = typeof b?.od === "string" ? b.od : "";
  const doDnia = typeof b?.do === "string" ? b.do : od;
  const until = typeof b?.do_dnia === "string" ? b.do_dnia : "";
  const weeks = Number(b?.co_tyg);
  if (!device || !DAY.test(od) || !DAY.test(doDnia) || !DAY.test(until) || !(weeks >= 1 && weeks <= 26)) return NextResponse.json({ message: "Podaj urządzenie, termin, co ile tygodni i do kiedy." }, { status: 400 });
  const spans = seriesSpans({ start: ymdToIdx(od), end: ymdToIdx(doDnia) }, weeks, ymdToIdx(until));
  return NextResponse.json({ terms: await checkSpans(device, spans, typeof b?.bez === "string" ? b.bez : null) });
}
