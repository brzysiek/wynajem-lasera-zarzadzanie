import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { REMINDER_DAYS, getReminderHour, getReminderTemplates, setReminderHour, setReminderTemplateBody, type ReminderDays } from "@/lib/reminders";
import { logInfo } from "@/lib/logger";

const HOUR_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  }

  const [hour, templates] = await Promise.all([getReminderHour(), getReminderTemplates()]);
  return NextResponse.json({ hour, templates });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const hour = typeof body?.hour === "string" ? body.hour : "";
  const templates = body?.templates;

  if (!HOUR_PATTERN.test(hour)) {
    return NextResponse.json({ message: "Podaj godzinę w formacie GG:MM." }, { status: 400 });
  }
  if (!templates || typeof templates !== "object") {
    return NextResponse.json({ message: "Brak treści szablonów." }, { status: 400 });
  }
  for (const days of REMINDER_DAYS) {
    const value = templates[String(days)];
    if (typeof value !== "string" || !value.trim()) {
      return NextResponse.json({ message: `Szablon dla przypomnienia ${days} dni przed nie może być pusty.` }, { status: 400 });
    }
  }

  await setReminderHour(hour);
  for (const days of REMINDER_DAYS) {
    await setReminderTemplateBody(days as ReminderDays, String(templates[String(days)]).trim());
  }

  logInfo("reminder_settings_updated", { userId: session.user.id, hour });

  return NextResponse.json({ ok: true });
}
