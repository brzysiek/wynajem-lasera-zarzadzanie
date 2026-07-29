import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { updateQueuedReminderBody } from "@/lib/reminders";
import { logInfo, logWarn } from "@/lib/logger";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  }

  const { id } = await params;
  const payload = await req.json().catch(() => null);
  const messageBody = typeof payload?.messageBody === "string" ? payload.messageBody.trim() : "";
  if (!messageBody) {
    return NextResponse.json({ message: "Treść wiadomości nie może być pusta." }, { status: 400 });
  }

  const updated = await updateQueuedReminderBody(id, messageBody);
  if (!updated) {
    logWarn("reminder_queue_edit_rejected", { userId: session.user.id, reminderRuleId: id });
    return NextResponse.json({ message: "Nie można edytować tego powiadomienia." }, { status: 400 });
  }

  logInfo("reminder_queue_edited", { userId: session.user.id, reminderRuleId: id });
  return NextResponse.json({ ok: true });
}
