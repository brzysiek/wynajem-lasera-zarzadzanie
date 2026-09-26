# Prompt dla Claude Code — „Sygnały”: lejek sprzedaży w panelu, zsynchronizowany z HubSpotem (CRM, prompt 2)

> **AKTUALIZACJA 26.09.2026 — moduł Sygnały już istnieje w panelu.** Nie budujesz go od zera. Wdrażasz
> **różnice** względem tego, co działa dziś: sekcje **1.0** (kontakt a klient, `qualifiedAt`, backfill),
> **1.0a** (lista „Do obdzwonienia”, pole `callList`), **2.2** (poprawione mapowanie etapów — patrz niżej),
> **2.3** (nowe zakresy importu), **3.2** (czwarta zakładka) i **3.3** (przycisk „Odpowiedziałam mailem”),
> kryteria 7a–7b. Zanim zaczniesz: porównaj ten prompt z obecnym kodem modułu, wypisz listę różnic do
> wdrożenia i **zatrzymaj się na potwierdzenie**.
>
> **Import sygnałów NIE był jeszcze uruchomiony** (podgląd z 26.09: 520 transakcji w HubSpot, 168 do
> importu, 40 już w panelu z crona, 312 pominiętych). Uruchomimy go dopiero po wdrożeniu tych zmian —
> 40 sygnałów, które cron już dociągnął, przelicz według nowych reguł (kwalifikacja, „Do obdzwonienia”).
>
> **Poprawka mapowania:** panel ostrzega, że w lejku „Proces sprzedaży” brakuje etapu `3080529125`
> (Wysłany kontrakt). Ten etap należy do lejka „Wynajem”, więc usuń go z mapowania.

## 0. Kontekst i cel

**Wymaga ukończonego promptu 1** (`prompt-claude-code-crm-1-klienci.md`): modele `Client` i
`ClientContact`, synchronizacja kontaktów z HubSpotem (cron `/api/cron/hubspot-sync`, kolejka
`HubspotOutbox`, snapshoty, przełączniki `hubspot_pull_enabled` / `hubspot_push_enabled`). Ten prompt
**rozszerza tę samą infrastrukturę** o transakcje — nie buduj drugiego mechanizmu synchronizacji.

Dziś zapytania od klientów („sygnały”) żyją w HubSpocie jako transakcje w lejku „Proces sprzedaży”.
Formularze WWW (Contact Form 7) → n8n → HubSpot tworzą transakcje o nazwach typu
`WWW - pobranie cennika - adres@email.pl`, `WWW - kontakt - …`, `WWW - rezerwacja wynajmu - …`.
Ania dodaje też transakcje ręcznie po telefonach (nazwa = imię i nazwisko lub gabinet).

**Na razie n8n i HubSpot działają dalej bez zmian.** Panel pobiera transakcje z HubSpota co 5 minut i
pokazuje je Ani jako **Sygnały** — przejrzyste miejsce pracy z szybkimi akcjami. Zmiany etapu i
aktywności z panelu wracają do HubSpota, żeby HubSpot pozostał kompletną kopią zapasową. Zasada
nadrzędna z promptu 1 obowiązuje: **panel niczego w HubSpocie nie usuwa ani nie scala.**

Znane problemy danych w HubSpocie (stan 25.09.2026), które panel ma obsłużyć, nie powielać:

- **88% transakcji z formularzy nie ma powiązanego kontaktu** (n8n tworzy kontakt i transakcję osobno,
  bez powiązania). Adres e-mail jest w nazwie transakcji.
- **Telefon z formularza nie trafia do kontaktu** (52% kontaktów bez telefonu), mimo że pole jest wymagane.
- 332 transakcje sprzed 01.09.2025 pochodzą z importu, 309 z nich stoi w „Sygnale” — to archiwum, nie praca.
- „Zamrażalnik” jest używany zamiast „Zamknięte niepomyślnie”, bez powodu.

