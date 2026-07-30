import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { updateCalendarEvent, deleteCalendarEvent, moveCalendarEvent } from "@/lib/integrations/google-calendar";
import { logInfo, logWarn, logError } from "@/lib/logger";
import { CONFIRMATION_OFFSET, REMINDER_DAYS, syncReminderRules, type ReminderDays } from "@/lib/reminders";
import { withDeliveryTimePrefix } from "@/lib/rental-title";

const RENTAL_INCLUDE = {
  device: true,
  reminderRules: { orderBy: { daysBefore: "asc" as const } },
  messages: { orderBy: { sentAt: "desc" as const } },
};

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  }

  const { id } = await params;
  const rental = await prisma.rental.findUnique({ where: { id } });
  if (!rental) {
    return NextResponse.json({ message: "Nie znaleziono rezerwacji." }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const title = typeof body?.title === "string" ? body.title.trim() : rental.title;
  const description = typeof body?.description === "string" ? body.description.trim() : rental.description ?? "";
  const allDay = typeof body?.allDay === "boolean" ? body.allDay : rental.allDay;
  const startsAt = typeof body?.startsAt === "string" ? new Date(body.startsAt) : rental.startsAt;
  const endsAt = typeof body?.endsAt === "string" ? new Date(body.endsAt) : rental.endsAt;
  const deliveryAddress = typeof body?.deliveryAddress === "string" ? body.deliveryAddress.trim() : rental.deliveryAddress ?? "";
  const deliveryTime =
    typeof body?.deliveryTime === "string" ? (body.deliveryTime || null) : rental.deliveryTime;
  const pickupTime = typeof body?.pickupTime === "string" ? (body.pickupTime || null) : rental.pickupTime;

  if (!title || isNaN(startsAt.getTime()) || isNaN(endsAt.getTime())) {
    logWarn("rental_update_rejected", { userId: session.user.id, rentalId: id, reason: "invalid_input" });
    return NextResponse.json({ message: "Uzupełnij tytuł i poprawny termin." }, { status: 400 });
  }
  if (endsAt < startsAt) {
    logWarn("rental_update_rejected", { userId: session.user.id, rentalId: id, reason: "invalid_date_range" });
    return NextResponse.json({ message: "Termin zakończenia musi być późniejszy niż rozpoczęcia." }, { status: 400 });
  }

  const requestedDeviceId = typeof body?.deviceId === "string" && body.deviceId ? body.deviceId : rental.deviceId;
  const deviceChanged = requestedDeviceId !== rental.deviceId;
  let targetCalendarId = rental.googleCalendarId;
  if (deviceChanged) {
    const newDevice = await prisma.device.findUnique({ where: { id: requestedDeviceId } });
    if (!newDevice) {
      logWarn("rental_update_rejected", { userId: session.user.id, rentalId: id, reason: "device_not_found" });
      return NextResponse.json({ message: "Nie znaleziono wybranego urządzenia." }, { status: 400 });
    }
    targetCalendarId = newDevice.googleCalendarId;
  }

  // reminderDays is only sent by the rental form. Partial updates from
  // elsewhere (e.g. the calendar's drag-and-drop date move) omit it — in
  // that case we keep whatever was already checked/sent, just re-syncing
  // scheduledFor for any still-pending reminder against the new startsAt.
  const explicitReminderDays = Array.isArray(body?.reminderDays)
    ? REMINDER_DAYS.filter((days) => body.reminderDays.includes(days))
    : null;
  const explicitConfirmation = typeof body?.sendConfirmation === "boolean" ? body.sendConfirmation : null;

  let selectedDays: ReminderDays[];
  let confirmationSelected: boolean;
  if (explicitReminderDays !== null && explicitConfirmation !== null) {
    selectedDays = explicitReminderDays;
    confirmationSelected = explicitConfirmation;
  } else {
    const existingRules = await prisma.reminderRule.findMany({ where: { rentalId: id, channel: "SMS" } });
    const activeRules = existingRules.filter((r) => r.status === "SENT" || r.status === "SCHEDULED");
    selectedDays =
      explicitReminderDays ??
      (activeRules.filter((r) => REMINDER_DAYS.includes(r.daysBefore as ReminderDays)).map((r) => r.daysBefore) as ReminderDays[]);
    confirmationSelected =
      explicitConfirmation ?? activeRules.some((r) => r.daysBefore === CONFIRMATION_OFFSET);
  }

  try {
    if (deviceChanged) {
      await moveCalendarEvent(rental.googleCalendarId, rental.googleEventId, targetCalendarId);
    }
    await updateCalendarEvent(targetCalendarId, rental.googleEventId, {
      title: withDeliveryTimePrefix(title, deliveryTime),
      description: description || null,
      startsAt,
      endsAt,
      allDay,
    });

    const updated = await prisma.rental.update({
      where: { id },
      data: {
        title,
        description: description || null,
        startsAt,
        endsAt,
        allDay,
        deviceId: requestedDeviceId,
        googleCalendarId: targetCalendarId,
        deliveryAddress: deliveryAddress || null,
        deliveryTime,
        pickupTime,
        lastSyncedAt: new Date(),
      },
    });

    await syncReminderRules(updated, selectedDays, confirmationSelected);

    logInfo("rental_updated", { userId: session.user.id, rentalId: id, deviceChanged });

    const withRelations = await prisma.rental.findUniqueOrThrow({ where: { id }, include: RENTAL_INCLUDE });
    return NextResponse.json({ rental: withRelations });
  } catch (err) {
    logError("rental_update_failed", err, { userId: session.user.id, rentalId: id });
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ message }, { status: 502 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  }

  const { id } = await params;
  const rental = await prisma.rental.findUnique({ where: { id } });
  if (!rental) {
    return NextResponse.json({ message: "Nie znaleziono rezerwacji." }, { status: 404 });
  }

  try {
    await deleteCalendarEvent(rental.googleCalendarId, rental.googleEventId);
    // Hard-delete: reminder_rules cascade-delete with the rental (no pending
    // reminders survive a deleted rental), and messages.rentalId is set to
    // NULL on delete so already-sent SMS history stays visible in Bramka.
    await prisma.rental.delete({ where: { id } });

    logInfo("rental_deleted", { userId: session.user.id, rentalId: id });

    return NextResponse.json({ ok: true });
  } catch (err) {
    logError("rental_delete_failed", err, { userId: session.user.id, rentalId: id });
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ message }, { status: 502 });
  }
}
