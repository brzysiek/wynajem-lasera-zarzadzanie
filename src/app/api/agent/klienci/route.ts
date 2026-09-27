import { NextRequest } from "next/server";
import { json, withAgent, AgentApiError } from "@/lib/agent-api/handler";
import { listAgentClients } from "@/lib/agent-api/clients";
import { dayParam, paginate, pagination } from "@/lib/agent-api/token";

// API agenta: klienci i kontakty z zapytań — lista z paginacją i filtrami:
// brak_telefonu=1, brak_nip=1, brak_miasta=1, status=POTENCJALNY|NOWY|STALY|
// USPIONY|BYLY|NIE_KONTAKTOWAC, miasto=, zmienione_od=RRRR-MM-DD,
// zapytania=1 (tylko kontakty z zapytań) / 0 (tylko klienci), q=.
export async function GET(req: NextRequest) {
  return withAgent(req, async () => {
    const sp = req.nextUrl.searchParams;
    const since = dayParam(sp.get("zmienione_od"));
    if (since === "invalid") throw new AgentApiError("zmienione_od: data RRRR-MM-DD.");
    const z = sp.get("zapytania");
    const list = await listAgentClients({
      missingPhone: sp.get("brak_telefonu") === "1",
      missingNip: sp.get("brak_nip") === "1",
      missingCity: sp.get("brak_miasta") === "1",
      status: sp.get("status"),
      city: sp.get("miasto"),
      changedSince: since,
      inquiries: z === "1" ? true : z === "0" ? false : null,
      q: sp.get("q"),
      region: sp.get("region"),
      beforeSeason: sp.get("przed_sezonem") === "1" || sp.get("przed_sezonem") === "true",
      noNextStep: sp.get("bez_nastepnego_kroku") === "1" || sp.get("bez_nastepnego_kroku") === "true",
    });
    return json(paginate(list, pagination(sp)));
  });
}
