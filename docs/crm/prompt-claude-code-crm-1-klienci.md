# Prompt dla Claude Code — moduł „Klienci” + synchronizacja z HubSpotem (CRM, prompt 1 z 2)

## 0. Kontekst i cel

Dziś panel nie ma własnego modelu klienta. Przy wynajmie biuro wyszukuje kontakt w HubSpocie
(`src/lib/integrations/hubspot.ts`, `POST /api/rentals/[id]/contact`), a panel zapisuje na `Rental`
`hubspotContactId` + kopie pól (`contactNameCache`, `contactPhoneCache`, `contactEmailCache`,
`contactCompanyCache`, `contactAddressCache`, `contactNipCache`, `contactTransportPriceCache`).
Integracja jest **tylko do odczytu** — panel nic do HubSpota nie zapisuje.

Docelowo właściciel chce przenieść **całe** funkcje CRM z HubSpota do panelu. **Na razie HubSpot i n8n
mają działać dalej bez zmian** — formularze WWW nadal tworzą kontakty i transakcje w HubSpocie, a panel
pracuje **równolegle**: na bieżąco pobiera dane z HubSpota i odsyła tam swoje zmiany. Biuro (Ania)
stopniowo przechodzi na pracę w panelu. Gdy wszystko będzie działać, właściciel odepnie n8n i HubSpot
— wtedy wystarczy wyłączyć synchronizację (przełączniki w sekcji 5.6), bez zmian w kodzie.

Kolejność promptów:

1. **Klienci w panelu + synchronizacja kontaktów z HubSpotem** ← ten prompt
2. Sygnały (lejek sprzedaży) w panelu, synchronizowane z transakcjami HubSpot — `prompt-claude-code-crm-2-sygnaly.md`
3. Pomiar: UTM/gclid, konwersje offline do Google Ads, raport lejka
4. Formularze WWW prosto do panelu, wyłączenie n8n i HubSpota

**Zasada nadrzędna: nie psujemy HubSpota.** Panel nigdy nie usuwa niczego w HubSpocie, nie scala
kontaktów w HubSpocie, nie zmienia właściwości, których sam nie zna. Zapisuje tylko pola wymienione w
sekcji 5.4. HubSpot przez cały okres przejściowy ma być kompletną kopią zapasową.

Po tym etapie rezerwacja **nie zależy już od dostępności HubSpota**: klient jest wybierany z bazy panelu.

**Zanim zaczniesz kodować**: przeczytaj `schema.prisma`, `src/lib/integrations/hubspot.ts`,
`src/app/api/rentals/[id]/contact/route.ts`, `src/components/rental-form.tsx`,
`src/lib/revenue/aggregate.ts` + `load.ts`, `src/lib/invoicing/contact-email.ts`,
`src/lib/missing-email-alerts*.ts`, `src/lib/reminders.ts` i `src/components/sidebar-nav.tsx`.
Nazwy modeli i pól poniżej to **docelowy kształt** — dopasuj je do konwencji repo. Jeśli coś w tej
specyfikacji koliduje z tym, co zastaniesz (np. inny sposób liczenia „klienta” w przychodach) —
zatrzymaj się i zapytaj, zamiast zgadywać.

**Zasada przejścia:** pola `contact*Cache` i `hubspotContactId` na `Rental` **zostają** w etapie 1.
Używają ich przychody, faktury, przypomnienia i alerty. Zmieniamy tylko **źródło**, z którego te pola
są wypełniane (klient z panelu zamiast HubSpota). Usunięcie cache to osobny, późniejszy krok.

---

## 1. Model danych

### 1.1 `Client` — gabinet / firma (klient B2B)

