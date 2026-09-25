# Prompt dla Claude Code — historia klienta: kalendarz, faktury i skrzynka e-mail (CRM, prompt 3)

## 0. Kontekst i problem

Moduł „Klienci” działa (prompt 1). Status klienta liczy się z wynajmów w bazie panelu — ale
`src/lib/device-sync.ts` pobiera z Kalendarza Google tylko **30 dni wstecz** (`SYNC_PAST_DAYS = 30`).
Wszystkie starsze wynajmy istnieją wyłącznie w kalendarzach urządzeń, w Fakturowni i w poczcie. Skutek:
stałe klientki mają w panelu 1–2 wynajmy i status „Nowy”, a karta klienta nie pokazuje historii.

Cel tego promptu:

1. **Odtworzyć historię wynajmów** z kalendarzy urządzeń (od początku działalności) i z faktur Fakturowni,
   przypisać ją do klientów i uwzględnić w statusie, liczbie wynajmów i „kliencie od”.
2. **Podłączyć skrzynkę Gmail** tak, jak robił to HubSpot: każdy e-mail wysłany do klienta lub od niego
   pojawia się na osi czasu klienta — wstecz (import historii) i na bieżąco.
3. (Opcjonalnie, sekcja 6) **Podsumowanie historii przez AI** na karcie klienta.

Źródła, z których panel już korzysta (nie buduj nowych integracji):

- Kalendarz Google — konto serwisowe z delegowaniem domeny (`src/lib/integrations/google-calendar.ts`,
  `GOOGLE_IMPERSONATED_USER`), jeden kalendarz na urządzenie (`Device.googleCalendarId`).
- Fakturownia — `listInvoices()` z `period=all` w `src/lib/integrations/fakturownia.ts`.
- Gmail — to samo konto serwisowe; dziś tylko zakres `gmail.compose` (szkice faktur, `gmail.ts`).
- Historia e-maili i notatek z HubSpota — importowana już w prompcie 2 (`LeadActivity` z
  `hubspotEngagementId`); nie dubluj — e-maile z Gmaila i z HubSpota deduplikuj po `Message-ID`, jeśli
  HubSpot go udostępnia, w przeciwnym razie po (nadawca, odbiorca, temat, czas ±2 min).

**Zanim zaczniesz kodować:** policz i wypisz: ile wydarzeń mają kalendarze urządzeń przed oknem 30 dni
(per urządzenie, per rok), ile faktur zwraca Fakturownia (per rok, ile z NIP nabywcy), jakie jest
`GOOGLE_IMPERSONATED_USER` (tylko adres, bez sekretów). Pokaż 20 losowych tytułów wydarzeń
historycznych — na nich zaprojektuj normalizację w sekcji 2. **Zatrzymaj się na potwierdzenie.**

**Zasada:** historia to warstwa **tylko do odczytu** — nie może uruchomić przypomnień SMS, alertów
(raporty, faktury, brak e-maila), zadań kierowcy ani wpłynąć na moduł przychodów bieżących. Dlatego
**nie** importuj historii do `Rental` — osobne modele poniżej.

---

## 1. Model danych

