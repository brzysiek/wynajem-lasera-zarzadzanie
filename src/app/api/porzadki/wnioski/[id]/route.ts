import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-guards";
import { OFFICE_AND_AGENT } from "@/lib/permissions";
import { loadProposal, setProposalStatus, updateProposal } from "@/lib/porzadki/proposals";
import { isStatus, parseProposalInput } from "@/lib/porzadki/rules";
import { porzadkiErrorResponse } from "@/lib/porzadki/http";
import { logInfo } from "@/lib/logger";

// Szczegół wniosku i zmiany. Pola: autor (dopóki „nowy / do decyzji”) albo
// ADMIN. Status (`status` + `comment`, dla duplikatu `duplicateOfId`):
// statusy decyzyjne tylko ADMIN — reguła w src/lib/porzadki/rules.ts.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession(OFFICE_AND_AGENT);
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const { id } = await params;
  const p = await loadProposal(id, { userId: session.user.id, role: session.user.role });
  if (!p) return NextResponse.json({ message: "Wniosek nie istnieje." }, { status: 404 });
  return NextResponse.json(p);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession(OFFICE_AND_AGENT);
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ message: "Nieprawidłowe dane." }, { status: 400 });
  const actor = { userId: session.user.id, role: session.user.role };
  const { status, comment, duplicateOfId, ...fields } = body as Record<string, unknown>;
  if (status !== undefined && !isStatus(status)) return NextResponse.json({ message: "Nieznany status." }, { status: 400 });
  const parsed = parseProposalInput(fields, true);
  if (!parsed.ok) return NextResponse.json({ message: parsed.message }, { status: 400 });
  try {
    if (Object.keys(parsed.data).length) await updateProposal(id, parsed.data, actor);
    if (isStatus(status)) {
      await setProposalStatus(id, status, actor, {
        comment: typeof comment === "string" ? comment : null,
        duplicateOfId: typeof duplicateOfId === "string" ? duplicateOfId : null,
      });
    }
    logInfo("proposal_updated", { userId: session.user.id, proposalId: id, status: status ?? null, fields: Object.keys(parsed.data) });
    return NextResponse.json(await loadProposal(id, actor));
  } catch (err) {
    return porzadkiErrorResponse(err, "proposal_update_failed", session.user.id);
  }
}
