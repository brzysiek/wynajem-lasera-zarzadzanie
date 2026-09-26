import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-guards";
import { OFFICE_AND_AGENT } from "@/lib/permissions";
import { addProposalComment, loadProposal } from "@/lib/porzadki/proposals";
import { porzadkiErrorResponse } from "@/lib/porzadki/http";

// Komentarz do wniosku — ADMIN/STAFF/AGENT (bez edycji i usuwania).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession(OFFICE_AND_AGENT);
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const actor = { userId: session.user.id, role: session.user.role };
  try {
    await addProposalComment(id, typeof body?.body === "string" ? body.body : "", actor);
    return NextResponse.json(await loadProposal(id, actor));
  } catch (err) {
    return porzadkiErrorResponse(err, "proposal_comment_failed", session.user.id);
  }
}