```
enum ClientStatusOverride {
  NIE_KONTAKTOWAC   // ręczna blokada: nie chcemy / nie możemy współpracować
}

enum DeviceInterest {
  LIGHTSHEER        // Desire / Quattro / Light
  LIGHTSHEER_ET400
  ALMA_HARMONY
  COOLTECH
  RESURFX
  OBSERV
  SZKOLENIE
}

enum ClientSource {
  FORMULARZ_WWW
  TELEFON
  POLECENIE
  GOOGLE_ADS
  META
  POWRACAJACY
  INNE
}

enum ClinicType {
  GABINET_KOSMETOLOGICZNY
  KLINIKA_MEDYCYNY_ESTETYCZNEJ
  SALON_BEAUTY
  KOSMETOLOG_MOBILNY
  INNE
}

model Client {
  id                String   @id @default(cuid())
  name              String                 // nazwa gabinetu; gdy brak firmy — imię i nazwisko osoby
  nip               String?                // tylko cyfry, bez kresek (normalizuj przy zapisie)
  street            String?
  zip               String?
  city              String?
  country           String?  @default("Polska")
  transportPriceNet Decimal? @db.Decimal(10, 2) // dawne HubSpot „ustalona_cena_transportu”
  distanceKm        Decimal? @db.Decimal(6, 1)  // dawne Rental.contactDistanceKm „ostatnia znana”
  clinicType        ClinicType?
  source            ClientSource?
  deviceInterests   Json?    // DeviceInterest[] — tablica, wielokrotny wybór
  statusOverride    ClientStatusOverride?
  notes             String?  @db.Text      // notatka wewnętrzna (pełne notatki/historia = etap 4)

  // mapowanie na HubSpot — do importu, deduplikacji i linku „otwórz w HubSpot” w okresie przejściowym
  hubspotCompanyId  String?  @unique
  legacyHubspotTag  String?                // surowa wartość HubSpot „tagi” — tylko do wglądu, nie logika
  hubspotSnapshot   Json?                  // wartości pól HubSpot z ostatniej synchronizacji (sekcja 5.5)

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  contacts ClientContact[]
  rentals  Rental[]

  @@index([nip])
  @@index([name])
  @@map("clients")
}
```

### 1.2 `ClientContact` — osoba kontaktowa w gabinecie

```
model ClientContact {
  id               String  @id @default(cuid())
  clientId         String
  client           Client  @relation(fields: [clientId], references: [id], onDelete: Cascade)
  firstName        String?
  lastName         String?
  phone            String?  // zapisuj w E.164 (+48…) — użyj tej samej normalizacji co wysyłka SMS (szybkisms.ts); nie dodawaj nowej biblioteki bez pytania
  email            String?
  role             String?  // np. „właścicielka”, „kosmetolog”
  isPrimary        Boolean  @default(false) // dokładnie jedna główna osoba na klienta
  hubspotContactId String?  @unique
  hubspotSnapshot  Json?    // sekcja 5.5
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  rentals Rental[]

  @@index([clientId])
  @@index([email])
  @@index([phone])
  @@map("client_contacts")
}
```

### 1.3 Rozszerzenie `Rental`

```
model Rental {
  // ...istniejące pola bez zmian (w tym hubspotContactId i contact*Cache)...
  clientId        String?
  client          Client?        @relation(fields: [clientId], references: [id], onDelete: SetNull)
  clientContactId String?
  clientContact   ClientContact? @relation(fields: [clientContactId], references: [id], onDelete: SetNull)

  @@index([clientId])
}
```

Migracja zgodnie z konwencją repo: `prisma migrate diff --from-migrations ... --to-schema-datamodel ...`
bez lokalnej bazy, aplikowana przez `deploy/migrate.mjs` (nie `prisma migrate deploy`) — patrz
`README.md` i wcześniejsze migracje w `prisma/migrations/`.

---

## 2. Status klienta — liczony, nie wpisywany

Status to **pochodna historii wynajmów**, nie pole do ręcznej edycji (poza blokadą `NIE_KONTAKTOWAC`).
Czysta funkcja w `src/lib/clients/status.ts` + testy vitest (`status.test.ts`):

```
type ClientStatus = "POTENCJALNY" | "NOWY" | "STALY" | "USPIONY" | "BYLY" | "NIE_KONTAKTOWAC";

computeClientStatus({ statusOverride, realizedRentalDates: Date[], today }): ClientStatus
```

