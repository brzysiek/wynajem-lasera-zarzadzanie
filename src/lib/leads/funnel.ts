// Lejek sprzedaży (wniosek 18, etap L1): reguły wyniku kontaktu (następny
// krok, próby, follow-upy), „Na dziś”, kolejka „Do obdzwonienia” i wskaźniki.
// Czas pracy: pn–pt 8–17 (work-time.ts). Czyste funkcje (vitest bez "@/").
import { WORK_END_HOUR, WORK_START_HOUR, addWorkdays, nextWorkday, workHoursBetween } from "./work-time";
import type { LeadStageKey, LeadTypeKey } from "./parse-deal";
import { SPRING_REF_PREFIX } from "./season-goal";

export const OPEN_STAGES: LeadStageKey[] = ["SYGNAL", "WYWIAD", "OFERTA", "REZERWACJA"];
// Sygnały sprzed 2026 nie trafiają do „Na dziś” ani „Do obdzwonienia”.
export const FUNNEL_FROM = new Date("2025-12-31T23:00:00.000Z");
export const FIRST_CONTACT_SLA_HOURS = 4;
export const NO_ANSWER_LIMIT = 3;
export const OFFER_FOLLOW_UP_DAYS = [3, 7] as const; // dni robocze: 1. i 2. follow-up oferty
// Archiwum „2025 – bez kontaktu” (powód archiwizacji sygnału, Porządki).
export const ARCHIVE_2025 = "BEZ_KONTAKTU_2025";

// Najwyższy etap, jaki sygnał kiedykolwiek osiągnął (raport i konwersja):
// bieżący etap + zmiany etapów z historii (wpisy „Wywiad → Oferta wysłana”).
export const REACH_ORDER: LeadStageKey[] = ["SYGNAL", "WYWIAD", "OFERTA", "REZERWACJA", "WYGRANA"];
export function maxStageReached(current: LeadStageKey, stageChangeBodies: (string | null)[], labels: Record<LeadStageKey, string[]>, hasRental: boolean): LeadStageKey {
  let best = current === "PRZEGRANA" ? 0 : current === "ODLOZONE" ? 1 : REACH_ORDER.indexOf(current);
  for (const body of stageChangeBodies) {
    if (!body) continue;
    for (let i = REACH_ORDER.length - 1; i > best; i--) {
      if (labels[REACH_ORDER[i]].some((l) => body.includes(l))) {
        best = i;
        break;
      }
    }
  }
  if (hasRental) best = Math.max(best, REACH_ORDER.indexOf("REZERWACJA"));
  return REACH_ORDER[best];
}

export type NextStepType = "PIERWSZY_KONTAKT" | "PONOWNA_PROBA" | "FOLLOW_UP_OFERTY" | "ODDZWONI" | "DOPYTAC" | "POWROT" | "UMOW_TERMIN" | "INNE";
export const NEXT_STEP_LABEL: Record<NextStepType, string> = {
  PIERWSZY_KONTAKT: "pierwszy kontakt",
  PONOWNA_PROBA: "ponowna próba",
  FOLLOW_UP_OFERTY: "follow-up oferty",
  ODDZWONI: "oddzwoni",
  DOPYTAC: "dopytać",
  POWROT: "powrót z odłożonych",
  UMOW_TERMIN: "umówić termin",
  INNE: "kolejny krok",
};
// Kroki telefoniczne — trafiają do „Do obdzwonienia”, gdy przypadają.
export const PHONE_STEPS: NextStepType[] = ["PIERWSZY_KONTAKT", "PONOWNA_PROBA", "FOLLOW_UP_OFERTY", "ODDZWONI", "DOPYTAC", "UMOW_TERMIN"];

// Odłożone liczy się jak „W kontakcie” (automaty tylko do przodu).
const STAGE_ORDER: Record<LeadStageKey, number> = { SYGNAL: 0, WYWIAD: 1, ODLOZONE: 1, OFERTA: 2, REZERWACJA: 3, WYGRANA: 4, PRZEGRANA: 5 };
const atHour = (d: Date, h: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), h);
export const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const endOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);

// Następny dzień roboczy o 10:00 („jutro 10:00”).
export function nextWorkdayAt10(now: Date): Date {
  return atHour(nextWorkday(now), 10);
}

