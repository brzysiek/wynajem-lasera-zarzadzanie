import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-guards";
import { OFFICE_AND_AGENT } from "@/lib/permissions";
import { loadRentalCandidates } from "@/lib/leads/rental-candidates";

// „Powiąż z wynajmem” (wniosek 18 b): kandydaci i wyszukiwarka po dacie /
// nazwie. Tylko odczyt — samo powiązanie idzie przez PATCH /api/leads/[id].
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession(OFFICE_AND_AGENT);
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const { id } = await params;
  const q = new URL(req.url).searchParams.get("q") ?? "";
  return NextResponse.json({ candidates: await loadRentalCandidates(id, q.slice(0, 80)) });
}
