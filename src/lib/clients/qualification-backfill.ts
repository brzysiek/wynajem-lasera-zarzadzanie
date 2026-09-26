import { prisma } from "@/lib/prisma";
import { fetchAllDeals, fetchAssociationCounts } from "@/lib/integrations/hubspot-deals";
import { parseDealName } from "@/lib/leads/parse-deal";
import { QUALIFICATION_ACTIVE_KEY } from "@/lib/clients/qualify";

// Porządkowanie bazy klientów (prompt 2 v2, 1.0 „Backfill”): kto jest
// klientem (był kontakt), a kto tylko kontaktem z zapytania. Podgląd →
// świadome włączenie przez ADMINA. Z HubSpota tylko odczyt.

// Etapy „dalsze niż Sygnał” w lejku „Proces sprzedaży”.
const BEYOND_SIGNAL = new Set(["appointmentscheduled", "qualifiedtobuy", "presentationscheduled", "closedwon", "closedlost"]);

type Reason = "flag" | "rental" | "history" | "invoice" | "hubspotStage" | "hubspotNotes" | "hubspotCalls" | "panelCall" | "gmail";
export const REASON_LABEL: Record<Reason, string> = {
  flag: "już zakwalifikowani",
  rental: "wynajem w panelu",
  history: "historia z kalendarza",
  invoice: "faktura",
  hubspotStage: "transakcja HubSpot dalej niż „Sygnał”",
  hubspotNotes: "notatka w HubSpot",
  hubspotCalls: "rozmowa w HubSpot",
  panelCall: "rozmowa / odpowiedź zapisana w panelu",
  gmail: "e-mail wysłany do klienta (Gmail)",
};
// Te powody nie wymagają zapisu flagi — liczone zawsze przy odczycie.
const DERIVED: Reason[] = ["rental", "history", "invoice"];

type Evaluated = { id: string; name: string; city: string | null; reason: Reason | null };

async function evaluate(): Promise<{ rows: Evaluated[]; callsReadable: boolean; notesReadable: boolean }> {
  const assigned = { matchState: { in: ["AUTO" as const, "CONFIRMED" as const] } };
  const clients = await prisma.client.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      city: true,
      qualifiedAt: true,
      contacts: { select: { hubspotContactId: true, email: true } },
      _count: { select: { rentals: true, history: { where: assigned }, invoices: { where: assigned } } },
    },
  });

  // Transakcje HubSpot → klient (powiązany kontakt albo e-mail z nazwy).
  const byHs = new Map<string, string>();
  const byEmail = new Map<string, string>();
  for (const c of clients) {
    for (const p of c.contacts) {
      if (p.hubspotContactId) byHs.set(p.hubspotContactId, c.id);
      if (p.email) byEmail.set(p.email.toLowerCase(), c.id);
    }
  }
  const deals = await fetchAllDeals();
  const stageHit = new Set<string>();
  const dealClient = new Map<string, string>();
  for (const d of deals) {
    const clientId = d.contactIds.map((id) => byHs.get(id)).find(Boolean) ?? (() => {
      const e = parseDealName(d.properties.dealname ?? "").email;
      return e ? byEmail.get(e) : undefined;
    })();
    if (!clientId) continue;
    dealClient.set(d.id, clientId);
    if ((d.properties.pipeline ?? "default") === "default" && BEYOND_SIGNAL.has(d.properties.dealstage ?? "")) stageHit.add(clientId);
  }

  // Notatki i rozmowy w HubSpot — przy kontakcie albo przy jego transakcji.
  const noteHit = new Set<string>();
  const callHit = new Set<string>();
  let notesReadable = true;
  let callsReadable = true;
  const contactIds = [...byHs.keys()];
  const dealIds = [...dealClient.keys()];
  const collect = async (to: "notes" | "calls", hit: Set<string>) => {
    const [c, d] = await Promise.all([fetchAssociationCounts("contacts", contactIds, to), fetchAssociationCounts("deals", dealIds, to)]);
    for (const [id, n] of c) if (n > 0 && byHs.get(id)) hit.add(byHs.get(id)!);
    for (const [id, n] of d) if (n > 0 && dealClient.get(id)) hit.add(dealClient.get(id)!);
  };
  await collect("notes", noteHit).catch(() => (notesReadable = false));
  await collect("calls", callHit).catch(() => (callsReadable = false));

  const [panelCalls, gmailOut] = await Promise.all([
    prisma.leadActivity.findMany({ where: { type: { in: ["CALL", "EMAIL"] } }, select: { clientId: true, lead: { select: { clientId: true } } } }),
    prisma.emailMessage.groupBy({ by: ["clientId"], where: { direction: "OUT", clientId: { not: null } } }),
  ]);
  const panelHit = new Set(panelCalls.map((a) => a.clientId ?? a.lead?.clientId).filter((x): x is string => Boolean(x)));
  const gmailHit = new Set(gmailOut.map((g) => g.clientId as string));

  const rows = clients.map((c) => {
    const reason: Reason | null = c.qualifiedAt
      ? "flag"
      : c._count.rentals
        ? "rental"
        : c._count.history
          ? "history"
          : c._count.invoices
            ? "invoice"
            : stageHit.has(c.id)
              ? "hubspotStage"
              : callHit.has(c.id)
                ? "hubspotCalls"
                : noteHit.has(c.id)
                  ? "hubspotNotes"
                  : panelHit.has(c.id)
                    ? "panelCall"
                    : gmailHit.has(c.id)
                      ? "gmail"
                      : null;
    return { id: c.id, name: c.name, city: c.city, reason };
  });
  return { rows, callsReadable, notesReadable };
}

