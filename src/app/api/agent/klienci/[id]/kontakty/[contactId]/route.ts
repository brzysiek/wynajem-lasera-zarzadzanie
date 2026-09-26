import { NextRequest } from "next/server";
import { json, readJson, withAgent, AgentApiError } from "@/lib/agent-api/handler";
import { patchContact } from "@/lib/clients/update";

// API agenta: zmiana osoby kontaktowej (imię, nazwisko, telefony, e-mail,
// rola, osoba główna). Wymagane zrodlo, pewnosc i paczka; wpis w dzienniku.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; contactId: string }> }) {
  return withAgent(req, async (agent) => {
    const { id, contactId } = await params;
    const result = await patchContact(id, contactId, await readJson(req), agent, { requireBatch: true });
    if (!result.ok) throw new AgentApiError(result.message, result.status);
    return json({ changed: result.changed, refreshedRentals: result.refreshedRentals });
  });
}
