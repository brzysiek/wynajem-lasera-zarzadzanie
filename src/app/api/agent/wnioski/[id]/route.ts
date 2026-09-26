import { NextRequest } from "next/server";
import { json, readJson, withAgent, AgentApiError } from "@/lib/agent-api/handler";
import { loadProposal, setProposalStatus, updateProposal } from "@/lib/porzadki/proposals";
import { isStatus, parseProposalInput } from "@/lib/porzadki/rules";

// API agenta: szczegół i zmiana wniosku. Agent zmienia tylko własne wnioski
// w statusie NOWY / DO_DECYZJI i ustawia tylko te dwa statusy.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withAgent(req, async (agent) => {
    const p = await loadProposal((await params).id, agent);
    if (!p) throw new AgentApiError("Wniosek nie istnieje.", 404);
    return json(p);
  });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withAgent(req, async (agent) => {
    const { id } = await params;
    const { status, comment, ...fields } = await readJson(req);
    if (status !== undefined && !isStatus(status)) throw new AgentApiError("Nieznany status.");
    const parsed = parseProposalInput(fields, true);
    if (!parsed.ok) throw new AgentApiError(parsed.message);
    if (Object.keys(parsed.data).length) await updateProposal(id, parsed.data, agent);
    if (isStatus(status)) await setProposalStatus(id, status, agent, { comment: typeof comment === "string" ? comment : null });
    return json(await loadProposal(id, agent));
  });
}
