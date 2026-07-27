import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { setReminderHour } from "@/lib/reminders";
import { logInfo } from "@/lib/logger";

const HOUR_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const hour = typeof body?.hour === "string" ? body.hour : "";

  if (!HOUR_PATTERN.test(hour)) {
    return NextResponse.json({ message: "Podaj godzinę w formacie GG:MM." }, { status: 400 });
  }

  await setReminderHour(hour);
  logInfo("reminder_settings_updated", { userId: session.user.id, hour });

  return NextResponse.json({ ok: true });
}
