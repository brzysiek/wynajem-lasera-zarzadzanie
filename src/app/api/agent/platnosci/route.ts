import { NextRequest } from "next/server";
import { json, withAgent, AgentApiError } from "@/lib/agent-api/handler";
import { dayParam, pagination } from "@/lib/agent-api/token";
import { listPaymentsForAgent } from "@/lib/invoicing/bank-transfers";

// API agenta (tylko odczyt): przelewy przychodzące z wgranych wyciągów CSV
// z dopasowaniem do faktur, nieopłacone faktury i data ostatniego importu.
// Filtry: od=, do= (data przelewu), stan= (niedopasowane | dopasowane |
// AUTO | MANUAL | AMBIGUOUS | NONE), klient=.
export async function GET(req: NextRequest) {
  return withAgent(req, async () => {
    const sp = req.nextUrl.searchParams;
    const from = dayParam(sp.get("od"));
    const to = dayParam(sp.get("do"));
    if (from === "invalid" || to === "invalid") throw new AgentApiError("od / do: data RRRR-MM-DD.");
    const p = pagination(sp);
    const data = await listPaymentsForAgent({ from, to, state: sp.get("stan"), clientId: sp.get("klient"), skip: p.skip, take: p.perPage });
    return json({ ...data, page: p.page, perPage: p.perPage });
  });
}
