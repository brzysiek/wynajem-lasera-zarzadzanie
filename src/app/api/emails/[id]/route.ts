import { NextRequest, NextResponse } from "next/server";
import { requireStaffSession } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { getMessageFull } from "@/lib/integrations/gmail-read";
import { headerMap, htmlToText } from "@/lib/gmail/parse";
import { logError } from "@/lib/logger";

// Pełna treść e-maila — pobierana z Gmaila W TEJ CHWILI, nigdy nie
// zapisywana ani logowana (prompt 3, 4.4–4.5). Tylko tekst (HTML
// przerobiony na tekst: bez skryptów, obrazów, iframe'ów) + lista
// załączników. ADMIN/STAFF; KIEROWCA — 403.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireStaffSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const { id } = await params;
  const row = await prisma.emailMessage.findUnique({ where: { id }, select: { mailbox: true, gmailMessageId: true, direction: true, sentAt: true } });
  if (!row) return NextResponse.json({ message: "Wiadomość nie istnieje." }, { status: 404 });
  try {
    const full = await getMessageFull(row.mailbox, row.gmailMessageId);
    const h = headerMap(full.headers);
    return NextResponse.json({
      subject: h["subject"] ?? "(bez tematu)",
      from: h["from"] ?? "",
      to: h["to"] ?? "",
      cc: h["cc"] ?? null,
      sentAt: row.sentAt.toISOString(),
      direction: row.direction,
      mailbox: row.mailbox,
      text: (full.text ?? (full.html ? htmlToText(full.html) : "")).slice(0, 100_000),
      attachments: full.attachments,
      gmailUrl: `https://mail.google.com/mail/u/?authuser=${encodeURIComponent(row.mailbox)}#all/${row.gmailMessageId}`,
    });
  } catch (err) {
    // W logu tylko id wiadomości, bez treści.
    logError("email_fetch_failed", err, { emailId: id });
    return NextResponse.json({ message: "Nie udało się pobrać wiadomości z Gmaila." }, { status: 502 });
  }
}
