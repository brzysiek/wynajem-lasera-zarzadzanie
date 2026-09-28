import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-guards";
import { OFFICE_AND_AGENT } from "@/lib/permissions";
import { buildOfferDraft } from "@/lib/leads/offer-draft";

// „Przygotuj ofertę” (złote zasady, pkt 6): szkic maila z 2 wolnymi terminami,
// ceną i transportem. Tylko odczyt — mail otwiera się w programie pocztowym.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession(OFFICE_AND_AGENT);
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const { id } = await params;
  const draft = await buildOfferDraft(id);
  if (!draft) return NextResponse.json({ message: "Sygnał nie istnieje." }, { status: 404 });
  return NextResponse.json(draft);
}