```
enum HistoryMatchMethod {
  NIP            // faktura: NIP nabywcy = Client.nip
  EMAIL          // adres e-mail osoby kontaktowej
  PHONE          // numer telefonu w opisie wydarzenia
  NAME_AUTO      // dopasowanie nazwy powyżej progu pewności
  MANUAL         // potwierdzone / wybrane ręcznie przez biuro
}

enum HistoryMatchState {
  AUTO           // przypisane automatycznie (wysoka pewność)
  SUGGESTED      // propozycja do potwierdzenia
  CONFIRMED      // potwierdzone przez człowieka
  IGNORED        // nie dotyczy klienta (np. serwis, blokada terminu, prywatne)
  UNMATCHED      // brak propozycji
}

model RentalHistory {                // wydarzenie z kalendarza urządzenia sprzed okna synchronizacji
  id               String   @id @default(cuid())
  deviceId         String
  device           Device   @relation(fields: [deviceId], references: [id])
  googleCalendarId String
  googleEventId    String
  title            String
  description      String?  @db.Text
  startsAt         DateTime
  endsAt           DateTime
  kind             String   // "WYNAJEM" | "SZKOLENIE" | "INNE" — z normalizacji tytułu (sekcja 2)
  clientId         String?
  client           Client?  @relation(fields: [clientId], references: [id], onDelete: SetNull)
  matchMethod      HistoryMatchMethod?
  matchState       HistoryMatchState @default(UNMATCHED)
  matchScore       Float?
  matchedByUserId  String?
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  @@unique([googleCalendarId, googleEventId])
  @@index([clientId])
  @@index([matchState])
  @@map("rental_history")
}

model ClientInvoice {                // faktury z Fakturowni (wszystkie, także sprzed panelu)
  id                   String   @id @default(cuid())
  fakturowniaInvoiceId Int      @unique
  number               String
  issueDate            DateTime
  buyerName            String
  buyerTaxNo           String?  // znormalizowany NIP
  totalNet             Decimal  @db.Decimal(10, 2)
  totalGross           Decimal  @db.Decimal(10, 2)
  positionsSummary     String?  @db.Text // nazwy pozycji — do rozpoznania urządzenia
  clientId             String?
  client               Client?  @relation(fields: [clientId], references: [id], onDelete: SetNull)
  rentalId             String?  // gdy faktura należy do wynajmu z panelu (RentalFinance.fakturowniaInvoiceId)
  matchMethod          HistoryMatchMethod?
  matchState           HistoryMatchState @default(UNMATCHED)
  createdAt            DateTime @default(now())
  updatedAt            DateTime @updatedAt

  @@index([clientId])
  @@index([buyerTaxNo])
  @@map("client_invoices")
}

enum EmailDirection {
  IN   // od klienta
  OUT  // do klienta
}

model EmailMessage {                 // metadane e-maili z/do klientów (Gmail)
  id               String   @id @default(cuid())
  mailbox          String   // skrzynka, z której pobrano (np. kontakt@wynajemlasera.pl)
  gmailMessageId   String
  gmailThreadId    String
  rfcMessageId     String?  // nagłówek Message-ID — deduplikacja między skrzynkami i z HubSpotem
  direction        EmailDirection
  fromAddress      String
  toAddresses      Json     // string[]
  ccAddresses      Json?
  subject          String?  @db.Text
  snippet          String?  @db.Text   // skrót z Gmaila (~200 znaków)
  hasAttachments   Boolean  @default(false)
  sentAt           DateTime
  clientId         String?
  client           Client?  @relation(fields: [clientId], references: [id], onDelete: SetNull)
  clientContactId  String?
  matchMethod      HistoryMatchMethod?
  createdAt        DateTime @default(now())

  @@unique([mailbox, gmailMessageId])
  @@index([clientId, sentAt])
  @@index([rfcMessageId])
  @@map("email_messages")
}
```

Pełnej treści maili **nie zapisujemy w bazie**. Na karcie klienta treść jest pobierana z Gmaila w chwili
otwarcia wiadomości (sekcja 4.4). W bazie tylko metadane i skrót — mniej danych osobowych, mniejsza baza.

`Client` — dodaj pola wyliczane przy odczycie (nie w bazie): „klient od” (najwcześniejsza data z
`Rental`, `RentalHistory`, `ClientInvoice`), liczba wynajmów łącznie, przychód historyczny z faktur.

---

## 2. Historia z kalendarzy urządzeń

### 2.1 Import

Jednorazowy import (ADMIN, `/ustawienia/integracje/google` → „Importuj historię kalendarzy”, z podglądem
jak w prompcie 1) wszystkich wydarzeń każdego kalendarza urządzenia **od najstarszego do granicy okna
synchronizacji** (`now − SYNC_PAST_DAYS`). Idempotentny (klucz `googleCalendarId + googleEventId`).
Wydarzenia, które już są w `Rental` (ten sam `googleEventId`), pomijaj. Codzienny cron dopisuje do
historii wydarzenia, które właśnie wypadły z okna 30 dni, jeśli z jakiegoś powodu nie ma ich w `Rental`.

