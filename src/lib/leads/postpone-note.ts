// Notatka kroku „powrót z odłożonych” (wniosek 49). Odłożenie zastępuje krok
// krokiem POWROT, ale treść poprzedniego kroku (np. skrypt telefonu) nie może
// zniknąć z karty: dopisujemy ją po znaczniku „Wcześniej:” i przenosimy dalej
// przy powrocie. Czysty moduł (vitest), bez schematu bazy.

const PREV = ". Wcześniej: ";
const PREV_MAX = 400;

// „wraca: inny powód — dopisek. Wcześniej: <poprzednia notatka>”
export function postponeStepNote(a: { reasonLabel: string; note: string | null; previous: string | null }): string {
  const head = `wraca: ${a.reasonLabel}${a.note?.trim() ? ` — ${a.note.trim()}` : ""}`;
  const prev = cleanPrevious(a.previous);
  return prev ? `${head}${PREV}${prev}` : head;
}

// Poprzednia notatka z notatki kroku POWROT (albo sama notatka, gdy to nie powrót).
export function previousStepNote(stepType: string | null, note: string | null): string | null {
  if (!note?.trim()) return null;
  if (stepType !== "POWROT" && !note.startsWith("wraca")) return cleanPrevious(note);
  const i = note.indexOf(PREV);
  return i >= 0 ? cleanPrevious(note.slice(i + PREV.length)) : null;
}

// Dopisek z notatki „wraca: <powód> — <dopisek>[. Wcześniej: …]”.
export function postponeAddendum(note: string | null): string | null {
  if (!note?.startsWith("wraca: ")) return null;
  const head = note.includes(PREV) ? note.slice(0, note.indexOf(PREV)) : note;
  const i = head.indexOf(" — ");
  return i >= 0 ? head.slice(i + 3).trim() || null : null;
}

// Krok po powrocie: „wraca z odłożonych (powód) — zapytać o decyzję[ · dopisek]. Wcześniej: …”.
export function returnStepNote(a: { why: string | null; postponeNote: string | null }): string {
  const addendum = postponeAddendum(a.postponeNote);
  const prev = previousStepNote("POWROT", a.postponeNote);
  return `wraca z odłożonych${a.why ? ` (${a.why})` : ""} — zapytać o decyzję${addendum ? ` · ${addendum}` : ""}${prev ? `${PREV}${prev}` : ""}`;
}

function cleanPrevious(s: string | null): string | null {
  const t = s?.trim().replace(/\s+/g, " ");
  return t ? t.slice(0, PREV_MAX) : null;
}