„Zrealizowany wynajem” = `Rental.eventType = WYNAJEM`, `deletedInGoogle = false`,
`finance.confirmedAt != null` (to samo źródło prawdy co „przychód rzeczywisty” w
`src/lib/revenue/aggregate.ts` — sprawdź i użyj tej samej definicji, nie twórz drugiej).
Szkolenia (`SZKOLENIE`) **nie liczą się** do statusu.

Reguły (kolejność ma znaczenie, strefa `Europe/Warsaw`):

1. `statusOverride = NIE_KONTAKTOWAC` → `NIE_KONTAKTOWAC`
2. brak zrealizowanych wynajmów → `POTENCJALNY`
3. ostatni wynajem > 365 dni temu → `BYLY`
4. ostatni wynajem 181–365 dni temu → `USPIONY`
5. ≥ 2 wynajmy w ostatnich 365 dniach → `STALY`
6. w przeciwnym razie → `NOWY`

Liczone **przy odczycie** (klientów jest < 1000, jedno zapytanie z agregacją wystarczy) — bez
zapisywania statusu w bazie i bez crona. Jeśli okaże się za wolne, zgłoś, zanim dodasz denormalizację.

Dodatkowo na liście i karcie klienta: liczba wynajmów (12 mies. / łącznie), data ostatniego wynajmu,
**przychód netto łącznie** (suma `RentalFinance.totalNet` + `transportTotalNet` — ta sama logika co w
przychodach). Przychód widoczny tylko dla `ADMIN` i `STAFF`, **nigdy** w odpowiedzi API dla roli
`KIEROWCA` (reguła bezpieczeństwa jak przy `hourlyRate` — sprawdzaj w API, nie tylko ukrywaj w UI).

Chip statusu (kolory neutralne względem chipów pilności z Zadań): Potencjalny — szary, Nowy — niebieski,
Stały — zielony, Uśpiony — pomarańczowy, Były — grafit, Nie kontaktować — przekreślony szary.

---

## 3. Ekrany

### 3.1 Nawigacja

Nowa pozycja w `sidebar-nav.tsx` **„Klienci”** (`/klienci`), między „Kalendarz/Nadchodzące” a
„Finanse”. Ikona: prosty kontur dwóch osób, spójny z istniejącymi ikonami. Niewidoczna dla `KIEROWCA`
(także w „podglądzie kierowcy” — `effective-role.ts`).

### 3.2 `/klienci` — lista

- Wyszukiwarka (debounce 300 ms, min. 2 znaki): nazwa, NIP, miasto, imię/nazwisko, telefon, e-mail
  osoby kontaktowej. Telefon wyszukuj po samych cyfrach (ignoruj spacje, `+48`).
- Filtry (chipy): status (wielokrotny), zainteresowanie urządzeniem, rodzaj gabinetu, źródło.
- Kolumny: Nazwa · Główna osoba (imię, telefon) · Miasto · Status (chip) · Wynajmy 12 mies. / łącznie ·
  Ostatni wynajem · Przychód netto · Źródło.
- Sortowanie domyślne: ostatni wynajem malejąco, klienci bez wynajmów na końcu (wg daty utworzenia).
- Przycisk „+ Nowy klient” (formularz jak w 3.3, w modalu lub panelu bocznym — zgodnie z tym, jak
  dziś działają formularze w aplikacji).
- Szybkie widoki (zakładki nad listą, zapisane na sztywno): **Wszyscy · Stali · Uśpieni (do
  reaktywacji) · Byli · Potencjalni · Bez telefonu**. „Uśpieni” i „Byli” to lista do kampanii
  przedsezonowych (luty, wrzesień) — dodaj eksport CSV widocznej listy (nazwa, osoba, telefon, e-mail,
  miasto, status, ostatni wynajem, urządzenia).

### 3.3 `/klienci/[id]` — karta klienta

