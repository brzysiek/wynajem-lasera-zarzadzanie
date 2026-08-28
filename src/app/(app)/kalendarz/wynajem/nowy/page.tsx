import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getAllReminderTemplates } from "@/lib/reminders";
import { RentalForm } from "@/components/rental-form";

export default async function NewRentalPage({
  searchParams,
}: {
  searchParams: Promise<{ device?: string; date?: string }>;
}) {
  const { device, date } = await searchParams;
  const session = await auth();
  const isAdmin = session?.user.role === "ADMIN";

  const [devices, reminderTemplates, drivers] = await Promise.all([
    prisma.device.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, shortName: true, color: true, active: true },
    }),
    getAllReminderTemplates(),
    isAdmin
      ? prisma.user.findMany({ where: { role: "KIEROWCA" }, orderBy: { name: "asc" }, select: { id: true, name: true } })
      : Promise.resolve([]),
  ]);

  return (
    <RentalForm
      devices={devices}
      rental={null}
      defaultDeviceId={device}
      defaultDateIso={date}
      reminderTemplates={reminderTemplates}
      drivers={drivers}
      canManageDrivers={isAdmin}
      backHref="/kalendarz"
    />
  );
}
