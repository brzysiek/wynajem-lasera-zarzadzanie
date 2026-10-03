import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { AUTO_MAIL_ENABLED_KEY, AUTO_MAIL_FROM_NAME_KEY, ensureAutoMailTemplate, loadAutoMailConfig, recentAutoMails } from "@/lib/leads/auto-mail";
import { AUTO_MAIL_TEMPLATE_KEY } from "@/lib/leads/auto-mail-render";
import { logInfo } from "@/lib/logger";

// Mail z cennikiem po formularzu WWW (04.10.2026): treść, nadawca, przełącznik
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
  const b = (await req.json().catch(() => null)) as { subject?: unknown; body?: unknown; fromName?: unknown; enabled?: unknown } | null;
  if (!b) return NextResponse.json({ message: "Brak danych." }, { status: 400 });
  const cfg = await loadAutoMailConfig();
  const subject = typeof b.subject === "string" ? b.subject.trim() : cfg.subject;
  const body = typeof b.body === "string" ? b.body.trim() : cfg.body;
  const fromName = typeof b.fromName === "string" ? b.fromName.trim().slice(0, 120) : cfg.fromName;
  const enabled = typeof b.enabled === "boolean" ? b.enabled : cfg.enabled;
  if (!subject || !body) return NextResponse.json({ message: "Temat i treść nie mogą być puste." }, { status: 400 });
  if (enabled && !cfg.attachments.length) return NextResponse.json({ message: "Najpierw dodaj załączniki (cennik i katalog)." }, { status: 400 });

  await ensureAutoMailTemplate();
  await prisma.$transaction([
    prisma.messageTemplate.update({ where: { key: AUTO_MAIL_TEMPLATE_KEY }, data: { subject, body } }),
    prisma.setting.upsert({ where: { key: AUTO_MAIL_FROM_NAME_KEY }, create: { key: AUTO_MAIL_FROM_NAME_KEY, value: fromName }, update: { value: fromName } }),
    prisma.setting.upsert({ where: { key: AUTO_MAIL_ENABLED_KEY }, create: { key: AUTO_MAIL_ENABLED_KEY, value: enabled ? "1" : "0" }, update: { value: enabled ? "1" : "0" } }),
  ]);
  if (enabled !== cfg.enabled) logInfo("auto_mail_toggled", { userId: session.user.id, enabled });
  return NextResponse.json({ config: await loadAutoMailConfig() });
}
