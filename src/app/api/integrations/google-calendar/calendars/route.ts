import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth-guards";
import { listGoogleCalendars } from "@/lib/integrations/google-calendar";
import { logError } from "@/lib/logger";

export async function GET() {
  const session = await requireAdminSession();
  if (!session) {
    return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  }

  try {
    const calendars = await listGoogleCalendars();
    return NextResponse.json({ calendars });
  } catch (err) {
    logError("google_calendar_list_failed", err, { userId: session.user.id });
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ message }, { status: 502 });
  }
}
