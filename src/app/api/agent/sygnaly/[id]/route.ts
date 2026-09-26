import { NextRequest } from "next/server";
import { json, withAgent, AgentApiError } from "@/lib/agent-api/handler";
import { loadLeadDetail } from "@/lib/leads/load";

// API agenta: szczegół sygnału (z osią czasu).
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withAgent(req, async () => {
    const d = await loadLeadDetail((await params).id);
    if (!d) throw new AgentApiError("Sygnał nie istnieje.", 404);
    return json(d);
  });
}