**Zanim zaczniesz kodować:** pobierz przez API **wszystkie właściwości** kilku najnowszych transakcji
`WWW - …` (każdego typu formularza) i sprawdź, gdzie n8n zapisuje telefon, urządzenie, termin, liczbę
dni i treść wiadomości (właściwości transakcji, opis, notatka, powiązany e-mail?). Wypisz znalezione
mapowanie i **zatrzymaj się na potwierdzenie**, zanim zbudujesz parser. Nie zakładaj nazw właściwości.

---

## 0.1 Makieta — obowiązujący wygląd

Wygląd ekranów z tego promptu jest ustalony w makiecie zaakceptowanej przez właściciela:

- `docs/crm/mockup-sygnaly.html` + `docs/crm/zrzuty/sygnaly-na-dzis.png` — `/sygnaly`, widok „Na dziś” z kartą sygnału w prawej kolumnie i zakładką „Do obdzwonienia”.
- `docs/crm/mockup-klienci.html` — karta klienta (sekcje „Otwarte sygnały” i „Historia”), którą ten
  prompt rozszerza.

Zasady:

- Otwórz makietę **przed** budową ekranów i odwzoruj ją: układ, hierarchię, kolejność sekcji, etykiety,
  chipy statusów, szybkie akcje, stany wyróżnienia. Widoki „Tablica” i „Lista” nie mają makiety — zbuduj je w tym samym języku wizualnym (karty, chipy, kolory etapów).
- Kolory i krój: z `src/components/shell-tokens.ts` (`SHELL` / `APP`) i Jost z `globals.css` — makieta
  używa tych samych wartości, ale w kodzie odwołuj się do tokenów, nie przepisuj hexów. Kolory statusów
  klienta (Stały zielony, Nowy niebieski, Uśpiony pomarańczowy, Były grafit, Potencjalny szary,
  Nie kontaktować przekreślony) dodaj jako nazwane stałe obok `APP`.
- Style w makiecie są inline wyłącznie dlatego, że to statyczny plik. Buduj z istniejących wzorców i
  komponentów aplikacji (powłoka, sidebar, `page-header.tsx`, tabele z modułu Finansów, panel Zadań),
  nie kopiuj markupu makiety 1:1.
- Dane w makiecie są przykładowe. Liczby, nazwy i treści biorą się z bazy. Pola oznaczone `[…]`
  (np. podsumowanie 30 dni) to miejsca na wartości liczone.
- Logika i zakres: rozstrzyga ten prompt. Wygląd: rozstrzyga makieta. Jeśli makieta pokazuje coś, czego
  prompt nie opisuje (np. podpowiedź „Przed sezonem” nad listą klientów), zrób to, jeśli da się to
  policzyć z dostępnych danych; jeśli nie — pomiń i wypisz w podsumowaniu pracy.
- Ekran projektowany na 1440 px. Poniżej 1280 px prawy panel (karta klienta / sygnału) staje się
  wysuwanym panelem nad listą, zamiast stałej kolumny.

---

## 1.0 Kontakt a klient — zasada (decyzja właściciela z 26.09.2026)

**Sygnał to zapytanie. Klient to gabinet, z którym faktycznie nawiązaliśmy kontakt.**

- Każdy sygnał (formularz, telefon, e-mail) ma przypiętą osobę i rekord `Client`, ale taki klient jest
  **niezakwalifikowany** (`Client.qualifiedAt = null`) i **nie pokazuje się** na liście `/klienci` ani w
  jej kafelkach i licznikach.
- Klient staje się **zakwalifikowany** (`qualifiedAt = now()`, status „Potencjalny”, dopóki nie ma
  wynajmu) przy pierwszym z tych zdarzeń w dowolnym jego sygnale:
  1. rozmowa zapisana jako „Rozmawiałam” (`LeadActivity.type = CALL`),
  2. **e-mail wysłany w odpowiedzi na zapytanie**: przycisk „Odpowiedziałam mailem” na karcie sygnału
     (do czasu podłączenia Gmaila) albo — po etapie B promptu 3 — wiadomość wychodząca do adresu tej
     osoby wykryta w skrzynce (`EmailMessage.direction = OUT`, data po utworzeniu sygnału),
  3. utworzenie rezerwacji z sygnału.
  SMS (np. „Nie mogłam się dodzwonić”) i nieodebrane połączenie **nie** kwalifikują.
