# API agenta (Claude / „Klaudiusz”)

JSON API do pracy agenta nad porządkami danych: wnioski, uwagi, dziennik zmian, reguły, odczyt klientów, sygnałów, dopasowań i faktur oraz zmiana danych klientów z automatycznym wpisem w dzienniku.

## Konektor MCP (claude.ai) — zalecany sposób

Panel ma serwer MCP: `https://panel.wynajemlasera.pl/api/mcp`. Po podłączeniu agent w claude.ai widzi panel jako zestaw narzędzi (tak jak Gmail czy HubSpot), a token nigdy nie trafia do czatu.

**Podłączenie** (robi administrator, raz):

1. claude.ai → Ustawienia → Konektory → Dodaj własny konektor.
2. Nazwa: „Panel WynajemLasera”. Adres: `https://panel.wynajemlasera.pl/api/mcp`. Pola OAuth zostaw puste, bo claude.ai zarejestruje się samo.
3. Kliknij **Połącz**. Otworzy się okno panelu. Zaloguj się jako administrator i na ekranie zgody wybierz konto agenta („Klaudiusz”), potem **Zezwól**.
4. Połączenie pojawi się w **Ustawienia → Użytkownicy → Klaudiusz → Tokeny API** jako „konektor (OAuth)”. Tam unieważnisz je jednym kliknięciem.

**Zasady tokenów OAuth:**

- Token dostępu jest ważny 1 godzinę i claude.ai sam go odświeża.
- Odświeżanie wygasa po 30 dniach bez użycia.
- Dostęp działa zawsze jako konto z rolą AGENT, z tymi samymi regułami co to API.
- Każde wywołanie trafia do logu jako `/api/mcp tools/call:<narzędzie>`.

**Zabezpieczenia OAuth:**

- PKCE S256 jest obowiązkowe.
- Adresy powrotu mogą prowadzić wyłącznie do `https://claude.ai/api/mcp/auth_callback` albo `https://claude.com/api/mcp/auth_callback`.
- Kod autoryzacji jest ważny 5 minut i działa tylko raz.
- Zgodę wydaje wyłącznie zalogowany administrator.

**Dostęp sieciowy.** Na produkcji musi przechodzić ruch z adresów Anthropic (`160.79.104.0/21`). Konektor działa tylko na produkcji. Serwer testowy ma ścieżkę `/wynajem`, a claude.ai szuka metadanych OAuth w katalogu głównym domeny.

**Stały token zamiast OAuth.** Jeśli w organizacji claude.ai jest sekcja „Request headers”, można zamiast OAuth wpisać nagłówek `Authorization: Bearer <token z Ustawień>`.

**Narzędzia.** Odpowiadają trasom opisanym niżej:

- **Odczyt:** `reguly_porzadkow`, `klienci_lista`, `klient`, `sygnaly_lista`, `sygnal`, `kalendarz_wynajmy`, `dopasowania`, `faktury`, `fv_bez_faktury`, `archiwum`, `dziennik`, `wnioski_lista`, `wniosek`, `uwagi_lista`, `zadania_lista`, `osoby_biura`.
- **Zapis:** `klient_zmien`, `osoba_zmien`, `osoba_dodaj`, `klienci_scal`, `przenies_do_klientow`, `notatka_klient`, `notatka_sygnal`, `zadanie_utworz` (pole `dla` przyjmuje id albo imię, np. „Ania”), `zadanie_zmien` (tylko własne zadania), `zadanie_komentarz`, `wniosek_utworz`, `wniosek_zmien`, `wniosek_komentarz`, `uwaga_utworz`, `uwaga_zmien`, `dziennik_wpis`, `propozycje_dodaj`, `propozycje_lista`, `dopasowanie_decyzja`; odczyt także `podejrzane_zlepki`.

---

## Adres i uwierzytelnienie

- Produkcja: `https://panel.wynajemlasera.pl/api/agent/…`
- Serwer testowy: `https://<host testowy>/wynajem/api/agent/…`

Każde żądanie musi mieć nagłówek:

```
Authorization: Bearer wla_…
```

