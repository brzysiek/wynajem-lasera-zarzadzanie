import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth-guards";
import { addMailbox, getGmailStatus, removeMailbox, setGmailSyncEnabled } from "@/lib/gmail/sync";
import { logInfo } from "@/lib/logger";

// Ustawienia historii e-maili: wyłącznik i lista skrzynek. Tylko ADMIN.
// Dodanie skrzynki wymaga jawnego potwierdzenia (consent) — biuro zobaczy
// korespondencję tej osoby z klientami (prompt 3, 4.2).
export async function POST(req: NextRequest) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ message: "Nieprawidłowe dane." }, { status: 400 });

  if (typeof body.enabled === "boolean") {
    await setGmailSyncEnabled(body.enabled);
    logInfo("gmail_sync_toggled", { userId: session.user.id, enabled: body.enabled });
  }
  if (typeof body.addMailbox === "string") {
    if (body.consent !== true) return NextResponse.json({ message: "Potwierdź, że biuro może widzieć tę korespondencję." }, { status: 400 });
    const err = await addMailbox(body.addMailbox);
    if (err) return NextResponse.json({ message: err }, { status: 400 });
    logInfo("gmail_mailbox_added", { userId: session.user.id, mailbox: body.addMailbox });
  }
  if (typeof body.removeMailbox === "string") {
    const err = await removeMailbox(body.removeMailbox);
    if (err) return NextResponse.json({ message: err }, { status: 400 });
    logInfo("gmail_mailbox_removed", { userId: session.user.id, mailbox: body.removeMailbox });
  }
  return NextResponse.json(await getGmailStatus());
}