// Chwila po `hours` godzinach roboczych od `from` (SLA pierwszego kontaktu).
export function addWorkHours(from: Date, hours: number): Date {
  let t = new Date(from);
  let left = hours;
  for (let guard = 0; guard < 60 && left > 0; guard++) {
    const day = startOfDay(t);
    const wd = t.getDay() >= 1 && t.getDay() <= 5;
    const open = atHour(day, WORK_START_HOUR);
    const close = atHour(day, WORK_END_HOUR);
    if (!wd || t >= close) {
      t = atHour(nextWorkday(day), WORK_START_HOUR);
      continue;
    }
    if (t < open) t = open;
    const avail = (close.getTime() - t.getTime()) / 3_600_000;
    if (avail >= left) return new Date(t.getTime() + left * 3_600_000);
    left -= avail;
    t = atHour(nextWorkday(day), WORK_START_HOUR);
  }
  return t;
}

// ------------------------------------------------------------------ wynik kontaktu

export type Outcome = "talked" | "no_answer" | "callback" | "offer_sent" | "email" | "postpone";

export type OutcomeState = { stage: LeadStageKey; nextStepType: string | null; attempts: number; followUpNo: number };

export type OutcomePlan = {
  stage: LeadStageKey | null; // null = bez zmiany etapu
  nextActionAt: Date | null;
  nextStepType: NextStepType | null;
  nextStepNote: string | null;
  attempts: number;
  followUpNo: number;
  contact: boolean; // był kontakt (rozmowa / mail) — pierwszy i ostatni kontakt
  noAnswerLimit: boolean; // 3. próba bez odebrania: szkic SMS + propozycja przegranej
};

// Reguły z decyzji Tomka (27.09.2026, pkt 3):
// - Rozmawiam → etap co najmniej Wywiad, krok wybrany (domyślnie +2 dni rob.);
// - Nie odebrała → próba +1, jutro 10:00; przy 3. — szkic SMS + „brak kontaktu?”;
//   przy 1. follow-upie oferty bez odpowiedzi → 2. follow-up +7 dni rob.;
// - Oddzwoni → wybrany termin;
// - Wysłałam ofertę → Oferta wysłana, follow-up +3 dni rob. (10:00);
// - Odpowiedziałam mailem → kontakt, sprawdzić odpowiedź za 3 dni rob.
export function planOutcome(s: OutcomeState, outcome: Outcome, now: Date, opts: { at?: Date | null; note?: string | null } = {}): OutcomePlan {
  const base = { attempts: s.attempts, followUpNo: s.followUpNo, noAnswerLimit: false };
  if (outcome === "talked") {
    return {
      ...base,
      stage: STAGE_ORDER[s.stage] < STAGE_ORDER.WYWIAD ? "WYWIAD" : null,
      nextActionAt: opts.at ?? atHour(addWorkdays(now, 2), 10),
      nextStepType: "INNE",
      nextStepNote: opts.note ?? "po rozmowie",
      attempts: 0,
      contact: true,
    };
  }
  if (outcome === "callback") {
    return { ...base, stage: STAGE_ORDER[s.stage] < STAGE_ORDER.WYWIAD ? "WYWIAD" : null, nextActionAt: opts.at ?? nextWorkdayAt10(now), nextStepType: "ODDZWONI", nextStepNote: opts.note ?? null, attempts: 0, contact: true };
  }
  if (outcome === "offer_sent") {
    return {
      ...base,
      stage: STAGE_ORDER[s.stage] < STAGE_ORDER.OFERTA ? "OFERTA" : null,
      nextActionAt: atHour(addWorkdays(now, OFFER_FOLLOW_UP_DAYS[0]), 10),
      nextStepType: "FOLLOW_UP_OFERTY",
      nextStepNote: "follow-up 1 z 2",
      attempts: 0,
      followUpNo: 1,
      contact: true,
    };
  }
  // Odłóż do… (lejek v2): data powrotu obowiązkowa — w tym dniu sygnał wraca
  // do „W kontakcie” z krokiem na dziś (reviveReturningLeads).
  if (outcome === "postpone") {
    return { ...base, stage: "ODLOZONE", nextActionAt: opts.at ? atHour(opts.at, 9) : null, nextStepType: "POWROT", nextStepNote: opts.note ?? null, attempts: 0, contact: true };
  }
  if (outcome === "email") {
    return { ...base, stage: null, nextActionAt: opts.at ?? atHour(addWorkdays(now, 3), 10), nextStepType: "INNE", nextStepNote: opts.note ?? "sprawdzić odpowiedź na maila", attempts: 0, contact: true };
  }
  // Nie odebrała.
  if (s.nextStepType === "FOLLOW_UP_OFERTY" && s.followUpNo === 1) {
    return {
      ...base,
      stage: null,
      nextActionAt: atHour(addWorkdays(now, OFFER_FOLLOW_UP_DAYS[1]), 10),
      nextStepType: "FOLLOW_UP_OFERTY",
      nextStepNote: "follow-up 2 z 2 (bez odpowiedzi na 1.)",
      followUpNo: 2,
      contact: false,
    };
  }
  // Złote zasady (28.09): 3 próby w 3 różne dni i pory — od razu, jutro
  // 16–17, pojutrze 8–9 (najlepsze okna wg badań); dalej jutro 10:00.
  const attempts = s.attempts + 1;
  const next = nextWorkday(now);
  return {
    ...base,
    stage: null,
    nextActionAt: attempts === 1 ? atHour(next, 16) : attempts === 2 ? new Date(next.getFullYear(), next.getMonth(), next.getDate(), 8, 30) : nextWorkdayAt10(now),
    nextStepType: "PONOWNA_PROBA",
    nextStepNote: `próba ${Math.min(attempts + 1, NO_ANSWER_LIMIT + 1)} (nie odebrała ${attempts}×)`,
    attempts,
    contact: false,
    noAnswerLimit: attempts >= NO_ANSWER_LIMIT,
  };
}

