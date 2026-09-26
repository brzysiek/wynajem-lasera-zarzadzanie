import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { createCode, validateAuthorize } from "@/lib/oauth/server";
import { redirectWithParams } from "@/lib/oauth/rules";
import { oauthIssuer } from "@/lib/oauth/config";
import { logInfo } from "@/lib/logger";

// Decyzja z ekranu zgody (/oauth/authorize) — tylko zalogowany ADMIN.
// „Zezwól” wydaje jednorazowy kod dla wybranego konta z rolą AGENT i wraca
// do Claude; „Odmów” wraca z error=access_denied.
export async function POST(req: NextRequest) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ message: "Zgodę wydaje administrator panelu." }, { status: 403 });
  const form = new URLSearchParams(await req.text());
  const v = await validateAuthorize(form);
  if (!v.ok) return NextResponse.json({ message: v.message }, { status: 400 });
  const { params } = v;

  if (form.get("decision") !== "allow") {
    return NextResponse.redirect(redirectWithParams(params.redirectUri, { error: "access_denied", state: params.state, iss: oauthIssuer() }), 303);
  }
  const agentId = form.get("agent_user_id") ?? "";
  const agent = await prisma.user.findUnique({ where: { id: agentId }, select: { id: true, role: true } });
  if (agent?.role !== "AGENT") return NextResponse.json({ message: "Wybierz konto z rolą Agent AI." }, { status: 400 });

  const code = await createCode(params, agent.id, session.user.id);
  logInfo("oauth_consent_granted", { userId: session.user.id, agentUserId: agent.id, clientId: params.clientId });
  return NextResponse.redirect(redirectWithParams(params.redirectUri, { code, state: params.state, iss: oauthIssuer() }), 303);
}
