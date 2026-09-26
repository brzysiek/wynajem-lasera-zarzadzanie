import { NextRequest } from "next/server";
import { json, readJson, withAgent, AgentApiError } from "@/lib/agent-api/handler";
import { loadClientDetail } from "@/lib/clients/load";
import { patchClient } from "@/lib/clients/update";

// API agenta: pełna karta klienta i zmiana jego danych. PATCH wymaga
// zrodlo, pewnosc i paczka; każda zmiana pola trafia do dziennika.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withAgent(req, async () => {
    const detail = await loadClientDetail((await params).id);
    if (!detail) throw new AgentApiError("Nie znaleziono klienta.", 404);
    return json(detail);
  });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withAgent(req, async (agent) => {
    const { id } = await params;
    const result = await patchClient(id, await readJson(req), agent, { requireBatch: true });
    if (!result.ok) throw new AgentApiError(result.message, result.status);
    return json({ changed: result.changed, refreshedRentals: result.refreshedRentals });
  });
}
