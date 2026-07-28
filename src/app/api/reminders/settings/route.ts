import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { setReminderHour, getRemindersEnabled, setRemindersEnabled, discardStaleReminders } from "@/lib/reminders";
import { logInfo, logWarn } from "@/lib/logger";

const HOUR_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);

  if (typeof body?.enabled === "boolean") {
    const wasEnabled = await getRemindersEnabled();
    await setRemindersEnabled(body.enabled);

    let discarded = 0;
    if (body.enabled && !wasEnabled) {
      discarded = await discardStaleReminders();
    }

    logInfo("reminder_settings_toggle", { userId: session.user.id, enabled: body.enabled, discarded });
    return NextResponse.json({ ok: true, discarded });
  }

  const hour = typeof body?.hour === "string" ? body.hour : "";

  if (!HOUR_PATTERN.test(hour)) {
    logWarn("reminder_settings_rejected", { userId: session.user.id, hour });
    return NextResponse.json({ message: "Podaj godzinę w formacie GG:MM." }, { status: 400 });
  }

  await setReminderHour(hour);
  logInfo("reminder_settings_updated", { userId: session.user.id, hour });

  return NextResponse.json({ ok: true });
}