Token tworzy administrator w **Ustawienia → Użytkownicy → (konto z rolą Agent AI) → Tokeny API → Utwórz token**. Przy tworzeniu wybiera ważność: 30, 90 (domyślnie), 180 albo 365 dni. Token jest pokazywany tylko raz, bo w bazie zapisuje się wyłącznie jego skrót. Unieważnia się go tam samo przyciskiem **Unieważnij**, i działa to od razu. Token działa tylko dla konta z rolą `AGENT`. Po zmianie roli konta token przestaje działać.

- **Limit:** 120 zapytań na minutę na token. Po jego przekroczeniu serwer zwraca `429` z nagłówkiem `Retry-After: 60`.
- **Log:** każde wywołanie jest zapisywane (token, metoda, ścieżka, status, czas). Administrator widzi je w **Tokeny API → Ostatnie wywołania**.

## Odpowiedzi i błędy

- Sukces: `200`, a przy utworzeniu rekordu `201`. Treść to JSON.
- Błąd: `{ "message": "czytelny opis po polsku" }` z kodem:

| Kod | Znaczenie |
|-----|-----------|
| 400 | Złe dane |
| 401 | Brak tokenu albo token zły lub unieważniony |
| 403 | Poza uprawnieniami agenta |
| 404 | Rekord nie istnieje |
| 409 | Konflikt |
| 429 | Przekroczony limit zapytań |
| 500 | Błąd serwera |

Listy z paginacją przyjmują `?strona=1&na_strone=50` (maksymalnie 200) i zwracają:

```json
{ "items": [...], "page": 1, "perPage": 50, "total": 431, "pages": 9 }
```

Daty w parametrach mają format `RRRR-MM-DD`.

## Czego agent nie może

Agent nie ma dostępu do tych operacji, także przez sesję w przeglądarce, bo panel egzekwuje to po stronie serwera:

- wysyłać SMS-ów ani maili;
- tworzyć ani zmieniać rezerwacji;
- usuwać czegokolwiek;
- archiwizować;
- zmieniać statusów decyzyjnych wniosków;
- zmieniać ustawień i użytkowników;
- zmieniać ceny transportu, odległości ani „stałych ustaleń” klienta.

---

## Sprawdzenie tokenu

```bash
curl -H "Authorization: Bearer $TOKEN" https://panel.wynajemlasera.pl/api/agent/me
```

```json
{ "userId": "67b9…", "name": "Klaudiusz", "role": "AGENT", "rateLimitPerMinute": 120 }
```

## Reguły porządków

Przeczytaj je przed pracą.

`GET /api/agent/reguly` zwraca `{ "rules": [{ "id", "body", "example", "createdBy", "createdAt" }] }`.

---

## Klienci

### `GET /api/agent/klienci`

Filtry (wszystkie opcjonalne):

| Parametr | Znaczenie |
|----------|-----------|
| `brak_telefonu=1` | żadna osoba nie ma telefonu |
| `brak_nip=1` | klient bez NIP |
| `brak_miasta=1` | klient bez miasta |
| `status=` | `POTENCJALNY`, `NOWY`, `STALY`, `USPIONY`, `BYLY` albo `NIE_KONTAKTOWAC` |
| `miasto=` | fragment nazwy, bez polskich znaków |
| `zmienione_od=RRRR-MM-DD` | dane zmienione od tej daty |
| `zapytania=1` | tylko kontakty z zapytań |
| `zapytania=0` | tylko klienci |
| `q=` | nazwa, NIP, osoba, e-mail albo telefon |

Element listy: `id`, `name`, `status`, `qualified`, `nip`, `street`, `zip`, `city`, `country`, `clinicType`, `source`, `statusOverride`, `hubspotCompanyId`, `contacts[]` (`id`, `firstName`, `lastName`, `phone`, `phone2`, `email`, `role`, `isPrimary`, `hubspotContactId`), `rentalsTotal`, `lastRentalAt`, `lastContactAt`, `createdAt`, `updatedAt`.

```bash
curl -H "Authorization: Bearer $TOKEN" \
  "https://panel.wynajemlasera.pl/api/agent/klienci?brak_nip=1&status=STALY&na_strone=100"
```

### `GET /api/agent/klienci/:id`

Zwraca pełną kartę klienta: dane, osoby, wynajmy i faktury, komunikację i historię.

### `PATCH /api/agent/klienci/:id`

