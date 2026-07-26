import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth-guards";
import { testGoogleCalendarConnection } from "@/lib/integrations/google-calendar";
import { logInfo, logError } from "@/lib/logger";

export async function POST() {
  const session = await requireAdminSession();
  if (!session) {
    return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  }

  const result = await testGoogleCalendarConnection();
  if (result.ok) {
    logInfo("integration_google_calendar_test_ok", { userId: session.user.id });
  } else {
    logError("integration_google_calendar_test_failed", new Error(result.message), { userId: session.user.id });
  }

  return NextResponse.json(result);
}