- Klient z wynajmem, historią z kalendarza lub fakturą jest zawsze zakwalifikowany (backfill niżej).
- Nowy sygnał od klienta już zakwalifikowanego podpina się pod niego — nie tworzy nowego rekordu.
- Kwalifikacja jest jednokierunkowa; cofnąć może tylko ADMIN (przycisk na karcie klienta, z powodem).

Zmiany w danych:

```
model Client {
  // ...istniejące pola...
  qualifiedAt     DateTime?   // null = kontakt z zapytania, nie klient
  qualifiedReason String?     // "CALL" | "EMAIL_REPLY" | "RENTAL" | "HISTORY" | "MANUAL" | "BACKFILL"
}
```

**Backfill istniejących klientów** (przy migracji, z podglądem jak przy imporcie): zakwalifikowani są
klienci, którzy mają `Rental`, `RentalHistory` (AUTO/CONFIRMED) lub `ClientInvoice`, albo transakcję
HubSpot w etapie dalszym niż „Sygnał”, albo zapisaną w HubSpot rozmowę / e-mail wychodzący. Pozostali
(dziś większość z ~349 „Potencjalnych”) → `qualifiedAt = null`. Podgląd pokazuje liczby w obu grupach i
20 przykładów z każdej — **zatrzymaj się na potwierdzenie** przed zapisem.

Lista `/klienci`: domyślnie tylko zakwalifikowani. Obok kafelków link **„Kontakty z zapytań (N)”** —
ta sama tabela z filtrem `qualifiedAt = null`, z kolumną „Ostatnie zapytanie” i linkiem do sygnału.
Wyszukiwarka w formularzu wynajmu i w nagłówku panelu przeszukuje obie grupy.

## 1.0a Baza „Do obdzwonienia” (zaległe zapytania z 2026)

Zapytania z HubSpota **od 01.01.2026**, których nikt nie obsłużył, nie trafiają do „Na dziś” (zalałyby
widok czerwonymi licznikami), tylko do osobnej listy **„Do obdzwonienia”** — bazy do systematycznej
obdzwonki przez obsługę klienta.

- Kryteria przy imporcie: transakcja utworzona 01.01.2026–dzień wdrożenia, etap „Sygnał” lub
  „Zamrażalnik”, bez rozmowy i bez e-maila wychodzącego w historii HubSpot.
  → `Lead.stage = SYGNAL`, `Lead.callList = true` (nowe pole `callList Boolean @default(false)`),
  `nextActionAt = null`.
- Starsze niż 01.01.2026 i nieobsłużone → `PRZEGRANA` z powodem `ARCHIWUM_IMPORTU` (zmień etykietę
  powodu na „Archiwum (sprzed 2026)”); zostają wyszukiwalne, nie pojawiają się w widokach pracy.
- Nowe sygnały po wdrożeniu nigdy nie trafiają na tę listę — idą normalnie do „Na dziś”.
- Ekran: czwarta zakładka `/sygnaly` **„Do obdzwonienia (N)”**:
  - pasek postępu „Obdzwoniono 42 z 187”,
  - kolejność: najpierw zapytania o konkretny termin/rezerwację, potem kontakt, na końcu pobranie cennika;
    w każdej grupie od najnowszych; filtr po urządzeniu i miejscowości,
  - wiersz: nazwa/e-mail, telefon (lub „brak telefonu — tylko e-mail”), typ, data zapytania, urządzenie,
    przycisk „Zadzwoń” (ta sama karta sygnału i te same wyniki rozmowy co w „Na dziś”),
  - tryb seryjny: po zapisaniu wyniku rozmowy karta od razu przechodzi do następnego kontaktu z listy,
  - wynik „Rozmawiałam” → kwalifikacja klienta + sygnał dalej normalnym lejkiem (znika z listy),
    „Nie odebrała” → zostaje na liście z licznikiem prób (po 3 próbach propozycja „Przegrana — brak kontaktu”),
    „Nie zainteresowana” → `PRZEGRANA` z powodem.