Zmienia dane klienta. Każde zmienione pole trafia do dziennika z wartością przed i po oraz do pochodzenia pola (`fieldMeta`: źródło, data weryfikacji, kto). Pole zmienione w panelu albo przez agenta ma `lockedManual = true`, więc synchronizacja z HubSpotem i uzupełnianie po NIP go nie nadpisują.

**Nowe pola karty** (MCP: `klient_zmien`):

- tożsamość: `shortName`, `regon`, `legalForm`, `businessStartDate`, `pkd` (`[{ code, name, main }]`), `vatStatus`, `bankAccounts`;
- paszport dostawy: `deliveryAddress`, `deliveryNotes` (`{ entrance, floor, parking, power, receiver }`);
- profil gabinetu: `services`, `openingHours`, `links` (`{ www, instagram, facebook, booksy, fresha }`), `ownDevices`, `seasonality`;
- zgody: `invoiceEmail`, `marketingConsent` (`{ email, sms, date, source }`), `smsReminders`, `googleReview` (`{ askedAt, given }`);
- baner „Następny krok”: `nextStepText` (pierwsza linia to krok, dalsze to kontekst) i `nextStepDueAt`.

Warunki handlowe zgłaszasz tylko propozycją `pole`:

- `agreedPrice`: cena ustalona za sam wynajem;
- `transportPriceNet`: transport;
- `paymentForm`: `gotówka`, `przelew` albo `oba`;
- `paymentTerms`;
- `frameAgreement`.

Status „po terminie” dostaje tylko faktura klienta z formą płatności `przelew`, jeśli wyciąg obejmuje termin. Przy innej formie płatności faktura bez przelewu ma status „brak przelewu”. Gotówkę oznacza biuro na karcie klienta: data i kto przyjął.

Osoba (MCP: `osoba_zmien`) ma dodatkowo:

- `roles`: `owner`, `decides`, `invoices`, `reception`, `cosmetologist`;
- `preferredChannel`;
- `salutation`, np. „Pani Basiu”;
- `trainedOn`: `[{ device, date }]`.

Szanse sprzedaży dodajesz narzędziem MCP `szansa_dodaj`. Pola: `urzadzenie`, `etap`, `szansa`, `ostatni_kontakt`, `wrocic`, `opis`, a do tego `zrodlo`, `pewnosc` i `paczka`.

**Wymagane:**

| Pole | Wartość |
|------|---------|
| `zrodlo` | skąd wiadomo, na przykład „mail kontakt@ 2026-03-14, temat …”, „Biała lista NIP”, „FV 12/03/2026” |
| `pewnosc` | `wysoka`, `srednia` albo `niska` |
| `paczka` | identyfikator paczki akceptacji, na przykład `P-2026-09-27-01` |

**Pola, które agent może zmienić:**

| Pole | Wartość |
|------|---------|
| `name` | nazwa |
| `nip` | 10 cyfr, może być z kreskami |
| `street`, `zip`, `city`, `country` | adres |
| `clinicType` | `GABINET_KOSMETOLOGICZNY`, `KLINIKA_MEDYCYNY_ESTETYCZNEJ`, `SALON_BEAUTY`, `KOSMETOLOG_MOBILNY`, `INNE` albo `null` |
| `source` | źródło pozyskania klienta: `FORMULARZ_WWW`, `TELEFON`, `POLECENIE`, `GOOGLE_ADS`, `META`, `POWRACAJACY`, `INNE` albo `null`. To nie jest źródło zmiany. |
| `deviceInterests` | lista wartości: `LIGHTSHEER`, `LIGHTSHEER_ET400`, `ALMA_HARMONY`, `COOLTECH`, `RESURFX`, `OBSERV`, `SZKOLENIE` |
| `statusOverride` | `"NIE_KONTAKTOWAC"` albo `null` |

Każde inne pole kończy się odpowiedzią `403`.

```bash
curl -X PATCH -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  https://panel.wynajemlasera.pl/api/agent/klienci/ckx123 \
  -d '{"city":"Kraków","nip":"6790001122","zrodlo":"Biała lista NIP 6790001122","pewnosc":"wysoka","paczka":"P-2026-09-27-01"}'
```

```json
{ "changed": 2, "refreshedRentals": 1 }
```

`refreshedRentals` to liczba nadchodzących wynajmów, na których zaktualizowano dane klienta.

