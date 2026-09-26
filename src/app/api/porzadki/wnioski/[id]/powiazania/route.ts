import { NextRequest, NextResponse } from "next/server";
import { requireSession, requireStaffSession } from "@/lib/auth-guards";
import { OFFICE_AND_AGENT } from "@/lib/permissions";
import { addProposalRelation, loadProposal, removeProposalRelation } from "@/lib/porzadki/proposals";
import { isRelation } from "@/lib/porzadki/rules";
import { porzadkiErrorResponse } from "@/lib/porzadki/http";

// Powiązania wniosku (duplikat / zależy od / zastępuje). Dodaje autor albo
// ADMIN (także AGENT przy własnym wniosku); usuwa tylko ADMIN/STAFF.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession(OFFICE_AND_AGENT);
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!isRelation(body?.kind) || typeof body?.toId !== "string") return NextResponse.json({ message: "Podaj rodzaj powiązania i wniosek." }, { status: 400 });
  const actor = { userId: session.user.id, role: session.user.role };
  try {
    await addProposalRelation(id, body.kind, body.toId, actor);
    return NextResponse.json(await loadProposal(id, actor));
  } catch (err) {
    return porzadkiErrorResponse(err, "proposal_relation_failed", session.user.id);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireStaffSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const { id } = await params;
  const relationId = req.nextUrl.searchParams.get("relationId") ?? "";
  const actor = { userId: session.user.id, role: session.user.role };
  try {
    await removeProposalRelation(relationId, actor);
    return NextResponse.json(await loadProposal(id, actor));
  } catch (err) {
    return porzadkiErrorResponse(err, "proposal_relation_failed", session.user.id);
  }
}
