import { prisma } from "@/lib/prisma";
import type { ClinicTypeKey, DeviceInterestKey, SourceKey } from "@/lib/clients/labels";
import { summarizeClient } from "@/lib/clients/summary";
import { isRealizedRental, type ClientStatus } from "@/lib/clients/status";
import { computeRhythm, headsFromText, monthsLabel, warsawDay, type RhythmRental } from "@/lib/clients/rhythm";
import { isBeforeSeason, rhythmStrip, seasonWindow, statusCheck, type StripCell } from "@/lib/clients/list-rules";
import { computeRegion, type RegionKey } from "@/lib/clients/region";
import { BASE, distanceKm, geoKey, mapAddress } from "@/lib/clients/geo-rules";
import { readFieldMeta } from "@/lib/clients/profile-fields";
import { isQualified } from "@/lib/clients/qualification";
import { isQualificationActive } from "@/lib/clients/qualify";
import { rentalTimeOf } from "@/lib/rental-title";
import { VISIBLE_EMAIL } from "@/lib/porzadki/exclusion-load";
import { logError } from "@/lib/logger";
import type { UnassignedRental } from "@/lib/clients/rental-match";
import {
  HISTORY_FACT_WHERE,
  INVOICE_FACT_SELECT,
  INVOICE_FACT_WHERE,
  historyToFact,
  invoiceToFact,
  parseInterests,
  personName,
  toFact,
  type RentalFactRow,
} from "@/lib/clients/facts";

// Lista klientów (/klienci) i API agenta (klienci_lista). ZAWIERA PRZYCHÓD —
// tylko dla ADMIN/STAFF/AGENT, nigdy dla KIEROWCY. Klientów < 1000, więc
// wszystko liczone przy odczycie jednym przebiegiem; filtry w przeglądarce.

const DAY = 86_400_000;
const WEEKDAY_SHORT = ["nd", "pn", "wt", "śr", "czw", "pt", "sob"];

export type ClientListRow = {
  id: string;
  name: string;
  shortName: string | null;
  city: string | null;
  zip: string | null;
  region: RegionKey;
  nip: string | null;
  primaryName: string | null;
  primaryPhone: string | null;
  primaryEmail: string | null;
  primaryLastName: string | null;
  hasPhone: boolean;
  status: ClientStatus;
  rentals12m: number;
  rentalsTotal: number;
  lastRentalAt: string | null;
  firstSeenAt: string | null;
  // Ostatni kontakt = najnowsze z: e-mail (Gmail), SMS/rozmowa z panelu, wynajem.
  lastContactAt: string | null;
  lastContactChannel: string | null;
  // Klient vs „kontakt z zapytania” (prompt 2 v2, 1.0) i ostatni sygnał.
  qualified: boolean;
  lastInquiry: { leadId: string; at: string } | null;
  lead: { id: string; stage: string; callList: boolean; lostReason: string | null; title: string; interests: DeviceInterestKey[]; at: string } | null;
  revenueNet: number;
  // Wynajmowane (od najczęstszego), potem deklarowane zainteresowania.
  devices: DeviceInterestKey[];
  // Urządzenia faktycznie wynajmowane — pod podpowiedź sezonową.
  rentedDevices: DeviceInterestKey[];
  source: SourceKey | null;
  clinicType: ClinicTypeKey | null;
  createdAt: string;
  // Lista klientów 27.09.2026: rytm, następny wynajem, następny krok.
  rhythm: {
    cells: StripCell[];
    days: number | null;
    weekday: string | null; // „pt”, gdy przeważa
    breakLabel: string | null; // „VII–VIII”
    risk: "niskie" | "średnie" | "wysokie" | null;
    ratio: number | null;
    suggestion: string | null; // ISO — propozycja terminu dla pierwszego miesiąca „F”
  };
  deviceChips: string[];
  distanceKm: number | null;
  nextRental: { at: string; time: string | null; smsAt: string | null; device: string; unassigned: boolean } | null;
  moreReservations: { count: number; dates: string[]; devices: string[]; lastAt: string | null };
  forecastAt: string | null;
  nextStep: { text: string; dueAt: string | null; person: string | null; agent: boolean; href: string | null } | null;
  check: string | null; // „do sprawdzenia: …”
  beforeSeason: boolean;
  overdueRatio: number | null; // dni od ostatniego / rytm, bez rezerwacji
  pickupAt: string | null; // odbiór 1–3 dni temu bez kontaktu po nim
  trained: boolean; // było szkolenie (widok „Alma po szkoleniu”)
  // Mapa (etap 1): współrzędne i odległość od bazy w linii prostej.
  geo: { lat: number; lng: number; precision: string | null; manual: boolean } | null;
  geoPending: boolean; // adres jest, współrzędnych jeszcze nie liczono (albo adres się zmienił)
  baseKm: number | null;
  // Indeks wyszukiwania: nazwa, nazwa robocza, aliasy z kalendarzy, NIP,
  // miasto, osoby, e-maile; telefony osobno, same cyfry bez prefiksu 48.
  search: string;
  phoneDigits: string;
};

