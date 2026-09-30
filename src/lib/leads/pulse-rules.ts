// Wniosek 36: Raport „puls” — klasyfikacja wpisów według DATY ZDARZENIA
// (LeadActivity.createdAt, zmiany etapu, maile wysłane). Praca ludzi = wpisy
// Ani / Tomka (rola ADMIN / STAFF); agent, SYSTEM bez autora, „auto ·”,
// migracje lejka i automatyczny cennik — „porządki / automatyczne”, nigdy
// praca. Rezerwacje z kalendarza liczą się zawsze (to efekt, nie praca).
// Czysty moduł (vitest, bez Prismy).

export type PulseKind = "kontakt" | "oferta" | "rez" | "przegrana" | "odlozone";

export type ActivityInput = { type: string; body: string | null; userRole: string | null };

export type Classified = { kind: PulseKind | null; human: boolean; auto: boolean };

const OFFICE = ["ADMIN", "STAFF"];
const CONTACT_TYPES = ["CALL", "CALL_NO_ANSWER", "SMS", "NOTE", "EMAIL"];
export const AUTO_PRICE_MAIL = /cennik oraz aktualna oferta/i;

export function classifyActivity(a: ActivityInput): Classified {
  const body = (a.body ?? "").trim();
  const isAutoText = body.startsWith("auto ·") || body.startsWith("auto:");
  const human = !!a.userRole && OFFICE.includes(a.userRole) && !isAutoText;
  // Wpisy synchronizacji lejka z kalendarzem (typ STAGE_CHANGE albo SYSTEM).
  const isRezSystem = (a.type === "SYSTEM" || a.type === "STAGE_CHANGE") && (body.startsWith("Rezerwacja w kalendarzu") || body.startsWith("Powiązano z rezerwacją"));
  if (isRezSystem) return { kind: "rez", human, auto: false };
  if (a.type === "STAGE_CHANGE") {
    const to = body.match(/→\s*([^·—]+)/)?.[1]?.trim() ?? "";
    // Oferta: człowiek albo automat z prawdziwego maila z ofertą; agent — porządki.
    if (to.startsWith("Oferta wysłana") && (human || body.startsWith("auto · mail z ofertą"))) return { kind: "oferta", human, auto: !human };
    if (to.startsWith("Rezerwacja") && human) return { kind: "rez", human, auto: false };
    if (to.startsWith("Przegrana") && human) return { kind: "przegrana", human, auto: false };
    if (to.startsWith("Odłożone") && human) return { kind: "odlozone", human, auto: false };
    return { kind: null, human, auto: !human };
  }
  if (human && CONTACT_TYPES.includes(a.type)) return { kind: "kontakt", human: true, auto: false };
  return { kind: null, human, auto: !human };
}

// Mail wysłany ze skrzynki biura: kontakt (ręczny), a z „ofertą” w temacie
// także sygnał oferty. Automatyczny cennik — porządki.
export function classifyOutMail(subject: string | null): { contact: boolean; offer: boolean; auto: boolean } {
  const s = subject ?? "";
  if (AUTO_PRICE_MAIL.test(s)) return { contact: false, offer: false, auto: true };
  return { contact: true, offer: /ofert/i.test(s), auto: false };
}

// Okres raportu: „ten tydzień” (od poniedziałku) albo N dni wstecz; poprzedni
// okres tej samej długości (dla tygodnia — cały poprzedni tydzień).
export type PulsePeriod = "week" | "7" | "14" | "30";
export function periodBounds(p: PulsePeriod, now: Date): { from: Date; to: Date; prevFrom: Date; prevTo: Date; label: string } {
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (p === "week") {
    const dow = (day.getDay() + 6) % 7; // pon = 0
    const from = new Date(day.getFullYear(), day.getMonth(), day.getDate() - dow);
    const prevFrom = new Date(from.getFullYear(), from.getMonth(), from.getDate() - 7);
    return { from, to: now, prevFrom, prevTo: from, label: "ten tydzień" };
  }
  const n = Number(p);
  const from = new Date(day.getFullYear(), day.getMonth(), day.getDate() - (n - 1));
  const prevFrom = new Date(from.getFullYear(), from.getMonth(), from.getDate() - n);
  return { from, to: now, prevFrom, prevTo: from, label: `${n} dni` };
}

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