### `PATCH /api/agent/klienci/:id/kontakty/:contactId`

Zmienia osobę kontaktową. Pola: `firstName`, `lastName`, `phone`, `phone2`, `phone2Label`, `email`, `role` oraz `isPrimary: true`, żeby ustawić tę osobę jako główną. Te same wymagane pola co wyżej: `zrodlo`, `pewnosc`, `paczka`. Telefon jest normalizowany do formatu +48….

### `POST /api/agent/klienci/:id/scal`

Scala duplikat w klienta `:id`. Body: `{ "zrodlowy_id": "<id duplikatu>", "zrodlo": "…", "pewnosc": "…", "paczka": "…" }` — wszystkie wymagane.

Wszystko z duplikatu przechodzi na klienta `:id`: osoby, wynajmy, historia, faktury, sygnały, notatki, zadania, SMS-y, e-maile, uwagi, aliasy i powiązania wniosków. Puste pola klienta `:id` uzupełniają się danymi z duplikatu. Sam duplikat trafia do archiwum z powodem „duplikat”, więc da się go przywrócić.

W dzienniku powstają trzy rodzaje wpisów:

- `MERGE`: co przeniesiono;
- zmiany pól klienta `:id`;
- `ARCHIVE` duplikatu.

W HubSpocie nic się nie zmienia.

Odpowiedź: `{ "moved": { "osoby": 1, "wynajmy": 2, … } }`.

## Propozycje zmian (kolejka akceptacji)

Większe porządki zgłaszaj jako **paczkę propozycji**, nie bezpośrednimi zmianami. Administrator widzi je w **Porządki → Propozycje**, pogrupowane w paczki. Może je zaakceptować albo odrzucić, pojedynczo lub hurtem (z filtrem „tylko wysoka pewność” i „zaznacz wszystkie”), i może poprawić wartość przed akceptacją.

**Co się dzieje po akceptacji:**

- Zmiana wykonuje się od razu.
- W dzienniku jako „wykonał” zapisuje się autor propozycji, a jako „zatwierdził” administrator.
- Jeśli wartość w panelu zmieniła się od zgłoszenia, propozycja jest pomijana jako konflikt. Administrator może ją zaakceptować mimo to.

`POST /api/agent/propozycje`, narzędzie MCP `propozycje_dodaj`. Maksymalnie 500 propozycji w jednym zgłoszeniu:

```json
{
  "propozycje": [
    { "rodzaj": "pole", "klient_id": "ckx1", "pole": "city", "proponowane": "Kraków", "klasa": "miasto_slownik",
      "zrodlo": "słownik miast", "pewnosc": "wysoka", "paczka": "P-2026-09-27-01" },
    { "rodzaj": "osoba", "klient_id": "ckx1", "osoba_id": "ckp9", "pole": "phone", "proponowane": "601 000 111",
      "zrodlo": "stopka maila 14.03", "pewnosc": "srednia", "paczka": "P-2026-09-27-01" },
    { "rodzaj": "archiwizacja", "klient_id": "ckx2", "powod": "SPOZA_BRANZY", "dopisek": "firma budowlana, zapytanie przez pomyłkę",
      "zrodlo": "mail 14.03", "pewnosc": "wysoka", "paczka": "P-2026-09-27-01" },
    { "rodzaj": "scalenie", "klient_id": "ckx3", "duplikat_id": "ckx4",
      "zrodlo": "ten sam NIP i telefon", "pewnosc": "wysoka", "paczka": "P-2026-09-27-01" }
  ]
}
```

**Rodzaje propozycji:**

- **`pole`**: pola jak w `PATCH /klienci/:id`.
- **`osoba`**: `firstName`, `lastName`, `phone`, `phone2`, `phone2Label`, `email`, `role`.
- **`archiwizacja`**: klient albo sygnał (`sygnal_id`), z polami `powod` i `dopisek`.
- **`scalenie`**: pole `duplikat_id`.
- **`wydzielenie`**: rozdziela klienta-zlepka. Pola:
  - `osoby_ids`: osoby, które przechodzą do nowego klienta;
  - `nazwa`;
  - opcjonalnie `nip`, `ulica`, `kod`, `miasto`;
  - opcjonalnie `invoiceNip`: faktury z tym NIP-em nabywcy przechodzą razem z osobami. Bez tego pola przechodzą faktury z NIP-em nowego klienta (`nip`);
  - opcjonalnie `historyKeys`: klucze grup z kalendarzy (z narzędzia `dopasowania`) do przypisania nowemu klientowi.

  Nazwy pól są jednolite: `osoby_ids`, `nazwa`, `nip`, `ulica`, `kod`, `miasto`, `invoiceNip`, `historyKeys`. Dawne `faktury_nip` i `klucze_dopasowan` nadal działają. Nowy klient nie dziedziczy źródła (`source`) ani tagu HubSpot zlepka.
