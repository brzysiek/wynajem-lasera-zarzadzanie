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

  const { id } = await params;
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
}
