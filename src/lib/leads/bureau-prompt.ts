import { NEXT_STEP_LABEL, type NextStepType } from "@/lib/leads/funnel";

// „Kopiuj prompt dla BIURO” (wniosek 47, część 3/3): zamiast wysyłać mail / SMS
// z panelu, karta kopiuje do schowka gotowy prompt do wątku „BIURO · [gabinet]”
// w aplikacji Claude. Prompt zawiera tylko dane biznesowe sygnału (id, gabinet,
// etap, krok, urządzenie, termin) — nigdy treści maili klientki. Panel niczego
// nie wysyła i nie woła API modelu; treść promptu nie jest nigdzie pokazywana.

export type BureauKind = "OFERTA_MAIL" | "FOLLOW_UP_MAIL" | "POWROT_MAIL" | "SMS_NIEODEBRANY";

export type BureauInput = {
  id: string;
  name: string; // gabinet (klient) albo osoba / tytuł sygnału
  city: string | null;
  stageLabel: string;
  stepType: string | null;
  stepNote: string | null;
  stepAt: Date | null;
  devices: string[]; // etykiety urządzeń
  dates: string | null; // termin z zapytania, np. „20–24.10”
  followUpNo: number;
  returnAt: Date | null;
};

const NOTE_MAX = 200;
const pad = (n: number) => String(n).padStart(2, "0");

export function formatStepTerm(d: Date): string {
  const base = `${pad(d.getDate())}.${pad(d.getMonth() + 1)}`;
  return d.getHours() === 0 && d.getMinutes() === 0 ? base : `${base}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function stepText(i: BureauInput): string | null {
  const label = i.stepType && i.stepType in NEXT_STEP_LABEL ? NEXT_STEP_LABEL[i.stepType as NextStepType] : i.stepType ? i.stepType : null;
  const note = i.stepNote?.trim().replace(/\s+/g, " ").slice(0, NOTE_MAX) || null;
  const head = [label, note].filter(Boolean).join(" — ");
  const term = i.stepAt ? formatStepTerm(i.stepAt) : null;
  if (!head && !term) return null;
  return [head, term].filter(Boolean).join(", ");
}

const WHAT: Record<BureauKind, string> = {
  OFERTA_MAIL: "mail z ofertą",
  FOLLOW_UP_MAIL: "mail follow-up",
  POWROT_MAIL: "mail follow-up (powrót do rozmowy po odłożeniu)",
  SMS_NIEODEBRANY: "SMS po nieodebranym połączeniu",
};

function goal(kind: BureauKind, i: BureauInput): string {
  switch (kind) {
    case "OFERTA_MAIL":
      return "wyślij ofertę z dwoma wolnymi terminami i ceną z transportem";
    case "FOLLOW_UP_MAIL":
      return `follow-up oferty (${i.followUpNo >= 2 ? "2" : "1"} z 2): zapytaj o wybór jednego z dwóch wolnych terminów, nie o zgodę`;
    case "POWROT_MAIL":
      return "wróć do rozmowy po przerwie i zaproponuj konkretny wolny termin";
    case "SMS_NIEODEBRANY":
      return "krótki SMS po nieodebranym połączeniu z prośbą o kontakt lub informacją, kiedy oddzwonimy";
  }
}

export function buildBureauPrompt(kind: BureauKind, i: BureauInput): string {
  const place = [i.name, i.city].filter(Boolean).join(", ");
  const step = stepText(i);
  const lines = [
    `BIURO · ${i.name}: napisz ${WHAT[kind]} do klientki.`,
    `Sygnał: ${i.id} · ${place} · etap: ${i.stageLabel}${step ? ` · następny krok: ${step}` : ""}.`,
  ];
  const dev = [i.devices.join(", "), i.dates].filter(Boolean).join(", ");
  if (dev) lines.push(`Urządzenie i termin: ${dev}.`);
  lines.push(`Cel: ${goal(kind, i)}.`);
  lines.push(
    kind === "SMS_NIEODEBRANY"
      ? "Weź warunki klientki i wolne terminy z panelu, styl Ani wg skilla. SMS podaj w odpowiedzi do skopiowania (telefon Ani 531 574 115)."
      : "Weź cennik, warunki klientki i wolne terminy z panelu, styl Ani wg skilla. Mail zapisz jako szkic w Gmailu w wątku klientki i dopisz notatkę przy sygnale „szkic w Gmailu: [temat]”.",
  );
  return lines.join("\n");
}

// Opis w karcie (krótki, merytoryczny: co zrobić i dlaczego). Samego promptu
// nie pokazujemy.
export function bureauDescription(kind: BureauKind, i: BureauInput): string {
  switch (kind) {
    case "OFERTA_MAIL": {
      const what = [i.devices.join(", "), i.dates].filter(Boolean).join(", ");
      return `${what ? `Zapytanie dotyczy: ${what}. ` : ""}Warto wysłać ofertę z dwoma wolnymi terminami i ceną z transportem — konkretna propozycja najczęściej kończy się rezerwacją.`;
    }
    case "FOLLOW_UP_MAIL":
      return `Oferta czeka na odpowiedź (follow-up ${i.followUpNo >= 2 ? "2" : "1"} z 2). Warto zapytać o wybór jednego z dwóch wolnych terminów, a nie o zgodę.`;
    case "POWROT_MAIL":
      return `${i.returnAt ? `Sygnał odłożony do ${formatStepTerm(i.returnAt).split(",")[0]}. ` : ""}Przy powrocie warto odnowić kontakt z konkretnym wolnym terminem.`;
    case "SMS_NIEODEBRANY":
      return "Jeśli klientka nie odbiera, krótki SMS z prośbą o kontakt zwykle odblokowuje rozmowę (tekst z szablonu jest wyżej).";
  }
}
