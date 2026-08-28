import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getAllReminderTemplates } from "@/lib/reminders";
import { listSmsTemplates } from "@/lib/message-templates";
import { RentalForm, type Rental, type ReminderOffset } from "@/components/rental-form";
import { RentalReadonlyView } from "@/components/rental-readonly-view";

const RENTAL_INCLUDE = {
  device: true,
  driver: { select: { id: true, name: true } },
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

  // A driver gets a read-only card, and only for rentals assigned to them.
  if (role === "KIEROWCA") {
    const rental = await prisma.rental.findUnique({ where: { id }, include: { device: true, driver: true } });
    if (!rental || rental.driverId !== session!.user.id) {
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
          contactNameCache: rental.contactNameCache,
          contactPhoneCache: rental.contactPhoneCache,
          contactCompanyCache: rental.contactCompanyCache,
          contactAddressCache: rental.contactAddressCache,
        }}
      />
    );
  }

  const isAdmin = role === "ADMIN";

  const [devices, rental, reminderTemplates, smsTemplates, drivers] = await Promise.all([
    prisma.device.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, shortName: true, color: true, active: true },
    }),
    prisma.rental.findUnique({ where: { id }, include: RENTAL_INCLUDE }),
    getAllReminderTemplates(),
    listSmsTemplates(),
    isAdmin
      ? prisma.user.findMany({ where: { role: "KIEROWCA" }, orderBy: { name: "asc" }, select: { id: true, name: true } })
      : Promise.resolve([]),
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
    hubspotContactId: rental.hubspotContactId,
    driverId: rental.driverId,
    driver: rental.driver,
    contactNameCache: rental.contactNameCache,
    contactPhoneCache: rental.contactPhoneCache,
    contactEmailCache: rental.contactEmailCache,
    contactCompanyCache: rental.contactCompanyCache,
    contactAddressCache: rental.contactAddressCache,
    deliveryAddress: rental.deliveryAddress,
    deliveryTime: rental.deliveryTime,
    pickupTime: rental.pickupTime,
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
      devices={devices}
      rental={rentalDto}
      reminderTemplates={reminderTemplates}
      smsTemplates={smsTemplates}
      drivers={drivers}
      canManageDrivers={isAdmin}
      backHref={from && ALLOWED_FROM.has(from) ? from : "/kalendarz"}
    />
  );
}
