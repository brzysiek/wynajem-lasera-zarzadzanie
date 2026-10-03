import { NextRequest, NextResponse, after } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { parseWebhookBody, parseWwwForm, tokenMatches } from "@/lib/leads/www-form";
import { intakeWwwForm } from "@/lib/leads/www-intake";
import { deliverAutoMail, queueWwwPriceMail } from "@/lib/leads/auto-mail";
import { logError, logInfo, logWarn } from "@/lib/logger";

// Formularze Contact Form 7 z wynajemlasera.pl → sygnał w panelu (03.10.2026),
// zamiast n8n → HubSpot. Wtyczka „CF7 to Webhook”: POST, JSON albo
// x-www-form-urlencoded. Token WWW_WEBHOOK_TOKEN w ?token= (wtyczka może nie
// umieć nagłówków) albo w nagłówku x-webhook-token / Authorization: Bearer.
// Każde żądanie trafia do webhook_logs (payload i wynik). Błąd zapisu → 500
// (wtyczka wysyła wtedy mail o błędzie).
const KIND = "formularz-www";

async function log(result: string, data: { payload?: Prisma.InputJsonValue | null; leadId?: string | null; message?: string | null }) {
  await prisma.webhookLog
    .create({ data: { kind: KIND, result, leadId: data.leadId ?? null, message: data.message ?? null, payload: data.payload ?? undefined } })
    .catch((err) => logError("www_webhook_log_failed", err));
}

export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization");
  const provided = req.nextUrl.searchParams.get("token") ?? req.headers.get("x-webhook-token") ?? (auth?.startsWith("Bearer ") ? auth.slice(7) : null);
  if (!tokenMatches(provided, process.env.WWW_WEBHOOK_TOKEN)) {
    logWarn("www_webhook_unauthorized", { hasToken: Boolean(provided) });
    await log("UNAUTHORIZED", {});
    return NextResponse.json({ message: "Brak uprawnień." }, { status: 401 });
  }

  const raw = await req.text().catch(() => "");
  const body = parseWebhookBody(req.headers.get("content-type"), raw);
  const payload = body as Prisma.InputJsonValue;
  try {
    const form = parseWwwForm(body);
    const res = await intakeWwwForm(form);
    await log(res.result, { payload, leadId: res.leadId ?? null });
    // Cennik do klienta (04.10.2026): po odpowiedzi stronie — formularz nie
    // czeka na Gmaila. Błąd wysyłki nie psuje zgłoszenia (ponowi cron).
    if (res.result === "CREATED" && form.type === "POBRANIE_CENNIKA") {
      try {
        const mailId = await queueWwwPriceMail({ leadId: res.leadId ?? null, email: form.email, name: form.name });
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
    await log("ERROR", { payload, message });
    return NextResponse.json({ message: "Nie udało się zapisać zgłoszenia." }, { status: 500 });
  }
}
