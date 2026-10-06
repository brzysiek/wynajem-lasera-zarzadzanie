import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { AUTO_MAIL_ENABLED_KEY, AUTO_MAIL_FROM_NAME_KEY, FOOTER_TEMPLATE_KEY, REZ_MAIL_ENABLED_KEY, REZ_MAIL_TEMPLATE_KEY, ensureAutoMailTemplates, loadAutoMailConfig, recentAutoMails } from "@/lib/leads/auto-mail";
import { AUTO_MAIL_TEMPLATE_KEY } from "@/lib/leads/auto-mail-render";
import { ALERT_EMAIL_KEY } from "@/lib/alerts";
import { validAlertEmail } from "@/lib/ops/health-rules";
import { logInfo } from "@/lib/logger";

// Maile automatyczne po formularzu WWW (04–05.10.2026): cennik i
// potwierdzenie rezerwacji — treść, nadawca, wspólna stopka, przełączniki
// i ostatnie wysyłki. Tylko ADMIN.
export async function GET() {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const [config, recent] = await Promise.all([loadAutoMailConfig(), recentAutoMails()]);
  return NextResponse.json({ config, recent });
}

export async function PUT(req: NextRequest) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const b = (await req.json().catch(() => null)) as {
    subject?: unknown;
    body?: unknown;
    fromName?: unknown;
    enabled?: unknown;
    rezSubject?: unknown;
    rezBody?: unknown;
    rezEnabled?: unknown;
    footer?: unknown;
    alertEmail?: unknown;
  } | null;
  if (!b) return NextResponse.json({ message: "Brak danych." }, { status: 400 });
  const cfg = await loadAutoMailConfig();
  const subject = typeof b.subject === "string" ? b.subject.trim() : cfg.subject;
  const body = typeof b.body === "string" ? b.body.trim() : cfg.body;
  const fromName = typeof b.fromName === "string" ? b.fromName.trim().slice(0, 120) : cfg.fromName;
  const enabled = typeof b.enabled === "boolean" ? b.enabled : cfg.enabled;
  const rezSubject = typeof b.rezSubject === "string" ? b.rezSubject.trim() : cfg.rez.subject;
  const rezBody = typeof b.rezBody === "string" ? b.rezBody.trim() : cfg.rez.body;
  const rezEnabled = typeof b.rezEnabled === "boolean" ? b.rezEnabled : cfg.rez.enabled;
  const footer = typeof b.footer === "string" ? b.footer.trim() : cfg.footer;
  const alertEmail = typeof b.alertEmail === "string" ? b.alertEmail.trim().toLowerCase() : cfg.alertEmail;
  if (alertEmail && !validAlertEmail(alertEmail)) return NextResponse.json({ message: "Adres alarmów jest niepoprawny." }, { status: 400 });
  if (!subject || !body || !rezSubject || !rezBody) return NextResponse.json({ message: "Temat i treść nie mogą być puste." }, { status: 400 });
  if (enabled && !cfg.attachments.length) return NextResponse.json({ message: "Najpierw dodaj załączniki (cennik i katalog)." }, { status: 400 });

  await ensureAutoMailTemplates();
  const flag = (key: string, on: boolean) => prisma.setting.upsert({ where: { key }, create: { key, value: on ? "1" : "0" }, update: { value: on ? "1" : "0" } });
  await prisma.$transaction([
    prisma.messageTemplate.update({ where: { key: AUTO_MAIL_TEMPLATE_KEY }, data: { subject, body } }),
    prisma.messageTemplate.update({ where: { key: REZ_MAIL_TEMPLATE_KEY }, data: { subject: rezSubject, body: rezBody } }),
    prisma.messageTemplate.update({ where: { key: FOOTER_TEMPLATE_KEY }, data: { body: footer } }),
    prisma.setting.upsert({ where: { key: AUTO_MAIL_FROM_NAME_KEY }, create: { key: AUTO_MAIL_FROM_NAME_KEY, value: fromName }, update: { value: fromName } }),
    flag(AUTO_MAIL_ENABLED_KEY, enabled),
    flag(REZ_MAIL_ENABLED_KEY, rezEnabled),
    prisma.setting.upsert({ where: { key: ALERT_EMAIL_KEY }, create: { key: ALERT_EMAIL_KEY, value: alertEmail }, update: { value: alertEmail } }),
  ]);
  if (enabled !== cfg.enabled) logInfo("auto_mail_toggled", { userId: session.user.id, enabled });
  if (rezEnabled !== cfg.rez.enabled) logInfo("auto_mail_rez_toggled", { userId: session.user.id, enabled: rezEnabled });
  return NextResponse.json({ config: await loadAutoMailConfig() });
}
