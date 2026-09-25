import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { normalizePolishPhone } from "@/lib/reminders";
import { listCalendarEvents } from "@/lib/integrations/google-calendar";
import { SYNC_PAST_DAYS } from "@/lib/device-sync";
import { extractSignals, normalizeTitle, type HistoryKind } from "@/lib/history/normalize-title";
import { buildMatcher, type MatchCandidate, type MatchMethod, type MatchState } from "@/lib/history/match";

// Historia wynajmów z kalendarzy urządzeń (CRM, prompt 3A). Wydarzenia sprzed
// okna synchronizacji (device-sync.ts pobiera 30 dni wstecz) trafiają do
// OSOBNEJ tabeli rental_history — nigdy do rentals, więc nie uruchamiają
// przypomnień SMS, alertów, zadań kierowcy i nie zmieniają przychodów.
// Z Kalendarza Google wyłącznie odczyt.
//
// Idempotentny: klucz (googleCalendarId, googleEventId). Wydarzenia, które
// już są w rentals, są pomijane. Decyzje biura (matchedByUserId) nigdy nie są
// nadpisywane — przeliczane są tylko dopasowania automatyczne.

const DAY_MS = 86_400_000;
const HISTORY_FROM = new Date("2015-01-01T00:00:00Z");

type HistoricalEvent = {
  deviceId: string;
  deviceName: string;
  googleCalendarId: string;
  googleEventId: string;
  title: string;
  description: string | null;
  startsAt: Date;
  endsAt: Date;
};

export type Classification = {
  kind: HistoryKind;
  titleKey: string;
  clientId: string | null;
  matchMethod: MatchMethod | null;
  matchState: MatchState;
  matchScore: number | null;
  candidates: MatchCandidate[];
};

export function historyWindowEnd(now = new Date()): Date {
  return new Date(now.getTime() - SYNC_PAST_DAYS * DAY_MS);
}

async function fetchHistoricalEvents(now = new Date()) {
  const devices = await prisma.device.findMany({ select: { id: true, name: true, googleCalendarId: true }, orderBy: { name: "asc" } });
  const until = historyWindowEnd(now);
  const events: HistoricalEvent[] = [];
  const errors: { deviceName: string; message: string }[] = [];
  const seen = new Set<string>();

  for (const d of devices) {
    try {
      for (const e of await listCalendarEvents(d.googleCalendarId, HISTORY_FROM, until)) {
        const k = `${d.googleCalendarId}|${e.id}`;
        if (seen.has(k)) continue; // dwa urządzenia na jednym kalendarzu
        seen.add(k);
        events.push({
          deviceId: d.id,
          deviceName: d.name,
          googleCalendarId: d.googleCalendarId,
          googleEventId: e.id,
          title: e.title.slice(0, 191),
          description: e.description,
          startsAt: e.startsAt,
          endsAt: e.endsAt,
        });
      }
    } catch (err) {
      errors.push({ deviceName: d.name, message: err instanceof Error ? err.message : String(err) });
    }
  }

  const inRental = await prisma.rental.findMany({ select: { googleCalendarId: true, googleEventId: true } });
  const rentalKeys = new Set(inRental.map((r) => `${r.googleCalendarId}|${r.googleEventId}`));
  const fresh = events.filter((e) => !rentalKeys.has(`${e.googleCalendarId}|${e.googleEventId}`));
  return { events: fresh, skippedInRental: events.length - fresh.length, errors, deviceNames: devices.map((d) => d.name) };
}

// Dopasowanie liczone raz na klucz tytułu — opis z telefonem / e-mailem /
// NIP-em (rzadki) liczony osobno, bo to najmocniejszy sygnał.
// Słowo występujące w tylu RÓŻNYCH tytułach (i nienależące do żadnego
// klienta) to szum wpisywany przez biuro („razem”, „okulary”, „nowa”…).
const NOISE_MIN_KEYS = 5;

