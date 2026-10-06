import { prisma } from "@/lib/prisma";
import { sendGmailMessage } from "@/lib/integrations/gmail";
import { recordChanges } from "@/lib/changelog/record";
import { isPlaceholderEmail } from "@/lib/clients/placeholder";
import { logError, logInfo, logWarn } from "@/lib/logger";
import { ALERT_EMAIL_KEY, getAlertEmail, sendAlert } from "@/lib/alerts";
import { isGmailAccessError } from "@/lib/ops/health-rules";
import {
  AUTO_MAIL_FROM,
  AUTO_MAIL_MAX_ATTEMPTS,
  AUTO_MAIL_TEMPLATE_KEY,
  DEFAULT_AUTO_MAIL,
  DEFAULT_RESERVATION_MAIL,
  buildMimeMessage,
  renderAutoMail,
  type SummaryRow,
} from "@/lib/leads/auto-mail-render";

// Mail automatyczny z cennikiem po formularzu „cennik” na stronie (04.10.2026).
// Wyjątek od zasady „panel niczego nie wysyła sam” — decyzja Tomka: mail ma
// iść od razu, bez zatwierdzania. Wysyłka z kontakt@ przez Gmail API (konto
// serwisowe, zakres gmail.compose). Webhook zapisuje sygnał, odpowiada stronie
// i dopiero potem (after()) wysyła — formularz nie czeka na Gmaila. Nieudane
// próby ponawia cron Gmaila (co 5 min) do AUTO_MAIL_MAX_ATTEMPTS razy w 24 h.
// Przełącznik www_autoreply_enabled — domyślnie WYŁĄCZONY (włącza się po
// wyłączeniu autorespondera w WordPressie, żeby klient nie dostał dwóch maili).

export const AUTO_MAIL_ENABLED_KEY = "www_autoreply_enabled";
export const AUTO_MAIL_FROM_NAME_KEY = "www_autoreply_from_name";
// Mail potwierdzający rezerwację (5.10.2026) — ten sam mechanizm co cennik,
// bez załączników; przełącznik osobny, domyślnie WYŁĄCZONY (najpierw
// wyłączamy Mail 2 w WordPressie — formularze 5795 i 327, potem włączamy).
export const REZ_MAIL_ENABLED_KEY = "www_rez_autoreply_enabled";
export const REZ_MAIL_TEMPLATE_KEY = "www_rezerwacja_auto";
// Wspólna stopka (podpis Ani) doklejana do obu maili automatycznych.
export const FOOTER_TEMPLATE_KEY = "www_stopka_auto";
const DEFAULT_FROM_NAME = "wynajemlasera.pl";
const LOCK_MS = 3 * 60_000;
const RETRY_WINDOW_MS = 24 * 3_600_000;
// Identyczne zgłoszenia w 10 min odrzuca już webhook (www-intake: ta sama
// treść = duplikat), więc tu zostaje tylko limit przed zasypaniem adresu
// mailami przy zgłoszeniach z różną treścią (wniosek 39).
const MAIL_CAP_PER_HOUR = 3;
const MAIL_CAP_WINDOW_MS = 3_600_000;

export type AutoMailConfig = {
  enabled: boolean;
  fromName: string;
  subject: string;
  body: string;
  attachments: { id: string; filename: string; mime: string; size: number }[];
  rez: { enabled: boolean; subject: string; body: string };
  footer: string;
  // Adres alarmów (Setting alert_email) — pusty = alarmy nie są wysyłane.
  alertEmail: string;
};

const TEMPLATE_DEFAULTS = [
  { key: AUTO_MAIL_TEMPLATE_KEY, label: "Mail z cennikiem (formularz WWW)", subject: DEFAULT_AUTO_MAIL.subject, body: DEFAULT_AUTO_MAIL.body },
  { key: REZ_MAIL_TEMPLATE_KEY, label: "Mail potwierdzający rezerwację (formularz WWW)", subject: DEFAULT_RESERVATION_MAIL.subject, body: DEFAULT_RESERVATION_MAIL.body },
  { key: FOOTER_TEMPLATE_KEY, label: "Stopka maili automatycznych (podpis)", subject: null, body: "" },
];

