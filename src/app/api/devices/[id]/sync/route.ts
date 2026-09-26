import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { syncDevice } from "@/lib/device-sync";
import { logInfo, logError } from "@/lib/logger";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  }
  // Rola AGENT: tylko odczyt (src/lib/permissions.ts).
  if (session.user.role === "AGENT") {
    return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  }

  const { id } = await params;

  // syncDevice() catches and logs its own failures (Google API errors etc.),
  // but a throw from anything outside it — findUnique hitting a transient DB
  // blip, for instance — used to fall through to Next's default error
  // handling instead, which returns a body the panel's json() parse can't
  // read and logs nothing of ours. Wrap the whole handler so that class of
  // failure is captured too, not just the ones syncDevice() already expects.
  try {
    const device = await prisma.device.findUnique({ where: { id } });
    if (!device) {
      return NextResponse.json({ message: "Nie znaleziono urządzenia." }, { status: 404 });
    }

    const result = await syncDevice(device);

    if (result.status === "ERROR") {
      logError("device_sync_failed", new Error(result.message), { userId: session.user.id, deviceId: device.id });
      return NextResponse.json({ message: result.message }, { status: 502 });
    }

    logInfo("device_sync_ok", { userId: session.user.id, deviceId: device.id, count: result.count });
    return NextResponse.json({ message: result.message, count: result.count });
  } catch (err) {
    logError("device_sync_unexpected_error", err, { userId: session.user.id, deviceId: id });
    return NextResponse.json(
      { message: `Nieoczekiwany błąd synchronizacji: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    );
  }
}
