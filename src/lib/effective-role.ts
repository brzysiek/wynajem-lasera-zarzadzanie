// „Podgląd kierowcy" — ADMIN/STAFF z uprawnieniem canActAsDriver mogą
// przełączyć aplikację tak, by zachowywała się jak dla roli KIEROWCA,
// bez zmiany roli w bazie. Stan trzyma cookie ustawiane przez POST /api/view.
//
// Czyste funkcje bez importów — używalne również w middleware (proxy.ts).

export const VIEW_COOKIE = "wl_view";
export const DRIVER_VIEW_VALUE = "driver";
// Podgląd kierowcy z zawężeniem do własnych rezerwacji (te, w których jestem kierowcą).
export const DRIVER_OWN_VIEW_VALUE = "driver_own";

// Czy to ADMIN/STAFF w trybie podglądu kierowcy (nie prawdziwy KIEROWCA).
export function isDriverPreview(
  role: string | undefined,
  canActAsDriver: boolean | undefined,
  viewCookie: string | undefined,
): boolean {
  // AGENT nigdy nie przełącza się w tryb kierowcy (nawet ze starą flagą).
  return (
    role !== "KIEROWCA" &&
    role !== "AGENT" &&
    Boolean(canActAsDriver) &&
    (viewCookie === DRIVER_VIEW_VALUE || viewCookie === DRIVER_OWN_VIEW_VALUE)
  );
}

// Podgląd kierowcy w wariancie „tylko moje” — widać wyłącznie rezerwacje przypisane do tej osoby.
export function isDriverOwnPreview(
  role: string | undefined,
  canActAsDriver: boolean | undefined,
  viewCookie: string | undefined,
): boolean {
  return isDriverPreview(role, canActAsDriver, viewCookie) && viewCookie === DRIVER_OWN_VIEW_VALUE;
}

// Czy żądanie ma się zachować jak dla kierowcy: prawdziwy KIEROWCA albo
// ADMIN/STAFF w podglądzie.
export function actsAsDriver(
  role: string | undefined,
  canActAsDriver: boolean | undefined,
  viewCookie: string | undefined,
): boolean {
  return role === "KIEROWCA" || isDriverPreview(role, canActAsDriver, viewCookie);
}
