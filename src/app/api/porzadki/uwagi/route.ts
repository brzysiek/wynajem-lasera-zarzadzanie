import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-guards";
import { OFFICE_AND_AGENT } from "@/lib/permissions";
import { createRemark, listRemarks, parseRemarkInput, type RemarkInput } from "@/lib/porzadki/remarks";
import { porzadkiErrorResponse } from "@/lib/porzadki/http";
import { loadAreas } from "@/lib/porzadki/areas";

// Uwagi (Porządki) — lista (?status=OPEN&obszar=&klient=&q=) i nowa uwaga.
// ADMIN/STAFF/AGENT.
export async function GET(req: NextRequest) {
  const session = await requireSession(OFFICE_AND_AGENT);
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const sp = req.nextUrl.searchParams;
  const [remarks, areas] = await Promise.all([
    listRemarks(
      { status: sp.get("status"), area: sp.get("obszar") ?? sp.get("area"), clientId: sp.get("klient") ?? sp.get("clientId"), q: sp.get("q") },
      { userId: session.user.id, role: session.user.role },
    ),
    loadAreas(),
  ]);
  // areas — słownik obszarów (proposal_areas) do filtrów i przekształcenia we wniosek.
  return NextResponse.json({ remarks, areas });
}

export async function POST(req: NextRequest) {
  const session = await requireSession(OFFICE_AND_AGENT);
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ message: "Nieprawidłowe dane." }, { status: 400 });
  const parsed = parseRemarkInput(body, false);
  if (!parsed.ok) return NextResponse.json({ message: parsed.message }, { status: 400 });
  try {
    const r = await createRemark(parsed.data as RemarkInput, { userId: session.user.id, role: session.user.role });
    return NextResponse.json({ id: r.id });
  } catch (err) {
    return porzadkiErrorResponse(err, "remark_create_failed", session.user.id);
  }
}