// ------------------------------------------------------------------ widoki

export type FunnelLead = {
  id: string;
  stage: LeadStageKey;
  type: LeadTypeKey;
  createdAt: Date;
  firstContactAt: Date | null;
  lastContactAt: Date | null;
  stageChangedAt: Date;
  nextActionAt: Date | null;
  nextStepType: string | null;
  attempts: number;
  ownerId: string | null;
  rentalId: string | null;
  phone: string | null;
  // Lejek v2: ostatnia prawdziwa aktywność (rozmowa, mail, SMS, notatka,
  // zmiana etapu — nie zaplanowany termin), powrót odłożonego, najdalszy etap.
  lastWorkAt?: Date | null;
  returnAt?: Date | null;
  maxStage?: LeadStageKey;
  returningClient?: boolean;
};

// Wiersz z datami ISO (LeadRow) → wiersz lejka z datami.
export function funnelFromRow<T extends { createdAt: string; firstContactAt: string | null; lastContactAt: string | null; stageChangedAt: string; nextActionAt: string | null; lastWorkAt?: string | null; returnAt?: string | null }>(
  r: T,
): Omit<T, "createdAt" | "firstContactAt" | "lastContactAt" | "stageChangedAt" | "nextActionAt"> & Pick<FunnelLead, "createdAt" | "firstContactAt" | "lastContactAt" | "stageChangedAt" | "nextActionAt"> {
  return {
    ...r,
    createdAt: new Date(r.createdAt),
    firstContactAt: r.firstContactAt ? new Date(r.firstContactAt) : null,
    lastContactAt: r.lastContactAt ? new Date(r.lastContactAt) : null,
    stageChangedAt: new Date(r.stageChangedAt),
    nextActionAt: r.nextActionAt ? new Date(r.nextActionAt) : null,
    ...(r.lastWorkAt !== undefined ? { lastWorkAt: r.lastWorkAt ? new Date(r.lastWorkAt) : null } : {}),
    ...(r.returnAt !== undefined ? { returnAt: r.returnAt ? new Date(r.returnAt) : null } : {}),
  } as never;
}

// Id sygnałów w kolejce „Do obdzwonienia” (API agenta, filtr do_obdzwonienia).
export function callQueueIds<T extends Parameters<typeof funnelFromRow>[0] & Omit<FunnelLead, "createdAt" | "firstContactAt" | "lastContactAt" | "stageChangedAt" | "nextActionAt" | "lastWorkAt" | "returnAt">>(rows: T[], now: Date): Set<string> {
  return new Set(callQueue(rows.map((r) => funnelFromRow(r) as unknown as FunnelLead), now).map((l) => l.id));
}

