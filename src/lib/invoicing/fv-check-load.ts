import { prisma } from "@/lib/prisma";
import { daysSince, suggestInvoices, FV_MATCH_WINDOW_DAYS, type FvSuggestion } from "@/lib/invoicing/fv-check";

// Lista „FV bez faktury” (Finanse → Faktury VAT, GET /api/rentals/fv-bez-faktury).
// Reguła — patrz src/lib/invoicing/fv-check.ts. Bez dolnego progu daty
// (w odróżnieniu od alertów w kalendarzu): tu widać też wynajmy, których
// faktury wystawiano ręcznie w Fakturowni — z podpowiedzią, która to faktura.

export type FvWithoutInvoiceRow = {
  rentalId: string;
  title: string;
  startsAt: string;
  endsAt: string;
  daysSinceEnd: number;
  clientId: string | null;
  clientName: string;
  nip: string | null;
  deviceName: string;
  totalGross: string;
  paymentMethod: "CASH" | "TRANSFER";
  suggestions: FvSuggestion[];
};

const DAY = 24 * 60 * 60 * 1000;

export async function loadFvWithoutInvoice(now = new Date()): Promise<FvWithoutInvoiceRow[]> {
  const rentals = await prisma.rental.findMany({
    where: {
      deletedInGoogle: false,
      endsAt: { lt: now },
      finance: { vatApplicable: true, fakturowniaInvoiceId: null },
    },
    orderBy: { endsAt: "desc" },
    select: {
      id: true,
      title: true,
      startsAt: true,
      endsAt: true,
      clientId: true,
      contactNipCache: true,
      contactCompanyCache: true,
      contactNameCache: true,
      client: { select: { name: true, nip: true } },
      device: { select: { name: true } },
      finance: { select: { totalGross: true, paymentMethod: true } },
    },
  });
  if (rentals.length === 0) return [];

  const linked = await prisma.clientInvoice.findMany({
    where: { rentalId: { in: rentals.map((r) => r.id) } },
    select: { rentalId: true },
  });
  const linkedIds = new Set(linked.map((l) => l.rentalId));
  const open = rentals.filter((r) => !linkedIds.has(r.id));
  if (open.length === 0) return [];

  const clientIds = [...new Set(open.map((r) => r.clientId).filter((id): id is string => !!id))];
  const nips = [...new Set(open.map((r) => r.client?.nip ?? r.contactNipCache).filter((n): n is string => !!n))];
  const minStart = Math.min(...open.map((r) => r.startsAt.getTime())) - FV_MATCH_WINDOW_DAYS * DAY;
  const maxEnd = Math.max(...open.map((r) => r.endsAt.getTime())) + FV_MATCH_WINDOW_DAYS * DAY;
  const invoices = await prisma.clientInvoice.findMany({
    where: {
      rentalId: null,
      sellDate: { gte: new Date(minStart), lte: new Date(maxEnd) },
      OR: [...(clientIds.length ? [{ clientId: { in: clientIds } }] : []), ...(nips.length ? [{ buyerTaxNo: { in: nips } }] : [])],
    },
    select: { id: true, number: true, sellDate: true, buyerName: true, buyerTaxNo: true, clientId: true, totalGross: true, positionsSummary: true },
  });
  const candidates = invoices.map((i) => ({ ...i, totalGross: i.totalGross.toString() }));

  return open.map((r) => {
    const nip = r.client?.nip ?? r.contactNipCache ?? null;
    return {
      rentalId: r.id,
      title: r.title,
      startsAt: r.startsAt.toISOString(),
      endsAt: r.endsAt.toISOString(),
      daysSinceEnd: daysSince(r.endsAt, now),
      clientId: r.clientId,
      clientName: r.client?.name ?? r.contactCompanyCache ?? r.contactNameCache ?? r.title,
      nip,
      deviceName: r.device.name,
      totalGross: r.finance?.totalGross.toString() ?? "0",
      paymentMethod: r.finance?.paymentMethod ?? "TRANSFER",
      suggestions: candidates.length
        ? suggestInvoices({ startsAt: r.startsAt, endsAt: r.endsAt, clientId: r.clientId, nip, deviceName: r.device.name }, candidates)
        : [],
    };
  });
}
