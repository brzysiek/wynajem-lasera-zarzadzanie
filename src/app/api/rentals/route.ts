import { NextRequest, NextResponse } from "next/server";
import { withClientTag } from "@/lib/rental-client-tag";
import { recordChanges } from "@/lib/changelog/record";
import { qualifyClient } from "@/lib/clients/qualify";
import { clearResignedForRentals } from "@/lib/clients/resign";
import { auth } from "@/auth";
import { requireStaffSession } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { resolveDeliveryAddressId } from "@/lib/clients/delivery";
import { termsWarnings } from "@/lib/clients/terms";
import { insertCalendarEvent } from "@/lib/integrations/google-calendar";
import { getHubspotContact, formatHubspotAddress } from "@/lib/integrations/hubspot";
import { logInfo, logWarn, logError } from "@/lib/logger";
import { DEFAULT_REMINDER_DAYS, REMINDER_DAYS, syncReminderRules, type ReminderDays } from "@/lib/reminders";
import { checkAvailability, conflictMessage } from "@/lib/rentals/availability";
import { afterFinanceSave, applyClientCaches, parseTraining, validateRentalForm } from "@/lib/rentals/form-save";
import { withDeliveryTimePrefix } from "@/lib/rental-title";
import { resolveDriverId } from "@/lib/rental-driver";
import { resolveContactDistanceKm, resolveVehicleId } from "@/lib/rental-vehicle";
import { saveRentalFinance } from "@/lib/finance";
import { linkUnassignedRentalsSafe } from "@/lib/clients/rental-match";
import { syncLeadsWithRentalsSafe } from "@/lib/leads/rental-link";
import { updateLead } from "@/lib/leads/actions";

const RENTAL_INCLUDE = {
  device: true,
  driver: { select: { id: true, name: true, driverColor: true } },
  vehicle: { select: { id: true, name: true } },
  finance: true,
  reminderRules: { orderBy: { daysBefore: "asc" as const } },
  messages: { orderBy: { sentAt: "desc" as const } },
};

function parseReminderDays(body: unknown): ReminderDays[] {
  const raw = (body as { reminderDays?: unknown })?.reminderDays;
  // Wniosek 29: domyślnie tylko „3 dni przed” (bez tygodnia).
  if (!Array.isArray(raw)) return [...DEFAULT_REMINDER_DAYS];
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
      // Drivers only ever see the rentals an admin assigned to them.
      ...(session.user.role === "KIEROWCA" ? { driverId: session.user.id } : {}),
    },
    include: RENTAL_INCLUDE,
    orderBy: { startsAt: "asc" },
  });

  // Cena ≠ warunki klienta (> 10%) — ostrzeżenie na kafelku (tylko biuro).
  if (session.user.role === "ADMIN" || session.user.role === "STAFF") {
    const warnings = await termsWarnings(rentals);
    return NextResponse.json({ rentals: rentals.map((r) => (warnings.has(r.id) ? { ...r, termsWarning: warnings.get(r.id) } : r)) });
  }
  return NextResponse.json({ rentals });
}