export async function ensureAutoMailTemplates() {
  const rows = await prisma.messageTemplate.findMany({ where: { key: { in: TEMPLATE_DEFAULTS.map((t) => t.key) } } });
  for (const t of TEMPLATE_DEFAULTS) {
    if (!rows.some((r) => r.key === t.key)) {
      rows.push(await prisma.messageTemplate.create({ data: { key: t.key, label: t.label, channel: "EMAIL", subject: t.subject, body: t.body } }));
    }
  }
  return rows;
}

export async function loadAutoMailConfig(): Promise<AutoMailConfig> {
  const [tpls, settings, attachments] = await Promise.all([
    ensureAutoMailTemplates(),
    prisma.setting.findMany({ where: { key: { in: [AUTO_MAIL_ENABLED_KEY, AUTO_MAIL_FROM_NAME_KEY, REZ_MAIL_ENABLED_KEY] } } }),
    prisma.emailTemplateAttachment.findMany({
      where: { templateKey: AUTO_MAIL_TEMPLATE_KEY },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: { id: true, filename: true, mime: true, size: true },
    }),
  ]);
  const get = (k: string) => settings.find((s) => s.key === k)?.value;
  const tpl = (k: string) => tpls.find((t) => t.key === k);
  return {
    enabled: get(AUTO_MAIL_ENABLED_KEY) === "1",
    fromName: get(AUTO_MAIL_FROM_NAME_KEY) || DEFAULT_FROM_NAME,
    subject: tpl(AUTO_MAIL_TEMPLATE_KEY)?.subject ?? DEFAULT_AUTO_MAIL.subject,
    body: tpl(AUTO_MAIL_TEMPLATE_KEY)?.body ?? DEFAULT_AUTO_MAIL.body,
    attachments,
    rez: {
      enabled: get(REZ_MAIL_ENABLED_KEY) === "1",
      subject: tpl(REZ_MAIL_TEMPLATE_KEY)?.subject ?? DEFAULT_RESERVATION_MAIL.subject,
      body: tpl(REZ_MAIL_TEMPLATE_KEY)?.body ?? DEFAULT_RESERVATION_MAIL.body,
    },
    footer: tpl(FOOTER_TEMPLATE_KEY)?.body ?? "",
    alertEmail: (await prisma.setting.findUnique({ where: { key: ALERT_EMAIL_KEY } }))?.value ?? "",
  };
}

// Próbny alarm z ustawień — od razu, bez limitu; sprawdza adres i SMTP.
export async function sendTestAlert(): Promise<{ ok: boolean; error?: string }> {
  const to = await getAlertEmail();
  if (!to) return { ok: false, error: "Adres alarmów nie jest ustawiony." };
  const ok = await sendAlert({ key: "test_alarm", throttleMin: 0, subject: "Próbny alarm", text: "To jest próbny alarm z panelu — adres i wysyłka SMTP działają." });
  return ok ? { ok: true } : { ok: false, error: "Nie udało się wysłać (sprawdź SMTP na serwerze)." };
}

// Webhook: kolejkuje mail (szybki zapis), wysyłka osobno — deliverAutoMail.
async function queueAutoMail(
  kind: "www_cennik" | "www_rezerwacja",
  enabledKey: string,
  input: { leadId: string | null; email: string | null; name: string | null; summary?: SummaryRow[] },
): Promise<string | null> {
  if (!input.email || isPlaceholderEmail(input.email)) return null;
  const on = await prisma.setting.findUnique({ where: { key: enabledKey } });
  if (on?.value !== "1") return null;
  const since = new Date(Date.now() - MAIL_CAP_WINDOW_MS);
  const recent = await prisma.autoMail.count({ where: { kind, toAddress: input.email, createdAt: { gte: since } } });
  if (recent >= MAIL_CAP_PER_HOUR) {
    logWarn("auto_mail_cap_reached", { kind, toAddress: input.email, recent });
    return null;
  }
  const lead = input.leadId ? await prisma.lead.findUnique({ where: { id: input.leadId }, select: { clientId: true } }) : null;
  const row = await prisma.autoMail.create({
    data: {
      kind,
      leadId: input.leadId,
      clientId: lead?.clientId ?? null,
      toAddress: input.email,
      name: input.name,
      status: "PENDING",
      ...(input.summary ? { payload: { summary: input.summary } } : {}),
    },
  });
  return row.id;
}

