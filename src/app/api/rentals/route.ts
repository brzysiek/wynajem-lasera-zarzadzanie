import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { insertCalendarEvent } from "@/lib/integrations/google-calendar";
import { logInfo } from "@/lib/logger";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  if (!from || !to) {
    return NextResponse.json({ message: "Wymagane parametry from i to." }, { status: 400 });
  }

  const rentals = await prisma.rental.findMany({
    where: {
      deletedInGoogle: false,
      startsAt: { lte: new Date(to) },
      endsAt: { gte: new Date(from) },
    },
    include: { device: true },
    orderBy: { startsAt: "asc" },
  });

  return NextResponse.json({ rentals });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const deviceId = typeof body?.deviceId === "string" ? body.deviceId : "";
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const description = typeof body?.description === "string" ? body.description.trim() : "";
  const allDay = Boolean(body?.allDay);
  const startsAt = typeof body?.startsAt === "string" ? new Date(body.startsAt) : null;
  const endsAt = typeof body?.endsAt === "string" ? new Date(body.endsAt) : null;

  if (!deviceId || !title || !startsAt || !endsAt || isNaN(startsAt.getTime()) || isNaN(endsAt.getTime())) {
    return NextResponse.json(
      { message: "Uzupełnij urządzenie, tytuł oraz poprawny termin rozpoczęcia i zakończenia." },
      { status: 400 },
    );
  }
  if (endsAt <= startsAt) {
    return NextResponse.json({ message: "Termin zakończenia musi być późniejszy niż rozpoczęcia." }, { status: 400 });
  }

  const device = await prisma.device.findUnique({ where: { id: deviceId } });
  if (!device) {
    return NextResponse.json({ message: "Nie znaleziono urządzenia." }, { status: 404 });
  }

  try {
    const { id: googleEventId } = await insertCalendarEvent(device.googleCalendarId, {
      title,
      description: description || null,
      startsAt,
      endsAt,
      allDay,
    });

    const rental = await prisma.rental.create({
      data: {
        deviceId: device.id,
        googleEventId,
        googleCalendarId: device.googleCalendarId,
        title,
        description: description || null,
        startsAt,
        endsAt,
        allDay,
        lastSyncedAt: new Date(),
      },
      include: { device: true },
    });

    logInfo("rental_created", { userId: session.user.id, rentalId: rental.id, deviceId: device.id });

    return NextResponse.json({ rental });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ message }, { status: 502 });
  }
}
