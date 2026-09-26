import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-guards";
import { OFFICE_AND_AGENT } from "@/lib/permissions";
import { createProposal, findSimilar, listProposals } from "@/lib/porzadki/proposals";
import { parseProposalInput, type ProposalInput } from "@/lib/porzadki/rules";
import { porzadkiErrorResponse, proposalFilters } from "@/lib/porzadki/http";
import { logInfo } from "@/lib/logger";

// Wnioski (Porządki): lista z filtrami i liczniki statusów; nowy wniosek.
// ADMIN/STAFF/AGENT. Nowy wniosek: status „nowy” albo „do decyzji”, w
// odpowiedzi lista podobnych otwartych wniosków (ochrona przed duplikatami).
export async function GET(req: NextRequest) {
  const session = await requireSession(OFFICE_AND_AGENT);
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  return NextResponse.json(await listProposals(proposalFilters(req.nextUrl.searchParams)));
}

export async function POST(req: NextRequest) {
  const session = await requireSession(OFFICE_AND_AGENT);
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ message: "Nieprawidłowe dane." }, { status: 400 });
  const parsed = parseProposalInput(body, false);
  if (!parsed.ok) return NextResponse.json({ message: parsed.message }, { status: 400 });
  const status = body.status === "DO_DECYZJI" ? "DO_DECYZJI" : "NOWY";
  try {
    const data = parsed.data as ProposalInput;
    const similar = await findSimilar(data.title, data.area);
    const p = await createProposal(data, { userId: session.user.id, role: session.user.role }, status);
    logInfo("proposal_created", { userId: session.user.id, proposalId: p.id });
    return NextResponse.json({ id: p.id, number: p.number, similar });
  } catch (err) {
    return porzadkiErrorResponse(err, "proposal_create_failed", session.user.id);
  }
}
