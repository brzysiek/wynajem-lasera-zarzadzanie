import { useSyncExternalStore } from "react";

// Dopasowanie media query bez setState w efekcie (useSyncExternalStore).
// Na serwerze zwraca `false` — układ mobilny jest bezpiecznym domyślnym.
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}
