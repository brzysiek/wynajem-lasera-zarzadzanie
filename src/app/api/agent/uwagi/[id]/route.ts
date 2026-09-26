import { NextRequest } from "next/server";
import { json, readJson, withAgent, AgentApiError } from "@/lib/agent-api/handler";
import { normalizeRemarkBody } from "@/lib/agent-api/remark-body";
import { parseRemarkInput, updateRemark } from "@/lib/porzadki/remarks";

// API agenta: zmiana własnej uwagi (treść, obszar, dowód, klient, status OPEN/CLOSED).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withAgent(req, async (agent) => {
    const { status, ...rest } = normalizeRemarkBody(await readJson(req));
    if (status !== undefined && status !== "OPEN" && status !== "CLOSED") throw new AgentApiError("status: OPEN albo CLOSED.");
    const parsed = parseRemarkInput(rest, true);
    if (!parsed.ok) throw new AgentApiError(parsed.message);
    await updateRemark((await params).id, { ...parsed.data, ...(status ? { status: status as "OPEN" | "CLOSED" } : {}) }, agent);
    return json({ ok: true });
  });
}
