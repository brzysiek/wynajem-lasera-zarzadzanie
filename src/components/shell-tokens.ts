import type { CSSProperties } from "react";

// Paleta i krój pisma powłoki aplikacji (docs/prompt-claude-code-powloka-aplikacji.md,
// sekcja 3) — WYŁĄCZNIE dla ramy: topbar, sidebar, prawy pasek ikon, rama
// wysuwanego panelu. Treść istniejących stron (Kalendarz, Finanse/*, widok
// kierowcy, panel Zadań) zostaje przy dotychczasowej kolorystyce — nie
// importuj tych tokenów tam. Wzorzec: lokalny obiekt kolorów per moduł, jak
// `C` w revenue-dashboard.tsx, nie globalny @theme (żeby nie ryzykować
// kolizji z klasami Tailwind używanymi gdzie indziej w apce).
export const SHELL = {
  brand: "#1B6FA8",
  brandSoft: "#EAF4FB",
  brandDeep: "#14567F",
  accent: "#E08A5C",
  accentSoft: "#FBF0E7",
  sidebarBg: "#FAFCFD",
  sidebarText: "#5B6167",
  sidebarTextDim: "#9AA1A8",
  bg: "#F2F4F6",
  surface: "#FFFFFF",
  border: "#E9EDF1",
  text: "#4A4A4A",
  textMuted: "#6F7378",
  textFaint: "#9AA1A8",
} as const;

// Klasa na kontener, który ma renderować się krojem Jost (--font-jost,
// wystawionym w layout.tsx) zamiast domyślnego Geist/Arial reszty apki.
export const SHELL_FONT_STYLE: CSSProperties = { fontFamily: "var(--font-jost)" };
