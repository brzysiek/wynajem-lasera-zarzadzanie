import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { VIEW_COOKIE, actsAsDriver, isDriverPreview } from "@/lib/effective-role";
import { getAllReminderTemplates } from "@/lib/reminders";
import { listSmsTemplates } from "@/lib/message-templates";
import { RentalForm, type Rental, type ReminderOffset } from "@/components/rental-form";
import { RentalReadonlyView } from "@/components/rental-readonly-view";
import { DriverFinancePanel } from "@/components/driver-finance-panel";
import { financeDto, loadFinanceFormContext } from "@/lib/finance";
import { rentalDurationDays } from "@/lib/pricing/duration";

const DEVICE_SELECT = {
  id: true,
  name: true,
  shortName: true,
  color: true,
  active: true,
  pricingCategory: true,
  variantOptions: true,
} as const;

function deviceDto<T extends { variantOptions: unknown }>(d: T) {
  return {
    ...d,
    variantOptions: Array.isArray(d.variantOptions)
      ? (d.variantOptions as unknown[]).filter((v): v is string => typeof v === "string")
      : [],
  };
}

const RENTAL_INCLUDE = {
  device: true,
  driver: { select: { id: true, name: true } },
  finance: true,
  reminderRules: { orderBy: { daysBefore: "asc" as const } },
  messages: { orderBy: { sentAt: "desc" as const } },
};

const ALLOWED_FROM = new Set(["/kalendarz", "/nadchodzace"]);

export default async function RentalDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const { id } = await params;
  const { from } = await searchParams;
  const session = await auth();
  const role = session?.user.role;
  const viewCookie = (await cookies()).get(VIEW_COOKIE)?.value;
  const driverMode = actsAsDriver(role, session?.user.canActAsDriver, viewCookie);
  const preview = isDriverPreview(role, session?.user.canActAsDriver, viewCookie);

  // Driver (real or ADMIN/STAFF preview) gets the read-only card + finance
  // panel. A real KIEROWCA only sees rentals assigned to them; a preview
  // opens any rental.
  if (driverMode) {
    const [rental, financeCtx] = await Promise.all([
      prisma.rental.findUnique({ where: { id }, include: { device: true, driver: true, finance: true } }),
      loadFinanceFormContext(),
    ]);
    if (!rental || (!preview && rental.driverId !== session!.user.id)) {
      notFound();
    }

    return (
      <RentalReadonlyView
        rental={{
          title: rental.title,
          description: rental.description,
          startsAt: rental.startsAt.toISOString(),
          endsAt: rental.endsAt.toISOString(),
          allDay: rental.allDay,
          device: { name: rental.device.name, color: rental.device.color },
          driverName: rental.driver?.name ?? null,
          deliveryAddress: rental.deliveryAddress,
          deliveryTime: rental.deliveryTime,
          pickupTime: rental.pickupTime,
          transportPrice: rental.transportPrice,
          contactNameCache: rental.contactNameCache,
          contactPhoneCache: rental.contactPhoneCache,
          contactCompanyCache: rental.contactCompanyCache,
          contactAddressCache: rental.contactAddressCache,
        }}
        financeSlot={
          <DriverFinancePanel
            rentalId={rental.id}
            eventType={rental.eventType}
            pricingCategory={rental.device.pricingCategory}
            finance={financeDto(rental.finance)}
            initialDriverNotes={rental.driverNotes ?? ""}
            previewCtx={{ priceRules: financeCtx.previewPriceRules, pulseTiers: financeCtx.previewPulseTiers }}
            durationDays={rentalDurationDays(rental.startsAt, rental.endsAt)}
            transportPrice={rental.transportPrice}
            capFeeHsNet={financeCtx.capFeeHsNet}
            almaPulseRateNet={financeCtx.almaPulseRateNet}
          />
        }
      />
    );
  }

  const isAdmin = role === "ADMIN";

  const [devices, rental, reminderTemplates, smsTemplates, drivers, financeCtx] = await Promise.all([
    prisma.device.findMany({ orderBy: { name: "asc" }, select: DEVICE_SELECT }),
    prisma.rental.findUnique({ where: { id }, include: RENTAL_INCLUDE }),
    getAllReminderTemplates(),
    listSmsTemplates(),
    isAdmin
      ? prisma.user.findMany({ where: { role: "KIEROWCA" }, orderBy: { name: "asc" }, select: { id: true, name: true } })
      : Promise.resolve([]),
    loadFinanceFormContext(),
  ]);

  if (!rental) {
    notFound();
  }

  const rentalDto: Rental = {
    id: rental.id,
    deviceId: rental.deviceId,
    title: rental.title,
    description: rental.description,
    startsAt: rental.startsAt.toISOString(),
    endsAt: rental.endsAt.toISOString(),
    allDay: rental.allDay,
    eventType: rental.eventType,
    finance: financeDto(rental.finance),
    hubspotContactId: rental.hubspotContactId,
    driverId: rental.driverId,
    driver: rental.driver,
    contactNameCache: rental.contactNameCache,
    contactPhoneCache: rental.contactPhoneCache,
    contactEmailCache: rental.contactEmailCache,
    contactCompanyCache: rental.contactCompanyCache,
    contactAddressCache: rental.contactAddressCache,
    contactTransportPriceCache: rental.contactTransportPriceCache,
    deliveryAddress: rental.deliveryAddress,
    deliveryTime: rental.deliveryTime,
    pickupTime: rental.pickupTime,
    transportPrice: rental.transportPrice,
    reminderRules: rental.reminderRules.map((r) => ({
      id: r.id,
      daysBefore: r.daysBefore as ReminderOffset,
      status: r.status,
      sentAt: r.sentAt ? r.sentAt.toISOString() : null,
      scheduledFor: r.scheduledFor.toISOString(),
      errorMessage: r.errorMessage,
      edited: r.edited,
      messageBody: r.messageBody,
    })),
    messages: rental.messages.map((m) => ({
      id: m.id,
      recipient: m.recipient,
      body: m.body,
      status: m.status as "SENT" | "FAILED",
      errorMessage: m.errorMessage,
      sentAt: m.sentAt.toISOString(),
    })),
  };

  return (
    <RentalForm
      devices={devices.map(deviceDto)}
      rental={rentalDto}
      reminderTemplates={reminderTemplates}
      smsTemplates={smsTemplates}
      drivers={drivers}
      canManageDrivers={isAdmin}
      canManageFinance
      previewPriceRules={financeCtx.previewPriceRules}
      previewPulseTiers={financeCtx.previewPulseTiers}
      defaultVatRate={financeCtx.defaultVatRate}
      backHref={from && ALLOWED_FROM.has(from) ? from : "/kalendarz"}
    />
  );
}
