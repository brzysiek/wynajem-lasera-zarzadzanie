import { NextRequest, NextResponse } from "next/server";
import { requireStaffSession } from "@/lib/auth-guards";
import { cancelQueuedReminder } from "@/lib/reminders";
import { logInfo, logWarn } from "@/lib/logger";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // Tylko biuro (ADMIN/STAFF): AGENT i KIEROWCA dostają 403 (wniosek 31).
  const session = await requireStaffSession();
  if (!session) {
    return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  }

  const { id } = await params;
  const cancelled = await cancelQueuedReminder(id);
  if (!cancelled) {
    logWarn("reminder_queue_cancel_rejected", { userId: session.user.id, reminderRuleId: id });
    return NextResponse.json({ message: "Nie można anulować tego powiadomienia." }, { status: 400 });
  }

  logInfo("reminder_queue_cancelled", { userId: session.user.id, reminderRuleId: id });
  return NextResponse.json({ ok: true });
}