- Plakietka w menu „Sygnały” liczy tylko nowe sygnały z „Na dziś”, nie listę do obdzwonienia.

## 1. Model danych

```
enum LeadStage {
  SYGNAL          // nowy, nikt jeszcze nie rozmawiał
  WYWIAD          // rozmowa odbyta, klientka zainteresowana
  OFERTA          // oferta wysłana
  REZERWACJA      // termin potwierdzony (powiązany Rental)
  WYGRANA         // wynajem zrealizowany
  PRZEGRANA       // rezygnacja / brak kontaktu — zawsze z powodem
}

enum LeadType {
  POBRANIE_CENNIKA
  KONTAKT
  REZERWACJA_WWW
  SZKOLENIE_WWW
  TELEFON
  EMAIL
  INNE
}

enum LostReason {
  CENA
  TERMIN_ZAJETY
  ODLEGLOSC
  KUPILA_URZADZENIE
  INNE_URZADZENIE
  BRAK_KONTAKTU
  TYLKO_CENNIK      // chciała tylko cennik, bez realnej potrzeby
  ARCHIWUM_IMPORTU  // „Archiwum (sprzed 2026)” — nieobsłużone zapytania sprzed 01.01.2026
  INNE
}

model Lead {
  id               String     @id @default(cuid())
  clientId         String?
  client           Client?    @relation(fields: [clientId], references: [id], onDelete: SetNull)
  clientContactId  String?
  clientContact    ClientContact? @relation(fields: [clientContactId], references: [id], onDelete: SetNull)
  title            String     // czytelna nazwa, np. „Gabinet X — LightSheer 2 dni”
  type             LeadType
  stage            LeadStage  @default(SYGNAL)
  stageChangedAt   DateTime   @default(now())
  ownerId          String?    // User — kto prowadzi (domyślnie Ania)
  deviceInterest   Json?      // DeviceInterest[] z promptu 1
  requestedFrom    DateTime?  // od kiedy klientka chce wynająć
  requestedDays    Int?
  location         String?    // miejscowość wynajmu
  message          String?    @db.Text   // treść z formularza
  firstContactAt   DateTime?  // pierwsza rozmowa/SMS/mail wychodzący — do mierzenia czasu reakcji
  nextActionAt     DateTime?  // kiedy następny krok (napędza widok „Na dziś”)
  lostReason       LostReason?
  lostNote         String?    @db.Text
  returnAt         DateTime?  // „wróć do kontaktu” dla przegranych — tworzy zadanie
  rentalId         String?    @unique  // rezerwacja utworzona z sygnału
  // pola pod prompt 3 (pomiar) — dodaj teraz, wypełniaj, jeśli dane są dostępne
  utmSource        String?
  utmMedium        String?
  utmCampaign      String?
  gclid            String?
  // HubSpot
  hubspotDealId    String?    @unique
  hubspotSnapshot  Json?
  createdAt        DateTime   @default(now())  // przy imporcie = createdate transakcji z HubSpota
  updatedAt        DateTime   @updatedAt

  activities LeadActivity[]
  tasks      Task[]

  @@index([stage])
  @@index([clientId])
  @@index([nextActionAt])
  @@map("leads")
}

enum ActivityType {
  CALL          // rozmowa z wynikiem
  CALL_NO_ANSWER
  SMS
  EMAIL
  NOTE
  STAGE_CHANGE
  SYSTEM        // np. „utworzono z formularza WWW”, „zaimportowano z HubSpota”
}

model LeadActivity {
  id          String       @id @default(cuid())
  leadId      String?
  lead        Lead?        @relation(fields: [leadId], references: [id], onDelete: Cascade)
  clientId    String?      // aktywność może dotyczyć klienta bez sygnału (np. telefon od stałej klientki)
  type        ActivityType
  body        String?      @db.Text
  userId      String?
  messageId   String?      // powiązanie z istniejącym Message (SMS/e-mail wysłany z panelu)
  hubspotEngagementId String? @unique
  createdAt   DateTime     @default(now())

  @@index([leadId])
  @@index([clientId])
  @@map("lead_activities")
}
```

