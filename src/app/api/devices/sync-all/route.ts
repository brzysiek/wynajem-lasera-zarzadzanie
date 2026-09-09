import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { syncAllDevices } from "@/lib/device-sync";
import { logInfo, logError } from "@/lib/logger";

export async function POST() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  }

  // syncAllDevices()/syncDevice() catch and log per-device failures (Google
  // API errors etc.) into SyncLog and, below, app-error-*.log. A throw from
  // outside that — e.g. the initial prisma.device.findMany failing — used to
  // fall through to Next's default error handling instead: a response body
  // the panel's json() parse can't read, and nothing of ours logged at all.
  try {
    const results = await syncAllDevices();
    const totalEvents = results.reduce((sum, r) => sum + r.count, 0);
    const errors = results.filter((r) => r.status === "ERROR");

    if (errors.length > 0) {
      logError(
        "devices_sync_all_partial_failure",
        new Error(`${errors.length}/${results.length} urządzeń nie zsynchronizowano`),
        {
          userId: session.user.id,
          deviceCount: results.length,
          totalEvents,
          errors: errors.map((e) => ({ deviceId: e.deviceId, deviceName: e.deviceName, message: e.message })),
        },
      );
    } else {
      logInfo("devices_sync_all_ok", { userId: session.user.id, deviceCount: results.length, totalEvents });
    }

    // Per-device outcome (which calendar synced, which failed and why) is in
    // `results` — the UI renders that as a breakdown list, so this message
    // stays a one-line aggregate rather than repeating it.
    const message =
      errors.length > 0
        ? `Zsynchronizowano ${results.length - errors.length}/${results.length} urządzeń (${totalEvents} wydarzeń), ${errors.length} z błędem — szczegóły niżej.`
        : `Zsynchronizowano wszystkie urządzenia (${results.length}) — ${totalEvents} wydarzeń.`;

    return NextResponse.json({ message, results });
  } catch (err) {
    logError("devices_sync_all_unexpected_error", err, { userId: session.user.id });
    return NextResponse.json(
      { message: `Nieoczekiwany błąd synchronizacji: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    );
  }
}