- **`dopasowanie_platnosci`**: przelew z wyciągu → faktura. Pola `przelew_id` i `faktura_id`, oba z narzędzia `platnosci`. Po akceptacji faktura jest zapłacona z datą przelewu, a przelew ma stan `MANUAL`. Serwer odrzuca przelew już dopasowany i fakturę już zapłaconą.

  Razem z osobami przechodzą ich wynajmy, sygnały (z osią czasu i zadaniami), e-maile i SMS-y. Przy kliencie musi zostać co najmniej jedna osoba. Przykład:

  ```json
  { "rodzaj": "wydzielenie", "klient_id": "cmuhfoc0o00dwbhipcwdoo8t9", "osoby_ids": ["cmuhfoc1500e6bhipcqfsgjb8"],
    "nazwa": "Studio Urody „MiWiNi” Barbara Trzaska", "nip": "9441828201", "ulica": "Rudawska 4", "kod": "32-064", "miasto": "Rudawa",
    "invoiceNip": "9441828201", "historyKeys": ["miwini", "mi wi ni"],
    "zrodlo": "HubSpot + faktury 2026", "pewnosc": "wysoka", "paczka": "P-2026-09-27-01" }
  ```

**Odpowiedź:** `results[]` ma osobny wynik dla każdej pozycji: `ok`, `id`, `status` albo `message`. Serwer odrzuca:

- zmianę, która niczego nie zmienia;
- propozycję, która już czeka na decyzję;
- zmianę **wcześniej odrzuconą**; w odpowiedzi jest komentarz odrzucenia, więc nie proponuj jej ponownie.

**Klasy zatwierdzone na stałe.** `klasa` to krótki klucz typu zmiany, np. `miasto_slownik`. Administrator może oznaczyć klasę jako zatwierdzaną automatycznie. Wtedy propozycje **pól** z tą klasą wykonują się od razu po zgłoszeniu, ze statusem ACCEPTED, i nadal trafiają do dziennika. Archiwizacja i scalanie zawsze czekają na akceptację.

**Stan propozycji:** `GET /api/agent/propozycje?status=PENDING|ACCEPTED|REJECTED&wykonana=0|1&paczka=&klient=` albo narzędzie MCP `propozycje_lista`. Odpowiedź zawiera też listę klas zatwierdzanych automatycznie.

## Archiwum

`GET /api/agent/archiwum?typ=client|lead&powod=&paczka=&q=` pokazuje, co już jest w archiwum. Sprawdź to, zanim zaproponujesz archiwizację.

| Pole | Wartość |
|------|---------|
| `powod` | `SPAM`, `TEST`, `OSOBA_PRYWATNA`, `SPOZA_BRANZY`, `DOSTAWCA`, `JEDNORAZOWY`, `DUPLIKAT`, `INNE` |

**Agent nie archiwizuje i nie usuwa.** Proponuje archiwizację jako propozycję rodzaju `archiwizacja` (patrz wyżej), z powodem i dopiskiem. Archiwizację, przywracanie i trwałe usuwanie wykonuje administrator w **Porządki → Archiwum** albo na karcie klienta.

Trwałe usunięcie niczego nie kasuje w HubSpocie. ID kontaktu, firmy i transakcji trafiają na listę blokad, więc import ich nie przywróci. Nowy formularz od tej samej osoby tworzy nowe zapytanie.

---

## Sygnały (zapytania)

### `GET /api/agent/sygnaly`

