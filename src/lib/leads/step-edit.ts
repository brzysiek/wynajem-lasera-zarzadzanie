// Karta sygnału (wniosek 47): rodzaje kroku do ręcznej zmiany, tekst skutku
// „Wyniku rozmowy” liczony tą samą funkcją, która go zastosuje (planOutcome),
// i krótka informacja o skutku ręcznej zmiany etapu. Czyste funkcje (vitest).
import { NEXT_STEP_LABEL, NO_ANSWER_LIMIT, planOutcome, type NextStepType, type OutcomeState } from "./funnel";
import { EDITABLE_STEP_TYPES } from "./validate";

// Lista „Edytuj krok”: rodzaje z istniejącego enuma; bieżący rodzaj (np. pierwszy
// kontakt) zawsze na liście, żeby zapis niczego nie zmieniał przypadkiem.
export function stepTypeOptions(current: string | null): { value: string; label: string }[] {
  const base = EDITABLE_STEP_TYPES.filter((t) => t !== "PIERWSZY_KONTAKT");
  const values: string[] = current && !base.includes(current as (typeof base)[number]) && current in NEXT_STEP_LABEL ? [current, ...base] : [...base];
  return values.map((value) => ({ value, label: NEXT_STEP_LABEL[value as NextStepType] }));
}

// „jutro 8:30”, „pon. 12.10, 10:00”, „dziś 16:00”.
export function whenText(at: Date, now: Date): string {
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((day(at) - day(now)) / 86_400_000);
  const hm = `${at.getHours()}:${String(at.getMinutes()).padStart(2, "0")}`;
  if (diff === 0) return `dziś ${hm}`;
  if (diff === 1) return `jutro ${hm}`;
  return `${at.toLocaleDateString("pl-PL", { weekday: "short", day: "2-digit", month: "2-digit" })}, ${hm}`;
}

const dayLabel = (iso: string) => {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}.${m[2]}` : iso;
};

export type OutcomeChoice = "booked" | "no_answer" | "callback" | "later" | "offer" | "resign";

// Skutek wyniku rozmowy przed zatwierdzeniem; null = brak (np. „Umówiła termin”
// przechodzi do rezerwacji, albo brakuje daty).
export function outcomeEffect(
  choice: OutcomeChoice | null,
  lead: OutcomeState,
  now: Date,
  o: { date?: string; kind?: "ODDZWONI" | "DOPYTAC"; postpone?: boolean } = {},
): string | null {
  if (!choice || choice === "booked") return null;
  if (choice === "no_answer") {
    const plan = planOutcome(lead, "no_answer", now);
    if (plan.followUpNo === 2 && lead.nextStepType === "FOLLOW_UP_OFERTY") return plan.nextActionAt ? `→ follow-up 2 z 2, ${whenText(plan.nextActionAt, now)}` : null;
    if (plan.noAnswerLimit) return `→ próba ${plan.attempts} z ${NO_ANSWER_LIMIT} bez odebrania — panel zaproponuje przegraną (brak kontaktu)`;
    return plan.nextActionAt ? `→ próba ${plan.attempts + 1} (nie odebrała ${plan.attempts}×), ponowienie ${whenText(plan.nextActionAt, now)}` : null;
  }
  if (choice === "offer") {
    const plan = planOutcome(lead, "offer_sent", now);
    return plan.nextActionAt ? `→ Oferta wysłana, follow-up ${whenText(plan.nextActionAt, now)}` : null;
  }
  if (choice === "callback") return o.date ? `→ ${o.kind === "DOPYTAC" ? "dopytać" : "oddzwoni"} ${dayLabel(o.date)}` : null;
  if (choice === "later") {
    if (!o.date) return null;
    return o.postpone ? `→ Odłożone do ${dayLabel(o.date)}, w tym dniu wraca do „W kontakcie”` : `→ zostaje „W kontakcie”, krok ${dayLabel(o.date)}`;
  }
  return "→ Przegrana, klientka „Zrezygnowała”";
}

// Po ręcznej zmianie etapu: „Oferta wysłana → follow-up oferty, pon. 12.10, 10:00”.
export function stageEffectText(stageLabel: string, step: { type: string | null; at: string | null }, now: Date): string {
  if (!step.at) return `Etap: ${stageLabel}.`;
  const label = step.type && step.type in NEXT_STEP_LABEL ? NEXT_STEP_LABEL[step.type as NextStepType] : "kolejny krok";
  return `${stageLabel} → ${label}, ${whenText(new Date(step.at), now)}.`;
}
