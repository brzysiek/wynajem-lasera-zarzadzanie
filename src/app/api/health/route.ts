import { NextResponse, after } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAccessToken } from "@/lib/integrations/google-calendar";
import { GMAIL_COMPOSE_SCOPE } from "@/lib/integrations/gmail";
import { GMAIL_READ_SCOPE } from "@/lib/integrations/gmail-read";
import { gmailSummary } from "@/lib/gmail/sync";
import { AUTO_MAIL_FROM } from "@/lib/leads/auto-mail-render";
import { evaluateHealth } from "@/lib/ops/health-rules";
import { sendAlert } from "@/lib/alerts";

// Punkt kontrolny dla monitora z zewnątrz (06.10.2026): baza, dostęp do
// Gmail API (wysyłka i odczyt z kontakt@) i żywotność crona (ostatnia
// synchronizacja Gmaila). 200 + "ok":true albo 503. Publiczny, ale bez
// szczegółów — tylko znaczniki ok / nie ok. Dostęp do Gmaila sprawdzany co
// najwyżej raz na 10 min (pamięć procesu), żeby nie męczyć Google.
const GMAIL_TTL_MS = 10 * 60_000;
let gmailCache: { at: number; send: boolean; read: boolean } | null = null;

async function gmailAccess(): Promise<{ send: boolean; read: boolean }> {
  if (gmailCache && Date.now() - gmailCache.at < GMAIL_TTL_MS) return gmailCache;
  const ok = (scope: string) =>
    getAccessToken(scope, AUTO_MAIL_FROM).then(
      () => true,
      () => false,
    );
  const [send, read] = await Promise.all([ok(GMAIL_COMPOSE_SCOPE), ok(GMAIL_READ_SCOPE)]);
  gmailCache = { at: Date.now(), send, read };
  return gmailCache;
}

export async function GET() {
  const dbOk = await Promise.race([
    prisma.$queryRaw`SELECT 1`.then(
      () => true,
      () => false,
    ),
    new Promise<boolean>((r) => setTimeout(() => r(false), 4000)),
  ]);
  // Bez bazy nie sprawdzamy reszty (zależą od niej); odpowiedź i tak 503.
  const [gmail, sync] = dbOk
    ? await Promise.all([gmailAccess(), gmailSummary().catch(() => null)])
    : [{ send: false, read: false }, null];
  const r = evaluateHealth({
    db: dbOk,
    gmailSend: gmail.send,
    gmailRead: gmail.read,
    syncEnabled: sync?.enabled ?? true,
    lastSyncAt: sync?.lastSyncAt ?? null,
    now: new Date(),
  });
  // Panel żyje, a coś z wnętrza nie działa: alarm mailem (SMTP), raz na 6 h.
  if (dbOk && !r.gmail) {
    after(() =>
      sendAlert({
        key: "gmail_access",
        throttleMin: 360,
        subject: "Dostęp do Gmail API nie działa",
        text: "Panel nie może uzyskać dostępu do Gmail API dla kontakt@ (wysyłka maili z cennikiem i potwierdzeniami oraz odczyt poczty).\nSprawdź konto serwisowe i delegację domenową w Google Admin (zakresy gmail.compose i gmail.readonly) oraz klucz w .env serwera.\nMaile automatyczne czekają w kolejce i wyjdą po przywróceniu dostępu (ponowienia przez 24 h).",
      }).then(() => undefined),
    );
  }
  if (dbOk && !r.cron) {
    after(() =>
      sendAlert({
        key: "cron_stalled",
        throttleMin: 360,
        subject: "Cron panelu nie chodzi",
        text: "Ostatnia synchronizacja Gmaila (cron co 5 min) jest starsza niż 15 minut.\nTo ten sam cron ponawia nieudane maile automatyczne — dopóki nie wróci, ponowienia nie działają. Sprawdź zadania cron w panelu hostingu cyber_Folks.",
      }).then(() => undefined),
    );
  }
  return NextResponse.json(r, { status: r.ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