type LastContact = { at: Date; channel: string };

// Najnowszy kontakt z klientem (e-mail z Gmaila, SMS i rozmowy z panelu).
async function lastContacts(): Promise<Map<string, LastContact>> {
  const [emails, messages, calls] = await Promise.all([
    prisma.emailMessage.groupBy({ by: ["clientId"], where: { clientId: { not: null }, ...VISIBLE_EMAIL }, _max: { sentAt: true } }),
    prisma.message.groupBy({ by: ["clientId", "channel"], where: { clientId: { not: null } }, _max: { sentAt: true } }),
    prisma.leadActivity.groupBy({ by: ["clientId", "type"], where: { clientId: { not: null }, type: { in: ["CALL", "CALL_NO_ANSWER", "SMS", "EMAIL"] } }, _max: { createdAt: true } }),
  ]);
  const out = new Map<string, LastContact>();
  const put = (id: string | null, d: Date | null | undefined, channel: string) => {
    if (!id || !d) return;
    const prev = out.get(id);
    if (!prev || d > prev.at) out.set(id, { at: d, channel });
  };
  for (const e of emails) put(e.clientId, e._max.sentAt, "e-mail");
  for (const m of messages) put(m.clientId, m._max.sentAt, m.channel === "SMS" ? "SMS" : "e-mail");
  for (const c of calls) put(c.clientId, c._max.createdAt, c.type === "SMS" ? "SMS" : c.type === "EMAIL" ? "e-mail" : "telefon");
  return out;
}

const LIST_RENTAL_SELECT = {
  id: true,
  title: true,
  startsAt: true,
  endsAt: true,
  allDay: true,
  deliveryTime: true,
  eventType: true,
  deletedInGoogle: true,
  device: { select: { pricingCategory: true, name: true } },
  finance: { select: { confirmedAt: true, totalNet: true, deviceVariant: true } },
  messages: { where: { channel: "SMS", status: "SENT" }, select: { sentAt: true } },
} as const;

const OPEN_LEAD_STAGES = ["SYGNAL", "WYWIAD", "OFERTA", "REZERWACJA"] as const;

function headsOf(r: { title: string; finance: { deviceVariant: string | null } | null }): number | null {
  const v = r.finance?.deviceVariant;
  return v === "double" ? 2 : v?.startsWith("single") ? 1 : headsFromText(r.title);
}