- Nagłówek: nazwa, chip statusu, link „Otwórz w HubSpot” (jeśli jest mapowanie — tylko w okresie
  przejściowym), przycisk „Nowa rezerwacja dla klienta” (otwiera istniejący formularz wynajmu z
  wstępnie wybranym klientem).
- Sekcja **Dane**: nazwa, NIP, adres, cena transportu netto, odległość km, rodzaj gabinetu, źródło,
  zainteresowanie urządzeniami (multiselect), blokada „Nie kontaktować”, notatka. Edycja inline lub
  przyciskiem „Edytuj” — zgodnie z konwencją aplikacji.
- Sekcja **Osoby kontaktowe**: lista, dodaj/edytuj/usuń, oznaczenie osoby głównej. Nie pozwól usunąć
  ostatniej osoby, jeśli klient ma wynajmy z nią powiązane — najpierw przepnij.
- Sekcja **Historia wynajmów**: tabela z istniejących `Rental` klienta (data, urządzenie, typ
  wynajem/szkolenie, wartość netto, status rozliczenia) — klik otwiera istniejący widok wynajmu.
- Sekcja **Wiadomości**: istniejące `Message` z wynajmów klienta (SMS/e-mail, data, treść skrócona).
- Podsumowanie u góry: liczba wynajmów, przychód netto łącznie, średnia wartość wynajmu, ulubione
  urządzenie (najczęściej wynajmowane).

### 3.4 Formularz wynajmu — wybór klienta

Zastąp dzisiejszą wyszukiwarkę HubSpot w `rental-form.tsx` wyszukiwarką **klientów z panelu**
(te same pola co w 3.2). Wynik pokazuje: nazwa · osoba · telefon · miasto · chip statusu.

- Wybór klienta ustawia `Rental.clientId` + `clientContactId` (osoba główna, z możliwością zmiany na
  inną osobę klienta) i **wypełnia istniejące pola cache** z danych panelu:
  `contactNameCache` ← imię i nazwisko osoby, `contactPhoneCache`, `contactEmailCache` ← osoba,
  `contactCompanyCache` ← `Client.name`, `contactAddressCache` ← sformatowany adres klienta,
  `contactNipCache` ← `Client.nip`, `contactTransportPriceCache` ← `Client.transportPriceNet`.
  Zachowaj dzisiejsze reguły: `transportPrice` wypełniaj tylko, gdy puste; `contactDistanceKm` —
  podpowiedź z `Client.distanceKm`, a gdy biuro wpisze odległość na wynajmie, zapisz ją też na kliencie.
- Pod wynikami: **„Nie ma na liście? Szukaj w HubSpot”** — dzisiejsze wyszukiwanie HubSpot jako
  zapasowe. Wybór kontaktu z HubSpota najpierw **importuje go do panelu** (5.2), potem przypisuje jak
  wyżej. To pokrywa nowe kontakty z formularzy WWW do czasu etapu 2.
- **„+ Nowy klient”** bez wychodzenia z formularza wynajmu (minimum: nazwa, osoba, telefon, e-mail,
  adres; reszta później na karcie klienta).
- Endpoint: nowy `POST /api/rentals/[id]/client` (`{ clientId, clientContactId? }`) i
  `DELETE` do odpięcia (czyści `clientId`, `clientContactId` i cache jak dziś). Stary
  `/api/rentals/[id]/contact` zostaw działający, ale przestaw UI na nowy.

### 3.5 Spójność danych po edycji klienta

Gdy biuro zmieni na karcie klienta telefon, e-mail, adres, NIP lub cenę transportu — odśwież cache na
**przyszłych** wynajmach tego klienta (`startsAt >= dziś`, strefa Warszawa). Przeszłych wynajmów nie
ruszaj (faktury i historia mają pokazywać dane z tamtego dnia). Pokaż w UI komunikat
„Zaktualizowano dane na N nadchodzących wynajmach”.

---

## 4. Uprawnienia