export async function loadClassifier() {
  const [clients, aliases, keys, ignored] = await Promise.all([
    prisma.client.findMany({
      select: {
        id: true,
        name: true,
        city: true,
        nip: true,
        contacts: { select: { firstName: true, lastName: true, phone: true, email: true } },
      },
    }),
    prisma.clientAlias.findMany({ select: { alias: true, clientId: true } }),
    prisma.rentalHistory.findMany({ distinct: ["titleKey"], select: { titleKey: true } }),
    // Tytuły, które biuro świadomie pominęło — nowe wydarzenia z tym samym
    // tytułem też są pomijane.
    prisma.rentalHistory.findMany({ where: { matchState: "IGNORED", matchedByUserId: { not: null } }, distinct: ["titleKey"], select: { titleKey: true } }),
  ]);
  const tokenKeys = new Map<string, number>();
  for (const { titleKey } of keys) for (const t of new Set(titleKey.split(" ").filter(Boolean))) tokenKeys.set(t, (tokenKeys.get(t) ?? 0) + 1);
  const noise = new Set([...tokenKeys].filter(([, n]) => n >= NOISE_MIN_KEYS).map(([t]) => t));
  const ignoredKeys = new Set(ignored.map((r) => r.titleKey).filter(Boolean));
  const match = buildMatcher(clients, new Map(aliases.map((a) => [a.alias, a.clientId])), normalizePolishPhone, undefined, noise);
  const byKey = new Map<string, ReturnType<typeof match>>();

  return function classify(title: string, description: string | null): Classification {
    const n = normalizeTitle(title);
    if (n.kind === "INNE") {
      return { kind: n.kind, titleKey: n.key, clientId: null, matchMethod: null, matchState: "IGNORED", matchScore: null, candidates: [] };
    }
    if (ignoredKeys.has(n.key)) {
      return { kind: n.kind, titleKey: n.key, clientId: null, matchMethod: null, matchState: "IGNORED", matchScore: null, candidates: [] };
    }
    const signals = extractSignals(`${title}\n${description ?? ""}`, normalizePolishPhone);
    const hasSignals = signals.phones.length + signals.emails.length + signals.nips.length > 0;
    let r = hasSignals ? match(n.key, signals) : byKey.get(n.key);
    if (!r) {
      r = match(n.key);
      byKey.set(n.key, r);
    }
    return {
      kind: n.kind,
      titleKey: n.key,
      clientId: r.clientId,
      matchMethod: r.method,
      matchState: r.state,
      matchScore: r.score,
      candidates: r.candidates,
    };
  };
}

export type CalendarHistoryPreview = {
  total: number;
  alreadyImported: number;
  toImport: number;
  skippedInRental: number;
  years: string[];
  byDevice: { deviceName: string; total: number; perYear: Record<string, number> }[];
  byKind: Record<HistoryKind, number>;
  byState: Record<MatchState, number>;
  groups: number;
  sampleAuto: { title: string; clientName: string; method: MatchMethod | null }[];
  errors: { deviceName: string; message: string }[];
};

