// Pasek „Do zrobienia dziś” i Tablica (wniosek 35): zakres „Moje / Wszyscy”,
// notatka o zaległych w kaflu, podpowiedź, gdy „Moje” jest puste. Czyste
// funkcje (vitest bez "@/").

export type TodayOwner = "me" | "all";

// Domyślny zakres wg roli: STAFF (Ania) widzi swoje, ADMIN (Tomek) i agent
// (podgląd) — wszystkich; inaczej pasek Tomka był pusty przy pełnej Tablicy.
export function defaultTodayOwner(who: { isAdmin: boolean; readOnly: boolean }): TodayOwner {
  return who.isAdmin || who.readOnly ? "all" : "me";
}

export function scopeRows<T extends { ownerId: string | null }>(rows: T[], owner: TodayOwner, userId: string): T[] {
  return owner === "me" ? rows.filter((r) => r.ownerId === userId) : rows;
}

// Druga linijka kafla: ile spraw jest po terminie (null = żadna).
export function lateNote(late: number, total: number): string | null {
  if (late <= 0) return null;
  return late >= total ? `${late} · wszystkie po terminie` : `${late} po terminie`;
}

// „Twoje: 0 · wszystkie: 22” — tylko gdy zakres „Moje” jest pusty, a inni mają sprawy.
export function scopeHint(mine: number, all: number): string | null {
  return mine === 0 && all > 0 ? `Twoje: 0 · wszystkie: ${all}` : null;
}
