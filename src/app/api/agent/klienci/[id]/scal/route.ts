import { NextRequest } from "next/server";
import { json, readJson, withAgent, AgentApiError } from "@/lib/agent-api/handler";
import { mergeClients } from "@/lib/clients/merge";

// API agenta: scal duplikat w tego klienta. Body: { zrodlowy_id, zrodlo,
// pewnosc, paczka }. Duplikat trafia do archiwum („duplikat”), wszystko z
// niego przechodzi na klienta :id; wpisy w dzienniku.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withAgent(req, async (agent) => {
    const body = await readJson(req);
    if (typeof body.paczka !== "string" || !body.paczka.trim()) throw new AgentApiError("Podaj paczkę zmiany (paczka).");
    const sourceId = typeof body.zrodlowy_id === "string" ? body.zrodlowy_id : "";
    const result = await mergeClients((await params).id, sourceId, body, agent);
    if (!result.ok) throw new AgentApiError(result.message, result.status);
    return json({ moved: result.moved });
  });
}
