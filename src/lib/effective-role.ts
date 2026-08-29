// „Podgląd kierowcy" — ADMIN/STAFF z uprawnieniem canActAsDriver mogą
// przełączyć aplikację tak, by zachowywała się jak dla roli KIEROWCA,
// bez zmiany roli w bazie. Stan trzyma cookie ustawiane przez POST /api/view.
//
// Czyste funkcje bez importów — używalne również w middleware (proxy.ts).

export const VIEW_COOKIE = "wl_view";
export const DRIVER_VIEW_VALUE = "driver";

// Czy to ADMIN/STAFF w trybie podglądu kierowcy (nie prawdziwy KIEROWCA).
export function isDriverPreview(
  role: string | undefined,
  canActAsDriver: boolean | undefined,
  viewCookie: string | undefined,
): boolean {
  return role !== "KIEROWCA" && Boolean(canActAsDriver) && viewCookie === DRIVER_VIEW_VALUE;
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