export const queueWwwPriceMail = (input: { leadId: string | null; email: string | null; name: string | null }) => queueAutoMail("www_cennik", AUTO_MAIL_ENABLED_KEY, input);
export const queueWwwReservationMail = (input: { leadId: string | null; email: string | null; name: string | null; summary: SummaryRow[] }) =>
  queueAutoMail("www_rezerwacja", REZ_MAIL_ENABLED_KEY, input);

const SAMPLE_SUMMARY: SummaryRow[] = [
  { label: "Urządzenie", value: "LightSheer Desire" },
  { label: "Termin od", value: "2026-11-02" },
  { label: "Liczba dni", value: "2 dni" },
  { label: "Miejscowość gabinetu", value: "Kraków" },
];

// Próbna wysyłka z ustawień — od razu, bez sygnału; ślad w auto_mails.
export async function sendTestAutoMail(to: string, name: string | null, kind: "cennik" | "rezerwacja" = "cennik"): Promise<{ ok: boolean; error?: string }> {
  const row = await prisma.autoMail.create({
    data: {
      kind: kind === "rezerwacja" ? "www_rezerwacja_test" : "www_cennik_test",
      toAddress: to,
      name,
      status: "PENDING",
      attempts: AUTO_MAIL_MAX_ATTEMPTS - 1,
      ...(kind === "rezerwacja" ? { payload: { summary: SAMPLE_SUMMARY } } : {}),
    },
  });
  return deliverAutoMail(row.id);
}

