import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth-guards";
import { editProposalValue } from "@/lib/porzadki/change-proposals";
import { porzadkiErrorResponse } from "@/lib/porzadki/http";

// „Edytuj wartość” — ADMIN poprawia proponowaną wartość pola przed akceptacją.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const body = await req.json().catch(() => null);
  if (!body || !("value" in body)) return NextResponse.json({ message: "Podaj value." }, { status: 400 });
  try {
    await editProposalValue((await params).id, body.value, { userId: session.user.id, role: session.user.role });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return porzadkiErrorResponse(err, "change_proposal_edit_failed", session.user.id);
  }
}