### 2.2 Normalizacja tytułu

Tytuły są wolnym tekstem wpisywanym przez biuro, np. „Bloom House Wiktoria Pisarek”, „Sylwia Paciorek
1 gł.”, „Kuter Port Nieznanowice - mała głowica”, „Natalia Lesko Alma Szkolenie”, „FV”,
„⚠ Lubartów- rezerwacja”, „08:00 Gold Touch Olkusz”. Czysta funkcja z testami
(`src/lib/history/normalize-title.ts`):

- małe litery, usunięcie polskich znaków do porównań (oryginał zostaje do wyświetlenia), emoji i symboli;
- usunięcie godzin (`08:00`), słów technicznych: „gł”, „głowica”, „mała/duża głowica”, „1 gł.”, „FV”,
  „rezerwacja”, „wstępna”, „p.”, „pani”, nazw urządzeń (LightSheer, Quattro, Desire, Alma, Pixel,
  Cooltech, Resur, Observ) — **ale** zapamiętaj, czy wystąpiło „szkolenie” (`kind = SZKOLENIE`);
- tytuły bez treści po czyszczeniu („FV”, „blokada”, „serwis”, „przegląd”) → `kind = INNE`,
  `matchState = IGNORED`;
- wyciągnij z opisu telefony (`normalizePolishPhone`), e-maile i NIP-y — to najmocniejsze sygnały.

Listę słów technicznych trzymaj w jednym miejscu, łatwą do rozszerzenia — pierwsza wersja powstaje z
próbki 20 tytułów pokazanej przed kodowaniem.

### 2.3 Dopasowanie do klienta

Kolejność (pierwsze trafienie wygrywa), czysta funkcja z testami (`src/lib/history/match.ts`):

1. telefon lub e-mail z opisu = `ClientContact` → `AUTO` (`PHONE` / `EMAIL`);
2. NIP z opisu = `Client.nip` → `AUTO` (`NIP`);
3. nazwa: podobieństwo znormalizowanego tytułu do nazwy klienta, do „imię nazwisko” i „nazwisko imię”
   osób kontaktowych, z premią, gdy w tytule jest miasto klienta. Wynik ≥ 0,9 → `AUTO`;
   0,6–0,9 → `SUGGESTED` z 1–3 kandydatami; < 0,6 → `UNMATCHED`. Progi w konfiguracji.
4. Uczenie z potwierdzeń: gdy biuro potwierdzi „Kuter Port Nieznanowice” → klient X, zapisz alias
   (tabela `ClientAlias`: `clientId`, `alias` znormalizowany) i używaj go w kolejnych dopasowaniach
   (także dla nowych wynajmów w `Rental`, które nie mają przypisanego klienta).

### 2.4 Ekran przeglądu — `/klienci/dopasowania`

Jednorazowa praca dla Ani, zaprojektowana tak, żeby zajęła minimum czasu:

- Zakładki: **Do potwierdzenia** (SUGGESTED) · **Bez dopasowania** (UNMATCHED) · **Automatyczne** (AUTO,
  do wyrywkowej kontroli) · **Pominięte** (IGNORED).
- Grupowanie po **znormalizowanym tytule** — „Bloom House Wiktoria Pisarek” występujące 14 razy to jeden
  wiersz z licznikiem i zakresem dat, nie 14 wierszy. Jedna decyzja przypisuje całą grupę.
- Przy wierszu: kandydaci z wynikiem, przycisk „Potwierdź”, wyszukiwarka klienta („Inny klient…”),
  „Nowy klient z tego wpisu” (formularz z nazwą z tytułu), „Pomiń (nie klient)”.
- Zaznaczanie wielu wierszy + „Potwierdź zaznaczone”.
- Pasek postępu: „Przypisano 312 z 845 wydarzeń (37%)”.
- Ten sam ekran obsługuje faktury bez dopasowania (sekcja 3) — osobna zakładka.

---

## 3. Historia z faktur (Fakturownia)

