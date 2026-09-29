import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { loadClientStatuses } from "@/lib/clients/load";
import { normalizeTitle } from "@/lib/history/normalize-title";
import type { ClientStatus } from "@/lib/clients/status";
import { emailKey, nipKey, parseClientQuery, phoneKey } from "@/lib/clients/search-rules";

// Wyszukiwarka klienta przy rezerwacji (wniosek 23): nazwa, nazwa robocza,
// aliasy, osoba, telefon (po cyfrach), e-mail, NIP. Wynik z miastem,
// statusem i ostatnim wynajmem — żeby odróżnić osoby o podobnych nazwach.

export type ClientHit = {
  id: string;
  name: string;
  shortName: string | null;
  city: string | null;
  person: string | null;
  phone: string | null;
  email: string | null;
  status: ClientStatus | null;
  lastRentalAt: string | null;
};

function wordWhere(w: string): Prisma.ClientWhereInput {
  const alias = normalizeTitle(w).key;
  return {
    OR: [
      { name: { contains: w } },
      { shortName: { contains: w } },
      { city: { contains: w } },
      ...(alias ? [{ aliases: { some: { alias: { contains: alias } } } }] : []),
      { contacts: { some: { OR: [{ firstName: { contains: w } }, { lastName: { contains: w } }, { email: { contains: w } }] } } },
    ],
  };
}

export async function searchClients(q: string, limit = 10): Promise<ClientHit[]> {
  const { text, digits } = parseClientQuery(q);
  if (!text && !digits) return [];
  const where: Prisma.ClientWhereInput = digits
    ? { OR: [{ nip: { contains: digits } }, { contacts: { some: { OR: [{ phone: { contains: digits } }, { phone2: { contains: digits } }] } } }] }
    : { AND: text!.split(/\s+/).filter((w) => w.length >= 2).slice(0, 5).map(wordWhere) };
  const rows = await prisma.client.findMany({
    where: { archivedAt: null, ...where },
    take: limit,
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      shortName: true,
      city: true,
      contacts: { orderBy: { isPrimary: "desc" }, take: 1, select: { firstName: true, lastName: true, phone: true, email: true } },
      rentals: { where: { deletedInGoogle: false, startsAt: { lte: new Date() } }, orderBy: { startsAt: "desc" }, take: 1, select: { startsAt: true } },
    },
  });
  const statuses = await loadClientStatuses(rows.map((r) => r.id));
  return toHits(rows, statuses);
}

function toHits(
  rows: {
    id: string;
    name: string;
    shortName: string | null;
    city: string | null;
    contacts: { firstName: string | null; lastName: string | null; phone: string | null; email: string | null }[];
    rentals?: { startsAt: Date }[];
  }[],
  statuses: Map<string, ClientStatus>,
): ClientHit[] {
  return rows.map((r) => {
    const p = r.contacts[0];
    const person = p ? [p.firstName, p.lastName].filter(Boolean).join(" ") || null : null;
    return {
      id: r.id,
      name: r.name,
      shortName: r.shortName,
      city: r.city,
      person: person && person !== r.name ? person : null,
      phone: p?.phone ?? null,
      email: p?.email ?? null,
      status: statuses.get(r.id) ?? null,
      lastRentalAt: r.rentals?.[0]?.startsAt.toISOString() ?? null,
    };
  });
}

// „Czy to ta klientka?” — istniejący klienci z tym samym telefonem, e-mailem
// albo NIP-em (także w archiwum nie — tylko aktywni).
export async function findClientDuplicates(input: { phone?: string | null; email?: string | null; nip?: string | null }): Promise<ClientHit[]> {
  const ph = phoneKey(input.phone);
  const em = emailKey(input.email);
  const nip = nipKey(input.nip);
  const or: Prisma.ClientWhereInput[] = [];
  if (ph) or.push({ contacts: { some: { OR: [{ phone: { contains: ph } }, { phone2: { contains: ph } }] } } });
  if (em) or.push({ contacts: { some: { email: em } } });
  if (nip) or.push({ nip });
  if (!or.length) return [];
  const rows = await prisma.client.findMany({
    where: { archivedAt: null, OR: or },
    take: 5,
    select: {
      id: true,
      name: true,
      shortName: true,
      city: true,
      contacts: { orderBy: { isPrimary: "desc" }, take: 1, select: { firstName: true, lastName: true, phone: true, email: true } },
      rentals: { where: { deletedInGoogle: false, startsAt: { lte: new Date() } }, orderBy: { startsAt: "desc" }, take: 1, select: { startsAt: true } },
    },
  });
  return toHits(rows, await loadClientStatuses(rows.map((r) => r.id)));
}
