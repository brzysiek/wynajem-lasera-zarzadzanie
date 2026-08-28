import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getAllReminderTemplates } from "@/lib/reminders";
import { loadFinanceFormContext } from "@/lib/finance";
import { RentalForm } from "@/components/rental-form";

export default async function NewRentalPage({
  searchParams,
}: {
  searchParams: Promise<{ device?: string; date?: string }>;
}) {
  const { device, date } = await searchParams;
  const session = await auth();
  const isAdmin = session?.user.role === "ADMIN";

  const [devices, reminderTemplates, drivers, financeCtx] = await Promise.all([
    prisma.device.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        shortName: true,
        color: true,
        active: true,
        pricingCategory: true,
        variantOptions: true,
      },
    }),
    getAllReminderTemplates(),
    isAdmin
      ? prisma.user.findMany({ where: { role: "KIEROWCA" }, orderBy: { name: "asc" }, select: { id: true, name: true } })
      : Promise.resolve([]),
    loadFinanceFormContext(),
  ]);

  return (
    <RentalForm
      devices={devices.map((d) => ({
        ...d,
        variantOptions: Array.isArray(d.variantOptions)
          ? (d.variantOptions as unknown[]).filter((v): v is string => typeof v === "string")
          : [],
      }))}
      rental={null}
      defaultDeviceId={device}
      defaultDateIso={date}
      reminderTemplates={reminderTemplates}
      drivers={drivers}
      canManageDrivers={isAdmin}
      canManageFinance
      previewPriceRules={financeCtx.previewPriceRules}
      previewPulseTiers={financeCtx.previewPulseTiers}
      defaultVatRate={financeCtx.defaultVatRate}
      backHref="/kalendarz"
    />
  );
}