export async function previewCalendarHistory(): Promise<CalendarHistoryPreview> {
  const { events, skippedInRental, errors } = await fetchHistoricalEvents();
  const existing = await prisma.rentalHistory.findMany({ select: { googleCalendarId: true, googleEventId: true } });
  const existingKeys = new Set(existing.map((r) => `${r.googleCalendarId}|${r.googleEventId}`));
  const classify = await loadClassifier();

  const byDevice = new Map<string, { total: number; perYear: Record<string, number> }>();
  const years = new Set<string>();
  const byKind: Record<HistoryKind, number> = { WYNAJEM: 0, SZKOLENIE: 0, INNE: 0 };
  const byState: Record<MatchState, number> = { AUTO: 0, SUGGESTED: 0, CONFIRMED: 0, IGNORED: 0, UNMATCHED: 0 };
  const keys = new Set<string>();
  const autoSample: { title: string; clientId: string; method: MatchMethod | null }[] = [];

  for (const e of events) {
    const year = String(e.startsAt.getFullYear());
    years.add(year);
    const d = byDevice.get(e.deviceName) ?? { total: 0, perYear: {} };
    d.total++;
    d.perYear[year] = (d.perYear[year] ?? 0) + 1;
    byDevice.set(e.deviceName, d);

    const c = classify(e.title, e.description);
    byKind[c.kind]++;
    byState[c.matchState]++;
    if (c.kind !== "INNE") keys.add(c.titleKey);
    if (c.clientId && autoSample.length < 12 && !autoSample.some((s) => s.clientId === c.clientId)) {
      autoSample.push({ title: e.title, clientId: c.clientId, method: c.matchMethod });
    }
  }

  const names = new Map(
    (await prisma.client.findMany({ where: { id: { in: autoSample.map((s) => s.clientId) } }, select: { id: true, name: true } })).map((c) => [
      c.id,
      c.name,
    ]),
  );

  return {
    total: events.length,
    alreadyImported: events.filter((e) => existingKeys.has(`${e.googleCalendarId}|${e.googleEventId}`)).length,
    toImport: events.filter((e) => !existingKeys.has(`${e.googleCalendarId}|${e.googleEventId}`)).length,
    skippedInRental,
    years: [...years].sort(),
    byDevice: [...byDevice.entries()].map(([deviceName, v]) => ({ deviceName, ...v })),
    byKind,
    byState,
    groups: keys.size,
    sampleAuto: autoSample.map((s) => ({ title: s.title, clientName: names.get(s.clientId) ?? "?", method: s.method })),
    errors,
  };
}

function toData(c: Classification) {
  return {
    kind: c.kind,
    titleKey: c.titleKey,
    clientId: c.clientId,
    matchMethod: c.matchMethod,
    matchState: c.matchState,
    matchScore: c.matchScore,
    candidates: c.candidates.length ? (c.candidates as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
  };
}

export async function importCalendarHistory(): Promise<{
  created: number;
  rematched: number;
  skippedInRental: number;
  errors: { deviceName: string; message: string }[];
}> {
  const { events, skippedInRental, errors } = await fetchHistoricalEvents();
  const existing = await prisma.rentalHistory.findMany({ select: { googleCalendarId: true, googleEventId: true } });
  const existingKeys = new Set(existing.map((r) => `${r.googleCalendarId}|${r.googleEventId}`));
  const classify = await loadClassifier();

  const rows = events
    .filter((e) => !existingKeys.has(`${e.googleCalendarId}|${e.googleEventId}`))
    .map((e) => ({
      deviceId: e.deviceId,
      googleCalendarId: e.googleCalendarId,
      googleEventId: e.googleEventId,
      title: e.title,
      description: e.description,
      startsAt: e.startsAt,
      endsAt: e.endsAt,
      ...toData(classify(e.title, e.description)),
    }));

  let created = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const res = await prisma.rentalHistory.createMany({ data: rows.slice(i, i + 200), skipDuplicates: true });
    created += res.count;
  }

  const rematched = await rematchHistory();
  return { created, rematched, skippedInRental, errors };
}

// Przelicza dopasowania automatyczne (np. po imporcie klientów z HubSpota,
// dodaniu osoby kontaktowej albo nowym aliasie). Wiersze, o których
// zdecydowało biuro (matchedByUserId), zostają nietknięte.
export async function rematchHistory(): Promise<number> {
  const rows = await prisma.rentalHistory.findMany({
    where: { matchedByUserId: null },
    select: { id: true, title: true, description: true, clientId: true, matchState: true, matchMethod: true, matchScore: true, candidates: true, titleKey: true, kind: true },
  });
  const classify = await loadClassifier();
  let changed = 0;
  for (const r of rows) {
    const c = classify(r.title, r.description);
    const same =
      r.clientId === c.clientId &&
      r.matchState === c.matchState &&
      r.matchMethod === c.matchMethod &&
      r.matchScore === c.matchScore &&
      r.titleKey === c.titleKey &&
      r.kind === c.kind &&
      JSON.stringify(r.candidates ?? []) === JSON.stringify(c.candidates);
    if (same) continue;
    await prisma.rentalHistory.update({
      where: { id: r.id },
      data: toData(c),
    });
    changed++;
  }
  return changed;
}
