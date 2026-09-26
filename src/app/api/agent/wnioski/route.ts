import { NextRequest } from "next/server";
import { json, readJson, withAgent, AgentApiError } from "@/lib/agent-api/handler";
import { createProposal, findSimilar, listProposals } from "@/lib/porzadki/proposals";
import { parseProposalInput, type ProposalInput } from "@/lib/porzadki/rules";
import { proposalFilters } from "@/lib/porzadki/http";

// API agenta: lista wniosków (filtry jak w panelu) i nowy wniosek (status
// „NOWY” albo „DO_DECYZJI”). W odpowiedzi podobne otwarte wnioski.
export async function GET(req: NextRequest) {
  return withAgent(req, async () => json(await listProposals(proposalFilters(req.nextUrl.searchParams))));
}

export async function POST(req: NextRequest) {
  return withAgent(req, async (agent) => {
    const body = await readJson(req);
    const parsed = parseProposalInput(body, false);
    if (!parsed.ok) throw new AgentApiError(parsed.message);
    const data = parsed.data as ProposalInput;
    const similar = await findSimilar(data.title, data.area);
    const status = body.status === "DO_DECYZJI" ? "DO_DECYZJI" : "NOWY";
    const p = await createProposal(data, agent, status);
    return json({ id: p.id, number: p.number, status, similar }, 201);
  });
}
