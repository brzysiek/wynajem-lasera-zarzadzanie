// Cel sezonu (wniosek 21, decyzja Tomka 29.09.2026): liczymy GABINETY, nie
// wynajmy. Czysty moduł (vitest bez aliasu "@/").
// - „Wracają z wiosny”: gabinet z listy zamrożonej 29.09 (bez rezerwacji na
//   jesień) — liczy się raz, przy pierwszej rezerwacji z terminem w sezonie;
// - „Nowe”: pierwszy przyjazd w historii (wniosek 20) — wynajem (nie
//   szkolenie) w sezonie, a wcześniej żadnego przyjazdu ani wynajmu w
//   kalendarzu (± 3 dni to ten sam przyjazd). Powracające spoza listy wiosny
//   i szkolenia się nie liczą.
// Kolejność (numer „6 z 20” w komunikacie „Brawo”) — wg chwili wpisania
// rezerwacji do kalendarza.

export const SPRING_LIST_KEY = "season_spring_list";
export const SPRING_REF_PREFIX = "wiosna:";

const DAY_MS = 86_400_000;
const ARRIVAL_GAP_MS = 3 * DAY_MS;

export type SeasonRental = { clientId: string; clientName: string; startsAt: Date; createdAt: Date; eventType: "WYNAJEM" | "SZKOLENIE"; deletedInGoogle: boolean; deviceName: string | null };

export type SeasonWin = { clientId: string; name: string; kind: "returning" | "new"; at: string; startsAt: string; device: string | null; no: number };

export type SpringOutcome = "BOOKED" | "TALKING" | "POSTPONED" | "LOST" | "DO_NOT_CONTACT" | "TODO";
export type SpringRow = { clientId: string; name: string; outcome: SpringOutcome; leadId: string | null; bookedAt: string | null };

// pool — gabinety z listy wiosny wciąż do odzyskania: bez rezerwacji, nie
// przegrane i bez „Nie kontaktować” (wniosek 21: przegrana / blokada wypada).
export type SeasonGoal = { returning: number; fresh: number; total: number; wins: SeasonWin[]; spring: SpringRow[]; pool: number };

export function seasonBounds(season: { from: string; to: string }): { from: Date; to: Date } {
  return { from: new Date(`${season.from}T00:00:00`), to: new Date(`${season.to}T23:59:59`) };
}

// `rentals` — wynajmy i szkolenia z kalendarza (panel) klientów, którzy mają
// coś w sezonie, także sprzed sezonu; `priorArrivals` — zrealizowane
// przyjazdy klienta z historii kalendarzy i faktur (status.ts / summary.ts).
export function computeSeasonGoal(input: {
  season: { from: string; to: string };
  springIds: string[];
  rentals: SeasonRental[];
  priorArrivals: Map<string, Date[]>;
}): Omit<SeasonGoal, "spring" | "pool"> {
  const { from, to } = seasonBounds(input.season);
  const spring = new Set(input.springIds);
  const live = input.rentals.filter((r) => r.eventType === "WYNAJEM" && !r.deletedInGoogle);
  const byClient = new Map<string, SeasonRental[]>();
  for (const r of live) byClient.set(r.clientId, [...(byClient.get(r.clientId) ?? []), r]);

  const found: Omit<SeasonWin, "no">[] = [];
  for (const [clientId, rs] of byClient) {
    const inSeason = rs.filter((r) => r.startsAt >= from && r.startsAt <= to).sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
    if (!inSeason.length) continue;
    const first = inSeason[0];
    const before = first.startsAt.getTime() - ARRIVAL_GAP_MS;
    let kind: SeasonWin["kind"] | null = null;
    if (spring.has(clientId)) kind = "returning";
    else {
      const earlierRental = rs.some((r) => r.startsAt.getTime() < before);
      const earlierArrival = (input.priorArrivals.get(clientId) ?? []).some((d) => d.getTime() < before);
      if (!earlierRental && !earlierArrival) kind = "new";
    }
    if (!kind) continue;
    // Chwila rezerwacji = najwcześniej wpisany do kalendarza wynajem sezonu.
    const booked = inSeason.reduce((a, b) => (b.createdAt < a.createdAt ? b : a));
    found.push({ clientId, name: first.clientName, kind, at: booked.createdAt.toISOString(), startsAt: first.startsAt.toISOString(), device: first.deviceName });
  }
  const wins = found.sort((a, b) => a.at.localeCompare(b.at)).map((w, i) => ({ ...w, no: i + 1 }));
  const returning = wins.filter((w) => w.kind === "returning").length;
  return { returning, fresh: wins.length - returning, total: wins.length, wins };
}

// Wynik gabinetu z listy wiosny (Raport → „Cel sezonu”): zarezerwowała /
// w rozmowie / odłożona / rezygnuje / do telefonu — z rezerwacji w sezonie
// albo etapu jego sygnału „wraca z wiosny”.
export function springOutcome(booked: boolean, lead: { stage: string; lastContactAt: Date | null } | null, doNotContact = false): SpringOutcome {
  if (booked) return "BOOKED";
  if (doNotContact) return "DO_NOT_CONTACT";
  if (!lead) return "TODO";
  if (lead.stage === "REZERWACJA" || lead.stage === "WYGRANA") return "BOOKED";
  if (lead.stage === "ODLOZONE") return "POSTPONED";
  if (lead.stage === "PRZEGRANA") return "LOST";
  return lead.lastContactAt ? "TALKING" : "TODO";
}

export const SPRING_OUTCOME_LABEL: Record<SpringOutcome, string> = {
  BOOKED: "zarezerwowała",
  TALKING: "w rozmowie",
  POSTPONED: "odłożona",
  LOST: "rezygnuje",
  DO_NOT_CONTACT: "nie kontaktować",
  TODO: "do telefonu",
};

// Zamrożona lista (Setting season_spring_list: {"frozenAt","clientIds"}).
export const inSpringPool = (o: SpringOutcome) => o === "TODO" || o === "TALKING" || o === "POSTPONED";

export function parseSpringList(raw: string | null | undefined): string[] {
  try {
    const v = JSON.parse(raw ?? "") as { clientIds?: unknown };
    return Array.isArray(v?.clientIds) ? v.clientIds.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}
