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

  const now = new Date();
  const nextRentals = await prisma.rental.findMany({
    where: { deviceId: { in: devices.map((d) => d.id) }, deletedInGoogle: false, startsAt: { gte: now } },
    orderBy: { startsAt: "asc" },
  });
  const nextRentalByDevice = new Map<string, (typeof nextRentals)[number]>();
  for (const rental of nextRentals) {
    if (!nextRentalByDevice.has(rental.deviceId)) nextRentalByDevice.set(rental.deviceId, rental);
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
    nextRental: nextRentalByDevice.has(device.id)
      ? {
          title: nextRentalByDevice.get(device.id)!.title,
          startsAt: nextRentalByDevice.get(device.id)!.startsAt.toISOString(),
        }
      : null,
  }));

  return (
    <div>
      <PageHeader title="Urządzenia" description="Lista urządzeń dostępnych do wynajmu i ich powiązanie z kalendarzami Google." />
      <DevicesPanel devices={devicesData} isAdmin={isAdmin} />
    </div>
  );
}
