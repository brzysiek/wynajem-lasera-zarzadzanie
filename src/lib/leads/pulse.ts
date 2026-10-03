import { prisma } from "@/lib/prisma";
import { loadLeadRows, type LeadRow } from "@/lib/leads/load";
import { FUNNEL_FROM, REACH_ORDER } from "@/lib/leads/funnel";
import { LOST_REASON_LABEL, type LostReasonKey } from "@/lib/leads/labels";
import { SPRING_REF_PREFIX } from "@/lib/leads/season-goal";
import { loadSeasonGoal } from "@/lib/leads/season-goal-load";
import { loadPlaybook } from "@/lib/leads/playbook-load";
import { workHoursBetween } from "@/lib/leads/work-time";
import { loadCalendarQueues } from "@/lib/calendar/queues";
import { classifyActivity, classifyOutMail, median, periodBounds, type PulseKind, type PulsePeriod } from "@/lib/leads/pulse-rules";
import { autoMailGmailIds } from "@/lib/leads/auto-mail";

// Wniosek 36: Raport w Sygnałach jako „puls” — czy coś ucieka (stan na
// teraz), ile pracy (okres vs poprzedni, według dat zdarzeń), czy daje efekt
// (cel sezonu, lejek zapytań z okresu, czas do pierwszego kontaktu, powody
// przegranych) i kronika dzień po dniu. Klientki wracające są wliczane.

export type PulseItem = { leadId?: string; rentalId?: string; name: string; note: string };
export type PulseCheck = { key: string; level: "ok" | "bad" | "info"; title: string; sub: string; items: PulseItem[] };
export type PulseEvent = { at: string; kind: PulseKind | "porzadki"; leadId: string | null; name: string; spring: boolean; who: string; userId: string | null; human: boolean; body: string };
export type PulseKpis = { kontakt: number; oferta: number; rez: number; przegrana: number; odlozone: number };

export type PulseReport = {
  period: { key: PulsePeriod; label: string; from: string; to: string; prevFrom: string; prevTo: string };
  person: string | null;
  pulse: { bad: number; checks: PulseCheck[] };
  work: {
    kpis: PulseKpis;
    prev: PulseKpis;
    byPerson: { userId: string | null; name: string; kontakt: number; oferta: number; przegrana: number }[];
    auto: number;
    daily: { day: string; kontakt: number; oferta: number; rez: number }[];
  };
  effect: {
    season: { returning: number; returningTarget: number; fresh: number; freshTarget: number; milestone: string; target: number; total: number };
    funnel: { key: string; label: string; count: number }[];
    medianFirstContactH: number | null;
    firstContactTargetH: number;
    lostReasons: { reason: string; count: number }[];
  };
  events: PulseEvent[];
};

const OPEN = ["SYGNAL", "WYWIAD", "OFERTA", "REZERWACJA"];
// Maile wysłane ze skrzynki biura liczą się osobie, która ją prowadzi
// (decyzja Tomka 30.09: kontakt@ = zawsze Ania).
const MAILBOX_OWNER: Record<string, string> = { "kontakt@wynajemlasera.pl": "Ania" };
const DAY = 86_400_000;
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const dm = (d: Date | string) => new Date(d).toLocaleDateString("pl-PL", { day: "2-digit", month: "2-digit", timeZone: "Europe/Warsaw" });
const nameOf = (r: Pick<LeadRow, "clientName" | "person" | "email" | "title">) => r.clientName ?? r.person ?? r.email ?? r.title;
const cut = (s: string, n = 220) => (s.length > n ? `${s.slice(0, n)}…` : s);

