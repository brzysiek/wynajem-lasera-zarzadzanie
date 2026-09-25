import { prisma } from "@/lib/prisma";
import type { MatchCandidate, MatchMethod, MatchState } from "@/lib/history/match";

// Dane ekranu /klienci/dopasowania (prompt 3, 2.4). Wydarzeń jest ~1,5 tys.,
// klientów < 1000 — całość idzie do przeglądarki jednym zapytaniem, a
// zakładki, wyszukiwanie i sortowanie działają lokalnie.

export type ReviewGroup = {
  id: string;
  key: string;
  state: MatchState;
  // Oryginalne zapisy tytułu (od najczęstszego) — pierwszy jest nagłówkiem grupy.
  titles: { title: string; count: number }[];
  count: number;
  firstAt: string;
  lastAt: string;
  devices: string[];
  trainings: number;
  other: boolean; // tytuł rozpoznany jako serwis / blokada / FV
  clientId: string | null;
  method: MatchMethod | null;
  score: number | null;
  candidates: MatchCandidate[];
  manual: boolean; // decyzja biura (można cofnąć)
  events: { id: string; at: string; deviceName: string; title: string }[];
};

export type ReviewClient = { id: string; name: string; city: string | null; person: string | null };

export type ReviewData = {
  groups: ReviewGroup[];
  clients: ReviewClient[];
  totals: { events: number; relevant: number; assigned: number };
};

export async function loadHistoryReview(): Promise<ReviewData> {
  const [rows, clients] = await Promise.all([
    prisma.rentalHistory.findMany({
      orderBy: { startsAt: "desc" },
      select: {
        id: true,
        title: true,
        titleKey: true,
        kind: true,
        startsAt: true,
        clientId: true,
        matchState: true,
        matchMethod: true,
        matchScore: true,
        matchedByUserId: true,
        candidates: true,
        device: { select: { name: true } },
      },
    }),
    prisma.client.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        city: true,
        contacts: { select: { firstName: true, lastName: true }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }], take: 1 },
      },
    }),
  ]);

  const groups = new Map<string, ReviewGroup & { titleCounts: Map<string, number>; deviceSet: Set<string> }>();
  for (const r of rows) {
    // AUTO/CONFIRMED rozdzielone też po kliencie — ten sam tytuł może trafić
    // do dwóch klientów (np. inny telefon w opisie).
    const id = `${r.matchState}|${r.titleKey}|${r.clientId ?? ""}`;
    let g = groups.get(id);
    if (!g) {
      g = {
        id,
        key: r.titleKey,
        state: r.matchState,
        titles: [],
        titleCounts: new Map(),
        deviceSet: new Set(),
        count: 0,
        firstAt: r.startsAt.toISOString(),
        lastAt: r.startsAt.toISOString(),
        devices: [],
        trainings: 0,
        other: false,
        clientId: r.clientId,
        method: r.matchMethod,
        score: r.matchScore,
        candidates: Array.isArray(r.candidates) ? (r.candidates as MatchCandidate[]) : [],
        manual: false,
        events: [],
      };
      groups.set(id, g);
    }
    g.count++;
    g.titleCounts.set(r.title, (g.titleCounts.get(r.title) ?? 0) + 1);
    g.deviceSet.add(r.device.name);
    if (r.kind === "SZKOLENIE") g.trainings++;
    if (r.kind === "INNE") g.other = true;
    if (r.matchedByUserId) g.manual = true;
    const at = r.startsAt.toISOString();
    if (at < g.firstAt) g.firstAt = at;
    if (at > g.lastAt) g.lastAt = at;
    g.events.push({ id: r.id, at, deviceName: r.device.name, title: r.title });
  }

  const relevant = rows.filter((r) => r.matchState !== "IGNORED").length;
  const assigned = rows.filter((r) => r.matchState === "AUTO" || r.matchState === "CONFIRMED").length;

  return {
    groups: [...groups.values()].map(({ titleCounts, deviceSet, ...g }) => ({
      ...g,
      titles: [...titleCounts.entries()].sort((a, b) => b[1] - a[1]).map(([title, count]) => ({ title, count })),
      devices: [...deviceSet],
    })),
    clients: clients.map((c) => {
      const p = c.contacts[0];
      const person = p ? [p.firstName, p.lastName].filter(Boolean).join(" ") || null : null;
      return { id: c.id, name: c.name, city: c.city, person: person && person !== c.name ? person : null };
    }),
    totals: { events: rows.length, relevant, assigned },
  };
}

// Ile wydarzeń z historii kalendarzy czeka na decyzję biura (licznik przy
// przycisku „Dopasowania historii” na liście klientów).
export async function countPendingHistory(): Promise<number> {
  return prisma.rentalHistory.count({ where: { matchState: { in: ["SUGGESTED", "UNMATCHED"] } } });
}