- `/klienci`, `/klienci/[id]`, wszystkie `/api/clients/*` — `ADMIN` i `STAFF` (`requireStaffSession()`).
- `KIEROWCA`: brak dostępu (403). Widok kierowcy wynajmu nadal pokazuje dane kontaktu z cache — bez
  zmian — ale nigdy statusu, przychodu ani notatki klienta.
- Import, synchronizacja i przełączniki HubSpot (sekcja 5) — tylko `ADMIN`.

---

## 5. Synchronizacja z HubSpotem (dwukierunkowa, na okres przejściowy)

### 5.1 Wymagania i zakresy tokenu

Token Private App (`HUBSPOT_ACCESS_TOKEN`) ma dziś tylko `crm.objects.contacts.read`. Potrzebne:
`crm.objects.contacts.read` + `crm.objects.contacts.write`, `crm.objects.companies.read`
(prompt 2 doda zakresy transakcji i notatek). Dodaje je ADMIN w HubSpot (Ustawienia → Integracje →
Aplikacje prywatne → zakresy). Strona `/ustawienia/integracje/hubspot` ma sprawdzać każdy zakres osobno
(próbne wywołanie) i pokazać, czego brakuje, zamiast ogólnego błędu.

Pobierane właściwości kontaktu: `firstname, lastname, email, phone, mobilephone, company, address,
city, zip, country, nip, ustalona_cena_transportu, tagi, urzadzenie, createdate, lastmodifieddate`
+ powiązania z firmami. Firmy: `name, domain, address, city, zip, country, phone` (+ `nip`, jeśli taka
właściwość istnieje na firmie — sprawdź przez `/crm/v3/properties/companies`, nie zakładaj).

### 5.2 Pierwszy import pełny — `/ustawienia/integracje/hubspot` → „Importuj klientów”

Dwa kroki, żeby ADMIN widział skutki przed zapisem:

1. **Podgląd (dry run)** — nic nie zapisuje, pokazuje: ile kontaktów i firm pobrano, ile klientów
   powstanie, ile osób trafi do istniejących klientów, lista konfliktów (ten sam NIP w różnych
   firmach, ten sam e-mail u kilku kontaktów, kontakty bez e-maila i telefonu).
2. **Import** — zapis partiami, idempotentny (powtórne uruchomienie nie tworzy duplikatów: klucze
   `hubspotCompanyId` i `hubspotContactId`).

Reguły grupowania kontaktów w klientów (czysta funkcja `src/lib/clients/hubspot-import.ts` + testy):

1. Kontakt powiązany z firmą HubSpot → osoba w kliencie tej firmy (`Client.hubspotCompanyId`).
2. Bez firmy, ale z NIP → łącz z klientem o tym samym NIP (znormalizowanym).
3. W przeciwnym razie → nowy klient; `name` = pole `company` z kontaktu, a gdy puste — imię i nazwisko,
   a gdy i to puste — e-mail.
4. Pierwsza osoba w kliencie (najstarszy `createdate`) → `isPrimary = true`.
5. `phone` ← `phone`, a gdy pusty — `mobilephone`; normalizuj funkcją `normalizePolishPhone`
   z `src/lib/reminders.ts` (tą samą co wysyłka SMS); nieparsowalne zostaw jako surowy tekst i dopisz
   do raportu.

Mapowania pól:

- `ustalona_cena_transportu` → `Client.transportPriceNet` (parsuj liczbę z tekstu typu „150 zł”,
  „150,00”; nieparsowalne → pomiń i pokaż w raporcie).
- `urzadzenie` (HubSpot: Lightsheer, Cooltech, Observ, RersurFX, AlmaHarmonyXL) → `deviceInterests`
  (`LIGHTSHEER`, `COOLTECH`, `OBSERV`, `RESURFX`, `ALMA_HARMONY`).