const isOpen = (l: FunnelLead) => OPEN_STAGES.includes(l.stage);
const in2026 = (l: FunnelLead) => l.createdAt >= FUNNEL_FROM;

// „Na dziś”: zaległe i dzisiejsze kroki (po pierwszym kontakcie), nowe bez
// kontaktu z 30 dni, rezerwacje i wygrane bez wynajmu. Tylko sygnały z 2026.
export function buildNaDzis<T extends FunnelLead>(leads: T[], now: Date) {
  const eod = endOfDay(now);
  const from30 = new Date(now.getTime() - 30 * 86_400_000);
  const open = leads.filter((l) => isOpen(l) && in2026(l));
  const due = open
    .filter((l) => l.firstContactAt && l.nextActionAt && l.nextActionAt <= eod && l.stage !== "REZERWACJA")
    .sort((a, b) => a.nextActionAt!.getTime() - b.nextActionAt!.getTime());
  const fresh = open.filter((l) => !l.firstContactAt && l.createdAt >= from30).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  // Do powiązania: rezerwacje bez wynajmu i wygrane bez wynajmu (wygrana
  // liczy się w raporcie dopiero z wynajmem w kalendarzu).
  const toLink = leads
    .filter((l) => in2026(l) && !l.rentalId && (l.stage === "REZERWACJA" || l.stage === "WYGRANA"))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  return { due, fresh, toLink };
}

// Zaległy = krok przed dzisiejszym dniem (albo SLA pierwszego kontaktu minęło).
export function isOverdue(l: { nextActionAt: Date | null }, now: Date): boolean {
  return !!l.nextActionAt && l.nextActionAt < now;
}

// „Do obdzwonienia” — liczona na bieżąco: otwarte z 2026 bez kontaktu albo
// z telefonicznym krokiem ≤ dziś. Kolejność: zaległe → rezerwacje WWW →
// formularze → pobrania cennika; w grupie od najnowszych.
const TYPE_RANK: Record<LeadTypeKey, number> = {
  REZERWACJA_WWW: 1,
  SZKOLENIE_WWW: 1,
  KONTAKT: 2,
  TELEFON: 2,
  EMAIL: 2,
  OLX: 2,
  POLECENIE: 2,
  INNE: 2,
  POBRANIE_CENNIKA: 3,
};

export function callQueue<T extends FunnelLead>(leads: T[], now: Date): T[] {
  const eod = endOfDay(now);
  const sod = startOfDay(now);
  const rows = leads.filter(
    (l) =>
      isOpen(l) &&
      in2026(l) &&
      l.stage !== "REZERWACJA" &&
      (!l.firstContactAt || (!!l.nextActionAt && l.nextActionAt <= eod && PHONE_STEPS.includes(l.nextStepType as NextStepType))),
  );
  const rank = (l: T) => (l.nextActionAt && l.nextActionAt < sod ? 0 : TYPE_RANK[l.type]);
  return rows.sort((a, b) => rank(a) - rank(b) || b.createdAt.getTime() - a.createdAt.getTime());
}

// ------------------------------------------------------------------ wskaźniki

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
}

// Mediana czasu do 1. kontaktu (godziny robocze) — z czekającymi: sygnał bez
// kontaktu liczony do teraz, więc zaległości podnoszą wynik.
export function medianFirstContactHours(leads: { createdAt: Date; firstContactAt: Date | null }[], now: Date): number | null {
  const m = median(leads.map((l) => workHoursBetween(l.createdAt, l.firstContactAt ?? now)));
  return m == null ? null : Math.round(m * 10) / 10;
}

export function naDzisKpis<T extends FunnelLead>(leads: T[], now: Date) {
  const { due, fresh } = buildNaDzis(leads, now);
  const work = [...due, ...fresh];
  const from30 = new Date(now.getTime() - 30 * 86_400_000);
  const from90 = new Date(now.getTime() - 90 * 86_400_000);
  const new30 = leads.filter((l) => l.createdAt >= from30);
  const created90 = leads.filter((l) => l.createdAt >= from90);
  const offers = leads.filter(
    (l) => l.stage === "OFERTA" && in2026(l) && workHoursBetween(l.stageChangedAt, now) > 3 * (WORK_END_HOUR - WORK_START_HOUR) && (!l.lastContactAt || l.lastContactAt <= l.stageChangedAt),
  );
  return {
    overdue: work.filter((l) => isOverdue(l, now)).length,
    today: work.filter((l) => !isOverdue(l, now)).length,
    new30: new30.length,
    new30NoContact: new30.filter((l) => !l.firstContactAt && isOpen(l)).length,
    medianFirstContact: medianFirstContactHours(new30, now),
    offersNoAnswer: offers.length,
    conversion90: created90.length ? created90.filter((l) => l.rentalId || l.stage === "REZERWACJA" || l.stage === "WYGRANA").length / created90.length : null,
  };
}

