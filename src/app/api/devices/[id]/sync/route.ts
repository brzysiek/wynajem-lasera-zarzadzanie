import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { listCalendarEvents } from "@/lib/integrations/google-calendar";
import { logInfo, logError } from "@/lib/logger";

// Wide enough to cover realistic bookings without pulling a device's entire
// history on every manual sync — full incremental sync (syncToken) is a
// later stage.
const SYNC_PAST_DAYS = 30;
const SYNC_FUTURE_DAYS = 365;

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

  const timeMin = new Date(Date.now() - SYNC_PAST_DAYS * 24 * 60 * 60 * 1000);
  const timeMax = new Date(Date.now() + SYNC_FUTURE_DAYS * 24 * 60 * 60 * 1000);

  try {
    const events = await listCalendarEvents(device.googleCalendarId, timeMin, timeMax);

    for (const event of events) {
      await prisma.rental.upsert({
        where: {
          googleCalendarId_googleEventId: { googleCalendarId: device.googleCalendarId, googleEventId: event.id },
        },
        create: {
          deviceId: device.id,
          googleEventId: event.id,
          googleCalendarId: device.googleCalendarId,
          title: event.title,
          description: event.description,
          startsAt: event.startsAt,
          endsAt: event.endsAt,
          allDay: event.allDay,
          lastSyncedAt: new Date(),
        },
        update: {
          title: event.title,
          description: event.description,
          startsAt: event.startsAt,
          endsAt: event.endsAt,
          allDay: event.allDay,
          deletedInGoogle: false,
          lastSyncedAt: new Date(),
        },
      });
    }

    // Rentals in the synced window that Google no longer returned are marked
    // deleted rather than dropped, preserving history of anything already
    // sent to a client (messages/reminders, in a later stage).
    const seenIds = events.map((event) => event.id);
    await prisma.rental.updateMany({
      where: {
        deviceId: device.id,
        googleCalendarId: device.googleCalendarId,
        startsAt: { gte: timeMin, lte: timeMax },
        googleEventId: { notIn: seenIds.length > 0 ? seenIds : ["__none__"] },
        deletedInGoogle: false,
      },
      data: { deletedInGoogle: true },
    });

    await prisma.syncLog.create({
      data: { deviceId: device.id, direction: "PULL", eventsProcessed: events.length, status: "OK" },
    });

    logInfo("device_sync_ok", { userId: session.user.id, deviceId: device.id, count: events.length });

    return NextResponse.json({ message: `Zsynchronizowano ${events.length} wydarzeń.`, count: events.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.syncLog.create({
      data: { deviceId: device.id, direction: "PULL", eventsProcessed: 0, status: "ERROR", errorMessage: message },
    });
    logError("device_sync_failed", err, { userId: session.user.id, deviceId: device.id });
    return NextResponse.json({ message }, { status: 502 });
  }
}