export async function loadPulseReport(opts: { period?: PulsePeriod; personId?: string | null; now?: Date } = {}): Promise<PulseReport> {
  const now = opts.now ?? new Date();
  const period = opts.period ?? "week";
  const b = periodBounds(period, now);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  // Okno danych: poprzedni okres, wykres 10 dni i kronika do 14 dni.
  const windowFrom = new Date(Math.min(b.prevFrom.getTime(), today.getTime() - 13 * DAY));

  const [rows, activities, mails, queues, playbook, office] = await Promise.all([
    loadLeadRows(),
    prisma.leadActivity.findMany({
      where: { createdAt: { gte: windowFrom }, leadId: { not: null } },
      orderBy: { createdAt: "desc" },
      select: { type: true, body: true, createdAt: true, leadId: true, userId: true, user: { select: { name: true, role: true } } },
    }),
    prisma.emailMessage.findMany({
      where: { direction: "OUT", sentAt: { gte: windowFrom }, hiddenReason: null },
      orderBy: { sentAt: "desc" },
      select: { subject: true, sentAt: true, clientId: true, toAddresses: true, mailbox: true, gmailMessageId: true },
    }),
    loadCalendarQueues(now).catch(() => []),
    loadPlaybook(),
    prisma.user.findMany({ where: { role: { in: ["ADMIN", "STAFF"] } }, select: { id: true, name: true } }),
  ]);
  const userByName = new Map(office.map((u) => [u.name, u]));
  const autoIds = await autoMailGmailIds(mails.map((m) => m.gmailMessageId));
  const season = await loadSeasonGoal(playbook.season);
  const byId = new Map(rows.map((r) => [r.id, r]));
  // Mail → sygnał: najnowszy sygnał klienta albo sygnał z tym adresem.
  const leadByClient = new Map<string, LeadRow>();
  const leadByEmail = new Map<string, LeadRow>();
  for (const r of [...rows].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    if (r.clientId) leadByClient.set(r.clientId, r);
    if (r.email) leadByEmail.set(r.email.toLowerCase(), r);
  }

  // ---------------------------------------------------------------- zdarzenia
  const events: PulseEvent[] = [];
  for (const a of activities) {
    const lead = a.leadId ? byId.get(a.leadId) : undefined;
    if (!lead) continue;
    const c = classifyActivity({ type: a.type, body: a.body, userRole: a.user?.role ?? null });
    if (!c.kind && !c.auto) continue;
    events.push({
      at: a.createdAt.toISOString(),
      kind: c.kind ?? "porzadki",
      leadId: lead.id,
      name: nameOf(lead),
      spring: !!lead.sourceRef?.startsWith(SPRING_REF_PREFIX),
      who: c.human ? (a.user?.name ?? "biuro") : a.user?.role === "AGENT" ? `agent${a.user?.name ? ` ${a.user.name}` : ""}` : "automatycznie",
      userId: c.human ? a.userId : null,
      human: c.human,
      body: cut(a.body ?? ""),
    });
  }
  for (const m of mails) {
    const to = Array.isArray(m.toAddresses) ? (m.toAddresses as unknown[]).filter((x): x is string => typeof x === "string").map((x) => x.toLowerCase()) : [];
    const lead = (m.clientId ? leadByClient.get(m.clientId) : undefined) ?? to.map((x) => leadByEmail.get(x)).find(Boolean);
    if (!lead) continue;
    const c = autoIds.has(m.gmailMessageId) ? { contact: false, offer: false, auto: true } : classifyOutMail(m.subject);
    const owner = userByName.get(MAILBOX_OWNER[m.mailbox.toLowerCase()] ?? "");
    const base = { leadId: lead.id, name: nameOf(lead), spring: !!lead.sourceRef?.startsWith(SPRING_REF_PREFIX), who: owner?.name ?? `${m.mailbox.split("@")[0]}@`, userId: owner?.id ?? null };
    if (c.auto) events.push({ ...base, at: m.sentAt.toISOString(), kind: "porzadki", human: false, body: `Automatyczny mail: ${m.subject ?? ""}` });
    else events.push({ ...base, at: m.sentAt.toISOString(), kind: c.offer ? "oferta" : "kontakt", human: true, body: `Mail do klientki: ${m.subject ?? "(bez tematu)"}` });
  }
  events.sort((x, y) => y.at.localeCompare(x.at));

  const person = opts.personId ?? null;
  const mine = (e: PulseEvent) => !person || e.userId === person;
  // Oferty i rezerwacje: jedna na sygnał i dzień (zmiana etapu + mail = jedna oferta).
  const kpis = (from: Date, to: Date): PulseKpis => {
    const inRange = events.filter((e) => e.at >= from.toISOString() && e.at < to.toISOString() && mine(e));
    const uniq = (k: PulseKind) => new Set(inRange.filter((e) => e.kind === k).map((e) => `${e.leadId}|${e.at.slice(0, 10)}`)).size;
    return {
      kontakt: inRange.filter((e) => e.kind === "kontakt" && e.human).length,
      oferta: uniq("oferta"),
      rez: uniq("rez"),
      przegrana: inRange.filter((e) => e.kind === "przegrana").length,
      odlozone: inRange.filter((e) => e.kind === "odlozone").length,
    };
  };
  const cur = kpis(b.from, new Date(now.getTime() + 1));
  const prev = kpis(b.prevFrom, b.prevTo);
  const inPeriod = events.filter((e) => e.at >= b.from.toISOString());
  const people = new Map<string, { userId: string | null; name: string; kontakt: number; oferta: number; przegrana: number }>();
  for (const e of inPeriod) {
    if (!e.human) continue;
    const key = e.userId ?? e.who;
    const p = people.get(key) ?? { userId: e.userId, name: e.userId ? e.who : `maile ${e.who}`, kontakt: 0, oferta: 0, przegrana: 0 };
    if (e.kind === "kontakt") p.kontakt++;
    if (e.kind === "oferta") p.oferta++;
    if (e.kind === "przegrana") p.przegrana++;
    people.set(key, p);
  }
  const daily = Array.from({ length: 10 }, (_, i) => {
    const d = new Date(today.getTime() - (9 - i) * DAY);
    const key = ymd(d);
    const dayEv = events.filter((e) => ymd(new Date(e.at)) === key && mine(e));
    const uniq = (k: PulseKind) => new Set(dayEv.filter((e) => e.kind === k).map((e) => e.leadId)).size;
    return { day: key, kontakt: dayEv.filter((e) => e.kind === "kontakt" && e.human).length, oferta: uniq("oferta"), rez: uniq("rez") };
  });

  // ---------------------------------------------------------------- czy coś ucieka
  const open = rows.filter((r) => OPEN.includes(r.stage) && new Date(r.createdAt) >= FUNNEL_FROM);
  const item = (r: LeadRow, note: string): PulseItem => ({ leadId: r.id, name: nameOf(r), note });
  const isFollowUp = (r: LeadRow) => r.nextStepType === "FOLLOW_UP_OFERTY" || r.stage === "OFERTA";
  const lateAll = open.filter((r) => r.nextActionAt && new Date(r.nextActionAt) < today && r.stage !== "REZERWACJA");
  const lateFollow = lateAll.filter(isFollowUp);
  const lateOther = lateAll.filter((r) => !isFollowUp(r));
  const noContact = open.filter((r) => r.stage === "SYGNAL" && !r.firstContactAt && !r.sourceRef?.startsWith(SPRING_REF_PREFIX) && workHoursBetween(new Date(r.createdAt), now) > 4);
  const noStep = open.filter((r) => !r.nextActionAt && r.stage !== "REZERWACJA");
  const spring = open.filter((r) => r.sourceRef?.startsWith(SPRING_REF_PREFIX) && !r.lastContactAt && !r.firstContactAt);
  const springNoStep = spring.filter((r) => !r.nextActionAt);
  const springPlanned = spring.filter((r) => r.nextActionAt);
  const lastPlanned = springPlanned.map((r) => r.nextActionAt!).sort().pop();
  const backLate = rows.filter((r) => r.stage === "ODLOZONE" && r.returnAt && new Date(r.returnAt) < today);
  const q = (k: string) => queues.find((x) => x.key === k)?.items ?? [];
  const unassigned = q("unassigned");
  const fv = q("invoices");
  const dates = (xs: LeadRow[]) => [...new Set(xs.map((r) => dm(r.nextActionAt!)))].slice(0, 3).join(", ");
  const checks: PulseCheck[] = [
    lateFollow.length
      ? { key: "lateFollow", level: "bad", title: `${lateFollow.length} ${lateFollow.length === 1 ? "przypomnienie" : "przypomnień"} o ofercie po terminie`, sub: `termin: ${dates(lateFollow)}`, items: lateFollow.map((r) => item(r, `follow-up ${dm(r.nextActionAt!)}`)) }
      : { key: "lateFollow", level: "ok", title: "Follow-upy ofert po terminie: 0", sub: "oferty mają przypomnienia w terminie", items: [] },
    lateOther.length
      ? { key: "lateOther", level: "bad", title: `${lateOther.length} ${lateOther.length === 1 ? "krok" : "kroków"} po terminie`, sub: `termin: ${dates(lateOther)}`, items: lateOther.map((r) => item(r, `krok ${dm(r.nextActionAt!)}`)) }
      : { key: "lateOther", level: "ok", title: "Zaległe kroki: 0", sub: "pozostałe kroki w terminie", items: [] },
    noContact.length
      ? { key: "noContact", level: "bad", title: `Nowe zapytania bez kontaktu: ${noContact.length}`, sub: "dłużej niż 4 h robocze", items: noContact.map((r) => item(r, `wpłynęło ${dm(r.createdAt)}`)) }
      : { key: "noContact", level: "ok", title: "Nowe zapytania bez kontaktu: 0", sub: "każde ma rozmowę albo próbę w 4 h rob.", items: [] },
    noStep.length
      ? { key: "noStep", level: "bad", title: `Sygnały bez kroku: ${noStep.length}`, sub: "otwarte bez daty następnego kroku", items: noStep.map((r) => item(r, "brak kroku")) }
      : { key: "noStep", level: "ok", title: "Sygnały bez kroku: 0", sub: "każdy otwarty ma datę", items: [] },
    springNoStep.length
      ? { key: "spring", level: "bad", title: `Wracające z wiosny bez kroku: ${springNoStep.length}`, sub: "bez kontaktu i bez zaplanowanego telefonu", items: springNoStep.map((r) => item(r, "bez kroku")) }
      : springPlanned.length
        ? { key: "spring", level: "info", title: `Wracające z wiosny: ${springPlanned.length} czeka na telefon`, sub: `zaplanowane do ${lastPlanned ? dm(lastPlanned) : "—"}`, items: springPlanned.map((r) => item(r, `krok ${dm(r.nextActionAt!)}`)) }
        : { key: "spring", level: "ok", title: "Wracające z wiosny: wszystkie w kontakcie", sub: "", items: [] },
    backLate.length
      ? { key: "backLate", level: "bad", title: `Odłożone po dacie powrotu: ${backLate.length}`, sub: "niepodjęte", items: backLate.map((r) => item(r, `powrót ${dm(r.returnAt!)}`)) }
      : { key: "backLate", level: "ok", title: "Odłożone po dacie powrotu: 0", sub: "wracają w swoim dniu", items: [] },
    unassigned.length
      ? { key: "unassigned", level: "bad", title: `Rezerwacje bez klienta: ${unassigned.length}`, sub: "Kalendarz → Do dopięcia", items: unassigned.map((i) => ({ rentalId: i.rentalId, name: i.title, note: `${dm(i.startsAt)} · ${i.note}` })) }
      : { key: "unassigned", level: "ok", title: "Rezerwacje bez klienta: 0", sub: "z „Do dopięcia” w Kalendarzu", items: [] },
    { key: "fv", level: fv.length ? "info" : "ok", title: `FV do wystawienia: ${fv.length}`, sub: fv.length ? fv.slice(0, 2).map((i) => i.title).join(", ") : "z „Do dopięcia” w Kalendarzu", items: fv.map((i) => ({ rentalId: i.rentalId, name: i.title, note: i.note })) },
  ];

  // ---------------------------------------------------------------- efekt
  const fresh = rows.filter((r) => !r.returningClient && !r.sourceRef?.startsWith(SPRING_REF_PREFIX) && new Date(r.createdAt) >= b.from && new Date(r.createdAt) >= FUNNEL_FROM);
  const reached = (s: string) => fresh.filter((r) => REACH_ORDER.indexOf(r.maxStage) >= REACH_ORDER.indexOf(s as (typeof REACH_ORDER)[number])).length;
  const firstHours = fresh.filter((r) => r.firstContactAt).map((r) => workHoursBetween(new Date(r.createdAt), new Date(r.firstContactAt!)));
  const lostIds = new Set(inPeriod.filter((e) => e.kind === "przegrana").map((e) => e.leadId));
  const reasons = new Map<string, number>();
  for (const id of lostIds) {
    const r = id ? byId.get(id) : undefined;
    const k = r?.lostReason ?? "INNE";
    reasons.set(k, (reasons.get(k) ?? 0) + 1);
  }

  return {
    period: { key: period, label: b.label, from: b.from.toISOString(), to: b.to.toISOString(), prevFrom: b.prevFrom.toISOString(), prevTo: b.prevTo.toISOString() },
    person,
    pulse: { bad: checks.filter((c) => c.level === "bad").reduce((s, c) => s + c.items.length, 0), checks },
    work: { kpis: cur, prev, byPerson: [...people.values()].sort((x, y) => y.kontakt - x.kontakt), auto: inPeriod.filter((e) => e.kind === "porzadki").length, daily },
    effect: {
      season: { returning: season.returning, returningTarget: playbook.season.returningTarget, fresh: season.fresh, freshTarget: playbook.season.newTarget, milestone: playbook.season.milestone, target: playbook.season.target, total: season.total },
      funnel: [
        { key: "all", label: "Zapytania", count: fresh.length },
        { key: "contact", label: "Rozmowa / kontakt", count: fresh.filter((r) => r.firstContactAt || REACH_ORDER.indexOf(r.maxStage) >= 1).length },
        { key: "offer", label: "Oferta wysłana", count: reached("OFERTA") },
        { key: "rez", label: "Rezerwacja", count: reached("REZERWACJA") },
      ],
      medianFirstContactH: median(firstHours),
      firstContactTargetH: 4,
      lostReasons: [...reasons.entries()].map(([k, n]) => ({ reason: LOST_REASON_LABEL[k as LostReasonKey] ?? k, count: n })).sort((x, y) => y.count - x.count),
    },
    events: events.filter((e) => e.at >= new Date(today.getTime() - 13 * DAY).toISOString()),
  };
}
