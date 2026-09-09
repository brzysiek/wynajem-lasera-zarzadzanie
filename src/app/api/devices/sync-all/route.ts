import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { syncAllDevices } from "@/lib/device-sync";
import { logInfo, logError } from "@/lib/logger";

export async function POST() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  }

  const results = await syncAllDevices();
  const totalEvents = results.reduce((sum, r) => sum + r.count, 0);
  const errors = results.filter((r) => r.status === "ERROR");

  // Each per-device failure is already written to SyncLog (see
  // device-sync.ts), but that table isn't surfaced anywhere admins actually
  // check for problems — this used to only ever call logInfo here, even when
  // some devices failed, so a bulk-sync error never showed up in
  // app-error-*.log at all.
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
}