export type QualificationPreview = {
  active: boolean;
  qualified: number;
  unqualified: number;
  byReason: { reason: string; count: number }[];
  qualifiedExamples: { name: string; city: string | null; reason: string }[];
  unqualifiedExamples: { name: string; city: string | null }[];
  callsReadable: boolean;
  notesReadable: boolean;
};

function sample<T>(list: T[], n: number): T[] {
  if (list.length <= n) return list;
  const step = list.length / n;
  return Array.from({ length: n }, (_, i) => list[Math.floor(i * step)]);
}

export async function previewQualification(): Promise<QualificationPreview> {
  const { rows, callsReadable, notesReadable } = await evaluate();
  const q = rows.filter((r) => r.reason);
  const u = rows.filter((r) => !r.reason);
  const counts = new Map<Reason, number>();
  for (const r of q) counts.set(r.reason!, (counts.get(r.reason!) ?? 0) + 1);
  return {
    active: (await prisma.setting.findUnique({ where: { key: QUALIFICATION_ACTIVE_KEY } }))?.value === "1",
    qualified: q.length,
    unqualified: u.length,
    byReason: [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([r, count]) => ({ reason: REASON_LABEL[r], count })),
    qualifiedExamples: sample(q, 20).map((r) => ({ name: r.name, city: r.city, reason: REASON_LABEL[r.reason!] })),
    unqualifiedExamples: sample(u, 20).map((r) => ({ name: r.name, city: r.city })),
    callsReadable,
    notesReadable,
  };
}

export async function applyQualification(): Promise<{ flagged: number }> {
  const { rows } = await evaluate();
  const toFlag = rows.filter((r) => r.reason && r.reason !== "flag" && !DERIVED.includes(r.reason));
  let flagged = 0;
  const now = new Date();
  for (const r of toFlag) {
    const res = await prisma.client.updateMany({
      where: { id: r.id, qualifiedAt: null },
      data: { qualifiedAt: now, qualifiedReason: r.reason === "gmail" ? "EMAIL_REPLY" : r.reason === "panelCall" ? "CALL" : "BACKFILL" },
    });
    flagged += res.count;
  }
  await prisma.setting.upsert({ where: { key: QUALIFICATION_ACTIVE_KEY }, create: { key: QUALIFICATION_ACTIVE_KEY, value: "1" }, update: { value: "1" } });
  return { flagged };
}