export async function deliverAutoMail(id: string): Promise<{ ok: boolean; error?: string }> {
  const now = new Date();
  // Rezerwacja wiersza — after() z webhooka i cron nie wyślą tego samego dwa razy.
  const claimed = await prisma.autoMail.updateMany({
    where: { id, status: "PENDING", OR: [{ lockedAt: null }, { lockedAt: { lt: new Date(now.getTime() - LOCK_MS) } }] },
    data: { lockedAt: now, attempts: { increment: 1 } },
  });
  if (!claimed.count) return { ok: false, error: "Wysyłka już trwa albo zakończona." };
  const row = await prisma.autoMail.findUniqueOrThrow({ where: { id } });

  try {
    const cfg = await loadAutoMailConfig();
    const rez = row.kind.startsWith("www_rezerwacja");
    // Potwierdzenie rezerwacji idzie bez załączników; cennik musi je mieć.
    const files = rez
      ? []
      : await prisma.emailTemplateAttachment.findMany({
          where: { templateKey: AUTO_MAIL_TEMPLATE_KEY },
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          select: { filename: true, mime: true, data: true },
        });
    if (!rez && !files.length) throw new Error("Brak załączników w szablonie (Ustawienia → Maile automatyczne).");
    const payload = row.payload as { summary?: SummaryRow[] } | null;
    const mail = renderAutoMail(rez ? cfg.rez : { subject: cfg.subject, body: cfg.body }, { name: row.name, summary: payload?.summary ?? [], footer: cfg.footer });
    const raw = buildMimeMessage({
      from: AUTO_MAIL_FROM,
      fromName: cfg.fromName,
      to: row.toAddress,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
      attachments: files.map((f) => ({ filename: f.filename, mime: f.mime, data: Buffer.from(f.data) })),
    });
    const sent = await sendGmailMessage(AUTO_MAIL_FROM, raw);
    await prisma.autoMail.update({
      where: { id },
      data: { status: "SENT", sentAt: new Date(), gmailMessageId: sent.id, subject: mail.subject, error: null, lockedAt: null },
    });
    if (row.leadId) {
      const what = rez ? "potwierdzeniem rezerwacji" : "cennikiem";
      const names = files.map((f) => f.filename).join(", ");
      await prisma.leadActivity.create({
        data: {
          leadId: row.leadId,
          clientId: row.clientId,
          type: "SYSTEM",
          body: `auto · wysłano mail z ${what} na ${row.toAddress} („${mail.subject}”${names ? `, załączniki: ${names}` : ""})`,
        },
      });
      await recordChanges(prisma, { userId: "" }, [
        { entity: "LEAD", entityId: row.leadId, operation: "AUTO_MAIL", clientId: row.clientId, field: "mail", after: `${rez ? "potwierdzenie rezerwacji" : "cennik"} → ${row.toAddress}${names ? ` (${names})` : ""}` },
      ]);
    }
    logInfo("auto_mail_sent", { id, kind: row.kind, leadId: row.leadId });
    return { ok: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    const last = row.attempts >= AUTO_MAIL_MAX_ATTEMPTS;
    await prisma.autoMail.update({ where: { id }, data: { status: last ? "FAILED" : "PENDING", error, lockedAt: null } });
    if (last && row.leadId) {
      const what = row.kind.startsWith("www_rezerwacja") ? "potwierdzeniem rezerwacji" : "cennikiem";
      await prisma.leadActivity.create({
        data: { leadId: row.leadId, clientId: row.clientId, type: "SYSTEM", body: `auto · NIE wysłano maila z ${what} na ${row.toAddress} (${error}) — odezwij się ręcznie` },
      });
    }
    logError("auto_mail_failed", err, { id, attempt: row.attempts, final: last });
    // Alarm (06.10.2026): druga nieudana próba z rzędu albo ostateczna porażka.
    // Mail próbny z ustawień nie alarmuje (wynik widać od razu na ekranie).
    if (!row.kind.endsWith("_test") && row.attempts >= 2) {
      const access = isGmailAccessError(error);
      const what = row.kind.startsWith("www_rezerwacja") ? "potwierdzenie rezerwacji" : "mail z cennikiem";
      await sendAlert({
        key: last ? `automail_final:${id}` : access ? "gmail_access" : "automail_fail",
        throttleMin: last ? 0 : access ? 360 : 60,
        subject: last ? `Nie wysłano maila do klienta (${what}) — wyślij ręcznie` : access ? "Dostęp do Gmail API przestał działać" : `Mail do klienta (${what}) nie wychodzi`,
        text:
          `${last ? "Po 5 próbach" : `Próba ${row.attempts} z 5`} nie udało się wysłać: ${what}${row.leadId ? ` (sygnał ${row.leadId})` : ""}.\nBłąd: ${error.slice(0, 300)}\n` +
          (access
            ? "To wygląda na utratę dostępu do Gmail API (klucz konta serwisowego, delegacja w Google Admin, zakres) — ponowienia nie pomogą, dopóki dostęp nie wróci.\n"
            : "Panel ponawia wysyłkę co 5 minut (do 5 razy w ciągu doby).\n") +
          (last ? "Klient NIE dostał maila — odezwij się do niego ręcznie (sygnał ma o tym wpis w historii).\n" : "") +
          "Podgląd: Ustawienia → Maile automatyczne → Ostatnie wysyłki.",
      });
    }
    return { ok: false, error };
  }
}

// Cron Gmaila (co 5 min): ponowienia nieudanych wysyłek z ostatnich 24 h.
export async function retryAutoMails(now = new Date()): Promise<{ sent: number; failed: number }> {
  await prisma.autoMail.updateMany({
    where: { status: "PENDING", createdAt: { lt: new Date(now.getTime() - RETRY_WINDOW_MS) } },
    data: { status: "FAILED", error: "Nie wysłano w ciągu 24 h." },
  });
  const rows = await prisma.autoMail.findMany({
    where: {
      status: "PENDING",
      createdAt: { gte: new Date(now.getTime() - RETRY_WINDOW_MS), lte: new Date(now.getTime() - 60_000) },
      OR: [{ lockedAt: null }, { lockedAt: { lt: new Date(now.getTime() - LOCK_MS) } }],
    },
    orderBy: { createdAt: "asc" },
    take: 10,
    select: { id: true },
  });
  let sent = 0;
  let failed = 0;
  for (const r of rows) {
    const res = await deliverAutoMail(r.id);
    if (res.ok) sent++;
    else failed++;
  }
  return { sent, failed };
}

// Identyfikatory Gmaila maili wysłanych automatem — raport i automaty lejka
// nie liczą ich jako kontaktu biura.
export async function autoMailGmailIds(ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const rows = await prisma.autoMail.findMany({ where: { gmailMessageId: { in: ids } }, select: { gmailMessageId: true } });
  return new Set(rows.map((r) => r.gmailMessageId!).filter(Boolean));
}

export async function recentAutoMails(take = 20) {
  return prisma.autoMail.findMany({
    orderBy: { createdAt: "desc" },
    take,
    select: { id: true, kind: true, leadId: true, toAddress: true, status: true, attempts: true, error: true, createdAt: true, sentAt: true },
  });
}