| Parametr | Znaczenie |
|----------|-----------|
| `etap=` | `SYGNAL`, `WYWIAD`, `OFERTA`, `REZERWACJA`, `WYGRANA` albo `PRZEGRANA` |
| `typ=` | `POBRANIE_CENNIKA`, `KONTAKT`, `REZERWACJA_WWW`, `SZKOLENIE_WWW`, `TELEFON`, `EMAIL` albo `INNE` |
| `od=RRRR-MM-DD` | wpłynęło od tej daty |
| `do_obdzwonienia=1` | tylko sygnały na liście do obdzwonienia |
| `klient=` | identyfikator klienta |
| `q=` | wyszukiwanie |

Lista ma paginację i jest posortowana od najnowszych.

### `GET /api/agent/sygnaly/:id`

Zwraca szczegół sygnału z osią czasu.

## Podejrzane zlepki

`GET /api/agent/zlepki` (narzędzie MCP: `podejrzane_zlepki`) zwraca klientów, pod którymi prawdopodobnie jest kilka gabinetów, od najbardziej podejrzanych. Przy każdym są punkty i uzasadnienie:

- osoby z adresami zastępczymi (np. `brak.pl`);
- faktury wystawione na różne NIP-y;
- NIP klienta, który nie występuje na jego fakturach;
- firma HubSpot łącząca wiele osób.

Taki zlepek rozdzielaj propozycją rodzaju `wydzielenie` (patrz niżej).

## Dopasowania historii

`GET /api/agent/dopasowania?stan=UNMATCHED|SUGGESTED|AUTO|CONFIRMED|IGNORED`

Zwraca:

- `groups`: grupy wydarzeń z kalendarzy, po tytule;
- `invoices`: faktury z Fakturowni ze stanem dopasowania do klienta;
- `totals`.

**Decyzje:** `POST /api/agent/dopasowania` (narzędzie MCP: `dopasowanie_decyzja`), każda z wpisem w dzienniku:

```json
{ "rodzaj": "kalendarz", "akcja": "przypisz", "klucze": ["miwini", "mi wi ni"], "klient_id": "ckx1" }
{ "rodzaj": "faktury", "akcja": "pomin", "faktury_ids": ["cki9"] }
```

- `akcja`: `przypisz` (wymaga `klient_id`), `pomin` albo `cofnij`.
- `klucze` to wartości `groups[].key` z odczytu dopasowań.
- Przypisanie tworzy alias, więc kolejne wydarzenia o tej nazwie dopasują się same.

## Faktury

`GET /api/agent/faktury` to kopia faktur z Fakturowni w bazie panelu.

| Parametr | Znaczenie |
|----------|-----------|
| `od=`, `do=` | zakres daty sprzedaży |
| `klient=` | identyfikator klienta |
| `nip=` | NIP nabywcy |
| `stan=` | stan dopasowania do klienta |
| `bez_klienta=1` | faktury bez przypisanego klienta |
| `bez_wynajmu=1` | faktury bez powiązanego wynajmu |

Lista ma paginację. Każda faktura ma `payment`: `status` i `label` wpłaty (zapłacona dd.mm / częściowo zapłacona / po terminie / nie sprawdzono / oczekuje), `paidAt` i `byBankTransfer`. Odpowiedź ma też `paymentsAsOf`.

## Wpłaty (wyciągi bankowe)

Wpłaty sprawdza się w module Finanse na podstawie pliku CSV z banku, wgrywanego co jakiś czas. Fakturownia nie jest źródłem wpłat. Import dopasowuje przelewy przychodzące do faktur wystawionych od 01.09.2026 (wcześniej wpłat nie śledzono).

`GET /api/agent/platnosci` (MCP: `platnosci`) działa tylko do odczytu i zwraca:

- `ostatni_import`: kiedy wgrano plik, jego nazwę i okres operacji w pliku;
- `wplaty_aktualne_na`: ostatni dzień objęty wyciągami;
- `przelewy[]`: data, kwota, opis przelewu i jego stan:
  - `AUTO`: dopasowany automatycznie;
  - `MANUAL`: dopasowany ręcznie;
  - `AMBIGUOUS`: kilka możliwych faktur, lista w `kandydaci`;
  - `NONE`: niedopasowany;

  Dopasowany przelew ma też `faktura`: numer, nabywcę, NIP, kwotę brutto i klienta.
- `nieoplacone_faktury[]`: faktury bez wpłaty ze statusem:
  - `PO_TERMINIE`: termin minął, a wyciąg obejmuje ten dzień;
  - `NIE_SPRAWDZONO`: termin mija po ostatnim dniu wyciągu albo faktura sprzed śledzenia wpłat;
  - `OCZEKUJE`: termin jeszcze nie minął.

