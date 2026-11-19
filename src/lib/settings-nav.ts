// Wniosek 55: Ustawienia w 6 grupach (menu boczne), strona startowa i uprawnienia.
// Czysty moduł (vitest bez „@/”): definicja grup, widoczność i tryb dostępu zależny od roli.
//
// Uprawnienia (decyzja Tomka 19.11.2026): STAFF (Ania) widzi wszystkie grupy i stronę
// startową; edytuje wszędzie poza pozycjami `restricted` (Użytkownicy, Integracje,
// Messenger / Instagram — klucze i tokeny, Importy historii) — tam tylko podgląd, bez
// sekretów, bez przycisków; API odrzuca zapis (403).

export type SettingsRole = "ADMIN" | "STAFF" | string | null | undefined;

export type SettingsItem = {
  href: string;
  label: string;
  hint: string;
  restricted?: boolean; // STAFF: tylko podgląd
  outside?: boolean; // strona poza /ustawienia (np. Marketing → Ustawienia pomiaru)
};

export type SettingsGroup = { key: string; title: string; description: string; items: SettingsItem[] };

export const SETTINGS_HOME = "/ustawienia/przeglad";
export const SETTINGS_STAFF_HOME = "/ustawienia/przypomnienia-sms";

export const SETTINGS_GROUPS: SettingsGroup[] = [
  {
    key: "oferta",
    title: "Oferta",
    description: "Ceny, ściąga dla zespołu i maile z ofertą.",
    items: [
      { href: "/ustawienia/cennik", label: "Cennik", hint: "Ceny wynajmu, transport, dopłaty" },
      { href: "/ustawienia/sciaga", label: "Ściąga", hint: "Podpowiedzi dla zespołu na etapach lejka" },
      { href: "/ustawienia/mail-cennik", label: "Maile automatyczne", hint: "Cennik i potwierdzenie rezerwacji z formularzy WWW" },
    ],
  },
  {
    key: "zapytania",
    title: "Zapytania i skrzynka",
    description: "Jak zapytania trafiają do sygnałów: formularze, maile, Messenger.",
    items: [
      { href: "/ustawienia/formularze-www", label: "Formularze WWW → sygnały", hint: "Zgłoszenia z formularzy strony i ich obsługa" },
      { href: "/ustawienia/maile-sygnaly", label: "Maile → sygnały", hint: "Filtr maili od nowych osób" },
      { href: "/ustawienia/wykluczenia", label: "Wykluczenia maili", hint: "Adresy i domeny pomijane przy dopasowaniu" },
      { href: "/ustawienia/messenger-instagram", label: "Messenger / Instagram", hint: "Połączenie z Meta, odbiór wiadomości", restricted: true },
    ],
  },
  {
    key: "sms",
    title: "SMS",
    description: "Szablony i reguły automatycznych przypomnień.",
    items: [
      { href: "/ustawienia/szablony-sms", label: "Szablony", hint: "Treści SMS-ów do klientek" },
      { href: "/ustawienia/przypomnienia-sms", label: "Przypomnienia", hint: "Reguły i harmonogram (kolejka i log są w Wysyłce SMS)" },
    ],
  },
  {
    key: "flota",
    title: "Flota i koszty",
    description: "Pojazdy kierowców i kategorie kosztów.",
    items: [
      { href: "/ustawienia/pojazdy", label: "Pojazdy", hint: "Spalanie i dane pojazdów do kosztów paliwa" },
      { href: "/ustawienia/kategorie-kosztow", label: "Kategorie kosztów", hint: "Podział wpisów kosztów" },
    ],
  },
  {
    key: "marketing",
    title: "Marketing",
    description: "Pomiar reklam.",
    items: [{ href: "/marketing/ustawienia", label: "Konwersje Google Ads", hint: "Import kosztów i eksport konwersji (w zakładce Marketing)", outside: true }],
  },
  {
    key: "system",
    title: "System",
    description: "Konta, połączenia z usługami i jednorazowe importy.",
    items: [
      { href: "/ustawienia/uzytkownicy", label: "Użytkownicy", hint: "Konta, role, dostęp agenta AI (tokeny i log wywołań)", restricted: true },
      { href: "/ustawienia/integracje", label: "Integracje", hint: "Połączenia i klucze: Google, HubSpot, Fakturownia, SzybkiSMS", restricted: true },
      { href: "/ustawienia/importy", label: "Importy historii", hint: "Narzędzia jednorazowe: HubSpot, kalendarze, faktury", restricted: true },
    ],
  },
];

export const canSeeSettings = (role: SettingsRole): boolean => role === "ADMIN" || role === "STAFF";

// „edit” — pełna edycja; „view” — tylko podgląd (STAFF w pozycjach z restricted).
export function itemAccess(item: Pick<SettingsItem, "restricted">, role: SettingsRole): "edit" | "view" | "none" {
  if (role === "ADMIN") return "edit";
  if (role === "STAFF") return item.restricted ? "view" : "edit";
  return "none";
}

// /ustawienia: ADMIN ląduje na stronie startowej, STAFF w grupie SMS.
export const homeFor = (role: SettingsRole): string => (role === "ADMIN" ? SETTINGS_HOME : SETTINGS_STAFF_HOME);

export function findItem(pathname: string): { group: SettingsGroup; item: SettingsItem } | null {
  let best: { group: SettingsGroup; item: SettingsItem } | null = null;
  for (const group of SETTINGS_GROUPS) {
    for (const item of group.items) {
      if (pathname === item.href || pathname.startsWith(`${item.href}/`)) {
        if (!best || item.href.length > best.item.href.length) best = { group, item };
      }
    }
  }
  return best;
}

// Dostęp do strony po ścieżce (pozycja spoza menu, np. przegląd = edycja).
export function accessForPath(pathname: string, role: SettingsRole): "edit" | "view" | "none" {
  if (!canSeeSettings(role)) return "none";
  const f = findItem(pathname);
  return f ? itemAccess(f.item, role) : "edit";
}
