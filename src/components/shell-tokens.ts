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

// Chipy statusu klienta (moduł Klienci, docs/crm/mockup-klienci.html) —
// celowo neutralne względem chipów pilności z Zadań. Tło z palety APP, a
// ciemniejsze odcienie tekstu (greenDeep/accentDeep) dopisane tu, bo APP
// ich nie ma. `dot` = kropka na kafelkach segmentów nad listą.
// Ciemne odcienie tekstu na miękkich tłach APP (chipy, awatary) — APP ma
// tylko wersje „soft” i podstawowe, a tekst na soft-tle wymaga ciemniejszego
// odcienia tego samego koloru dla kontrastu.
export const APP_DEEP = {
  green: "#15754F",
  accent: "#8A4414",
  gold: "#8A6414",
  purple: "#5B2BB5",
} as const;

export const CLIENT_STATUS_COLORS = {
  POTENCJALNY: { bg: APP.bg, fg: APP.sidebarText, dot: APP.textFaint, strike: false },
  NOWY: { bg: APP.brandSoft, fg: APP.brandDeep, dot: APP.brand, strike: false },
  STALY: { bg: APP.greenSoft, fg: APP_DEEP.green, dot: APP.green, strike: false },
  USPIONY: { bg: APP.accentSoft, fg: APP_DEEP.accent, dot: APP.accent, strike: false },
  BYLY: { bg: APP.border, fg: APP.text, dot: APP.textMuted, strike: false },
  NIE_KONTAKTOWAC: { bg: APP.bg, fg: APP.textMuted, dot: APP.textFaint, strike: true },
} as const;

// Paleta APP jako zmienne CSS — ustawiane na korzeniu strony, żeby klasy
// Tailwind mogły z nich korzystać także w stanach :hover/:focus
// (np. `hover:bg-[var(--c-brand-soft)]`). Styl inline zawsze wygrywa z
// :hover z klasy, więc kolory interaktywnych elementów NIE mogą iść przez
// `style` — a hexów nie przepisujemy, bo źródłem prawdy jest APP.
export const APP_CSS_VARS = {
  "--c-brand": APP.brand,
  "--c-brand-soft": APP.brandSoft,
  "--c-brand-deep": APP.brandDeep,
  "--c-accent": APP.accent,
  "--c-accent-soft": APP.accentSoft,
  "--c-bg": APP.bg,
  "--c-surface": APP.surface,
  "--c-border": APP.border,
  "--c-text": APP.text,
  "--c-muted": APP.textMuted,
  "--c-faint": APP.textFaint,
  "--c-sidebar-text": APP.sidebarText,
  "--c-navy": APP.navy,
  "--c-navy-soft": APP.navySoft,
  "--c-gold": APP.gold,
  "--c-gold-soft": APP.goldSoft,
  "--c-purple": APP.purple,
  "--c-purple-soft": APP.purpleSoft,
  "--c-green": APP.green,
  "--c-green-soft": APP.greenSoft,
  "--c-red": APP.red,
  "--c-red-soft": APP.redSoft,
  "--c-green-deep": APP_DEEP.green,
  "--c-accent-deep": APP_DEEP.accent,
  "--c-gold-deep": APP_DEEP.gold,
  "--c-purple-deep": APP_DEEP.purple,
} as CSSProperties;

// Klasa na kontener, który ma renderować się krojem Jost (--font-jost,
// wystawionym w layout.tsx). Odkąd Jost jest krojem całej aplikacji
// (globals.css), ten helper jest już w większości zbędny — zostaje dla
// miejsc, które chcą go jawnie wymusić niezależnie od dziedziczenia.
export const SHELL_FONT_STYLE: CSSProperties = { fontFamily: "var(--font-jost)" };
