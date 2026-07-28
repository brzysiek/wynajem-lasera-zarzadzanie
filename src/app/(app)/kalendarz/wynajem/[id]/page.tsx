import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getAllReminderTemplates } from "@/lib/reminders";
import { RentalForm, type Rental, type ReminderOffset } from "@/components/rental-form";

const RENTAL_INCLUDE = {
  device: true,
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

  const [devices, rental, reminderTemplates] = await Promise.all([
    prisma.device.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, shortName: true, color: true, active: true },
    }),
    prisma.rental.findUnique({ where: { id }, include: RENTAL_INCLUDE }),
    getAllReminderTemplates(),
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
    contactNameCache: rental.contactNameCache,
    contactPhoneCache: rental.contactPhoneCache,
    contactEmailCache: rental.contactEmailCache,
    contactCompanyCache: rental.contactCompanyCache,
    contactAddressCache: rental.contactAddressCache,
    reminderRules: rental.reminderRules.map((r) => ({
      id: r.id,
      daysBefore: r.daysBefore as ReminderOffset,
      status: r.status,
      sentAt: r.sentAt ? r.sentAt.toISOString() : null,
      errorMessage: r.errorMessage,
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
      backHref={from && ALLOWED_FROM.has(from) ? from : "/kalendarz"}
    />
  );
}
