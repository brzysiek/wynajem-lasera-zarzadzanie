import { NextRequest, NextResponse } from "next/server";
import { requireStaffSession } from "@/lib/auth-guards";
import { DraftError, saveMailDraftToGmail } from "@/lib/leads/mail-draft";
import { logError } from "@/lib/logger";

// „Zapisz szkic w Gmailu” (wniosek 44): zapis albo aktualizacja szkicu na
// kontakt@ (odpowiedź w wątku klientki). Tylko szkic — wysyła człowiek w
// Gmailu. ADMIN/STAFF.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireStaffSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const { id } = await params;
  try {
    return NextResponse.json({ draft: await saveMailDraftToGmail(id, { kind: "USER", userId: session.user.id }) });
  } catch (err) {
    if (err instanceof DraftError) return NextResponse.json({ message: err.message }, { status: err.status });
    logError("mail_draft_gmail_route_failed", err, { leadId: id, userId: session.user.id });
    return NextResponse.json({ message: "Nie udało się zapisać szkicu w Gmailu." }, { status: 500 });
  }
}