Rozszerz istniejący `Task` o `leadId String?` i `clientId String?` (relacje opcjonalne,
`onDelete: SetNull`) — zadania przy sygnale i kliencie pokazują się w istniejącym panelu Zadań z
linkiem do sygnału/klienta. Rozszerz `Message` o `clientId String?`, żeby SMS wysłany z karty klienta
lub sygnału (bez wynajmu) był w historii.

Migracje wg konwencji repo (`prisma migrate diff` + `deploy/migrate.mjs`), jak w prompcie 1.

---

## 2. Synchronizacja transakcji z HubSpotem

### 2.1 Zakresy

Dodatkowo do zakresów z promptu 1: `crm.objects.deals.read`, `crm.objects.deals.write`, zapis notatek
(zakres dla notatek/engagementów — sprawdź aktualną nazwę w dokumentacji HubSpot, nie zgaduj) i odczyt
e-maili zapisanych w HubSpot (`sales-email-read`, jeśli potrzebny do treści). Strona ustawień integracji
sprawdza każdy zakres osobno, jak w prompcie 1.

### 2.2 Mapowanie etapów (lejek HubSpot „Proces sprzedaży”, `pipeline = default`)

| HubSpot (id etapu) | Panel |
| --- | --- |
| Sygnał (`3115771105`) | `SYGNAL` |
| Szansa (`appointmentscheduled`) | `WYWIAD` |
| Wywiad/oferta (`qualifiedtobuy`) | `OFERTA` |
| Akceptacja/rezerwacja (`presentationscheduled`) | `REZERWACJA` |
| Zamknięte pomyślnie (`closedwon`) | `WYGRANA` |
| Zamknięte niepomyślnie (`closedlost`) | `PRZEGRANA` (powód `INNE`, notatka z `closed_lost_reason`) |
| Zamrażalnik (`3211592907`) | `PRZEGRANA` (powód `INNE`, notatka „Zamrażalnik w HubSpot”) |

Odsyłanie etapu do HubSpota: `SYGNAL→3115771105`, `WYWIAD→appointmentscheduled`,
`OFERTA→qualifiedtobuy`, `REZERWACJA→presentationscheduled`, `WYGRANA→closedwon`,
`PRZEGRANA→closedlost` + `closed_lost_reason` = etykieta powodu i notatka. Identyfikatory etapów
**zweryfikuj przez API** (`/crm/v3/pipelines/deals`) przy starcie synchronizacji i trzymaj w konfiguracji,
nie w kodzie na sztywno; brak etapu → błąd widoczny w ustawieniach, bez zapisu.

Lejek „Wynajem” (`2247404753`) — **pomijaj** (3 transakcje, realizacja jest w kalendarzu panelu). Etap „Wysłany kontrakt” (`3080529125`) należy do tego lejka — nie ma go w mapowaniu i nie powinien wywoływać ostrzeżenia.

### 2.3 Pierwszy import

Jak w prompcie 1: podgląd (dry run) → import. Zakres:

- transakcje utworzone **od 01.01.2026** — wszystkie (nieobsłużone → lista „Do obdzwonienia”, sekcja 1.0a);
- utworzone 01.09.2025–31.12.2025 — wszystkie (nieobsłużone → `PRZEGRANA`, „Archiwum (sprzed 2026)”);
- starsze — tylko te **poza** etapem „Sygnał” (reszta zostaje tylko w HubSpocie).

Powiązanie z klientem, w tej kolejności:

1. powiązanie transakcja → kontakt w HubSpot → `ClientContact.hubspotContactId`;
2. brak powiązania, nazwa `WWW - <typ> - <e-mail>` → wyciągnij e-mail, znajdź `ClientContact` po e-mailu
   (bez względu na wielkość liter); nie ma — znajdź kontakt w HubSpot po e-mailu i zaimportuj go (prompt 1);
   nie ma i tam — utwórz klienta (niezakwalifikowanego, sekcja 1.0) i osobę z samym e-mailem;