- `tagi` → `legacyHubspotTag` (tylko do wglądu). Wyjątki: „nie planujemy współpracy” →
  `statusOverride = NIE_KONTAKTOWAC`; „pobranie oferty ze strony” → `source = FORMULARZ_WWW`.
  Pozostałe tagi (obecny/były/nowy klient itd.) **ignoruj** — status liczy się z wynajmów.
- `contactDistanceKm`: po imporcie ustaw `Client.distanceKm` z najnowszego wynajmu klienta, który ma
  odległość.

Po imporcie **backfill wynajmów**: dla każdego `Rental` z `hubspotContactId` znajdź
`ClientContact.hubspotContactId` → ustaw `clientId` i `clientContactId`. Cache **nie nadpisuj**.
Raport: ile powiązano, ile ma `hubspotContactId` bez odpowiednika — lista z linkiem do ręcznego przypięcia.

### 5.3 Pobieranie zmian z HubSpota (HubSpot → panel), co 5 minut

Nowy endpoint `POST /api/cron/hubspot-sync` wg wzorca `/api/cron/sync-devices` (nagłówek
`x-cron-secret`, wywoływany przez Cron Job w cPanelu co 5 minut; dopisz instrukcję do README w sekcji
cronów, dla obu serwerów). Pobiera kontakty i firmy zmienione od ostatniego kursora
(`POST /crm/v3/objects/contacts/search` z filtrem `lastmodifieddate >= kursor`, stronicowanie; kursor w
`Setting`, klucz `hubspot_contacts_cursor`, z zakładką kilku minut wstecz). Nowe rekordy → reguły 5.2.
Istniejące → scalanie wg 5.5. Ten sam kod pod przyciskiem „Synchronizuj teraz” w ustawieniach
integracji. Wynik każdego przebiegu zapisuj w `SyncLog` (lub analogicznej tabeli), ostatni przebieg i
błędy pokazuj w ustawieniach integracji.

W formularzu wynajmu zostaje zapasowe „Szukaj w HubSpot” (3.4) — wybór kontaktu importuje go od razu,
nie czekając na cron.

### 5.4 Odsyłanie zmian z panelu (panel → HubSpot)

Panel jest miejscem pracy, więc zmiany zrobione w panelu trafiają do HubSpota, żeby HubSpot pozostał
kompletny:

| Zdarzenie w panelu | Zapis w HubSpot |
| --- | --- |
| Edycja osoby kontaktowej powiązanej z HubSpotem | `PATCH` kontaktu: `firstname, lastname, phone, email` |
| Edycja klienta | `PATCH` wszystkich jego kontaktów z HubSpota: `company, address, city, zip, country, nip, ustalona_cena_transportu` |
| Nowa osoba / nowy klient utworzony w panelu | `POST` nowego kontaktu z tymi polami; zapisz zwrócone `hubspotContactId`. Przed utworzeniem wyszukaj w HubSpot po e-mailu — jeśli istnieje, podepnij zamiast tworzyć duplikat |
| Usunięcie osoby lub klienta w panelu | **nic** — HubSpota nie czyścimy |

Pól istniejących tylko w panelu (status, rodzaj gabinetu, źródło, zainteresowania, notatka, blokada)
do HubSpota **nie wysyłamy** i nie tworzymy dla nich właściwości w HubSpot.

Mechanizm: tabela kolejki (np. `HubspotOutbox`: typ operacji, id rekordu, payload, liczba prób,
ostatni błąd, `processedAt`). Zapis w panelu nigdy nie czeka na HubSpota i nie zawodzi przez HubSpota
— trafia do kolejki, którą opróżnia ten sam cron (i próba natychmiastowa po zapisie). Po 5 nieudanych
próbach operacja zostaje oznaczona jako błąd i widoczna w ustawieniach integracji z przyciskiem „Ponów”.

### 5.5 Scalanie zmian (żeby nic nie nadpisać po cichu)

Na `ClientContact` i `Client` przechowuj `hubspotSnapshot Json?` — wartości pól HubSpot z ostatniej
udanej synchronizacji (w obie strony). Przy pobraniu z HubSpota, dla każdego pola z 5.4:

