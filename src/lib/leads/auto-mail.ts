import { prisma } from "@/lib/prisma";
import { sendGmailMessage } from "@/lib/integrations/gmail";
import { recordChanges } from "@/lib/changelog/record";
import { isPlaceholderEmail } from "@/lib/clients/placeholder";
import { logError, logInfo } from "@/lib/logger";
import {
  AUTO_MAIL_FROM,
  AUTO_MAIL_MAX_ATTEMPTS,
  AUTO_MAIL_TEMPLATE_KEY,
  DEFAULT_AUTO_MAIL,
  buildMimeMessage,
  renderAutoMail,
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
const DEFAULT_FROM_NAME = "wynajemlasera.pl";
const LOCK_MS = 3 * 60_000;
const RETRY_WINDOW_MS = 24 * 3_600_000;
const REPEAT_GUARD_MS = 10 * 60_000;

export type AutoMailConfig = {
  enabled: boolean;
  fromName: string;
  subject: string;
  body: string;
  attachments: { id: string; filename: string; mime: string; size: number }[];
};

export async function ensureAutoMailTemplate() {
  const row = await prisma.messageTemplate.findUnique({ where: { key: AUTO_MAIL_TEMPLATE_KEY } });
  if (row) return row;
  return prisma.messageTemplate.create({
    data: { key: AUTO_MAIL_TEMPLATE_KEY, label: "Mail z cennikiem (formularz WWW)", channel: "EMAIL", subject: DEFAULT_AUTO_MAIL.subject, body: DEFAULT_AUTO_MAIL.body },
  });
}

export async function loadAutoMailConfig(): Promise<AutoMailConfig> {
  const [tpl, settings, attachments] = await Promise.all([
    ensureAutoMailTemplate(),
    prisma.setting.findMany({ where: { key: { in: [AUTO_MAIL_ENABLED_KEY, AUTO_MAIL_FROM_NAME_KEY] } } }),
    prisma.emailTemplateAttachment.findMany({
      where: { templateKey: AUTO_MAIL_TEMPLATE_KEY },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: { id: true, filename: true, mime: true, size: true },
    }),
  ]);
  const get = (k: string) => settings.find((s) => s.key === k)?.value;
  return {
    enabled: get(AUTO_MAIL_ENABLED_KEY) === "1",
    fromName: get(AUTO_MAIL_FROM_NAME_KEY) || DEFAULT_FROM_NAME,
    subject: tpl.subject ?? DEFAULT_AUTO_MAIL.subject,
    body: tpl.body,
    attachments,
  };
}

// Webhook: kolejkuje mail (szybki zapis), wysyłka osobno — deliverAutoMail.
export async function queueWwwPriceMail(input: { leadId: string | null; email: string | null; name: string | null }): Promise<string | null> {
  if (!input.email || isPlaceholderEmail(input.email)) return null;
  const on = await prisma.setting.findUnique({ where: { key: AUTO_MAIL_ENABLED_KEY } });
  if (on?.value !== "1") return null;
  const since = new Date(Date.now() - REPEAT_GUARD_MS);
  const recent = await prisma.autoMail.count({ where: { kind: "www_cennik", toAddress: input.email, createdAt: { gte: since } } });
  if (recent) return null;
  const lead = input.leadId ? await prisma.lead.findUnique({ where: { id: input.leadId }, select: { clientId: true } }) : null;
  const row = await prisma.autoMail.create({
    data: { kind: "www_cennik", leadId: input.leadId, clientId: lead?.clientId ?? null, toAddress: input.email, name: input.name, status: "PENDING" },
  });
  return row.id;
}

// Próbna wysyłka z ustawień — od razu, bez sygnału; ślad w auto_mails.
export async function sendTestAutoMail(to: string, name: string | null): Promise<{ ok: boolean; error?: string }> {
  const row = await prisma.autoMail.create({ data: { kind: "www_cennik_test", toAddress: to, name, status: "PENDING", attempts: AUTO_MAIL_MAX_ATTEMPTS - 1 } });
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
    const files = await prisma.emailTemplateAttachment.findMany({
      where: { templateKey: AUTO_MAIL_TEMPLATE_KEY },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: { filename: true, mime: true, data: true },
    });
    if (!files.length) throw new Error("Brak załączników w szablonie (Ustawienia → Mail z cennikiem).");
    const mail = renderAutoMail({ subject: cfg.subject, body: cfg.body }, { name: row.name });
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
      const names = files.map((f) => f.filename).join(", ");
      await prisma.leadActivity.create({
        data: { leadId: row.leadId, clientId: row.clientId, type: "SYSTEM", body: `auto · wysłano mail z cennikiem na ${row.toAddress} („${mail.subject}”, załączniki: ${names})` },
      });
      await recordChanges(prisma, { userId: "" }, [
        { entity: "LEAD", entityId: row.leadId, operation: "AUTO_MAIL", clientId: row.clientId, field: "mail", after: `cennik → ${row.toAddress} (${names})` },
      ]);
    }
    logInfo("auto_mail_sent", { id, kind: row.kind, leadId: row.leadId });
    return { ok: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    const last = row.attempts >= AUTO_MAIL_MAX_ATTEMPTS;
    await prisma.autoMail.update({ where: { id }, data: { status: last ? "FAILED" : "PENDING", error, lockedAt: null } });
    if (last && row.leadId) {
      await prisma.leadActivity.create({
        data: { leadId: row.leadId, clientId: row.clientId, type: "SYSTEM", body: `auto · NIE wysłano maila z cennikiem na ${row.toAddress} (${error}) — wyślij cennik ręcznie` },
      });
    }
    logError("auto_mail_failed", err, { id, attempt: row.attempts, final: last });
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
