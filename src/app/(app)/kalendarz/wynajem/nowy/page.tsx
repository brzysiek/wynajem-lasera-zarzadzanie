import { prisma } from "@/lib/prisma";
import { getAllReminderTemplates } from "@/lib/reminders";
import { RentalForm } from "@/components/rental-form";

export default async function NewRentalPage({
  searchParams,
}: {
  searchParams: Promise<{ device?: string; date?: string }>;
}) {
  const { device, date } = await searchParams;
  const [devices, reminderTemplates] = await Promise.all([
    prisma.device.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, shortName: true, color: true, active: true },
    }),
    getAllReminderTemplates(),
  ]);

  return (
    <RentalForm
      devices={devices}
      rental={null}
      defaultDeviceId={device}
      defaultDateIso={date}
      reminderTemplates={reminderTemplates}
      backHref="/kalendarz"
    />
  );
}
