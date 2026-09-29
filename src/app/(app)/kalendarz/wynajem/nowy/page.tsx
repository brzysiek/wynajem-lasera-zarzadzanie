import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getAllReminderTemplates } from "@/lib/reminders";
import { loadFinanceFormContext } from "@/lib/finance";
import { RentalForm } from "@/components/rental-form";

export default async function NewRentalPage({
  searchParams,
}: {
  searchParams: Promise<{ device?: string; date?: string; sygnal?: string }>;
}) {
  const { device, date, sygnal } = await searchParams;
  // Rezerwacja z sygnału (lejek): klient z sygnału, tytuł = klient, po zapisie
  // wynajem wiąże się z sygnałem (etap „Rezerwacja”).
  const lead = sygnal
    ? await prisma.lead.findUnique({
        where: { id: sygnal },
        select: {
          id: true,
          contactName: true,
          contactPhone: true,
          contactEmail: true,
          client: { select: { id: true, name: true, shortName: true, city: true } },
          clientContact: { select: { hubspotContactId: true, firstName: true, lastName: true, phone: true, email: true } },
        },
      })
    : null;
  const hs = lead?.clientContact?.hubspotContactId ?? null;
  const prefill = lead
    ? {
        leadId: lead.id,
        title: lead.client?.shortName ?? lead.client?.name ?? lead.contactName ?? null,
        contact: hs
          ? {
              id: hs,
              name: [lead.clientContact?.firstName, lead.clientContact?.lastName].filter(Boolean).join(" ") || lead.contactName,
              phone: lead.clientContact?.phone ?? lead.contactPhone,
              email: lead.clientContact?.email ?? lead.contactEmail,
              company: lead.client?.name ?? null,
              address: null,
              transportPrice: null,
              url: null,
            }
          : null,
      }
    : undefined;
  const session = await auth();
  const isAdmin = session?.user.role === "ADMIN";

  const [devices, reminderTemplates, drivers, vehicles, financeCtx] = await Promise.all([
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
      ? prisma.user.findMany({
          where: { role: "KIEROWCA" },
          orderBy: { name: "asc" },
          select: { id: true, name: true, driverColor: true },
        })
      : Promise.resolve([]),
    isAdmin
      ? prisma.vehicle.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } })
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
      prefill={prefill}
      // Wniosek 23: rezerwacja z sygnału — klient sygnału od razu wybrany.
      initialClient={lead?.client ? { id: lead.client.id, name: lead.client.name, shortName: lead.client.shortName, city: lead.client.city } : null}
      reminderTemplates={reminderTemplates}
      drivers={drivers}
      vehicles={vehicles}
      canManageDrivers={isAdmin}
      canManageFinance
      previewPriceRules={financeCtx.previewPriceRules}
      previewPulseTiers={financeCtx.previewPulseTiers}
      defaultVatRate={financeCtx.defaultVatRate}
      backHref="/kalendarz"
    />
  );
}
