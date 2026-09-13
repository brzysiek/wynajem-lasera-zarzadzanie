import { prisma } from "@/lib/prisma";
import { ALERT_WINDOW_DAYS, type RentalAlert, type RentalAlertField } from "@/lib/rental-alerts";

// Serwerowa (Prisma) część modelu ostrzeżeń — src/lib/rental-alerts.ts ma tylko
// typy/etykiety i jest client-safe. Wyodrębnione z kalendarz/page.tsx, bo dziś
// odpytuje to też GET /api/rentals/alerts (pasek ikon — src/components/notifications-context.tsx),
// nie tylko sama strona kalendarza.
export async function loadRentalAlerts(): Promise<RentalAlert[]> {
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  const to = new Date(from);
  to.setDate(to.getDate() + ALERT_WINDOW_DAYS);
  to.setHours(23, 59, 59, 999);

  const rows = await prisma.rental.findMany({
    where: {
      // Wynajmy skasowane w Google Calendar zostają w bazie oznaczone
      // deletedInGoogle=true (historia SMS/przypomnień) — nie licz ich do
      // ostrzeżeń, tak samo jak nie pokazuje ich siatka kalendarza.
      deletedInGoogle: false,
      startsAt: { gte: from, lte: to },
      OR: [
        { driverId: null },
        { contactNameCache: null },
        { contactNameCache: "" },
        { contactPhoneCache: null },
        { contactPhoneCache: "" },
      ],
    },
    orderBy: { startsAt: "asc" },
    select: {
      id: true,
      title: true,
      startsAt: true,
      driverId: true,
      contactNameCache: true,
      contactPhoneCache: true,
      device: { select: { name: true, color: true } },
    },
  });

  return rows
    .map((r): RentalAlert => {
      const missing: RentalAlertField[] = [];
      if (!r.driverId) missing.push("driver");
      if (!r.contactNameCache?.trim()) missing.push("contact");
      if (!r.contactPhoneCache?.trim()) missing.push("phone");
      return {
        id: r.id,
        title: r.title,
        startsAt: r.startsAt.toISOString(),
        deviceName: r.device.name,
        deviceColor: r.device.color,
        missing,
      };
    })
    .filter((a) => a.missing.length > 0);
}