// „8 h rob.” / „2,4 dnia” (dzień roboczy = 9 h).
export function workDurationLabel(hours: number | null): string {
  if (hours == null) return "—";
  const perDay = WORK_END_HOUR - WORK_START_HOUR;
  if (hours < perDay) return `${Math.round(hours * 10) / 10} h rob.`.replace(".", ",");
  const d = Math.round((hours / perDay) * 10) / 10;
  return `${String(d).replace(".", ",")} dnia rob.`;
}

// ------------------------------------------------------------------ lejek v2: gnicie i Skrzynka

// Limity gnicia (lejek-v2, 3.2): Nowe — SLA 4 h rob. od wpłynięcia; W
// kontakcie — 3 dni rob. bez aktywności; Oferta — 10 dni. Licznik zeruje
// prawdziwa aktywność (rozmowa, mail, SMS, notatka), nie zaplanowany termin.
// Otwarty sygnał bez następnego kroku gnije zawsze. Rezerwacja nie gnije.
export const ROT_WORK_DAYS_CONTACT = 3;
export const ROT_DAYS_OFFER = 10;
const WORK_DAY_HOURS = WORK_END_HOUR - WORK_START_HOUR;

export type Rot = { rotting: boolean; label: string | null; days: number };

const untouched = (l: FunnelLead) => l.stage === "SYGNAL" && !l.firstContactAt;

export function lastWorkOf(l: FunnelLead): Date {
  return new Date(Math.max(l.stageChangedAt.getTime(), l.lastContactAt?.getTime() ?? 0, l.lastWorkAt?.getTime() ?? 0));
}

export function rotInfo(l: FunnelLead, now: Date): Rot {
  const none: Rot = { rotting: false, label: null, days: 0 };
  if (!isOpen(l) || !in2026(l) || l.stage === "REZERWACJA") return none;
  if (untouched(l)) {
    const h = workHoursBetween(l.createdAt, now);
    if (h <= FIRST_CONTACT_SLA_HOURS) return none;
    const d = Math.max(1, Math.floor(h / WORK_DAY_HOURS));
    return { rotting: true, label: `po czasie · ${d} ${d === 1 ? "dzień" : "dni"} rob.`, days: d };
  }
  if (!l.nextActionAt) return { rotting: true, label: "brak kroku", days: 0 };
  const last = lastWorkOf(l);
  if (l.stage === "OFERTA") {
    const d = Math.floor((now.getTime() - last.getTime()) / 86_400_000);
    return d > ROT_DAYS_OFFER ? { rotting: true, label: `stoi ${d} dni`, days: d } : { ...none, days: d };
  }
  const wd = Math.floor(workHoursBetween(last, now) / WORK_DAY_HOURS);
  return wd > ROT_WORK_DAYS_CONTACT ? { rotting: true, label: `stoi ${wd} dni rob.`, days: wd } : { ...none, days: wd };
}

