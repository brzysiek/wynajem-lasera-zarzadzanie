import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { AUTO_MAIL_ENABLED_KEY } from "@/lib/leads/auto-mail";
import { AUTO_MAIL_TEMPLATE_KEY } from "@/lib/leads/auto-mail-render";
import { logInfo } from "@/lib/logger";

// Podgląd (pobranie) i usunięcie załącznika maila z cennikiem.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const { id } = await params;
  const row = await prisma.emailTemplateAttachment.findUnique({ where: { id } });
  if (!row) return NextResponse.json({ message: "Nie ma takiego pliku." }, { status: 404 });
  return new NextResponse(new Uint8Array(row.data), {
    headers: {
      "Content-Type": row.mime,
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(row.filename)}`,
      "Cache-Control": "private, no-store",
    },
  });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const { id } = await params;
  const [enabled, count] = await Promise.all([
    prisma.setting.findUnique({ where: { key: AUTO_MAIL_ENABLED_KEY } }),
    prisma.emailTemplateAttachment.count({ where: { templateKey: AUTO_MAIL_TEMPLATE_KEY } }),
  ]);
  if (enabled?.value === "1" && count <= 1) {
    return NextResponse.json({ message: "Wysyłka jest włączona — nie można usunąć ostatniego załącznika. Najpierw dodaj nowy plik." }, { status: 400 });
  }
  const row = await prisma.emailTemplateAttachment.delete({ where: { id }, select: { filename: true } }).catch(() => null);
  if (!row) return NextResponse.json({ message: "Nie ma takiego pliku." }, { status: 404 });
  logInfo("auto_mail_attachment_removed", { userId: session.user.id, filename: row.filename });
  return NextResponse.json({ ok: true });
}
