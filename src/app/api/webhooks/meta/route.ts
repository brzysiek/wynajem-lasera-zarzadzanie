import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseMetaPayload, verifyMetaSignature } from "@/lib/chat/meta-rules";
import { ingestMetaEvents } from "@/lib/chat/ingest";
import { sendAlert } from "@/lib/alerts";
import { logError, logInfo, logWarn } from "@/lib/logger";

// Messenger i Instagram Direct (wniosek 42, faza 1: tylko odbiór). Meta Messenger
// Platform → webhook. GET: weryfikacja subskrypcji (META_VERIFY_TOKEN). POST:
// podpis X-Hub-Signature-256 (META_APP_SECRET) sprawdzany na surowym ciele; błąd
// zapisu → 500, żeby Meta ponowiła dostarczenie (zapis jest idempotentny po mid).
const KIND = "meta-chat";

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const token = process.env.META_VERIFY_TOKEN;
  if (p.get("hub.mode") === "subscribe" && token && p.get("hub.verify_token") === token && p.get("hub.challenge")) {
    return new NextResponse(p.get("hub.challenge"), { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
}

async function log(result: string, data: { message?: string | null; leadId?: string | null; receivedAt: Date; tookMs: number; externalId?: string | null }) {
  await prisma.webhookLog
    .create({ data: { kind: KIND, result, message: data.message ?? null, leadId: data.leadId ?? null, receivedAt: data.receivedAt, tookMs: data.tookMs, externalId: data.externalId ?? null } })
    .catch((err) => logError("meta_webhook_log_failed", err));
}

export async function POST(req: NextRequest) {
  const receivedAt = new Date();
  const took = () => Date.now() - receivedAt.getTime();
  const raw = await req.text().catch(() => "");
  if (!verifyMetaSignature(raw, req.headers.get("x-hub-signature-256"), process.env.META_APP_SECRET)) {
    logWarn("meta_webhook_bad_signature", { hasHeader: Boolean(req.headers.get("x-hub-signature-256")), hasSecret: Boolean(process.env.META_APP_SECRET) });
    await log("UNAUTHORIZED", { receivedAt, tookMs: took() });
    return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  }
  let body: unknown = null;
  try {
    body = JSON.parse(raw);
  } catch {
    await log("BAD_REQUEST", { receivedAt, tookMs: took(), message: "Nieprawidłowy JSON" });
    return NextResponse.json({ message: "Nieprawidłowe dane." }, { status: 400 });
  }
  const events = parseMetaPayload(body);
  if (!events.length) {
    await log("IGNORED", { receivedAt, tookMs: took() });
    return NextResponse.json({ ok: true, ignored: true });
  }
  try {
    const r = await ingestMetaEvents(events);
    logInfo("meta_webhook_ok", { events: events.length, ...r });
    await log("OK", { receivedAt, tookMs: took(), message: `wiadomości ${r.stored}, duplikaty ${r.duplicates}, nowe sygnały ${r.leads}`, externalId: events[0].mid });
    return NextResponse.json({ ok: true, ...r });
  } catch (err) {
    logError("meta_webhook_failed", err);
    await log("ERROR", { receivedAt, tookMs: took(), message: err instanceof Error ? err.message.slice(0, 500) : String(err), externalId: events[0].mid });
    await sendAlert({ key: "meta-webhook-error", subject: "Webhook Messenger/Instagram: błąd zapisu", text: `Nie udało się zapisać wiadomości z Meta (${err instanceof Error ? err.message : String(err)}). Meta ponowi dostarczenie.`, throttleMin: 60 }).catch(() => undefined);
    return NextResponse.json({ message: "Nie udało się zapisać." }, { status: 500 });
  }
}