// Chipy urządzeń: rodziny z wynajmów (od najczęstszej), dla jedynej rodziny —
// z liczbą głowic, gdy stała („LightSheer 2 gł.”).
function chipsOf(rentals: RhythmRental[], config: ReturnType<typeof computeRhythm>["deviceConfig"]): string[] {
  const counts = new Map<string, number>();
  for (const r of rentals) {
    if (!r.device) continue;
    const family = r.device.trim().split(/\s+/)[0];
    counts.set(family, (counts.get(family) ?? 0) + 1);
  }
  const families = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([f]) => f);
  if (families.length === 1 && config) {
    const name = config.family.split(/\s+/).slice(0, 2).join(" ");
    return [config.heads && config.always ? `${name} ${config.heads} gł.` : name];
  }
  return families.slice(0, 3);
}

// Odbiór = dzień zakończenia (całodniowy: endsAt to północ dnia następnego).
function pickupDay(r: { endsAt: Date; allDay: boolean }): Date {
  return r.allDay ? new Date(r.endsAt.getTime() - 1) : r.endsAt;
}

export async function loadClientRows(today = new Date(), opts: { unassigned?: UnassignedRental[] } = {}): Promise<ClientListRow[]> {
  const [contactsAt, qualificationActive] = await Promise.all([lastContacts(), isQualificationActive()]);
  const clients = await prisma.client.findMany({
    // Zarchiwizowani (Porządki → Archiwum) nie wracają na listę.
    where: { archivedAt: null },
    select: {
      id: true,
      name: true,
      shortName: true,
      city: true,
      zip: true,
      region: true,
      street: true,
      deliveryAddress: true,
      lat: true,
      lng: true,
      geoSource: true,
      geoPrecision: true,
      geoQuery: true,
      nip: true,
      statusOverride: true,
      source: true,
      clinicType: true,
      deviceInterests: true,
      distanceKm: true,
      nextStepText: true,
      nextStepDueAt: true,
      fieldMeta: true,
      createdAt: true,
      contacts: {
        select: { firstName: true, lastName: true, phone: true, phone2: true, email: true, isPrimary: true },
        orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
      },
      rentals: { select: LIST_RENTAL_SELECT },
      history: { where: HISTORY_FACT_WHERE, select: { startsAt: true, endsAt: true, kind: true, title: true, description: true, device: { select: { pricingCategory: true, name: true } } } },
      invoices: { where: INVOICE_FACT_WHERE, select: INVOICE_FACT_SELECT },
      aliases: { select: { alias: true } },
      qualifiedAt: true,
      leads: {
        where: { archivedAt: null },
        orderBy: { createdAt: "desc" },
        select: { id: true, createdAt: true, stage: true, callList: true, lostReason: true, title: true, deviceInterest: true, nextActionAt: true },
      },
    },
  });

  const ids = clients.map((c) => c.id);
  const [tasks, proposals] = await Promise.all([
    prisma.task.findMany({
      where: { status: "OPEN", clientId: { in: ids } },
      orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
      select: { clientId: true, title: true, dueDate: true, assignee: { select: { name: true } }, author: { select: { role: true } } },
    }),
    prisma.changeProposal.findMany({
      where: { status: "PENDING", field: "nextStepText", clientId: { in: ids } },
      orderBy: { createdAt: "desc" },
      select: { clientId: true, proposedValue: true, createdAt: true },
    }),
  ]);
  const taskBy = new Map<string, (typeof tasks)[number]>();
  for (const t of tasks) if (t.clientId && !taskBy.has(t.clientId)) taskBy.set(t.clientId, t);
  const proposalBy = new Map<string, string>();
  for (const p of proposals) {
    if (!p.clientId || proposalBy.has(p.clientId)) continue;
    try {
      const v = JSON.parse(p.proposedValue ?? "null");
      if (typeof v === "string" && v.trim()) proposalBy.set(p.clientId, v.trim());
    } catch {
      // wartość nieczytelna — pomijamy propozycję
    }
  }
  const authorIds = [...new Set(clients.map((c) => readFieldMeta(c.fieldMeta).nextStepText?.verifiedBy).filter((x): x is string => !!x))];
  const authors = authorIds.length ? await prisma.user.findMany({ where: { id: { in: authorIds } }, select: { id: true, name: true, role: true } }) : [];
  const authorBy = new Map(authors.map((a) => [a.id, a]));

  // Rezerwacje bez klienta z propozycją klienta (wniosek 13) — pokazywane
  // jako „następny wynajem” z dopiskiem i blokują „przed sezonem”.
  const unassignedBy = new Map<string, Date[]>();
  for (const u of opts.unassigned ?? []) {
    const top = u.candidates[0];
    if (!top) continue;
    unassignedBy.set(top.clientId, [...(unassignedBy.get(top.clientId) ?? []), new Date(u.startsAt)]);
  }

  const window = seasonWindow(today);
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const regionFixes = new Map<RegionKey, string[]>();

  const rows = clients.map((c): ClientListRow => {
    const rentalRows = c.rentals as unknown as (RentalFactRow & (typeof c.rentals)[number])[];
    const summary = summarizeClient({
      statusOverride: c.statusOverride,
      rentals: [...rentalRows.map(toFact), ...c.history.map(historyToFact)],
      invoices: c.invoices.map(invoiceToFact),
      today,
    });
    const primary = c.contacts[0] ?? null;
    const interests = parseInterests(c.deviceInterests);
    const region = computeRegion(c.zip, c.city);
    if (region !== c.region) regionFixes.set(region, [...(regionFixes.get(region) ?? []), c.id]);

    // --- Rytm (jak na karcie: wynajmy z panelu + historia kalendarzy) ---
    const live = c.rentals.filter((r) => !r.deletedInGoogle && r.eventType === "WYNAJEM");
    const rhythmRentals: RhythmRental[] = [
      ...live.map((r) => ({ at: r.startsAt, device: r.device.name, heads: headsOf(r) })),
      ...c.history.filter((h) => h.kind === "WYNAJEM").map((h) => ({ at: h.startsAt, device: h.device.name, heads: headsFromText(`${h.title} ${h.description ?? ""}`) })),
    ];
    const realizedR = rhythmRentals.filter((x) => x.at <= today);
    const plannedR = rhythmRentals.filter((x) => x.at > today);
    const rhythm = computeRhythm({ realized: realizedR, planned: plannedR, today });
    const unassigned = (unassignedBy.get(c.id) ?? []).filter((d) => d > today);
    const strip = rhythmStrip({
      realized: realizedR.map((x) => x.at),
      planned: [...plannedR.map((x) => x.at), ...unassigned],
      forecast: rhythm.forecast,
      rhythmDays: rhythm.rhythmDays,
      seasonalBreak: rhythm.seasonalBreak,
      today,
    });

    // --- Ostatni → następny ---
    const upcoming = live.filter((r) => r.startsAt > today).sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
    const own = upcoming[0];
    const firstUnassigned = [...unassigned].sort((a, b) => a.getTime() - b.getTime())[0];
    const nextRental = own && (!firstUnassigned || own.startsAt <= firstUnassigned)
      ? {
          at: own.startsAt.toISOString(),
          time: rentalTimeOf(own),
          smsAt: own.messages.map((m) => m.sentAt.toISOString()).sort().pop() ?? null,
          device: own.device.name,
          unassigned: false,
        }
      : firstUnassigned
        ? { at: firstUnassigned.toISOString(), time: null, smsAt: null, device: "", unassigned: true }
        : null;
    const later = [...upcoming.slice(nextRental && !nextRental.unassigned ? 1 : 0).map((r) => ({ at: r.startsAt, device: r.device.name })), ...unassigned.filter((d) => d.toISOString() !== nextRental?.at).map((d) => ({ at: d, device: "" }))].sort(
      (a, b) => a.at.getTime() - b.at.getTime(),
    );
    const laterFamilies = [...new Set(later.map((x) => x.device.split(/\s+/)[0]).filter(Boolean))];

    // --- Następny krok ---
    const meta = readFieldMeta(c.fieldMeta).nextStepText;
    const author = meta?.verifiedBy ? authorBy.get(meta.verifiedBy) : undefined;
    const task = taskBy.get(c.id);
    const lead = c.leads.find((l) => (OPEN_LEAD_STAGES as readonly string[]).includes(l.stage) && l.nextActionAt);
    const nextStep: ClientListRow["nextStep"] = c.nextStepText
      ? { text: c.nextStepText, dueAt: c.nextStepDueAt?.toISOString() ?? null, person: author?.name ?? null, agent: author?.role === "AGENT" || meta?.source === "agent", href: null }
      : proposalBy.has(c.id)
        ? { text: proposalBy.get(c.id)!, dueAt: null, person: null, agent: true, href: "/propozycje" }
        : task
          ? { text: task.title, dueAt: task.dueDate?.toISOString() ?? null, person: task.assignee?.name ?? null, agent: task.author?.role === "AGENT", href: null }
          : lead
            ? { text: `${lead.title} — zaplanowany kontakt`, dueAt: lead.nextActionAt!.toISOString(), person: null, agent: false, href: `/sygnaly?id=${lead.id}` }
            : null;

    // --- Do sprawdzenia, przed sezonem, po terminie, kontakt po wynajmie ---
    const facts = rentalRows.map(toFact);
    const realizedDates = [
      ...facts.filter(isRealizedRental).map((f) => f.startsAt),
      ...c.history.filter((h) => h.kind === "WYNAJEM").map((h) => h.startsAt),
    ];
    const unconfirmedPast = facts
      .filter((f) => f.eventType === "WYNAJEM" && !f.deletedInGoogle && f.endsAt <= today && !isRealizedRental(f))
      .map((f) => f.startsAt);
    const check = statusCheck({
      status: summary.status,
      realizedDates,
      unconfirmedPast,
      nextReservation: nextRental ? new Date(nextRental.at) : null,
      today,
    });
    const beforeSeason = isBeforeSeason({
      status: summary.status,
      rentalDates: realizedDates,
      bookedDates: [...live.map((r) => r.startsAt), ...unassigned],
      seasonalBreak: rhythm.seasonalBreak,
      window,
      today,
    });
    const lastAt = summary.lastRentalAt;
    const overdueRatio =
      !nextRental && rhythm.rhythmDays && lastAt ? Math.round(((warsawDay(today).getTime() - warsawDay(lastAt).getTime()) / DAY / rhythm.rhythmDays) * 100) / 100 : null;
    const contact = contactsAt.get(c.id);
    const pickups = live
      .map(pickupDay)
      .filter((d) => {
        const ago = Math.round((startOfToday.getTime() - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / DAY);
        return ago >= 1 && ago <= 3;
      })
      .sort((a, b) => b.getTime() - a.getTime());
    const pickupAt = pickups[0] && !(contact && contact.at > pickups[0]) ? pickups[0].toISOString() : null;

    const lastRentalPast = lastAt && lastAt <= today ? lastAt : null;
    const lastContact = [contact ? { at: contact.at, channel: contact.channel } : null, lastRentalPast ? { at: lastRentalPast, channel: "wynajem" } : null]
      .filter((x): x is LastContact => !!x)
      .sort((a, b) => b.at.getTime() - a.at.getTime())[0];
    const inquiry = c.leads[0];
    const addr = mapAddress(c);
    const geo = c.lat != null && c.lng != null ? { lat: c.lat, lng: c.lng, precision: c.geoPrecision, manual: c.geoSource === "MANUAL" } : null;

    return {
      id: c.id,
      name: c.name,
      shortName: c.shortName,
      city: c.city,
      zip: c.zip,
      region,
      nip: c.nip,
      primaryName: primary ? personName(primary) : null,
      primaryPhone: primary?.phone ?? null,
      primaryEmail: primary?.email ?? null,
      primaryLastName: primary?.lastName ?? null,
      hasPhone: c.contacts.some((p) => Boolean(p.phone?.trim() || p.phone2?.trim())),
      status: summary.status,
      rentals12m: summary.rentals12m,
      rentalsTotal: summary.rentalsTotal,
      lastRentalAt: summary.lastRentalAt?.toISOString() ?? null,
      firstSeenAt: summary.firstSeenAt?.toISOString() ?? null,
      lastContactAt: lastContact?.at.toISOString() ?? null,
      lastContactChannel: lastContact?.channel ?? null,
      revenueNet: summary.revenueNet,
      qualified: isQualified({ qualifiedAt: c.qualifiedAt, rentals: c.rentals.length, history: c.history.length, invoices: c.invoices.length }, qualificationActive),
      lastInquiry: inquiry ? { leadId: inquiry.id, at: inquiry.createdAt.toISOString() } : null,
      lead: inquiry
        ? {
            id: inquiry.id,
            stage: inquiry.stage,
            callList: inquiry.callList,
            lostReason: inquiry.lostReason,
            title: inquiry.title,
            interests: parseInterests(inquiry.deviceInterest),
            at: inquiry.createdAt.toISOString(),
          }
        : null,
      devices: [...new Set([...summary.rentedDevices, ...interests])],
      rentedDevices: summary.rentedDevices,
      source: c.source,
      clinicType: c.clinicType,
      createdAt: c.createdAt.toISOString(),
      rhythm: {
        cells: strip.cells,
        days: rhythm.rhythmDays,
        weekday: rhythm.preferredWeekday && rhythm.preferredWeekday.share >= 0.5 ? WEEKDAY_SHORT[rhythm.preferredWeekday.day] : null,
        breakLabel: rhythm.seasonalBreak.length ? monthsLabel(rhythm.seasonalBreak) : null,
        risk: rhythm.churnRisk?.level ?? null,
        ratio: rhythm.churnRisk?.ratio ?? null,
        suggestion: strip.suggestion?.at.toISOString() ?? null,
      },
      deviceChips: chipsOf(rhythmRentals, rhythm.deviceConfig),
      distanceKm: c.distanceKm != null ? Number(c.distanceKm.toString()) : null,
      nextRental,
      moreReservations: {
        count: later.length,
        dates: later.slice(0, 3).map((x) => x.at.toISOString()),
        devices: laterFamilies.length > 1 ? laterFamilies : [],
        lastAt: later.length ? later[later.length - 1].at.toISOString() : null,
      },
      forecastAt: rhythm.forecast[0]?.toISOString() ?? null,
      nextStep,
      check,
      beforeSeason,
      overdueRatio,
      pickupAt,
      geo,
      geoPending: !!addr && c.geoSource !== "MANUAL" && geoKey(addr) !== c.geoQuery,
      baseKm: geo ? distanceKm(BASE, geo) : null,
      trained: c.rentals.some((r) => r.eventType === "SZKOLENIE" && !r.deletedInGoogle) || c.history.some((h) => h.kind === "SZKOLENIE"),
      search: [c.name, c.shortName, c.nip, c.city, ...c.aliases.map((a) => a.alias), ...c.contacts.flatMap((p) => [personName(p), p.email])]
        .filter(Boolean)
        .join(" ")
        .toLowerCase(),
      phoneDigits: c.contacts
        .flatMap((p) => [p.phone, p.phone2])
        .map((ph) => (ph ?? "").replace(/\D/g, "").replace(/^48(?=\d{9}$)/, ""))
        .filter(Boolean)
        .join(" "),
    };
  });

  // Region to pole liczone — zapisujemy tylko rozjazdy (nowy kod, nowe
  // miasto). Błąd zapisu nie psuje listy.
  if (regionFixes.size) {
    try {
      for (const [region, list] of regionFixes) await prisma.client.updateMany({ where: { id: { in: list } }, data: { region } });
    } catch (err) {
      logError("client_region_update_failed", err);
    }
  }
  return rows;
}