3. w pozostałych przypadkach — sygnał bez klienta (widoczny w filtrze „Bez klienta”).

Gdy powiązanie ustalono krokami 2–3, a w HubSpot go brakowało — **dopisz powiązanie transakcja ↔
kontakt w HubSpot** (to naprawia dane, niczego nie usuwa). Za przełącznikiem `hubspot_push_enabled`.

Typ (`LeadType`) z nazwy: `pobranie cennika` → `POBRANIE_CENNIKA`, `kontakt` → `KONTAKT`,
`rezerwacja wynajmu` → `REZERWACJA_WWW`, `szkolenie` → `SZKOLENIE_WWW`; bez prefiksu `WWW` → `TELEFON`.
Telefon, urządzenie, termin, treść — wg mapowania ustalonego w kroku „Zanim zaczniesz kodować”.
Telefon znaleziony w transakcji, a brakujący w osobie kontaktowej → uzupełnij osobę (i odeślij do HubSpota).

Historia z HubSpota: notatki, połączenia i e-maile powiązane z transakcją i kontaktem importuj jako
`LeadActivity` (`hubspotEngagementId` = klucz idempotencji; e-mail = temat + pierwsze ~500 znaków).
Dzięki temu Ania widzi w panelu pełną historię i nic nie ginie.

### 2.4 Bieżąca synchronizacja (ten sam cron co w prompcie 1)

- **HubSpot → panel**: transakcje zmienione od kursora (`hs_lastmodifieddate`), nowe = reguły 2.3;
  istniejące = scalanie ze snapshotem jak w prompcie 1 (pola: etap, nazwa, powód przegranej).
  Nowy sygnał z formularza ma się pojawić w panelu **najpóźniej po 5 minutach** od wpadnięcia do HubSpota.
- **Panel → HubSpot** (przez `HubspotOutbox`): zmiana etapu, powód przegranej, nowy sygnał utworzony w
  panelu (tworzy transakcję w lejku `default` powiązaną z kontaktem), każda `LeadActivity` typu
  `CALL`, `CALL_NO_ANSWER`, `NOTE`, `SMS` → notatka w HubSpot przy transakcji i kontakcie (treść z
  prefiksem typu, np. „[Rozmowa] …”, „[SMS] …”). Aktywności zaimportowane z HubSpota nie wracają.
- Konflikt etapu (zmieniony w obu miejscach) → wygrywa panel, wpis w dzienniku konfliktów.

---

## 3. Ekrany — miejsce pracy Ani

Priorytet: **przejrzystość i mało klików**. Ania ma zacząć dzień od jednego ekranu i przejść przez
wszystkie sprawy bez szukania. Styl — spójny z istniejącą powłoką aplikacji i panelem Zadań
(`docs/prompt-claude-code-powloka-aplikacji.md`, `docs/panel zadania/…`).

### 3.1 Nawigacja

Pozycja **„Sygnały”** (`/sygnaly`) w `sidebar-nav.tsx`, **nad** „Klientami”, z plakietką liczby
sygnałów w etapie `SYGNAL` bez żadnej aktywności wychodzącej (`firstContactAt = null`). Niewidoczna dla
`KIEROWCA`.

### 3.2 `/sygnaly` — cztery widoki (zakładki)

1. **Na dziś** (domyślny) — jedna lista, sortowana wg pilności:
   - nowe sygnały bez kontaktu, od najstarszego, z licznikiem „czeka 3 h” (czerwony po 24 h roboczych,
     pon–pt 8–18, strefa Warszawa — funkcja z testami);
   - sygnały z `nextActionAt` ≤ dziś (follow-upy);
   - rezerwacje (`REZERWACJA`) z terminem wynajmu w ciągu 3 dni — przypomnienie „potwierdź”.
   Pusty widok = komunikat „Wszystko obsłużone”.
