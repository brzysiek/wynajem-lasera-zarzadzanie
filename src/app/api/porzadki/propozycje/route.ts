import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-guards";
import { OFFICE_AND_AGENT } from "@/lib/permissions";
import { listChangeProposals, submitProposals } from "@/lib/porzadki/change-proposals";
import { porzadkiErrorResponse } from "@/lib/porzadki/http";

// Kolejka propozycji zmian: lista (?status=PENDING|ACCEPTED|REJECTED&paczka=
// &klient=&pewnosc=&rodzaj=) i zgłoszenie (hurtem: { propozycje: [...] }).
// Decyzje — tylko ADMIN (…/decyzja).
export async function GET(req: NextRequest) {
  const session = await requireSession(OFFICE_AND_AGENT);
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const sp = req.nextUrl.searchParams;
  const w = sp.get("wykonana");
  return NextResponse.json({
    proposals: await listChangeProposals({
      status: sp.get("status"),
      batch: sp.get("paczka"),
      clientId: sp.get("klient"),
      confidence: sp.get("pewnosc"),
      kind: sp.get("rodzaj"),
      executed: w === "1" || w === "true" ? true : w === "0" || w === "false" ? false : null,
    }),
  });
}

export async function POST(req: NextRequest) {
  const session = await requireSession(OFFICE_AND_AGENT);
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const body = await req.json().catch(() => null);
  try {
    const results = await submitProposals(body?.propozycje ?? body?.proposals, { userId: session.user.id, role: session.user.role });
    return NextResponse.json({ results });
  } catch (err) {
    return porzadkiErrorResponse(err, "change_proposals_submit_failed", session.user.id);
  }
}
