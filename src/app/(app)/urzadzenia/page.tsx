import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/page-header";
import { DevicesPanel } from "@/components/devices-panel";

export default async function DevicesPage() {
  const session = await auth();
  const isAdmin = session?.user.role === "ADMIN";

  const devices = await prisma.device.findMany({
    orderBy: { name: "asc" },
    include: {
      _count: { select: { rentals: true } },
      syncLogs: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });

  const UPCOMING_PER_DEVICE = 5;
  const now = new Date();
  const upcomingRentals = await prisma.rental.findMany({
    where: { deviceId: { in: devices.map((d) => d.id) }, deletedInGoogle: false, startsAt: { gte: now } },
    orderBy: { startsAt: "asc" },
    select: {
      id: true,
      deviceId: true,
      title: true,
      startsAt: true,
      endsAt: true,
      allDay: true,
      contactNameCache: true,
      contactCompanyCache: true,
    },
  });
  const upcomingByDevice = new Map<string, typeof upcomingRentals>();
  for (const rental of upcomingRentals) {
    const list = upcomingByDevice.get(rental.deviceId) ?? [];
    if (list.length < UPCOMING_PER_DEVICE) {
      list.push(rental);
      upcomingByDevice.set(rental.deviceId, list);
    }
  }

  const devicesData = devices.map((device) => ({
    id: device.id,
    name: device.name,
    shortName: device.shortName,
    color: device.color,
    googleCalendarId: device.googleCalendarId,
    active: device.active,
    rentalCount: device._count.rentals,
    lastSync: device.syncLogs[0]
      ? { status: device.syncLogs[0].status, createdAt: device.syncLogs[0].createdAt.toISOString() }
      : null,
    upcomingRentals: (upcomingByDevice.get(device.id) ?? []).map((rental) => ({
      id: rental.id,
      title: rental.title,
      startsAt: rental.startsAt.toISOString(),
      endsAt: rental.endsAt.toISOString(),
      allDay: rental.allDay,
      contactNameCache: rental.contactNameCache,
      contactCompanyCache: rental.contactCompanyCache,
    })),
  }));

  return (
    <div>
      <PageHeader title="Urządzenia" description="Rozwiń urządzenie, aby zobaczyć szczegóły, nadchodzące rezerwacje i zsynchronizować kalendarz." />
      <DevicesPanel devices={devicesData} isAdmin={isAdmin} />
    </div>
  );
}