2. **Tablica** — kolumny etapów `SYGNAL → WYWIAD → OFERTA → REZERWACJA`, przeciąganie kart między
   kolumnami (przeciągnięcie na `PRZEGRANA` otwiera okno powodu). Wygrane i przegrane — zwinięte
   liczniki pod tablicą z linkiem do listy. Karta: nazwa klienta, urządzenie, termin, typ (ikona), „od X dni
   w etapie”, awatar prowadzącej osoby (kolory jak w Zadaniach).
3. **Do obdzwonienia** — sekcja 1.0a.
4. **Lista** — tabela z filtrami: etap, typ, urządzenie, prowadzący, zakres dat, „Bez klienta”,
   „Z HubSpota / z panelu”; wyszukiwarka jak w Klientach. Eksport CSV.

### 3.3 Karta sygnału (panel boczny otwierany z każdego widoku)

- Nagłówek: klient (link do `/klienci/[id]`, chip statusu klienta z promptu 1 — Ania od razu widzi, że
  to np. **stała** klientka), etap (zmiana selectem), typ, „wpłynęło 24.09, 10:23 (2 dni temu)”, link
  „Otwórz w HubSpot” (gdy integracja włączona).
- **Szybkie akcje** (duże przyciski, zawsze widoczne):
  - **Zadzwoń** — link `tel:` + okno wyniku rozmowy: „Rozmawiałam” (notatka + propozycja etapu
    `WYWIAD`), „Nie odebrała” (zapis `CALL_NO_ANSWER`, `nextActionAt` = następny dzień roboczy, opcja
    „wyślij SMS »Nie mogłam się dodzwonić«” jednym klikiem), „Oddzwoni / termin” (wybór daty
    `nextActionAt`). Pierwsza taka akcja ustawia `firstContactAt`.
  - **SMS** — istniejące szablony SMS (moduł `/ustawienia/szablony-sms`, wysyłka przez istniejący
    `POST /api/sms/send`) z uzupełnionymi zmiennymi klienta; zapis w `Message` + `LeadActivity`.
    Dodaj domyślne szablony: „Nie mogłam się dodzwonić”, „Dziękuję za rozmowę — oferta mailem”,
    „Przypomnienie o ofercie”.
  - **Oferta e-mail** — przygotowuje **szkic w Gmailu** (istniejący `src/lib/integrations/gmail.ts`,
    ten sam wzorzec: szkic, nie wysyłka) z szablonem oferty. Kwotę podpowiada **istniejący moduł cen**
    (`src/lib/pricing/` — urządzenie, wariant, liczba dni, transport z klienta) — Ania widzi wyliczenie
    i może je zmienić przed utworzeniem szkicu. Po utworzeniu: etap → `OFERTA`, `nextActionAt` = +3 dni
    robocze („follow-up oferty”).
  - **Utwórz rezerwację** — otwiera istniejący formularz nowego wynajmu z wypełnionym klientem,
    urządzeniem i terminem z sygnału; po zapisie `Lead.rentalId` + etap `REZERWACJA`.
  - **Odpowiedziałam mailem** — zapis `LeadActivity.type = EMAIL` (wychodzący) i kwalifikacja klienta
    (sekcja 1.0); po etapie B promptu 3 wykrywane automatycznie ze skrzynki, przycisk zostaje jako ręczny.
  - **Notatka** i **Zadanie** (zadanie w istniejącym module, z `leadId`).
  - **Przegrana** — okno: powód (lista `LostReason`, wymagany), notatka, opcjonalnie „wróć do
    kontaktu” (data → zadanie dla prowadzącej osoby w tym dniu).
- **Oś czasu** pod akcjami: wszystkie `LeadActivity` sygnału i klienta, najnowsze na górze, z ikoną
  typu i autorem; aktywności z HubSpota oznaczone małą etykietą „HubSpot”.
- Dane z formularza (treść wiadomości, urządzenie, termin, liczba dni, miejscowość) — edytowalne.
- Inne sygnały i wynajmy tego klienta — skrót z linkami (np. „3 wynajmy, ostatni 12.08 — LightSheer”).