| Parametr | Znaczenie |
|----------|-----------|
| `od=`, `do=` | zakres daty przelewu |
| `stan=` | `niedopasowane` (NONE i AMBIGUOUS), `dopasowane` (AUTO i MANUAL) albo jeden stan |
| `klient=` | przelewy dopasowane do faktur klienta i jego nieopłacone faktury |

Niedopasowany przelew (np. dopasowany przez Ciebie po NIP-ie, nazwie nadawcy i kwocie) zgłoś propozycją `dopasowanie_platnosci` w paczce.

## Lista wykluczeń domen (wniosek 7)

Narzędzie MCP `wykluczenia` służy tylko do odczytu. Zwraca:

- domeny i adresy `EXCLUDE`: ich maile nie trafiają do panelu, a kontakty i transakcje z HubSpota nie tworzą klientów ani sygnałów;
- domeny i adresy `HIDE`: wątki z ich udziałem są ukryte w historii klienta, chyba że temat albo skrót zawiera słowo o wynajmie;
- listę tych słów.

Nowe domeny zgłaszasz w `propozycje_dodaj`, rodzaj `wykluczenie`, z polami `wartosci` (lista, maks. 500), `typ` (`wyklucz` albo `ukrywaj`) i `dopisek`. Po akceptacji panel od razu ukrywa pasujące maile. Niczego nie usuwa.

`GET /api/agent/fv-bez-faktury` zwraca zakończone wynajmy ze znacznikiem FV (VAT doliczony), które nie mają faktury. Przy każdym wynajmie jest `suggestions[]`: prawdopodobne faktury (ten sam klient albo NIP, data sprzedaży ±7 dni, urządzenie w pozycjach). Powiązanie faktury z wynajmem zatwierdza administrator w panelu, w **Finanse → Faktury VAT → FV bez faktury → Powiąż**.

---

## Wnioski

**Słowniki:**

- **Obszar:** `KLIENCI`, `SYGNALY`, `HISTORIA`, `FINANSE`, `KALENDARZ`, `KOMUNIKACJA`, `INTEGRACJE`, `PROCES`.
- **Typ:** `BLAD`, `REGULA`, `BRAK_DANYCH`, `UX`, `AUTOMATYZACJA`, `JAKOSC_DANYCH`, `POMYSL`, `PYTANIE`.
- **Przyczyna (`causes`):** `PANEL`, `HUBSPOT`, `N8N`, `FORMULARZ`, `PROCES`, `INNE`.
- **Priorytet:** `HIGH`, `MEDIUM`, `LOW`.
- **Status:** `NOWY`, `DO_DECYZJI`, `PRZYJETY`, `W_REALIZACJI`, `ZROBIONY`, `ODRZUCONY`, `DUPLIKAT`.

Agent ustawia tylko `NOWY` i `DO_DECYZJI`. Resztę statusów ustawia administrator.

### `GET /api/agent/wnioski`

Filtry:

| Parametr | Znaczenie |
|----------|-----------|
| `status=open` | wszystkie otwarte |
| `status=<kod>` | jeden status |
| `obszar=`, `typ=`, `priorytet=` | jak w słownikach wyżej |
| `blokuje=1` | tylko wnioski blokujące porządki |
| `autor=<userId>` | wnioski jednej osoby |
| `klient=` | wnioski powiązane z klientem |
| `q=` | szukanie po tytule, treści albo numerze `W-0012` |

Zwraca `{ "rows": [...], "counts": { "NOWY": 3, … } }`.