- Import wszystkich faktur (`listInvoices()` bez zakresu = `period=all`) do `ClientInvoice`, idempotentnie
  po `fakturowniaInvoiceId`; codzienny cron dopisuje nowe. Pobierz NIP nabywcy i nazwy pozycji (jeśli
  lista nie zwraca pozycji — `getInvoiceDetail()` dla faktur bez dopasowania, z limitem zapytań).
- Dopasowanie: NIP nabywcy = `Client.nip` → `AUTO` (`NIP`); w przeciwnym razie nazwa nabywcy jak w 2.3.
- Faktura powiązana z wynajmem z panelu (`RentalFinance.fakturowniaInvoiceId`) → `rentalId`, bez liczenia
  drugi raz.
- Klient bez NIP, dopasowany do faktury po nazwie i potwierdzony → zaproponuj wpisanie NIP z faktury
  na kartę klienta (jeden klik). Dzięki temu kolejne faktury dopasują się już automatycznie po NIP.

---

## 4. Skrzynka Gmail — historia maili jak w HubSpocie

### 4.1 Dostęp (krok administratora)

W Google Workspace Admin (Bezpieczeństwo → Dostęp i kontrola danych → Kontrola interfejsów API →
Przekazywanie uprawnień w całej domenie) dla **tego samego Client ID** konta serwisowego dopisz zakres
`https://www.googleapis.com/auth/gmail.readonly` obok istniejących `calendar` i `gmail.compose`.
Strona `/ustawienia/integracje/google` sprawdza zakres próbnym wywołaniem i pokazuje instrukcję, jeśli go brak.

### 4.2 Które skrzynki

Lista skrzynek w ustawieniach (ADMIN), domyślnie `GOOGLE_IMPERSONATED_USER`. Można dodać kolejne
skrzynki z tej samej domeny Workspace (np. skrzynkę Ani) — delegowanie domeny pozwala czytać każdą
skrzynkę w domenie, więc **dodanie skrzynki wymaga świadomej decyzji ADMINA** (checkbox z informacją,
czyje maile będą widoczne dla biura). Skrzynek spoza domeny (np. prywatny Gmail) nie obsługujemy.

### 4.3 Co pobieramy

**Tylko wiadomości, w których nadawca lub odbiorca to adres osoby kontaktowej klienta** (`ClientContact.email`)
— reszta skrzynki nie trafia do panelu. Wyjątek: adres w domenie firmowej klienta (np. `@gabinet-aurora.pl`,
nie darmowe domeny: gmail.com, wp.pl, o2.pl, onet.pl, interia.pl, op.pl, poczta.onet.pl, icloud.com,
outlook.com, yahoo.com — lista w konfiguracji) → przypisz do klienta z tą domeną jako `SUGGESTED`
i zaproponuj dodanie nowej osoby kontaktowej.

- **Import historii**: dla każdego adresu klienta `messages.list` z `q = "from:<adres> OR to:<adres>"`
  (bez limitu dat), partiami, z poszanowaniem limitów API (backoff przy 429). Postęp w ustawieniach.
- **Bieżąca synchronizacja**: cron co 5 minut (ten sam wzorzec co `/api/cron/sync-devices`),
  `users.history.list` od zapisanego `historyId` dla każdej skrzynki; nowe wiadomości → filtr jak wyżej.
- **Nowy klient / nowy adres**: po dodaniu osoby kontaktowej albo zmianie e-maila — doimportuj jej historię.
- Pomijaj: wiadomości automatyczne panelu, jeśli są już w `Message` (ten sam temat i odbiorca w ±2 min),
  auto-odpowiedzi (`Auto-Submitted`, „Out of office”), spam i kosz.
- Ze szkiców faktur w Gmailu (`gmail.ts`) nic nie importuj, dopóki nie zostaną wysłane.

### 4.4 Wyświetlanie

- Oś czasu na karcie klienta: e-maile jako pozycje „E-mail ↓ od klienta” / „E-mail ↑ do klienta”,
  temat, skrót, data, skrzynka, ikona załącznika; wątki zwinięte do jednej pozycji z licznikiem.