export async function POST(req: NextRequest) {
  const session = await requireStaffSession();
  if (!session) {
    return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const deviceId = typeof body?.deviceId === "string" ? body.deviceId : "";
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const description = typeof body?.description === "string" ? body.description.trim() : "";
  const internalNotes = typeof body?.internalNotes === "string" ? body.internalNotes.trim() : "";
  const allDay = Boolean(body?.allDay);
  const startsAt = typeof body?.startsAt === "string" ? new Date(body.startsAt) : null;
  const endsAt = typeof body?.endsAt === "string" ? new Date(body.endsAt) : null;
  const deliveryAddress = typeof body?.deliveryAddress === "string" ? body.deliveryAddress.trim() : "";
  const deliveryTime = typeof body?.deliveryTime === "string" && body.deliveryTime ? body.deliveryTime : null;
  const pickupTime = typeof body?.pickupTime === "string" && body.pickupTime ? body.pickupTime : null;
  const transportPrice = typeof body?.transportPrice === "string" ? body.transportPrice.trim() : "";
  const eventType = body?.eventType === "SZKOLENIE" ? "SZKOLENIE" : "WYNAJEM";

  const distanceResolved = resolveContactDistanceKm(body?.contactDistanceKm);
  if (!distanceResolved.ok) return distanceResolved.response;
  const addressResolved = await resolveDeliveryAddressId(body?.deliveryAddressId, null);
  if (!addressResolved.ok) return NextResponse.json({ message: addressResolved.message }, { status: 400 });
  const deliveryAddressId = eventType === "SZKOLENIE" ? null : (addressResolved.id ?? null);
  const contactDistanceKm = distanceResolved.distanceKm;

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

  // Wniosek 23: klient rezerwacji wybierany w panelu — obowiązkowy.
  const clientId = typeof body?.clientId === "string" ? body.clientId.trim() : "";
  if (!clientId) return NextResponse.json({ message: "Wybierz klienta rezerwacji (albo dodaj nowego)." }, { status: 400 });
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { id: true, archivedAt: true } });
  if (!client || client.archivedAt) return NextResponse.json({ message: "Wybrany klient nie istnieje albo jest w archiwum." }, { status: 400 });

  // Wniosek 29: wariant obowiązkowy, transport klienta bez kwoty ustalonej, kolizje urządzenia.
  const invalid = await validateRentalForm({ eventType, variantOptions: device.variantOptions, finance: body?.finance, clientId });
  if (invalid) return NextResponse.json({ message: invalid }, { status: 400 });
  const avail = await checkAvailability(device.id, startsAt, endsAt);
  if (!avail.free && !(session.user.role === "ADMIN" && body?.allowConflict === true)) {
    return NextResponse.json({ message: `${conflictMessage(avail.conflicts, device.name)}${session.user.role === "ADMIN" ? " Zaznacz „Zapisz mimo kolizji”, jeśli to świadome." : " Zapis przy kolizji zatwierdza administrator."}`, conflicts: avail.conflicts, suggestions: avail.suggestions }, { status: 409 });
  }
  const training = parseTraining(body, eventType === "SZKOLENIE");

  // Only an admin may assign a driver/vehicle; a STAFF request silently ignores the fields.
  let driverId: string | null = null;
  let vehicleId: string | null = null;
  if (session.user.role === "ADMIN" && body && "driverId" in body) {
    const resolved = await resolveDriverId(body.driverId);
    if (!resolved.ok) return resolved.response;
    driverId = resolved.driverId;
  }
  if (session.user.role === "ADMIN" && body && "vehicleId" in body) {
    const resolved = await resolveVehicleId(body.vehicleId);
    if (!resolved.ok) return resolved.response;
    vehicleId = resolved.vehicleId;
  }

  try {
    const { id: googleEventId } = await insertCalendarEvent(device.googleCalendarId, {
      title: withDeliveryTimePrefix(title, deliveryTime),
      description: description || null,
      startsAt,
      endsAt,
      allDay,
      clientId,
    });

    const rental = await prisma.rental.create({
      data: {
        deviceId: device.id,
        googleEventId,
        googleCalendarId: device.googleCalendarId,
        title,
        clientId,
        eventClientId: clientId,
        description: withClientTag(description || null, clientId),
        internalNotes: internalNotes || null,
        startsAt,
        endsAt,
        allDay,
        deliveryAddress: deliveryAddress || null,
        deliveryAddressId,
        deliveryTime,
        pickupTime,
        transportPrice: transportPrice || null,
        contactDistanceKm,
        driverId,
        vehicleId,
        eventType,
        ...training,
        lastSyncedAt: new Date(),
      },
    });

    await syncReminderRules(rental, parseReminderDays(body), Boolean(body?.sendConfirmation));
    // Dane kontaktu z klienta panelu + „osoba na miejscu” (telefon dla kierowcy).
    await applyClientCaches(rental.id, clientId, typeof body?.clientContactId === "string" ? body.clientContactId : null);
    // Dziennik: klient wybrany w panelu przy zakładaniu rezerwacji.
    await recordChanges(prisma, { userId: session.user.id, provenance: { source: "rezerwacja z panelu — klient wybrany w formularzu", confidence: "HIGH", batch: null } }, [
      { entity: "RENTAL", entityId: rental.id, operation: "MATCH_ASSIGN", clientId, field: "clientId", before: null, after: clientId },
    ]);
    await qualifyClient(clientId, "RENTAL");
    // Wniosek 24: nowa rezerwacja zdejmuje stan „Zrezygnował”.
    await clearResignedForRentals([rental.id], session.user.id);

    // Contact assignment is best-effort: the calendar event and rental are
    // already created at this point, so a HubSpot lookup failure shouldn't
    // fail the whole request — the user can still assign it from the edit view.
    const contactId = typeof body?.contactId === "string" ? body.contactId.trim() : "";
    if (contactId) {
      try {
        const contact = await getHubspotContact(contactId);
        const name = [contact.firstname, contact.lastname].filter(Boolean).join(" ").trim() || null;
        // contactDistanceKm nie synchronizuje się z HubSpot (docs/prompt-claude-code-dashboard-kosztow.md
        // sekcja 7 — świadomie, bez integracji mapowych). "Raz przy danym
        // kliencie" realizujemy lokalnie: jeśli biuro nic nie wpisało na tym
        // formularzu, podpowiadamy ostatnią znaną odległość z poprzedniego
        // wynajmu tego samego kontaktu.
        let distanceToSave = contactDistanceKm;
        if (distanceToSave === null) {
          const prev = await prisma.rental.findFirst({
            where: { hubspotContactId: contact.id, contactDistanceKm: { not: null } },
            orderBy: { startsAt: "desc" },
            select: { contactDistanceKm: true },
          });
          if (prev?.contactDistanceKm !== null && prev?.contactDistanceKm !== undefined) {
            distanceToSave = Number(prev.contactDistanceKm);
          }
        }
        await prisma.rental.update({
          where: { id: rental.id },
          data: {
            hubspotContactId: contact.id,
            contactNameCache: name,
            contactPhoneCache: contact.phone,
            contactEmailCache: contact.email,
            contactCompanyCache: contact.company,
            contactAddressCache: formatHubspotAddress(contact),
            contactTransportPriceCache: contact.transportPrice,
            contactNipCache: contact.nip,
            // Backfill the rental's own field only if nothing was typed on the form.
            ...(transportPrice ? {} : { transportPrice: contact.transportPrice }),
            contactDistanceKm: distanceToSave,
          },
        });
      } catch (err) {
        logError("rental_contact_assign_on_create_failed", err, { rentalId: rental.id, contactId });
      }
    }

    // Klient po kontakcie HubSpot / aliasie / serii tytułu (wniosek 13).
    await linkUnassignedRentalsSafe({ userId: session.user.id, rentalIds: [rental.id] });
    // Lejek: rezerwacja utworzona z sygnału → od razu powiązana; poza tym
    // otwarty sygnał tego klienta → „Rezerwacja” z tym wynajmem.
    const leadId = typeof body?.leadId === "string" ? body.leadId : "";
    if (leadId) {
      await updateLead(leadId, { rentalId: rental.id }, session.user.id).catch((err) => logWarn("rental_lead_link_failed", { leadId, rentalId: rental.id, message: err instanceof Error ? err.message : String(err) }));
    }
    await syncLeadsWithRentalsSafe();
    // Adres z paszportu innego klienta niż ten, do którego trafił wynajem — odpinamy.
    if (deliveryAddressId) {
      const linked = await prisma.rental.findUnique({ where: { id: rental.id }, select: { clientId: true, deliveryAddressRef: { select: { clientId: true } } } });
      if (linked && linked.clientId !== linked.deliveryAddressRef?.clientId) await prisma.rental.update({ where: { id: rental.id }, data: { deliveryAddressId: null } });
    }

    logInfo("rental_created", { userId: session.user.id, rentalId: rental.id, deviceId: device.id });

    // Finanse — best-effort jak przypisanie kontaktu: wynajem i event w
    // kalendarzu już istnieją, brak ceny w cenniku nie może wywalić całości.
    let financeError: string | null = null;
    if (body?.finance && typeof body.finance === "object") {
      const current = await prisma.rental.findUniqueOrThrow({
        where: { id: rental.id },
        select: { transportPrice: true, clientId: true },
      });
      const result = await saveRentalFinance(
        {
          id: rental.id,
          clientId: current.clientId,
          eventType,
          startsAt,
          endsAt,
          transportPrice: current.transportPrice,
          device: { pricingCategory: device.pricingCategory },
          finance: null,
        },
        body.finance,
      );
      if (!result.ok) financeError = result.message;
      else await afterFinanceSave(rental.id, body.finance, session.user.id);
    }

    const withRelations = await prisma.rental.findUniqueOrThrow({ where: { id: rental.id }, include: RENTAL_INCLUDE });
    return NextResponse.json({ rental: withRelations, ...(financeError ? { financeError } : {}) });
  } catch (err) {
    logError("rental_create_failed", err, { userId: session.user.id, deviceId: device.id });
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ message }, { status: 502 });
  }
}