### `POST /api/agent/wnioski`

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  https://panel.wynajemlasera.pl/api/agent/wnioski -d '{
  "title": "Formularz rezerwacji gubi numer telefonu",
  "area": "INTEGRACJE",
  "type": "BLAD",
  "problem": "W części zapytań z formularza WWW pole telefon jest puste…",
  "evidence": "- HubSpot deal 1234 (2026-09-12)\n- mail kontakt@ 2026-09-14, temat „Rezerwacja”",
  "scale": "ok. 30 zapytań miesięcznie",
  "causes": ["N8N", "FORMULARZ"],
  "proposal": "Sprawdzić mapowanie pola w n8n…",
  "priority": "HIGH",
  "priorityReason": "Ania nie może oddzwonić",
  "blocksCleanup": false,
  "clientIds": ["ckx123"],
  "status": "DO_DECYZJI"
}'
```

Odpowiedź:

```json
{ "id": "…", "number": 12, "status": "DO_DECYZJI", "similar": [{ "id", "number", "title", "status", "score" }] }
```

Pole `similar` zawiera podobne otwarte wnioski. Sprawdź je, zanim uznasz wniosek za nowy. Jeśli to duplikat, dopisz komentarz do istniejącego wniosku.

### `GET /api/agent/wnioski/:id`

Zwraca wszystkie pola wniosku, a także:

- `statuses`: historię statusów;
- `comments`: komentarze;
- `relations`: powiązania z innymi wnioskami;
- `clients`: powiązanych klientów;
- `canEdit`: czy agent może zmieniać ten wniosek.

### `PATCH /api/agent/wnioski/:id`

Zmienia pola (te same klucze co przy tworzeniu) albo status: `{"status": "DO_DECYZJI", "comment": "…"}`. Agent może zmieniać tylko własne wnioski w statusie `NOWY` albo `DO_DECYZJI`.

### `POST /api/agent/wnioski/:id/komentarze`

Treść: `{ "tresc": "…" }`.

## Uwagi

### `GET /api/agent/uwagi`

Filtry: `status=OPEN|CLOSED`, `obszar=`, `klient=`, `q=`.

### `POST /api/agent/uwagi`

```json
{ "tresc": "Gabinet Bella i „Bella Studio” to ten sam NIP", "obszar": "KLIENCI", "dowod": "Biała lista 6790001122", "klient_id": "ckx123" }
```

Można też podać `sygnal_id` zamiast `klient_id` albo obok niego. Jeśli podasz tylko sygnał, uwaga przypnie się też do klienta tego sygnału.

### `PATCH /api/agent/uwagi/:id`

Zmienia własną uwagę: `tresc`, `obszar`, `dowod`, `klient_id`, `status` (`OPEN` albo `CLOSED`).

## Dziennik zmian

### `GET /api/agent/dziennik`

Filtry:

| Parametr | Znaczenie |
|----------|-----------|
| `klient=` | identyfikator klienta |
| `paczka=` | identyfikator paczki |
| `autor=<userId>` | kto wykonał zmianę |
| `obiekt=` | `CLIENT`, `CONTACT`, `LEAD`, `HISTORY`, `INVOICE`, `TASK`, `NOTE` |
| `od=`, `do=` | zakres dat |
| `q=` | szukanie |
| `limit=` | domyślnie 300, maksymalnie 5000 |

Zwraca `{ "entries": [...] }`. Wartości `before` i `after` to JSON zapisany jako tekst; `"null"` oznacza puste pole.

### `POST /api/agent/dziennik`

Ręczny wpis dla zmian wykonanych poza standardowymi endpointami, na przykład w HubSpocie albo ręcznego scalenia.

```json
{
  "obiekt": "klient",
  "obiekt_id": "ckx123",
  "klient_id": "ckx123",
  "operacja": "scalenie",
  "pole": null,
  "przed": { "duplikat": "ckx999", "nazwa": "Bella Studio" },
  "po": { "scalono_do": "ckx123" },
  "zrodlo": "ten sam NIP i telefon",
  "pewnosc": "wysoka",
  "paczka": "P-2026-09-27-01"
}
```

| Pole | Wartości |
|------|----------|
| `obiekt` | `klient`, `kontakt`, `sygnal`, `dopasowanie`, `faktura` |
| `operacja` | `zmiana_pola`, `scalenie`, `zmiana_statusu`, `przeniesienie_do_zapytan`, `nie_kontaktowac`, `potwierdzenie_dopasowania`, `odrzucenie_dopasowania` |

Pole `przed` jest wymagane, ale może mieć wartość `null`. Wymagane są też `zrodlo` i `pewnosc`.

Zmiany zrobione przez `PATCH /api/agent/klienci/…` trafiają do dziennika automatycznie, więc nie dopisuj ich ręcznie.

Cofanie wpisów („Cofnij”) jest tylko w panelu i tylko dla administratora.
