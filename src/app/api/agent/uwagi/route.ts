import { NextRequest } from "next/server";
import { json, readJson, withAgent, AgentApiError } from "@/lib/agent-api/handler";
import { normalizeRemarkBody } from "@/lib/agent-api/remark-body";
import { createRemark, listRemarks, parseRemarkInput, type RemarkInput } from "@/lib/porzadki/remarks";

// API agenta: uwagi — lista (?status=OPEN|CLOSED&obszar=&klient=&q=) i nowa
// uwaga ({ tresc, obszar, dowod, klient_id, sygnal_id }).
export async function GET(req: NextRequest) {
  return withAgent(req, async (agent) => {
    const sp = req.nextUrl.searchParams;
    return json({ remarks: await listRemarks({ status: sp.get("status"), area: sp.get("obszar"), clientId: sp.get("klient"), q: sp.get("q") }, agent) });
  });
}

export async function POST(req: NextRequest) {
  return withAgent(req, async (agent) => {
    const { status: _s, ...body } = normalizeRemarkBody(await readJson(req));
    void _s;
    const parsed = parseRemarkInput(body, false);
    if (!parsed.ok) throw new AgentApiError(parsed.message);
    const r = await createRemark(parsed.data as RemarkInput, agent);
    return json({ id: r.id }, 201);
  });
}