- wartość w HubSpot = snapshot → HubSpot nic nie zmienił → zostaw wartość z panelu;
- wartość w HubSpot ≠ snapshot, a w panelu = snapshot → zmiana z HubSpota → przepisz do panelu;
- obie różne od snapshotu (zmieniono w obu miejscach) → **wygrywa panel**, odeślij wartość panelu do
  HubSpota i zapisz wpis w dzienniku konfliktów (widocznym w ustawieniach integracji).

Po każdym udanym odesłaniu (5.4) zaktualizuj snapshot — inaczej następny przebieg crona uzna własny
zapis panelu za zmianę z HubSpota. Logikę scalania wydziel do czystej funkcji z testami vitest.

### 5.6 Przełączniki (na dzień odpięcia HubSpota)

W `Setting`, edytowalne przez ADMINA w ustawieniach integracji:

- `hubspot_pull_enabled` — pobieranie zmian z HubSpota (domyślnie włączone),
- `hubspot_push_enabled` — odsyłanie zmian do HubSpota (domyślnie włączone).

Wyłączenie obu = panel działa samodzielnie. Linki „Otwórz w HubSpot” ukrywaj, gdy integracja jest wyłączona.

---

## 6. Zmiany w istniejących miejscach

- **Przychody** (`src/lib/revenue/*`): dziś „klient” = `hubspotContactId`. Przełącz grupowanie na
  `clientId`, z fallbackiem na `hubspotContactId` dla wynajmów jeszcze niepowiązanych. Etykieta —
  `Client.name`. Nazwy klientów w rozbiciu przychodów linkuj do `/klienci/[id]`. Zaktualizuj testy.
- **Faktury** (`contact-email.ts`) i **alerty braku e-maila**: bez zmian w logice (dalej czytają cache).
  Zmień tylko komunikaty „uzupełnij w HubSpot” na „uzupełnij e-mail na karcie klienta” z linkiem.
- **Kafelek w kalendarzu**: ikona „kontakt HubSpot” → ikona „klient przypisany” (to samo znaczenie,
  nowe źródło). Ostrzeżenie o braku klienta zostaje.

---

## 7. Poza zakresem etapu 1

Sygnały i lejek (prompt 2), endpoint formularzy WWW, UTM/gclid, konwersje Google Ads, Gmail,
usunięcie pól `contact*Cache`, wyłączenie integracji HubSpot. Model danych projektuj tak, żeby prompt 2
mógł dodać `Lead` z `clientId` i dziennik aktywności przy kliencie bez przebudowy `Client`.

---

## 8. Kryteria odbioru

1. Dry run pokazuje liczby zbliżone do stanu HubSpota (ok. 456 kontaktów, 70 firm) i listę konfliktów.
2. Po imporcie każdy wynajem z `hubspotContactId` ma `clientId` albo jest na liście do ręcznego przypięcia.
3. Nowy wynajem da się utworzyć i przypisać klienta **bez** działającego HubSpota (wyłącz token i sprawdź).
3a. Zmiana telefonu osoby w panelu pojawia się w HubSpot najpóźniej po 5 minutach; zmiana e-maila w
    HubSpot pojawia się w panelu po kolejnym przebiegu crona; zmiana w obu miejscach naraz trafia do
    dziennika konfliktów, a panel wygrywa.
3b. Nowy kontakt z formularza WWW (n8n → HubSpot) pojawia się w panelu jako klient najpóźniej po 5 minutach.
3c. Żaden rekord w HubSpot nie został usunięty ani scalony przez panel.
4. Statusy klientów zgadzają się z regułami z sekcji 2 (testy jednostkowe na granicach 180/365 dni i 2 wynajmów).
5. Rola `KIEROWCA` dostaje 403 na `/api/clients/*` i nie widzi przychodu nigdzie.
6. Przychody pokazują to samo łączne netto co przed zmianą (grupowanie inne, suma ta sama).
7. `npm run lint`, `npm test`, build przechodzą.
