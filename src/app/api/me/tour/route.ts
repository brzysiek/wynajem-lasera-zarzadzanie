import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-guards";
import { OFFICE_ROLES } from "@/lib/permissions";
import { TOURS, markTour, type TourKey } from "@/lib/tours";

// Przewodnik (wniosek 19): „Później” / obejrzany — tylko własna flaga, tylko
// biuro (agent i kierowca przewodnika nie dostają).
export async function POST(req: NextRequest) {
  const session = await requireSession(OFFICE_ROLES);
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const body = (await req.json().catch(() => null)) as { tour?: string; action?: string } | null;
  if (!body || !TOURS.includes(body.tour as TourKey) || (body.action !== "later" && body.action !== "done")) {
    return NextResponse.json({ message: "Nieprawidłowe dane." }, { status: 400 });
  }
  await markTour(session.user.id, body.tour as TourKey, body.action);
  return NextResponse.json({ ok: true });
}
