import type { CSSProperties } from "react";

// Paleta i krój pisma ramy aplikacji — topbar, sidebar, prawy pasek ikon,
// rama wysuwanego panelu. Od 27.09.2026 tokeny ze wzoru karty klienta
// (prompt-code-karta-klienta.md, sekcja 1): akcent zieleń #0E5C58, tło
// #F3F5F7, tekst #14191F, krój Public Sans. Wcześniej #1B6FA8 / Jost.
export const SHELL = {
  brand: "#0E5C58",
  brandSoft: "#DDEDEA",
  brandDeep: "#083F3C",
  accent: "#C2620A",
  accentSoft: "#FDF1E1",
  sidebarBg: "#FFFFFF",
  sidebarText: "#3F4852",
  sidebarTextDim: "#8A94A0",
  bg: "#F3F5F7",
  surface: "#FFFFFF",
  border: "#DDE2E8",
  text: "#14191F",
  textMuted: "#56606B",
  textFaint: "#8A94A0",
} as const;

// Dodatkowe tokeny wzoru karty: linie podziału, tło wewnętrzne, tekst
// drugorzędny (ciemniejszy), obramowanie przycisków, ostrzeżenie.
export const TOKENS = {
  divider: "#EDF0F3",
  inner: "#F7F9FA",
  textSecondary: "#3F4852",
  buttonBorder: "#CBD2DA",
  brandSoftBorder: "#B9D8D3",
  warnBg: "#FDF1E1",
  warnBorder: "#F2D2A6",
  warnText: "#5E2C02",
  warnTextSoft: "#7A3A04",
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
  navy: "#14191F",
  navySoft: "#EDF0F3",
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
  accent: "#7A3A04",
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

// Etapy sygnału (moduł Sygnały, docs/crm/mockup-sygnaly.html) — miękkie tło
// z palety APP + ciemny odcień tekstu, jak chipy statusu klienta.
export const LEAD_STAGE_COLORS = {
  SYGNAL: { bg: APP.accentSoft, fg: APP_DEEP.accent, dot: APP.accent },
  WYWIAD: { bg: APP.brandSoft, fg: APP.brandDeep, dot: APP.brand },
  OFERTA: { bg: APP.goldSoft, fg: APP_DEEP.gold, dot: APP.gold },
  REZERWACJA: { bg: APP.purpleSoft, fg: APP_DEEP.purple, dot: APP.purple },
  WYGRANA: { bg: APP.greenSoft, fg: APP_DEEP.green, dot: APP.green },
  PRZEGRANA: { bg: APP.redSoft, fg: APP.red, dot: APP.red },
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
  "--c-divider": TOKENS.divider,
  "--c-inner": TOKENS.inner,
  "--c-text-2": TOKENS.textSecondary,
  "--c-btn-border": TOKENS.buttonBorder,
  "--c-brand-soft-border": TOKENS.brandSoftBorder,
  "--c-warn-bg": TOKENS.warnBg,
  "--c-warn-border": TOKENS.warnBorder,
  "--c-warn-text": TOKENS.warnText,
  "--c-warn-text-2": TOKENS.warnTextSoft,
} as CSSProperties;

// Krój ramy aplikacji — Public Sans (--font-app, src/app/fonts/fonts.css).
// Jest krojem całego panelu (globals.css), więc helper zostaje tylko dla
// miejsc, które wymuszają go jawnie.
export const SHELL_FONT_STYLE: CSSProperties = { fontFamily: "var(--font-app)" };
