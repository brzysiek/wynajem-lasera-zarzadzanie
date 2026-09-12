import type { CSSProperties } from "react";

// Paleta i krój pisma ramy aplikacji (docs/prompt-claude-code-powloka-aplikacji.md,
// sekcja 3) — topbar, sidebar, prawy pasek ikon, rama wysuwanego panelu.
// Ta sama paleta co wynajemlasera.pl (patrz np. strona produktowa Alma
// Harmony) — #1B6FA8 / #E08A5C / Jost.
export const SHELL = {
  brand: "#1B6FA8",
  brandSoft: "#EAF4FB",
  brandDeep: "#14567F",
  accent: "#E08A5C",
  accentSoft: "#FBF0E7",
  // Lekko błękitne (nie białe/szare) tło sidebaru — celowo "żywsze" niż
  // dawne prawie-białe #FAFCFD, żeby lewy pasek miał wyczuwalny kolor marki
  // nawet gdy żadna pozycja nie jest aktywna.
  sidebarBg: "#EFF6FB",
  sidebarText: "#5B6167",
  sidebarTextDim: "#9AA1A8",
  bg: "#F2F4F6",
  surface: "#FFFFFF",
  border: "#E9EDF1",
  text: "#4A4A4A",
  textMuted: "#6F7378",
  textFaint: "#9AA1A8",
} as const;

// Paleta "premium" dla TREŚCI stron (dashboardy, tabele, formularze) — ten
// sam rdzeń co SHELL (brand/accent/bg/border/text), rozszerzony o kolory
// funkcyjne, których rama nie potrzebuje: głęboki granat na wyróżnione
// bloki (jak sekcja "Kalkulator rentowności" na stronie Alma), złoty/fiolet
// jako stałe etykiety zakresu (Pojazdy/Urządzenia w module Kosztów — NIE
// zmieniaj ich bez przeglądu wszystkich miejsc, które się na nie powołują),
// zielony/czerwony na trendy. Jeden wspólny obiekt zamiast osobnego `C` w
// każdym komponencie, żeby paleta się nie rozjeżdżała między stronami.
export const APP = {
  ...SHELL,
  navy: "#0C3450",
  navySoft: "#DCEAF4",
  gold: "#B5851E",
  goldSoft: "#FBF3E1",
  purple: "#7C3AED",
  purpleSoft: "#F3EBFF",
  green: "#1E9E6B",
  greenSoft: "#E7F7F0",
  red: "#D93025",
  redSoft: "#FCE8E6",
} as const;

// Klasa na kontener, który ma renderować się krojem Jost (--font-jost,
// wystawionym w layout.tsx). Odkąd Jost jest krojem całej aplikacji
// (globals.css), ten helper jest już w większości zbędny — zostaje dla
// miejsc, które chcą go jawnie wymusić niezależnie od dziedziczenia.
export const SHELL_FONT_STYLE: CSSProperties = { fontFamily: "var(--font-jost)" };