// Skrzynka (lejek v2, ekran 1): Nowe (nietknięte, z SLA), Do zrobienia dziś
// (kroki do końca dnia + rezerwacje bez wynajmu), Gniją (ponad limit etapu,
// bez tych na dziś), Wracają (Odłożone wg daty powrotu). Tylko z 2026.
export function buildInbox<T extends FunnelLead>(leads: T[], now: Date) {
  const eod = endOfDay(now);
  const act = leads.filter(in2026);
  const at = (l: T) => l.nextActionAt?.getTime() ?? 0;
  const fresh = act.filter((l) => isOpen(l) && untouched(l)).sort((a, b) => at(a) - at(b) || b.createdAt.getTime() - a.createdAt.getTime());
  const due = act.filter((l) => isOpen(l) && !untouched(l) && l.nextActionAt && l.nextActionAt <= eod).sort((a, b) => at(a) - at(b));
  const dueIds = new Set(due.map((l) => l.id));
  const toLink = act.filter((l) => l.stage === "REZERWACJA" && !l.rentalId && !dueIds.has(l.id));
  const today = [...due, ...toLink];
  const todayIds = new Set(today.map((l) => l.id));
  const rotting = act
    .filter((l) => isOpen(l) && !untouched(l) && !todayIds.has(l.id) && rotInfo(l, now).rotting)
    .sort((a, b) => rotInfo(b, now).days - rotInfo(a, now).days);
  const returning = leads.filter((l) => l.stage === "ODLOZONE").sort((a, b) => (a.returnAt?.getTime() ?? 0) - (b.returnAt?.getTime() ?? 0));
  return { fresh, today, rotting, returning };
}

export function inboxKpis<T extends FunnelLead>(leads: T[], now: Date) {
  const b = buildInbox(leads, now);
  const from30 = new Date(now.getTime() - 30 * 86_400_000);
  const week = new Date(now.getTime() + 7 * 86_400_000);
  const last30 = leads.filter((l) => l.createdAt >= from30 && !l.returningClient);
  const reached = (l: T, s: LeadStageKey) => REACH_ORDER.indexOf(l.maxStage ?? l.stage) >= REACH_ORDER.indexOf(s);
  const offers30 = last30.filter((l) => reached(l, "OFERTA"));
  return {
    fresh: b.fresh.length,
    freshLate: b.fresh.filter((l) => rotInfo(l, now).rotting).length,
    today: b.today.length,
    rotting: leads.filter((l) => in2026(l) && isOpen(l) && !untouched(l) && rotInfo(l, now).rotting).length,
    returning: b.returning.length,
    returningWeek: b.returning.filter((l) => l.returnAt && l.returnAt <= week).length,
    medianFirstContact: medianFirstContactHours(last30, now),
    offers30: offers30.length,
    reservations30: offers30.filter((l) => reached(l, "REZERWACJA")).length,
  };
}

// ------------------------------------------------------------------ Lista „Na dziś” (28.09, bez Skrzynki)

// Jedna tabela, kolejność: po czasie → nowe → zaplanowane na dziś → wracające
// odłożone. Grupy = punkty „Planu dnia” (klik filtruje tabelę).
export type TodayPriority = "late" | "new" | "today" | "back";
export type TodayGroup = "new" | "calls" | "spring" | "followups" | "back" | "other";
export type TodayItem<T> = { lead: T; priority: TodayPriority; group: TodayGroup };

// „Nowe” w Liście „Na dziś” = zapytania z ostatnich 30 dni; starsze nietknięte
// są rozłożone w kalendarzu (maks. 5 dziennie) i wracają wg terminu.
export const FRESH_INQUIRY_DAYS = 30;
export const isFreshInquiry = (l: { createdAt: Date }, now: Date) => now.getTime() - l.createdAt.getTime() <= FRESH_INQUIRY_DAYS * 86_400_000;

const PRIORITY_ORDER: Record<TodayPriority, number> = { late: 0, new: 1, today: 2, back: 3 };
const CALL_STEPS = ["ODDZWONI", "PONOWNA_PROBA", "UMOW_TERMIN", "DOPYTAC"];

// Wniosek 21: „Wracają z wiosny” — 3 telefony dziennie z puli gabinetów
// jeszcze nieobdzwonionych (krok „umówić termin”, bez kontaktu), wg rytmu:
// najpierw ci, którym termin (ostatni przyjazd + rytm) już minął / zbliża się.
export const SPRING_PER_DAY = 3;

