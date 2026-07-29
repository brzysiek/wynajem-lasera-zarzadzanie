import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getRemindersEnabled, setRemindersEnabled, discardStaleReminders } from "@/lib/reminders";
import { logInfo, logWarn } from "@/lib/logger";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);

  if (typeof body?.enabled !== "boolean") {
    logWarn("reminder_settings_rejected", { userId: session.user.id });
    return NextResponse.json({ message: "Podaj wartość enabled." }, { status: 400 });
  }

  const wasEnabled = await getRemindersEnabled();
  await setRemindersEnabled(body.enabled);

  let discarded = 0;
  if (body.enabled && !wasEnabled) {
    discarded = await discardStaleReminders();
  }

  logInfo("reminder_settings_toggle", { userId: session.user.id, enabled: body.enabled, discarded });
  return NextResponse.json({ ok: true, discarded });
}
