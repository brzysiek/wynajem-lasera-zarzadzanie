import { addWorkdays } from "@/lib/leads/work-time";
import type { LeadStageKey } from "@/lib/leads/parse-deal";

// Co wiadomość z Messengera / Instagrama robi z otwartym sygnałem (wniosek 42).
// Czysty moduł (vitest). Wykonanie: src/lib/chat/ingest.ts.
// Zasady: nasza odpowiedź → „W kontakcie” + pierwszy kontakt (jak odpowiedź
// mailowa z kontakt@); wiadomość klientki NIE jest kontaktem biura, ale gdy
// sygnał jest odłożony albo nie ma kroku na dziś — krok na „teraz”, żeby
// wiadomość nie czekała w ciszy. Automaty tylko do przodu.

export type ChatLead = {
  stage: LeadStageKey;
  firstContactAt: Date | null;
  lastContactAt: Date | null;
  nextActionAt: Date | null;
};

export type ChatPlan = {
  firstContactAt?: Date;
  lastContactAt?: Date;
  stage?: LeadStageKey;
  clearReturn?: boolean;
  nextActionAt?: Date;
  nextStepType?: string;
  nextStepNote?: string;
  activity: string;
} | null;

const endOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
const at10 = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 10);
const channelName = (c: "MESSENGER" | "INSTAGRAM") => (c === "INSTAGRAM" ? "Instagramie" : "Messengerze");

export function planOutbound(lead: ChatLead, at: Date, channel: "MESSENGER" | "INSTAGRAM"): ChatPlan {
  const lastContactAt = lead.lastContactAt && lead.lastContactAt > at ? lead.lastContactAt : at;
  const firstContactAt = lead.firstContactAt ? undefined : at;
  if (lead.stage === "SYGNAL") {
    return {
      firstContactAt,
      lastContactAt,
      stage: "WYWIAD",
      nextActionAt: at10(addWorkdays(at, 2)),
      nextStepType: "INNE",
      nextStepNote: `sprawdzić odpowiedź klientki na ${channelName(channel)}`,
      activity: `auto · odpowiedź na ${channelName(channel)} → W kontakcie`,
    };
  }
  // Etap bez zmian: tylko ostatni kontakt (bez wpisu na osi — odpowiedzi widać w czacie).
  return lastContactAt.getTime() === lead.lastContactAt?.getTime() ? null : { firstContactAt, lastContactAt, activity: "" };
}

export function planInbound(lead: ChatLead, now: Date, channel: "MESSENGER" | "INSTAGRAM"): ChatPlan {
  if (lead.stage === "ODLOZONE") {
    return {
      stage: "WYWIAD",
      clearReturn: true,
      nextActionAt: now,
      nextStepType: "DOPYTAC",
      nextStepNote: `klientka napisała na ${channelName(channel)} (sygnał był odłożony) — odpowiedzieć`,
      activity: `auto · klientka napisała na ${channelName(channel)}: Odłożone → W kontakcie`,
    };
  }
  if ((lead.stage === "WYWIAD" || lead.stage === "OFERTA") && (!lead.nextActionAt || lead.nextActionAt > endOfDay(now))) {
    return {
      nextActionAt: now,
      nextStepType: "INNE",
      nextStepNote: `klientka napisała na ${channelName(channel)} — odpowiedzieć`,
      activity: `auto · klientka napisała na ${channelName(channel)} → krok na dziś`,
    };
  }
  return null;
}
