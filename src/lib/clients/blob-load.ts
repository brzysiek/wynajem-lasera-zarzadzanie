import { prisma } from "@/lib/prisma";
import { SUSPECT_SCORE, blobScore } from "@/lib/clients/blob-detect";

// Lista podejrzanych zlepków (Porządki → Propozycje, API agenta, MCP
// podejrzane_zlepki) — od najbardziej podejrzanych. Tylko odczyt.
export type SuspectedBlob = { clientId: string; name: string; city: string | null; contacts: number; rentals: number; score: number; reasons: string[] };

export async function listSuspectedBlobs(): Promise<SuspectedBlob[]> {
  const clients = await prisma.client.findMany({
    where: { archivedAt: null },
    select: {
      id: true,
      name: true,
      city: true,
      nip: true,
      hubspotCompanyId: true,
      contacts: { select: { firstName: true, lastName: true, email: true } },
      invoices: { select: { buyerTaxNo: true } },
      _count: { select: { rentals: true } },
    },
  });
  return clients
    .map((c) => {
      const r = blobScore({
        name: c.name,
        nip: c.nip,
        hubspotCompanyId: c.hubspotCompanyId,
        contacts: c.contacts,
        invoiceNips: c.invoices.map((i) => i.buyerTaxNo).filter((x): x is string => !!x),
      });
      return { clientId: c.id, name: c.name, city: c.city, contacts: c.contacts.length, rentals: c._count.rentals, score: r.score, reasons: r.reasons };
    })
    .filter((b) => b.score >= SUSPECT_SCORE)
    .sort((a, b) => b.score - a.score);
}
