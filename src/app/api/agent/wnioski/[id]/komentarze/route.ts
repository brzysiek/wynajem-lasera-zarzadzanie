import { NextRequest } from "next/server";
import { json, readJson, withAgent } from "@/lib/agent-api/handler";
import { addProposalComment, loadProposal } from "@/lib/porzadki/proposals";

// API agenta: komentarz do wniosku ({ "tresc": "…" }).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withAgent(req, async (agent) => {
    const { id } = await params;
    const body = await readJson(req);
    const text = body.tresc ?? body.body;
    await addProposalComment(id, typeof text === "string" ? text : "", agent);
    return json(await loadProposal(id, agent), 201);
  });
}
