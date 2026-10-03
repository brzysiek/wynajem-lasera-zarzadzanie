import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { HUBSPOT_NEW_DEALS_KEY, hubspotNewDealsEnabled } from "@/lib/leads/hubspot-sync";
import { logInfo } from "@/lib/logger";

// Przełącznik importu nowych transakcji HubSpot → Sygnały (03.10.2026) i
// ostatnie żądania webhooka formularzy WWW. Tylko ADMIN.
export async function GET() {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const [enabled, logs] = await Promise.all([
    hubspotNewDealsEnabled(),
    prisma.webhookLog.findMany({ where: { kind: "formularz-www" }, orderBy: { createdAt: "desc" }, take: 10, select: { id: true, result: true, leadId: true, message: true, createdAt: true } }),
  ]);
  return NextResponse.json({ enabled, tokenConfigured: Boolean(process.env.WWW_WEBHOOK_TOKEN), logs });
}

export async function POST(req: NextRequest) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const body = (await req.json().catch(() => null)) as { enabled?: unknown } | null;
  if (typeof body?.enabled !== "boolean") return NextResponse.json({ message: "Podaj enabled: true / false." }, { status: 400 });
  const value = body.enabled ? "on" : "off";
  await prisma.setting.upsert({ where: { key: HUBSPOT_NEW_DEALS_KEY }, create: { key: HUBSPOT_NEW_DEALS_KEY, value }, update: { value } });
  logInfo("hubspot_new_deals_toggled", { userId: session.user.id, value });
  return NextResponse.json({ enabled: body.enabled });
}
