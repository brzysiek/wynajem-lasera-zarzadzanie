import { prisma } from "@/lib/prisma";
import { clientCacheFields, contactCacheFields } from "@/lib/clients/cache";

// Spec 3.5: po zmianie danych klienta/osoby w panelu odśwież dane kontaktu
// na PRZYSZŁYCH wynajmach (startsAt >= dziś, strefa serwera = Warszawa).
// Przeszłych NIE ruszamy — faktury i historia mają pokazywać dane z tamtego
// dnia. Wywołujący przekazuje tylko te grupy, w których COŚ się zmieniło,
// więc edycja np. samej notatki nie dotyka wynajmów w ogóle.
// Zwraca liczbę zaktualizowanych wynajmów (komunikat w UI).
export async function refreshFutureRentalCaches(opts: {
  clientId: string;
  clientFields?: boolean;
  contactId?: string;
}): Promise<number> {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const future = { startsAt: { gte: startOfToday }, deletedInGoogle: false };
  const touched = new Set<string>();

  if (opts.clientFields) {
    const client = await prisma.client.findUnique({ where: { id: opts.clientId } });
    if (client) {
      const where = { clientId: opts.clientId, ...future };
      const ids = await prisma.rental.findMany({ where, select: { id: true } });
      if (ids.length) {
        await prisma.rental.updateMany({ where, data: clientCacheFields(client) });
        ids.forEach((r) => touched.add(r.id));
      }
    }
  }

  if (opts.contactId) {
    const contact = await prisma.clientContact.findUnique({ where: { id: opts.contactId } });
    if (contact) {
      const where = { clientContactId: opts.contactId, ...future };
      const ids = await prisma.rental.findMany({ where, select: { id: true } });
      if (ids.length) {
        await prisma.rental.updateMany({ where, data: contactCacheFields(contact) });
        ids.forEach((r) => touched.add(r.id));
      }
    }
  }

  return touched.size;
}

// Pola klienta, które trafiają do danych kontaktu na wynajmie.
export const CLIENT_CACHE_KEYS = ["name", "street", "zip", "city", "country", "nip", "transportPriceNet"] as const;
// Pola osoby, które trafiają do danych kontaktu na wynajmie.
export const CONTACT_CACHE_KEYS = ["firstName", "lastName", "phone", "email"] as const;
