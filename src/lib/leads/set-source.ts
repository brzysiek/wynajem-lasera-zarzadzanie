// Kto albo co ustawił etap i krok sygnału (wniosek 47): kody źródeł, dane do
// zapisu przy każdej zmianie, opisy do karty („ustawił: Ania · 09.10”) i
// odtwarzanie z osi czasu dla sygnałów sprzed wdrożenia. Czysty moduł (vitest).

export type SourceCode =
  | "USER" // ręcznie (pasek etapu, Edytuj krok, Zmień termin, nowy sygnał)
  | "OUTCOME" // wynik rozmowy
  | "TASK" // termin zadania przy sygnale
  | "PROPOSAL" // zaakceptowana propozycja zmiany
  | "AUTO_FORM"
  | "AUTO_MAIL_IN"
  | "AUTO_MAIL_OUT"
  | "AUTO_MAIL_OFFER"
  | "AUTO_MAIL_BOUNCE"
  | "AUTO_RENTAL"
  | "AUTO_SPRING"
  | "AUTO_REPEAT"
  | "AUTO_TAKEOVER"
  | "AUTO_HUBSPOT"
  | "AUTO_RULE";

export const AUTO_LABEL: Record<Exclude<SourceCode, "USER" | "OUTCOME" | "TASK" | "PROPOSAL">, string> = {
  AUTO_FORM: "formularz WWW",
  AUTO_MAIL_IN: "mail od klientki",
  AUTO_MAIL_OUT: "mail wysłany z kontakt@",
  AUTO_MAIL_OFFER: "mail z ofertą",
  AUTO_MAIL_BOUNCE: "mail nie doszedł",
  AUTO_RENTAL: "powiązanie z wynajmem",
  AUTO_SPRING: "lista „Wracają z wiosny”",
  AUTO_REPEAT: "ponowne zapytanie",
  AUTO_TAKEOVER: "scalenie duplikatów",
  AUTO_HUBSPOT: "import z HubSpota",
  AUTO_RULE: "reguła planu dnia",
};

export const SOURCE_CODES = ["USER", "OUTCOME", "TASK", "PROPOSAL", ...Object.keys(AUTO_LABEL)] as SourceCode[];

// Dane do spreadu w prisma.lead.update/create przy zmianie etapu / kroku.
export const stageSet = (code: SourceCode, byId?: string | null, at: Date = new Date()) => ({ stageSource: code, stageSourceById: byId ?? null, stageSourceAt: at });
export const stepSet = (code: SourceCode, byId?: string | null, at: Date = new Date()) => ({ stepSource: code, stepSourceById: byId ?? null, stepSourceAt: at });

const d2 = (d: Date) => d.toLocaleDateString("pl-PL", { day: "2-digit", month: "2-digit" });
const hm = (d: Date) => d.toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" });

// „Ania” / „wynik rozmowy” / „automat (mail od klientki)”.
export function whoText(code: SourceCode | string, userName: string | null): string {
  if (code === "USER") return userName ?? "biuro";
  if (code === "OUTCOME") return "wynik rozmowy";
  if (code === "TASK") return "termin zadania";
  if (code === "PROPOSAL") return "automat (zaakceptowana propozycja)";
  const label = AUTO_LABEL[code as keyof typeof AUTO_LABEL];
  return label ? `automat (${label})` : "automat";
}

// Krok: „ustawił: Ania · 09.10”. Etap (pasek, dymek chipa): „Etap ustawił: … · 09.10, 11:04”.
export function stepSourceText(code: string, userName: string | null, at: Date): string {
  return `ustawił: ${whoText(code, userName)} · ${d2(at)}`;
}
export function stageSourceText(code: string, userName: string | null, at: Date): string {
  return `Etap ustawił: ${whoText(code, userName)} · ${d2(at)}, ${hm(at)}`;
}

// Odtworzenie źródła etapu z wpisu zmiany etapu na osi czasu (sygnały sprzed
// wdrożenia). Zwraca null, gdy wpis nie mówi, kto to zrobił — nie zgadujemy.
export function deriveStageSource(a: { body: string | null; userId?: string | null; userName: string | null; at: Date }): { code: SourceCode; userName: string | null; at: Date } | null {
  const body = (a.body ?? "").trim();
  if (body.startsWith("auto · mail z ofertą")) return { code: "AUTO_MAIL_OFFER", userName: null, at: a.at };
  if (body.startsWith("auto · mail od klientki")) return { code: "AUTO_MAIL_IN", userName: null, at: a.at };
  if (body.startsWith("auto · mail wysłany")) return { code: "AUTO_MAIL_OUT", userName: null, at: a.at };
  if (body.startsWith("Rezerwacja w kalendarzu") || body.startsWith("Powiązano z rezerwacją")) return a.userName ? { code: "USER", userName: a.userName, at: a.at } : { code: "AUTO_RENTAL", userName: null, at: a.at };
  if (a.userName) return { code: "USER", userName: a.userName, at: a.at };
  return null;
}