export function buildToday<T extends FunnelLead & { nextStepNote?: string | null; sourceRef?: string | null; spring?: { dueAt: string | null } | null; clientStatus?: string | null; clientResigned?: boolean }>(leads: T[], now: Date): TodayItem<T>[] {
  const sod = startOfDay(now);
  const eod = endOfDay(now);
  const out: TodayItem<T>[] = [];
  const springPool: T[] = [];
  for (const l of leads) {
    if (!in2026(l)) continue;
    if (l.sourceRef?.startsWith(SPRING_REF_PREFIX) && l.stage === "WYWIAD" && l.nextStepType === "UMOW_TERMIN" && !l.lastContactAt && l.attempts === 0) {
      // „Nie kontaktować” wypada z puli.
      if (l.clientStatus !== "NIE_KONTAKTOWAC" && !l.clientResigned) springPool.push(l);
      continue;
    }
    const back = l.nextStepType === "POWROT" || (l.nextStepNote ?? "").startsWith("wraca z odłożonych");
    if (l.stage === "ODLOZONE") {
      if (l.returnAt && l.returnAt <= eod) out.push({ lead: l, priority: "back", group: "back" });
      continue;
    }
    if (!isOpen(l)) continue;
    if (untouched(l)) {
      const fresh = isFreshInquiry(l, now);
      // Przegląd 29.09 07:15: kolejna próba i nietknięte starsze niż 30 dni
      // idą wg zaplanowanego terminu (nie wg czasu na kontakt) — nie zalewają
      // „Na dziś” i nie udają „dziś”, gdy próba jest jutro.
      if (l.attempts > 0 || !fresh) {
        if (!l.nextActionAt || l.nextActionAt > eod) continue;
        const late = l.nextActionAt < sod;
        out.push({ lead: l, priority: late ? "late" : fresh ? "new" : "today", group: fresh ? "new" : "calls" });
        continue;
      }
      const due = !l.nextActionAt || l.nextActionAt <= eod;
      const rot = rotInfo(l, now).rotting;
      if (!due && !rot) continue;
      // Pierwszy kontakt po czasie na kontakt — „Po czasie”, inaczej „Nowe”.
      out.push({ lead: l, priority: rot ? "late" : "new", group: "new" });
      continue;
    }
    // Wniosek 21: gabinety z listy „wracają z wiosny” — osobny punkt planu.
    const group: TodayGroup = back ? "back" : l.sourceRef?.startsWith(SPRING_REF_PREFIX) ? "spring" : l.nextStepType === "FOLLOW_UP_OFERTY" ? "followups" : CALL_STEPS.includes(l.nextStepType ?? "") ? "calls" : "other";
    if (l.stage === "REZERWACJA" && !l.rentalId) {
      out.push({ lead: l, priority: "today", group });
      continue;
    }
    if (!l.nextActionAt || l.nextActionAt > eod) continue;
    out.push({ lead: l, priority: l.nextActionAt < sod ? "late" : back ? "back" : "today", group });
  }
  const due = (l: T) => (l.spring?.dueAt ? new Date(l.spring.dueAt).getTime() : Number.MAX_SAFE_INTEGER);
  springPool
    .sort((a, b) => due(a) - due(b) || (a.nextActionAt?.getTime() ?? 0) - (b.nextActionAt?.getTime() ?? 0))
    .slice(0, SPRING_PER_DAY)
    .forEach((l) => out.push({ lead: l, priority: "today", group: "spring" }));
  const t = (x: TodayItem<T>) => (x.priority === "today" || x.priority === "back" ? (x.lead.nextActionAt ?? x.lead.returnAt ?? x.lead.createdAt).getTime() : -x.lead.createdAt.getTime());
  return out.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] || t(a) - t(b));
}

// Przegląd 29.09, pkt 3: „pierwszy kontakt” / „ponowna próba” tylko w etapie
// Nowe. Po wyjściu z Nowe krok zmienia się na odpowiedni dla etapu.
export const FIRST_CONTACT_STEPS = ["PIERWSZY_KONTAKT", "PONOWNA_PROBA"];
// Kontrola 29.09 09:35, pkt 2: krok „follow-up oferty” przed etapem „Oferta
// wysłana” = oferta już poszła → sygnał idzie do „Oferta wysłana” (tylko do
// przodu). Zwraca etap docelowy albo null, gdy etap zostaje.
export function stageForStep(stage: LeadStageKey, step: string | null): LeadStageKey | null {
  return step === "FOLLOW_UP_OFERTY" && (stage === "SYGNAL" || stage === "WYWIAD") ? "OFERTA" : null;
}

export function stepForStage(stage: LeadStageKey, step: string | null): string | null {
  if (stage === "SYGNAL" || !step || !FIRST_CONTACT_STEPS.includes(step)) return step;
  return stage === "OFERTA" ? "FOLLOW_UP_OFERTY" : stage === "REZERWACJA" ? "INNE" : "DOPYTAC";
}