### 3.4 Automatyka (bez konfiguracji w UI na start)

- Wynajem powiązany z sygnałem dostaje `RentalFinance.confirmedAt` → sygnał automatycznie `WYGRANA`.
- Wynajem powiązany z sygnałem usunięty w Google (`deletedInGoogle`) → sygnał wraca do `OFERTA` +
  zadanie „Rezerwacja odwołana — sprawdź”.
- Nowy sygnał od klienta ze statusem `STALY` lub `USPIONY` → oznaczenie „Powracająca klientka” na karcie.
- Nowy sygnał od klienta z blokadą `NIE_KONTAKTOWAC` → wyraźne ostrzeżenie na karcie.

### 3.5 Karta klienta (rozszerzenie promptu 1)

Na `/klienci/[id]` dodaj: sekcję „Sygnały” (otwarte i zamknięte), oś czasu aktywności klienta, te
same szybkie akcje Zadzwoń / SMS / Notatka / Nowy sygnał — żeby rozmowę ze stałą klientką (bez
formularza) też dało się zapisać.

### 3.6 Mini-podsumowanie nad widokami `/sygnaly`

Cztery liczby za ostatnie 30 dni: nowe sygnały · mediana czasu do pierwszego kontaktu (godziny robocze) ·
% sygnałów, które doszły do `REZERWACJA` · najczęstszy powód przegranej. Liczone z `Lead` i
`LeadActivity`, czysta funkcja z testami.

---

## 4. Uprawnienia

Jak w prompcie 1: `/sygnaly` i `/api/leads/*` — `ADMIN` i `STAFF`; `KIEROWCA` — 403. Kwoty z modułu
cen w oknie oferty — tylko `ADMIN` i `STAFF`.

---

## 5. Poza zakresem

Formularze WWW prosto do panelu (dalej idą przez n8n → HubSpot → cron), odpięcie n8n i HubSpota,
wysyłka konwersji do Google Ads (pola UTM/gclid tylko przygotowane), wysyłka maili z panelu bez Gmaila,
automatyczne sekwencje follow-upów. Lejek HubSpot „Wynajem”.

---

## 6. Kryteria odbioru

1. Dry run pokazuje liczbę transakcji do importu (ok. 186 od 09.2025 + starsze poza Sygnałem) i ile z
   nich zostanie powiązanych z klientem każdą z metod z 2.3.
2. Nowe zgłoszenie z formularza na wynajemlasera.pl pojawia się w „Na dziś” najpóźniej po 5 minutach,
   z klientem, telefonem i treścią (o ile n8n przekazuje je do HubSpota).
3. Przesunięcie karty na tablicy zmienia etap transakcji w HubSpot; zmiana etapu w HubSpot zmienia
   etap w panelu po kolejnym przebiegu crona.
4. Rozmowa, SMS i notatka zapisane w panelu są widoczne w HubSpot jako notatki przy transakcji.
5. „Utwórz rezerwację” tworzy wynajem z wypełnionymi danymi; potwierdzenie rozliczenia przez kierowcę
   przestawia sygnał na `WYGRANA`.
6. Wyłączenie `hubspot_pull_enabled` i `hubspot_push_enabled` nie psuje pracy na sygnałach w panelu.
7. Żadna transakcja ani kontakt w HubSpot nie zostały usunięte ani scalone.
7a. Po backfillu lista `/klienci` pokazuje tylko zakwalifikowanych; „Kontakty z zapytań” pokazuje resztę;
    rozmowa zapisana jako „Rozmawiałam” albo „Odpowiedziałam mailem” przenosi kontakt na listę klientów
    ze statusem „Potencjalny”; SMS i nieodebrane połączenie tego nie robią.
7b. Nieobsłużone zapytania z 2026 są w „Do obdzwonienia”, nie w „Na dziś”; wynik rozmowy w trybie
    seryjnym przechodzi do następnego kontaktu.
8. `npm run lint`, `npm test`, build przechodzą.
