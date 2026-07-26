import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/auth-guards";
import { logInfo } from "@/lib/logger";

const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdminSession();
  if (!session) {
    return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json().catch(() => null);

  const data: { name?: string; shortName?: string; color?: string; googleCalendarId?: string; active?: boolean } = {};

  if (typeof body?.name === "string" && body.name.trim()) data.name = body.name.trim();
  if (typeof body?.shortName === "string" && body.shortName.trim()) data.shortName = body.shortName.trim();
  if (typeof body?.color === "string") {
    if (!COLOR_PATTERN.test(body.color.trim())) {
      return NextResponse.json({ message: "Kolor musi być w formacie #RRGGBB." }, { status: 400 });
    }
    data.color = body.color.trim();
  }
  if (typeof body?.googleCalendarId === "string" && body.googleCalendarId.trim()) {
    data.googleCalendarId = body.googleCalendarId.trim();
  }
  if (typeof body?.active === "boolean") data.active = body.active;

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ message: "Brak zmian do zapisania." }, { status: 400 });
  }

  const device = await prisma.device.update({ where: { id }, data });
  logInfo("device_updated", { userId: session.user.id, deviceId: id, fields: Object.keys(data) });

  return NextResponse.json({ device });
}
