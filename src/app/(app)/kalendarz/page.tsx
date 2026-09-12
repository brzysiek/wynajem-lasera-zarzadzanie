import { cookies } from "next/headers";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { VIEW_COOKIE, actsAsDriver } from "@/lib/effective-role";
import { ALERT_WINDOW_DAYS, type RentalAlert, type RentalAlertField } from "@/lib/rental-alerts";
import { CalendarView } from "@/components/calendar-view";

export default async function CalendarPage() {
  const session = await auth();
  const viewCookie = (await cookies()).get(VIEW_COOKIE)?.value;
  const driverMode = actsAsDriver(session?.user.role, session?.user.canActAsDriver, viewCookie);

  // Ostrzeżenie dla admina: wynajmy z najbliższych ALERT_WINDOW_DAYS dni
  // (od dziś) bez przypisanego kierowcy / kontaktu / telefonu.
  const alerts = driverMode || session?.user.role !== "ADMIN" ? [] : await loadRentalAlerts();

  // Lista urządzeń do filtra nie jest już przekazywana tu jako prop —
  // CalendarView czyta ją (i zaznaczenie widoczności) ze współdzielonego
  // CalendarDeviceFilterProvider (AppShell), tak samo jak flyout "Kalendarze"
  // w lewym pasku nawigacji. Patrz src/components/calendar-device-filter-context.tsx.
  return <CalendarView canEdit={!driverMode} alerts={alerts} />;
}

async function loadRentalAlerts(): Promise<RentalAlert[]> {
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
