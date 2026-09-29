import { prisma } from "@/lib/prisma";
import { loadUnassignedRentals } from "@/lib/clients/rental-match";
import { loadFvWithoutInvoice } from "@/lib/invoicing/fv-check-load";
import { rentalIssues } from "@/lib/task-link-rules";

// Kalendarz → „Do dopięcia” (wniosek 26): kolejki liczone na bieżąco z danych,
// bez zadań. Każda pozycja linkuje do karty rezerwacji (/kalendarz?wynajem=).

export type QueueItem = { rentalId: string; title: string; startsAt: string; device: string; note: string };
export type CalendarQueue = { key: "unassigned" | "amounts" | "transport" | "tomorrow" | "invoices"; label: string; items: QueueItem[] };

const num = (v: { toString(): string } | null | undefined) => (v == null ? null : Number(v.toString()));

export async function loadCalendarQueues(now = new Date()): Promise<CalendarQueue[]> {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today.getTime() + 86_400_000);
  const dayAfter = new Date(tomorrow.getTime() + 86_400_000);
  const [unassigned, future, fv] = await Promise.all([
    loadUnassignedRentals({ now }).catch(() => []),
    prisma.rental.findMany({
      where: { deletedInGoogle: false, eventType: "WYNAJEM", endsAt: { gte: today }, clientId: { not: null } },
      orderBy: { startsAt: "asc" },
      select: {
        id: true,
        title: true,
        startsAt: true,
        eventType: true,
        clientId: true,
        client: { select: { name: true, shortName: true, transportPriceNet: true } },
        deliveryAddress: true,
        deliveryAddressId: true,
        deliveryTime: true,
        device: { select: { name: true, variantOptions: true } },
        finance: {
          select: {
            deviceVariant: true,
            totalNet: true,
            baseRentalPriceNet: true,
            pulseSurchargeNet: true,
            transportPriceNet: true,
            transportPaidSeparately: true,
            capUsedHS: true,
            capCountHS: true,
            capFeeNet: true,
            membraneUsed: true,
            membraneCount: true,
            membraneFeeNet: true,
          },
        },
      },
    }),
    loadFvWithoutInvoice(now).catch(() => []),
  ]);

  const amounts: QueueItem[] = [];
  const tomorrowItems: QueueItem[] = [];
  // Wniosek 28: klient bez transportu ustalonego — jedna pozycja na klienta
  // (najbliższa rezerwacja), dopóki biuro nie wpisze kwoty na karcie.
  const transportItems: QueueItem[] = [];
  const transportSeen = new Set<string>();
  for (const r of future) {
    if (r.client && r.client.transportPriceNet == null && r.clientId && !transportSeen.has(r.clientId)) {
      transportSeen.add(r.clientId);
      transportItems.push({ rentalId: r.id, title: r.title, startsAt: r.startsAt.toISOString(), device: r.device.name, note: `${r.client.shortName ?? r.client.name}: transport do zatwierdzenia` });
    }
    const f = r.finance;
    const variants = Array.isArray(r.device.variantOptions) ? (r.device.variantOptions as unknown[]).filter((x): x is string => typeof x === "string") : [];
    const issues = rentalIssues({
      eventType: r.eventType,
      clientId: r.clientId,
      variantOptions: variants,
      finance: f
        ? {
            deviceVariant: f.deviceVariant,
            totalNet: num(f.totalNet) ?? 0,
            baseNet: num(f.baseRentalPriceNet) ?? 0,
            pulseNet: num(f.pulseSurchargeNet),
            transportNet: num(f.transportPriceNet),
            transportSeparate: f.transportPaidSeparately,
            capUsed: f.capUsedHS,
            capCount: f.capCountHS,
            capFee: num(f.capFeeNet),
            membraneUsed: f.membraneUsed,
            membraneCount: f.membraneCount,
            membraneFee: num(f.membraneFeeNet),
          }
        : null,
    });
    if (issues.length) amounts.push({ rentalId: r.id, title: r.title, startsAt: r.startsAt.toISOString(), device: r.device.name, note: issues.join(" · ") });
    // Wydania na jutro bez adresu dostawy albo godziny.
    if (r.startsAt >= tomorrow && r.startsAt < dayAfter) {
      const missing = [!r.deliveryAddressId && !r.deliveryAddress?.trim() ? "brak adresu" : null, !r.deliveryTime ? "brak godziny" : null].filter(Boolean);
      if (missing.length) tomorrowItems.push({ rentalId: r.id, title: r.title, startsAt: r.startsAt.toISOString(), device: r.device.name, note: missing.join(" · ") });
    }
  }
  return [
    {
      key: "unassigned",
      label: "Bez klienta",
      items: unassigned.map((u) => ({ rentalId: u.id, title: u.title, startsAt: u.startsAt, device: u.deviceName, note: u.candidates[0] ? `kandydat: ${u.candidates[0].shortName ?? u.candidates[0].name} (${u.candidates[0].reason})` : "brak kandydata" })),
    },
    { key: "amounts", label: "Kwota / wariant", items: amounts },
    { key: "transport", label: "Transport do zatwierdzenia", items: transportItems },
    { key: "tomorrow", label: "Wydania jutro", items: tomorrowItems },
    { key: "invoices", label: "FV do wystawienia", items: fv.map((x) => ({ rentalId: x.rentalId, title: x.title, startsAt: x.startsAt, device: x.deviceName, note: `${x.clientName} · ${x.daysSinceEnd} dni po wynajmie` })) },
  ];
}

export async function countCalendarQueues(now = new Date()): Promise<number> {
  return (await loadCalendarQueues(now)).reduce((s, q) => s + q.items.length, 0);
}
