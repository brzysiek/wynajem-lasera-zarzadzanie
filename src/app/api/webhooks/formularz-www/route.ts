import { NextRequest, NextResponse, after } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { parseWebhookBody, parseWwwForm, tokenMatches } from "@/lib/leads/www-form";
import { intakeWwwForm } from "@/lib/leads/www-intake";
import { deliverAutoMail, queueWwwPriceMail, queueWwwReservationMail } from "@/lib/leads/auto-mail";
import { reservationSummary } from "@/lib/leads/auto-mail-render";
import { logError, logInfo, logWarn } from "@/lib/logger";

// Formularze Contact Form 7 z wynajemlasera.pl → sygnał w panelu (03.10.2026),
// zamiast n8n → HubSpot. Wtyczka „CF7 to Webhook”: POST, JSON albo
// x-www-form-urlencoded. Token WWW_WEBHOOK_TOKEN w ?token= (wtyczka może nie
// umieć nagłówków) albo w nagłówku x-webhook-token / Authorization: Bearer.
// Każde żądanie trafia do webhook_logs (payload i wynik). Błąd zapisu → 500
// (wtyczka wysyła wtedy mail o błędzie).
const KIND = "formularz-www";

// receivedAt / tookMs (5.10.2026): moment przyjęcia i czas obsługi do
// odpowiedzi — pomiar, czy formularz czeka na panel.
async function log(result: string, data: { payload?: Prisma.InputJsonValue | null; leadId?: string | null; message?: string | null; receivedAt?: Date; tookMs?: number }) {
  await prisma.webhookLog
    .create({
      data: { kind: KIND, result, leadId: data.leadId ?? null, message: data.message ?? null, payload: data.payload ?? undefined, receivedAt: data.receivedAt ?? null, tookMs: data.tookMs ?? null },
    })
    .catch((err) => logError("www_webhook_log_failed", err));
}

export async function POST(req: NextRequest) {
  const receivedAt = new Date();
  const took = () => Date.now() - receivedAt.getTime();
  const auth = req.headers.get("authorization");
  const provided = req.nextUrl.searchParams.get("token") ?? req.headers.get("x-webhook-token") ?? (auth?.startsWith("Bearer ") ? auth.slice(7) : null);
  if (!tokenMatches(provided, process.env.WWW_WEBHOOK_TOKEN)) {
    logWarn("www_webhook_unauthorized", { hasToken: Boolean(provided) });
    await log("UNAUTHORIZED", { receivedAt, tookMs: took() });
    return NextResponse.json({ message: "Brak uprawnień." }, { status: 401 });
  }

  const raw = await req.text().catch(() => "");
  const body = parseWebhookBody(req.headers.get("content-type"), raw);
  const payload = body as Prisma.InputJsonValue;
  try {
    const form = parseWwwForm(body);
    const res = await intakeWwwForm(form);
    await log(res.result, { payload, leadId: res.leadId ?? null, receivedAt, tookMs: took() });
    // Cennik do klienta (04.10.2026): po odpowiedzi stronie — formularz nie
    // czeka na Gmaila. Błąd wysyłki nie psuje zgłoszenia (ponowi cron).
    // Cennik i potwierdzenie rezerwacji: wysyłka po odpowiedzi stronie
    // (after()); duplikat w 10 min nie dostaje drugiego maila (queue…).
    if (res.result === "CREATED" && (form.type === "POBRANIE_CENNIKA" || form.type === "REZERWACJA_WWW")) {
      try {
        // Wpis o mailu na żywym sygnale (przy ponownym zapytaniu to ten, do którego dopisano zgłoszenie).
        const base = { leadId: res.mergedInto ?? res.leadId ?? null, email: form.email, name: form.name };
        const mailId =
          form.type === "POBRANIE_CENNIKA" ? await queueWwwPriceMail(base) : await queueWwwReservationMail({ ...base, summary: reservationSummary(form) });
        if (mailId) after(() => deliverAutoMail(mailId).then(() => undefined));
      } catch (err) {
        logError("auto_mail_queue_failed", err);
      }
    }
    logInfo("www_webhook_ok", { result: res.result, leadId: res.leadId ?? null, type: form.type });
    return NextResponse.json({ ok: true, result: res.result, leadId: res.leadId ?? null });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logError("www_webhook_failed", err);
    await log("ERROR", { payload, message, receivedAt, tookMs: took() });
    return NextResponse.json({ message: "Nie udało się zapisać zgłoszenia." }, { status: 500 });
  }
}
