import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { syncAllDevices } from "@/lib/device-sync";
import { logInfo } from "@/lib/logger";

export async function POST() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  }

  const results = await syncAllDevices();
  const totalEvents = results.reduce((sum, r) => sum + r.count, 0);
  const errors = results.filter((r) => r.status === "ERROR");

  logInfo("devices_sync_all_ok", {
    userId: session.user.id,
    deviceCount: results.length,
    errorCount: errors.length,
    totalEvents,
  });

  const message =
    errors.length > 0
      ? `Zsynchronizowano ${results.length - errors.length}/${results.length} urządzeń (${totalEvents} wydarzeń). Błędy: ${errors.length}.`
      : `Zsynchronizowano wszystkie urządzenia (${results.length}) — ${totalEvents} wydarzeń.`;

  return NextResponse.json({ message, results });
}
