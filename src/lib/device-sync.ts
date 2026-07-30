import { prisma } from "@/lib/prisma";
import { listCalendarEvents } from "@/lib/integrations/google-calendar";

// Wide enough to cover realistic bookings without pulling a device's entire
// history on every sync — full incremental sync (syncToken) is a later stage.
const SYNC_PAST_DAYS = 30;
const SYNC_FUTURE_DAYS = 365;

export type DeviceSyncResult = {
  deviceId: string;
  status: "OK" | "ERROR";
  count: number;
  message: string;
};

export async function syncDevice(device: { id: string; googleCalendarId: string }): Promise<DeviceSyncResult> {
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

    return { deviceId: device.id, status: "OK", count: events.length, message: `Zsynchronizowano ${events.length} wydarzeń.` };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.syncLog.create({
      data: { deviceId: device.id, direction: "PULL", eventsProcessed: 0, status: "ERROR", errorMessage: message },
    });
    return { deviceId: device.id, status: "ERROR", count: 0, message };
  }
}

// Sequential rather than Promise.all — keeps calls to the Google Calendar
// API gentle and keeps sync logs/ordering predictable when several devices
// fail at once.
export async function syncAllDevices(): Promise<DeviceSyncResult[]> {
  const devices = await prisma.device.findMany({ select: { id: true, googleCalendarId: true } });
  const results: DeviceSyncResult[] = [];
  for (const device of devices) {
    results.push(await syncDevice(device));
  }
  return results;
}
