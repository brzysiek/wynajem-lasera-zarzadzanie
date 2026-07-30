import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { insertCalendarEvent } from "@/lib/integrations/google-calendar";
import { getHubspotContact, formatHubspotAddress } from "@/lib/integrations/hubspot";
import { logInfo, logWarn, logError } from "@/lib/logger";
import { REMINDER_DAYS, syncReminderRules, type ReminderDays } from "@/lib/reminders";
import { withDeliveryTimePrefix } from "@/lib/rental-title";

const RENTAL_INCLUDE = {
  device: true,
  reminderRules: { orderBy: { daysBefore: "asc" as const } },
  messages: { orderBy: { sentAt: "desc" as const } },
};

function parseReminderDays(body: unknown): ReminderDays[] {
  const raw = (body as { reminderDays?: unknown })?.reminderDays;
  if (!Array.isArray(raw)) return [...REMINDER_DAYS];
  return REMINDER_DAYS.filter((days) => raw.includes(days));
}

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
    include: RENTAL_INCLUDE,
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
  const deliveryAddress = typeof body?.deliveryAddress === "string" ? body.deliveryAddress.trim() : "";
  const deliveryTime = typeof body?.deliveryTime === "string" && body.deliveryTime ? body.deliveryTime : null;
  const pickupTime = typeof body?.pickupTime === "string" && body.pickupTime ? body.pickupTime : null;

  if (!deviceId || !title || !startsAt || !endsAt || isNaN(startsAt.getTime()) || isNaN(endsAt.getTime())) {
    logWarn("rental_create_rejected", { userId: session.user.id, reason: "invalid_input" });
    return NextResponse.json(
      { message: "Uzupełnij urządzenie, tytuł oraz poprawny termin rozpoczęcia i zakończenia." },
      { status: 400 },
    );
  }
  if (endsAt < startsAt) {
    logWarn("rental_create_rejected", { userId: session.user.id, reason: "invalid_date_range" });
    return NextResponse.json({ message: "Termin zakończenia musi być późniejszy niż rozpoczęcia." }, { status: 400 });
  }

  const device = await prisma.device.findUnique({ where: { id: deviceId } });
  if (!device) {
    return NextResponse.json({ message: "Nie znaleziono urządzenia." }, { status: 404 });
  }

  try {
    const { id: googleEventId } = await insertCalendarEvent(device.googleCalendarId, {
      title: withDeliveryTimePrefix(title, deliveryTime),
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
        deliveryAddress: deliveryAddress || null,
        deliveryTime,
        pickupTime,
        lastSyncedAt: new Date(),
      },
    });

    await syncReminderRules(rental, parseReminderDays(body), Boolean(body?.sendConfirmation));

    // Contact assignment is best-effort: the calendar event and rental are
    // already created at this point, so a HubSpot lookup failure shouldn't
    // fail the whole request — the user can still assign it from the edit view.
    const contactId = typeof body?.contactId === "string" ? body.contactId.trim() : "";
    if (contactId) {
      try {
        const contact = await getHubspotContact(contactId);
        const name = [contact.firstname, contact.lastname].filter(Boolean).join(" ").trim() || null;
        await prisma.rental.update({
          where: { id: rental.id },
          data: {
            hubspotContactId: contact.id,
            contactNameCache: name,
            contactPhoneCache: contact.phone,
            contactEmailCache: contact.email,
            contactCompanyCache: contact.company,
            contactAddressCache: formatHubspotAddress(contact),
          },
        });
      } catch (err) {
        logError("rental_contact_assign_on_create_failed", err, { rentalId: rental.id, contactId });
      }
    }

    logInfo("rental_created", { userId: session.user.id, rentalId: rental.id, deviceId: device.id });

    const withRelations = await prisma.rental.findUniqueOrThrow({ where: { id: rental.id }, include: RENTAL_INCLUDE });
    return NextResponse.json({ rental: withRelations });
  } catch (err) {
    logError("rental_create_failed", err, { userId: session.user.id, deviceId: device.id });
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ message }, { status: 502 });
  }
}