- Klik → panel z pełną treścią pobraną **w tej chwili** z Gmail API (`messages.get`, `format=full`,
  tylko tekst + lista załączników; HTML sanityzowany — bez skryptów, zdalnych obrazów i iframe'ów) +
  link „Otwórz w Gmailu”.
- Na liście klientów kolumna/sortowanie „Ostatni kontakt” = najnowsza z: e-mail, SMS, rozmowa, wynajem.
- Na karcie sygnału (prompt 2) — e-maile klienta z ostatnich 30 dni.

### 4.5 Bezpieczeństwo

- Wszystkie endpointy e-maili: `ADMIN`/`STAFF`; `KIEROWCA` — 403, także metadane.
- Treść maila nigdy nie jest logowana (`logger`) ani zapisywana w bazie; w logach tylko id wiadomości.
- Wyłącznik `gmail_sync_enabled` w `Setting`.

---

## 5. Status i liczby klienta — nowe reguły

Zaktualizuj `computeClientStatus` (prompt 1) i jego testy: **zrealizowany wynajem** to:

1. `Rental` jak dotąd (`WYNAJEM`, nieusunięty, `finance.confirmedAt != null`), **lub**
2. `RentalHistory` z `kind = WYNAJEM` i `matchState ∈ {AUTO, CONFIRMED}`, **lub**
3. `ClientInvoice` dopasowana (`AUTO`/`CONFIRMED`), bez `rentalId`, która **nie** leży w ±7 dniach od
   wynajmu z punktów 1–2 tego samego klienta (faktura jako dowód wynajmu, którego nie ma w kalendarzu).

`SUGGESTED` się nie liczy, dopóki ktoś nie potwierdzi. Szkolenia dalej nie liczą się do statusu, ale są
widoczne w historii. Karta klienta: „Klient od: 03.2024 · 14 wynajmów łącznie · 6 w 12 mies.” oraz
historia wynajmów łącząca `Rental` i `RentalHistory` (historyczne z etykietą „z kalendarza”, bez kwot)
i faktury (kwoty).

Pole `legacyHubspotTag` (np. „nowy klient”) dalej **nie** wpływa na status — to jest właśnie błąd, który
usuwamy.

---

## 6. (Opcjonalnie) Podsumowanie historii przez AI

Tylko jeśli ADMIN ustawi `ANTHROPIC_API_KEY` w `.env` (bez klucza sekcja jest ukryta). Na karcie klienta
przycisk „Podsumuj historię”: panel składa oś czasu klienta (wynajmy, urządzenia, daty, notatki, tematy i
skróty maili — **bez** pełnych treści) i wysyła do Claude API z instrukcją, by zwrócił krótki JSON:
preferowane urządzenia i warianty, typowy rytm wynajmów, ustalenia logistyczne (godziny, dojazd),
ustalone ceny/rabaty wspomniane w mailach, otwarte sprawy. Wynik zapisz jako `Client.aiSummary` (+ data)
i pokaż jako edytowalną sekcję „Podsumowanie” z adnotacją „wygenerowane, sprawdź”. Nigdy automatycznie,
tylko na żądanie; bez wysyłania numerów telefonów i NIP do API.

---

## 7. Kryteria odbioru

1. Podgląd importu kalendarzy pokazuje liczbę wydarzeń per urządzenie i rok oraz ile dopasuje się
   automatycznie; import nie tworzy żadnego `Rental`, `ReminderRule` ani `Message`.
2. Po imporcie i przeglądzie dopasowań klienci z wieloma historycznymi wynajmami mają status „Stały”,
   „Uśpiony” albo „Były” zgodnie z regułami — nie „Nowy”.
3. Potwierdzenie jednej grupy tytułów przypisuje wszystkie jej wydarzenia i tworzy alias.
4. E-mail wysłany dziś do klientki z podłączonej skrzynki pojawia się na jej osi czasu najpóźniej po 5 minutach;
   e-mail do adresu spoza bazy klientów nie trafia do panelu.
5. Otwarcie e-maila pokazuje treść pobraną z Gmaila; w bazie i logach nie ma treści.
6. `KIEROWCA` dostaje 403 na wszystkie endpointy historii i e-maili.
7. Przychody bieżące (`/finanse/przychody`) się nie zmieniły.
8. `npm run lint`, `npm test`, build przechodzą.
