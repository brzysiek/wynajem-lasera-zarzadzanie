// Lejek v2, etap V3 (automaty): co mail z Gmaila robi z otwartym sygnałem
// klientki. Automaty tylko do przodu — nigdy nie cofają etapu. Czysty moduł
// (vitest bez "@/"). Wykonanie: src/lib/leads/mail-automation.ts.
import { OFFER_FOLLOW_UP_DAYS } from "./funnel";
import { addWorkdays } from "./work-time";
import type { LeadStageKey } from "./parse-deal";

// Maile automatyczne po formularzu WWW — nie są kontaktem biura: cennik
// (wysyła panel) i potwierdzenie rezerwacji (do przepięcia wysyła WordPress;
// 5.10.2026 temat zmieniony ze „Wstępna rezerwacja…” na „Otrzymaliśmy…”).
// Dokładny temat = automat; odpowiedź „Re: …” to już kontakt człowieka.
export const AUTO_PRICE_LIST_SUBJECT = "Cennik oraz aktualna oferta - wynajemlasera.pl";
export const AUTO_WWW_MAIL_SUBJECTS = [
  AUTO_PRICE_LIST_SUBJECT,
  "Wstępna rezerwacja sprzętu WynajemLasera.pl",
  "Otrzymaliśmy Twoją rezerwację — WynajemLasera.pl",
];
// Porównanie odporne na wielkość liter, podwójne spacje i rodzaj myślnika.
const canon = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ").replace(/[—–-]+/g, "-");
const AUTO_CANON = new Set(AUTO_WWW_MAIL_SUBJECTS.map(canon));
export function isAutoWwwMail(subject: string | null | undefined): boolean {
  return AUTO_CANON.has(canon(subject ?? ""));
}

// Mail z ofertą (decyzja Tomka 28.09): temat z „ofert”, ale nie automatyczny
// cennik i nie odpowiedź w jego wątku („Re: Cennik oraz aktualna oferta…”).
export function isOfferMail(subject: string | null): boolean {
  const s = (subject ?? "").toLowerCase();
  return s.includes("ofert") && !s.includes("cennik oraz aktualna oferta");
}

// Maile starsze niż ten limit (import historii) nie przesuwają sygnałów —
// historię uporządkowała migracja V1.
export const MAIL_AUTOMATION_MAX_AGE_DAYS = 7;

export type MailEvent = { direction: "IN" | "OUT"; subject: string | null; sentAt: Date };
export type MailLead = { stage: LeadStageKey; firstContactAt: Date | null; lastContactAt: Date | null; createdAt: Date };

export type MailPlan = {
  firstContactAt?: Date;
  lastContactAt: Date;
  stage?: LeadStageKey;
  nextActionAt?: Date;
  nextStepType?: string;
  nextStepNote?: string;
  followUpNo?: number;
  activity: string;
} | null;

const at10 = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 10);

export function planMailForLead(lead: MailLead, mail: MailEvent, now: Date): MailPlan {
  if (mail.sentAt < lead.createdAt) return null;
  if (now.getTime() - mail.sentAt.getTime() > MAIL_AUTOMATION_MAX_AGE_DAYS * 86_400_000) return null;
  if (mail.direction === "OUT" && isAutoWwwMail(mail.subject)) return null;
  const subject = mail.subject?.trim() || "(bez tematu)";
  const lastContactAt = lead.lastContactAt && lead.lastContactAt > mail.sentAt ? lead.lastContactAt : mail.sentAt;
  const firstContactAt = lead.firstContactAt ? undefined : mail.sentAt;
  const untouched = lead.stage === "SYGNAL";

  if (mail.direction === "IN") {
    // Odpowiedź klientki: kontakt; nietknięty sygnał → W kontakcie z krokiem na dziś.
    return {
      firstContactAt,
      lastContactAt,
      ...(untouched ? { stage: "WYWIAD" as const, nextActionAt: now, nextStepType: "INNE", nextStepNote: "odpowiedzieć na maila klientki" } : {}),
      activity: `auto · mail od klientki: „${subject}”${untouched ? " → W kontakcie" : ""}`,
    };
  }
  if (isOfferMail(mail.subject) && (lead.stage === "SYGNAL" || lead.stage === "WYWIAD")) {
    return {
      firstContactAt,
      lastContactAt,
      stage: "OFERTA",
      nextActionAt: at10(addWorkdays(mail.sentAt, OFFER_FOLLOW_UP_DAYS[0])),
      nextStepType: "FOLLOW_UP_OFERTY",
      nextStepNote: "follow-up 1 z 2",
      followUpNo: 1,
      activity: `auto · mail z ofertą: „${subject}” → Oferta wysłana · follow-up za ${OFFER_FOLLOW_UP_DAYS[0]} dni rob.`,
    };
  }
  return {
    firstContactAt,
    lastContactAt,
    ...(untouched ? { stage: "WYWIAD" as const, nextActionAt: at10(addWorkdays(mail.sentAt, 3)), nextStepType: "INNE", nextStepNote: "sprawdzić odpowiedź na maila" } : {}),
    activity: `auto · mail wysłany: „${subject}”${untouched ? " → W kontakcie" : ""}`,
  };
}

// Odbity mail (lejek v2, 3.3 pkt 6): nadawca mailer-daemon / postmaster albo
// temat o niedoręczeniu; adres z nagłówka X-Failed-Recipients.
export function bounceRecipients(h: Record<string, string | undefined>): string[] {
  const from = (h["from"] ?? "").toLowerCase();
  const subject = (h["subject"] ?? "").toLowerCase();
  const bounce = /mailer-daemon|postmaster/.test(from) || /(undeliverable|delivery status notification|niedostarczon|mail delivery failed|returned mail|nie można dostarczyć)/.test(subject);
  if (!bounce) return [];
  return (h["x-failed-recipients"] ?? "")
    .split(/[,\s]+/)
    .map((a) => a.trim().toLowerCase())
    .filter((a) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a));
}
