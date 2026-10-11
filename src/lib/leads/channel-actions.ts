// Wniosek 47, część 3/3 (decyzja Tomka 11.10.2026): telefon, SMS i mail NIE są
// uruchamiane z karty sygnału, „Na dziś” ani Tablicy — rozmowy i SMS-y idą ze
// służbowego telefonu, a treść maila powstaje w wątku „BIURO” (szkic od razu w
// Gmailu). Jedna flaga przywraca stary widok (części 1/2 i 2/2): przyciski
// Zadzwoń / SMS / Mail, sekcję „Odpowiedź mailowa”, ✉ na Tablicy i przyciski
// Podpowiedzi wysyłające przez panel. Nic nie jest usunięte z kodu.
export const LEAD_CARD_CHANNEL_ACTIONS = false;
