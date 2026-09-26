import { NextRequest } from "next/server";
import { json, readJson, withAgent } from "@/lib/agent-api/handler";
import { agentMatchDecision } from "@/lib/agent-api/match-decision";
import { loadHistoryReview } from "@/lib/history/review-load";

// API agenta: dopasowania historii — odczyt (grupy z kalendarzy i faktury,
// ?stan=UNMATCHED|SUGGESTED|AUTO|CONFIRMED|IGNORED) i decyzja (POST
// { rodzaj: kalendarz|faktury, akcja: przypisz|pomin|cofnij, klucze |
// faktury_ids, klient_id }) z wpisem w dzienniku.
export async function GET(req: NextRequest) {
  return withAgent(req, async () => {
    const state = req.nextUrl.searchParams.get("stan");
    const data = await loadHistoryReview();
    return json({
      totals: data.totals,
      groups: state ? data.groups.filter((g) => g.state === state) : data.groups,
      invoices: state ? data.invoices.filter((i) => i.state === state) : data.invoices,
    });
  });
}

export async function POST(req: NextRequest) {
  return withAgent(req, async (agent) => json(await agentMatchDecision(await readJson(req), agent.userId)));
}
