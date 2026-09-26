import { NextRequest } from "next/server";
import { json, withAgent, AgentApiError } from "@/lib/agent-api/handler";
import { loadLeadRows } from "@/lib/leads/load";
import { dayParam, paginate, pagination } from "@/lib/agent-api/token";

// API agenta: sygnały (zapytania) — lista z paginacją. Filtry: etap=, typ=,
// od=RRRR-MM-DD (wpłynęło od), do_obdzwonienia=1, klient=, q=.
export async function GET(req: NextRequest) {
  return withAgent(req, async () => {
    const sp = req.nextUrl.searchParams;
    const from = dayParam(sp.get("od"));
    if (from === "invalid") throw new AgentApiError("od: data RRRR-MM-DD.");
    const q = sp.get("q")?.toLowerCase().trim() ?? "";
    const rows = (await loadLeadRows()).filter(
      (r) =>
        (!sp.get("etap") || r.stage === sp.get("etap")) &&
        (!sp.get("typ") || r.type === sp.get("typ")) &&
        (!from || new Date(r.createdAt) >= from) &&
        (sp.get("do_obdzwonienia") !== "1" || r.callList) &&
        (!sp.get("klient") || r.clientId === sp.get("klient")) &&
        (!q || [r.title, r.person, r.email, r.phone, r.clientName, r.city].filter(Boolean).join(" ").toLowerCase().includes(q)),
    );
    rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return json(paginate(rows, pagination(sp)));
  });
}
