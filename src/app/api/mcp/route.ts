import { NextRequest, NextResponse } from "next/server";
import { AgentApiError, isRateLimited, logAgentCall, rateLimitResponse, resolveAgent } from "@/lib/agent-api/handler";
import { PorzadkiError } from "@/lib/porzadki/proposals";
import { TOOLS, TOOL_BY_NAME } from "@/lib/mcp/tools";
import { handleMessage, type RpcMessage, type RpcResponse } from "@/lib/mcp/protocol";
import { resourceMetadataUrl } from "@/lib/oauth/config";
import { logError } from "@/lib/logger";

// Serwer MCP panelu (konektor claude.ai). Token: OAuth (ekran zgody ADMIN,
// konto z rolą AGENT) albo token API z Ustawień w nagłówku Authorization.
// Bez tokenu — 401 ze wskazaniem metadanych OAuth (claude.ai zaczyna wtedy
// logowanie). Narzędzia i ich reguły: src/lib/mcp/tools.ts. Każde wywołanie
// w logu API agenta („/api/mcp <metoda>:<narzędzie>”).
const UNAUTHORIZED_HEADERS = () => ({ "WWW-Authenticate": `Bearer resource_metadata="${resourceMetadataUrl()}"` });

export async function POST(req: NextRequest) {
  const started = Date.now();
  const resolved = await resolveAgent(req);
  if (!resolved.ok) {
    return NextResponse.json({ error: "unauthorized", error_description: "Potrzebny token agenta (OAuth albo token API)." }, { status: 401, headers: UNAUTHORIZED_HEADERS() });
  }
  const r = resolved.value;
  const body = await req.json().catch(() => undefined);
  const messages: RpcMessage[] = Array.isArray(body) ? body : body && typeof body === "object" ? [body] : [];
  const label = messages
    .map((m) => `${m.method ?? "?"}${m.method === "tools/call" && typeof m.params?.name === "string" ? `:${m.params.name}` : ""}`)
    .join(",")
    .slice(0, 200);

  let res: Response;
  if (!messages.length) {
    res = NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Nieprawidłowy JSON-RPC." } }, { status: 400 });
  } else if (await isRateLimited(r.agent.tokenId)) {
    res = rateLimitResponse();
  } else {
    const out: RpcResponse[] = [];
    for (const m of messages) {
      const reply = await handleMessage(m, {
        tools: TOOLS,
        call: async (name, args) => {
          try {
            return { ok: true, value: await TOOL_BY_NAME.get(name)!.run(args, r.agent) };
          } catch (err) {
            if (err instanceof AgentApiError || err instanceof PorzadkiError) return { ok: false, message: err.message };
            logError("mcp_tool_failed", err, { tool: name, tokenId: r.agent.tokenId });
            return { ok: false, message: "Błąd serwera przy wykonaniu narzędzia." };
          }
        },
      });
      if (reply) out.push(reply);
    }
    res = out.length === 0 ? new NextResponse(null, { status: 202 }) : NextResponse.json(Array.isArray(body) ? out : out[0]);
  }
  await logAgentCall(r, "MCP", `/api/mcp ${label}`, res.status, started);
  return res;
}

// Bezstanowy serwer: bez strumienia SSE i sesji.
export function GET() {
  return new NextResponse(null, { status: 405, headers: { Allow: "POST" } });
}

export function DELETE() {
  return new NextResponse(null, { status: 405, headers: { Allow: "POST" } });
}
