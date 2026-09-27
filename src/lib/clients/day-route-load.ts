import { prisma } from "@/lib/prisma";
import { rentalTimeOf } from "@/lib/rental-title";
import { stopsForDay, type DayStop } from "@/lib/clients/day-route";

// Przystanki dnia dla mapy (etap 2): wynajmy i szkolenia, które tego dnia
// zaczynają się (dostawa) albo kończą (odbiór). Położenie = pinezka klientki
// (adres dostawy z paszportu albo firmy); adres z wynajmu tylko do opisu.
export async function loadDayStops(day: string): Promise<DayStop[]> {
  const d = new Date(`${day}T12:00:00.000Z`);
  const from = new Date(d.getTime() - 2 * 86_400_000);
  const to = new Date(d.getTime() + 2 * 86_400_000);
  const rows = await prisma.rental.findMany({
    where: { deletedInGoogle: false, OR: [{ startsAt: { gte: from, lte: to } }, { endsAt: { gte: from, lte: to } }] },
    select: {
      id: true,
      title: true,
      startsAt: true,
      endsAt: true,
      deliveryTime: true,
      pickupTime: true,
      deliveryAddress: true,
      device: { select: { name: true } },
      driver: { select: { name: true } },
      client: { select: { id: true, name: true, shortName: true, lat: true, lng: true } },
    },
  });
  return stopsForDay(
    rows.map((r) => ({
      id: r.id,
      title: r.title.replace(/^\d{1,2}[:.]\d{2}\s+/, ""),
      startsAt: r.startsAt,
      endsAt: r.endsAt,
      deliveryTime: rentalTimeOf(r),
      pickupTime: r.pickupTime?.trim().match(/^\d{1,2}[:.]\d{2}$/) ? r.pickupTime.trim().replace(".", ":").padStart(5, "0") : null,
      deviceName: r.device.name,
      driverName: r.driver?.name ?? null,
      clientId: r.client?.id ?? null,
      clientName: r.client ? (r.client.shortName ?? r.client.name) : null,
      geo: r.client?.lat != null && r.client?.lng != null ? { lat: r.client.lat, lng: r.client.lng } : null,
      address: r.deliveryAddress,
    })),
    day,
  );
}
