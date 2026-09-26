import { prisma } from "@/lib/prisma";
import { isQualified, type QualifyReason } from "@/lib/clients/qualification";

// Kwalifikacja klienta (prompt 2 v2, 1.0) — zapis przy akcjach i odczyt.
// Jednokierunkowa: pierwsze zdarzenie ustawia qualifiedAt, kolejne nic nie
// zmieniają; cofnąć może tylko ADMIN (unqualifyClient).

// Kwalifikacja działa dopiero po porządkowaniu bazy (backfill z podglądem) —
// wcześniej lista klientów wygląda jak dotąd, nikt z niej nie znika.
export const QUALIFICATION_ACTIVE_KEY = "clients_qualification_active";

export async function isQualificationActive(): Promise<boolean> {
  return (await prisma.setting.findUnique({ where: { key: QUALIFICATION_ACTIVE_KEY } }))?.value === "1";
}

export async function qualifyClient(clientId: string | null | undefined, reason: QualifyReason): Promise<boolean> {
  if (!clientId) return false;
  const res = await prisma.client.updateMany({ where: { id: clientId, qualifiedAt: null }, data: { qualifiedAt: new Date(), qualifiedReason: reason } });
  return res.count > 0;
}

export async function unqualifyClient(clientId: string, note: string) {
  await prisma.client.update({ where: { id: clientId }, data: { qualifiedAt: null, qualifiedReason: `COFNIĘTE: ${note}`.slice(0, 191) } });
}

const ASSIGNED = { matchState: { in: ["AUTO" as const, "CONFIRMED" as const] } };

// Zakwalifikowani wśród podanych klientów (flaga albo wynajem / historia /
// faktura). Przed włączeniem kwalifikacji — wszyscy.
export async function loadQualifiedMap(ids: string[]): Promise<Map<string, boolean>> {
  if (ids.length === 0) return new Map();
  const active = await isQualificationActive();
  if (!active) return new Map(ids.map((id) => [id, true]));
  const rows = await prisma.client.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      qualifiedAt: true,
      _count: { select: { rentals: true, history: { where: ASSIGNED }, invoices: { where: ASSIGNED } } },
    },
  });
  return new Map(
    rows.map((c) => [c.id, isQualified({ qualifiedAt: c.qualifiedAt, rentals: c._count.rentals, history: c._count.history, invoices: c._count.invoices }, true)]),
  );
}
