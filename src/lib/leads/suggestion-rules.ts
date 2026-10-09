// Sugestia Klaudiusza przy sygnale (wniosek 47, część 2) — reguły czyste
// (vitest bez "@/"): walidacja tekstu, które sygnały wymagają przebiegu agenta
// i w jakiej kolejności, ile nowych wpisów od ostatniej sugestii.

export const SUGGESTION_MAX = 400;

// Zwykły tekst, 1–400 znaków, bez HTML. Zwraca komunikat błędu albo null.
export function validateSuggestionText(text: string): string | null {
  const t = text.trim();
  if (!t) return "Sugestia nie może być pusta.";
  if (t.length > SUGGESTION_MAX) return `Sugestia może mieć najwyżej ${SUGGESTION_MAX} znaków (jest ${t.length}).`;
  if (/<\/?[a-z][^>]*>|<!--/i.test(t)) return "Sugestia ma być zwykłym tekstem, bez HTML.";
  return null;
}

// Wpisy osi czasu, które nie unieważniają sugestii: robota przy szkicu maila
// (agent sam je tworzy przy pracy nad sygnałem).
export function isDraftNoise(entry: { type: string; body: string | null }): boolean {
  return entry.type === "SYSTEM" && (entry.body ?? "").startsWith("Szkic odpowiedzi");
}

export function countNewEntries(coveredUntil: Date, entries: { at: Date; type?: string; body?: string | null }[]): number {
  return entries.filter((e) => e.at.getTime() > coveredUntil.getTime() && !isDraftNoise({ type: e.type ?? "", body: e.body ?? null })).length;
}

// Prośba „Poproś o aktualizację” czeka, dopóki agent nie zapisze nowej sugestii.
export function isRequestPending(requestedAt: Date | null, generatedAt: Date | null): boolean {
  return !!requestedAt && (!generatedAt || requestedAt.getTime() > generatedAt.getTime());
}

export function suggestionReasons(s: { exists: boolean; requestPending: boolean; newEntries: number }): string[] {
  const out: string[] = [];
  if (!s.exists) out.push("brak sugestii");
  if (s.requestPending) out.push("prośba o aktualizację");
  if (s.exists && s.newEntries > 0) out.push(`nowe wpisy (${s.newEntries})`);
  return out;
}

// Kolejność pracy agenta: krok na dziś lub po terminie → prośby o aktualizację →
// reszta (nowe wpisy / brak sugestii) od najnowszej aktywności. Stabilnie w grupie.
export function rankWork<T extends { stepDue: boolean; requestPending: boolean; stepAt: number | null; lastEntryAt: number }>(items: T[]): T[] {
  const tier = (x: T) => (x.stepDue ? 0 : x.requestPending ? 1 : 2);
  return [...items].sort((a, b) => {
    const t = tier(a) - tier(b);
    if (t) return t;
    if (tier(a) === 0) return (a.stepAt ?? 0) - (b.stepAt ?? 0);
    return b.lastEntryAt - a.lastEntryAt;
  });
}
