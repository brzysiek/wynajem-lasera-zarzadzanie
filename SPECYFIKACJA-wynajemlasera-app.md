# Aplikacja do zarządzania wynajmem urządzeń — WynajemLasera.pl

## Kontekst biznesowy

WynajemLasera.pl wynajmuje profesjonalne urządzenia kosmetyczne i medyczne (lasery, kriolipoliza, diagnostyka skóry) gabinetom beauty i medycznym na terenie Polski. Firma dysponuje **7 urządzeniami** — m.in. LightSheer (depilacja laserowa diodowa), CoolTech (kriolipoliza), Resur FX (laser frakcyjny nieablacyjny), Observ 520x (diagnostyka skóry). Wynajem jest krótkoterminowy — klient rezerwuje urządzenie na konkretne dni, firma zajmuje się transportem i szkoleniem.

### Stan obecny (do zastąpienia)

- **Rezerwacje** trzymane są w Kalendarzu Google. Każde z 7 urządzeń ma **własny, osobny kalendarz Google**. Pracownik obsługi klienta tworzy wydarzenie w kalendarzu odpowiadającym danemu urządzeniu, wpisując w treść informację o kliencie.
- **Klienci** trzymani są w HubSpot (CRM) — tam są kontakty z numerami telefonu i adresami e-mail.
- Nie ma powiązania między tymi dwoma systemami. Powiadomienia do klientów wysyłane są ręcznie.

### Cel aplikacji

Aplikacja webowa dla pracownika obsługi klienta, która:
1. Jest **odzwierciedleniem (dwukierunkowym) Kalendarza Google** — pozwala przeglądać i edytować rezerwacje bez otwierania Kalendarza Google.
2. Pozwala **przypisać do każdej rezerwacji klienta z HubSpot**.
3. Pozwala **zdefiniować i automatycznie wysyłać przypomnienia SMS/e-mail** do klienta przed terminem wynajmu.
4. Pozwala **wysłać doraźną wiadomość** do klienta (np. potwierdzenie rezerwacji) przez SMS lub e-mail.
5. Daje **przejrzysty widok nadchodzących wynajmów** na najbliższe tygodnie ze statusem wysłanych powiadomień.

Google Calendar pozostaje źródłem prawdy dla terminów rezerwacji. HubSpot pozostaje źródłem prawdy dla danych klientów. Aplikacja dokłada własną warstwę: powiązanie rezerwacja↔klient, reguły przypomnień i historię komunikacji.

---

## Stack techniczny

- **Framework**: Next.js (App Router), TypeScript
- **Baza danych**: PostgreSQL
- **ORM**: Prisma
- **Autentykacja**: NextAuth (Credentials provider — login + hasło, bez OAuth dla użytkowników aplikacji)
- **Hashowanie haseł**: bcrypt
- **Integracja kalendarza**: Google Calendar API (`googleapis`), autoryzacja przez service account z domain-wide delegation lub OAuth2 refresh token dla konta firmowego
- **Integracja CRM**: HubSpot API v3 (Contacts), Private App access token
- **Bramka SMS**: SMSAPI.pl (polska bramka, dobra dokumentacja) — abstrakcja pozwalająca podmienić dostawcę
- **E-mail**: Resend lub SMTP firmowej skrzynki (nodemailer)
- **Scheduler**: Vercel Cron (lub node-cron przy deploymencie na VPS) — worker uruchamiany co godzinę
- **UI**: React + Tailwind CSS; komponent kalendarza — FullCalendar lub własny (do decyzji na etapie implementacji)
- **Deployment docelowy**: Vercel (aplikacja) + Neon/Supabase (Postgres)

---

## Model danych

### `User`
Konta pracowników obsługi klienta. Nie ma publicznej rejestracji — konta zakłada administrator.

| pole | typ | opis |
|---|---|---|
| id | uuid PK | |
| email | string unique | login |
| passwordHash | string | bcrypt |
| name | string | wyświetlana nazwa |
| role | enum('ADMIN','STAFF') | ADMIN ma dostęp do Ustawień → Integracje i Użytkownicy |
| createdAt | timestamp | |

### `Device`
Urządzenia dostępne do wynajmu. Rekordy tworzone ręcznie w Ustawieniach; 7 sztuk.

| pole | typ | opis |
|---|---|---|
| id | uuid PK | |
| name | string | np. "LightSheer Desire" |
| shortName | string | etykieta w kalendarzu, np. "LightSheer" |
| color | string | hex, kolor wydarzeń w kalendarzu |
| googleCalendarId | string | ID kalendarza Google przypisanego do tego urządzenia |
| active | boolean | urządzenie wycofane → false, ukryte w nowych rezerwacjach |
| createdAt | timestamp | |

### `Rental`
Rezerwacja wynajmu — lokalne odzwierciedlenie wydarzenia z Kalendarza Google plus dane własne aplikacji.

| pole | typ | opis |
|---|---|---|
| id | uuid PK | |
| deviceId | uuid FK → Device | |
| googleEventId | string | ID wydarzenia w Kalendarzu Google |
| googleCalendarId | string | dla pewności przy re-syncu |
| title | string | tytuł wydarzenia (summary z Google) |
| description | text nullable | opis wydarzenia |
| startsAt | timestamp | |
| endsAt | timestamp | |
| allDay | boolean | Google pozwala na wydarzenia całodniowe |
| hubspotContactId | string nullable | ID kontaktu w HubSpot |
| contactNameCache | string nullable | zdenormalizowane z HubSpot |
| contactPhoneCache | string nullable | zdenormalizowane z HubSpot |
| contactEmailCache | string nullable | zdenormalizowane z HubSpot |
| internalNotes | text nullable | notatki widoczne tylko w aplikacji |
| lastSyncedAt | timestamp | kiedy ostatnio zsynchronizowano z Google |
| deletedInGoogle | boolean | wydarzenie usunięte w Google, zachowane lokalnie dla historii |
| createdAt / updatedAt | timestamp | |

Unikalny indeks na `(googleCalendarId, googleEventId)`.

### `ReminderRule`
Reguła przypomnienia przypisana do konkretnej rezerwacji. Pracownik zaznacza checkboxy „7 dni przed", „3 dni przed", „1 dzień przed" — każdy zaznaczony tworzy rekord.

| pole | typ | opis |
|---|---|---|
| id | uuid PK | |
| rentalId | uuid FK → Rental | cascade delete |
| daysBefore | int | 7, 3, 1 — lub dowolna liczba |
| channel | enum('SMS','EMAIL') | |
| messageBody | text | treść po podstawieniu domyślnego szablonu, edytowalna |
| status | enum('SCHEDULED','SENT','FAILED','CANCELLED') | |
| scheduledFor | timestamp | wyliczone: startsAt − daysBefore, o ustalonej godzinie (np. 10:00) |
| sentAt | timestamp nullable | |
| errorMessage | text nullable | |

### `Message`
Doraźne wiadomości wysłane ręcznie z aplikacji (np. potwierdzenie rezerwacji) oraz log wysłanych przypomnień.

| pole | typ | opis |
|---|---|---|
| id | uuid PK | |
| rentalId | uuid FK → Rental nullable | |
| userId | uuid FK → User nullable | kto wysłał (null = automat) |
| channel | enum('SMS','EMAIL') | |
| recipient | string | numer telefonu lub e-mail |
| subject | string nullable | tylko dla e-mail |
| body | text | |
| status | enum('SENT','FAILED') | |
| providerMessageId | string nullable | ID z bramki |
| errorMessage | text nullable | |
| sentAt | timestamp | |

### `MessageTemplate`
Domyślne szablony treści przypomnień, edytowalne w Ustawieniach.

| pole | typ | opis |
|---|---|---|
| id | uuid PK | |
| key | string unique | np. `reminder_7d_sms`, `confirmation_email` |
| label | string | nazwa wyświetlana |
| channel | enum('SMS','EMAIL') | |
| subject | string nullable | |
| body | text | zawiera zmienne: `{klient}`, `{urzadzenie}`, `{data}`, `{godzina}` |

### `Setting`
Prosty key-value na konfigurację (tokeny API, adres nadawcy, godzina wysyłki przypomnień). Wartości wrażliwe szyfrowane at-rest lub trzymane w zmiennych środowiskowych — do decyzji.

### `SyncLog`
Log synchronizacji z Google Calendar — pomocny przy diagnozowaniu rozjazdów.

| pole | typ | opis |
|---|---|---|
| id | uuid PK | |
| deviceId | uuid FK nullable | |
| direction | enum('PULL','PUSH') | |
| eventsProcessed | int | |
| status | enum('OK','ERROR') | |
| errorMessage | text nullable | |
| createdAt | timestamp | |

---

## Struktura nawigacji

```
/login                        ekran logowania (login + hasło)
/                             przekierowanie → /kalendarz
/kalendarz                    widok główny — kalendarz miesięczny/tygodniowy
/nadchodzace                  lista nadchodzących wynajmów
/urzadzenia                   lista urządzeń i status synchronizacji
/ustawienia/konto             zmiana własnego hasła, dane użytkownika
/ustawienia/integracje        HubSpot, Google Calendar, mapowanie urządzeń (tylko ADMIN)
/ustawienia/szablony          edycja szablonów przypomnień i potwierdzeń
/ustawienia/bramka            konfiguracja SMS i e-mail (tylko ADMIN)
/ustawienia/uzytkownicy       lista kont, dodawanie/usuwanie (tylko ADMIN)
```

Nawigacja główna (górny pasek lub lewy sidebar): Kalendarz · Nadchodzące · Urządzenia · Ustawienia. Po prawej stronie nazwa zalogowanego użytkownika i wylogowanie.

---

## Opis ekranów

### `/login`
Pola: e-mail, hasło. Przycisk „Zaloguj". Link „Nie pamiętam hasła" (reset przez e-mail — może być zaimplementowany w późniejszym etapie). Brak rejestracji.

### `/kalendarz` — widok główny
- Przełącznik widoku: **miesiąc** / **tydzień**
- Nawigacja: poprzedni / następny okres / „dziś"
- Filtr urządzeń: lista checkboxów z 7 urządzeniami, każde z kolorem; domyślnie wszystkie zaznaczone
- Siatka kalendarza z wydarzeniami — każde wydarzenie pokolorowane kolorem swojego urządzenia, etykieta: `{shortName urządzenia} · {nazwa klienta lub tytuł wydarzenia}`
- Wydarzenia bez przypisanego klienta mają wizualny znacznik (np. kropka ostrzegawcza)
- Kliknięcie wydarzenia → **modal szczegółów rezerwacji** (opis niżej)
- Przycisk „Nowa rezerwacja" → ten sam modal w trybie tworzenia

### Modal szczegółów rezerwacji
Sekcja 1 — **Termin i urządzenie**
- Wybór urządzenia (select, tylko aktywne)
- Data i godzina rozpoczęcia / zakończenia, checkbox „całodniowe"
- Tytuł wydarzenia, opis
- Zapis → aktualizacja wydarzenia w Kalendarzu Google (`events.update`) + lokalnej bazie

Sekcja 2 — **Klient (HubSpot)**
- Pole wyszukiwania z debounce (min. 3 znaki), przeszukujące HubSpot po imieniu, nazwisku, firmie, telefonie, e-mailu
- Lista wyników; kliknięcie przypisuje kontakt do rezerwacji (zapis `hubspotContactId` + cache pól)
- Po przypisaniu: karta z nazwą, telefonem, e-mailem, przyciskiem „odepnij" i linkiem otwierającym kontakt w HubSpot
- Bez przypisanego klienta sekcje przypomnień i wiadomości są nieaktywne (nie ma dokąd wysłać)

Sekcja 3 — **Przypomnienia**
- Checkboxy dla predefiniowanych okresów: 7 dni, 3 dni, 1 dzień przed
- Dla każdego: wybór kanału (SMS / e-mail) i podgląd treści z możliwością edycji
- Treść domyślna pobierana z szablonu i wypełniana zmiennymi
- Przy każdym przypomnieniu status: zaplanowane na `{data}` / wysłane `{data}` / błąd
- Zapis → utworzenie lub aktualizacja rekordów `ReminderRule`
- Jeśli termin rezerwacji się zmieni, `scheduledFor` przelicza się automatycznie; przypomnienia z datą w przeszłości oznaczane jako `CANCELLED`

Sekcja 4 — **Wyślij wiadomość**
- Wybór kanału: SMS / e-mail / oba
- Pole treści (dla e-maila także temat), z możliwością wstawienia gotowego szablonu
- Przycisk „Wyślij" → natychmiastowa wysyłka, zapis do `Message`
- Poniżej historia wysłanych wiadomości dla tej rezerwacji

Sekcja 5 — **Notatki wewnętrzne**
- Pole tekstowe widoczne tylko w aplikacji, nietrafiające do Kalendarza Google

Stopka modala: „Zapisz", „Usuń rezerwację" (usuwa też wydarzenie w Google, po potwierdzeniu), „Zamknij".

### `/nadchodzace`
- Lista rezerwacji pogrupowana po dniach, domyślnie: bieżący tydzień + następny
- Nawigacja: tydzień wstecz / tydzień w przód
- Każdy wiersz: dzień tygodnia, data, urządzenie (z kolorem), nazwa klienta, godziny
- Kolumna statusu powiadomień: które przypomnienia wysłane, które zaplanowane, ostrzeżenie przy braku przypisanego klienta
- Kliknięcie wiersza → ten sam modal szczegółów co w kalendarzu
- Możliwość filtrowania po urządzeniu

### `/urzadzenia`
- Lista 7 urządzeń: nazwa, kolor, ID przypisanego kalendarza Google
- Status synchronizacji: czy webhook aktywny, kiedy ostatni udany sync, liczba rezerwacji
- Najbliższa rezerwacja dla każdego urządzenia
- Przycisk „Synchronizuj teraz" wymuszający pełny pull z danego kalendarza
- Dodawanie / edycja urządzenia (nazwa, kolor, ID kalendarza, aktywne tak/nie)

### `/ustawienia/*`
Zakładki opisane w strukturze nawigacji. Kluczowe pola:
- **Integracje**: HubSpot Private App token (pole hasłowe, z testem połączenia), autoryzacja Google Calendar (status + przycisk ponownej autoryzacji), lista kalendarzy Google pobrana z API do wyboru przy mapowaniu urządzeń
- **Szablony**: edytor treści dla każdego szablonu, lista dostępnych zmiennych, podgląd z przykładowymi danymi
- **Bramka**: token SMSAPI, nazwa nadawcy SMS, adres nadawcy e-mail, godzina wysyłki przypomnień (domyślnie 10:00), przycisk „wyślij testową wiadomość"
- **Użytkownicy**: lista kont, dodawanie (e-mail, imię, rola, hasło startowe), usuwanie, reset hasła

---

## Integracje — szczegóły implementacyjne

### Google Calendar

**Autoryzacja.** Service account z domain-wide delegation (jeśli firma ma Google Workspace) lub OAuth2 z refresh tokenem dla konta, które jest właścicielem 7 kalendarzy. Refresh token trzymany w bazie lub zmiennych środowiskowych.

**Pull (Google → aplikacja).**
- Pełna synchronizacja przy pierwszym uruchomieniu i przy „synchronizuj teraz": `events.list` dla każdego kalendarza, zapis `syncToken` zwróconego przez API.
- Synchronizacja przyrostowa: kolejne `events.list` z `syncToken` zwracają tylko zmiany. Przy błędzie 410 (token wygasł) — pełna resynchronizacja.
- **Push notifications**: `events.watch` na każdym z 7 kalendarzy rejestruje webhook na endpoincie `/api/webhooks/google-calendar`. Google wysyła powiadomienie przy każdej zmianie; aplikacja odpala synchronizację przyrostową dla danego kalendarza. Kanały wygasają (max ~30 dni) — cron odnawiający je co tydzień.
- Fallback: cron co 15 minut robiący synchronizację przyrostową wszystkich kalendarzy, na wypadek nieodebranego webhooka.
- Wydarzenia usunięte w Google (`status: cancelled`) → ustawienie `deletedInGoogle = true`, nie fizyczne usunięcie (zachowanie historii wysłanych wiadomości).

**Push (aplikacja → Google).**
- Utworzenie rezerwacji: `events.insert` do kalendarza urządzenia, zapis zwróconego `eventId`.
- Edycja terminu/tytułu/opisu: `events.update`.
- Usunięcie: `events.delete`.
- Uwaga na pętlę: zapis do Google wywoła webhooka, który wywoła pull. Pull powinien wykrywać, że dane są identyczne, i nie robić nic (porównanie `updated` z Google z `lastSyncedAt`).

**Mapowanie urządzeń.** Tabela `Device.googleCalendarId` — jeden kalendarz na urządzenie, konfigurowane w Ustawieniach.

### HubSpot

- Private App access token ze scope'ami `crm.objects.contacts.read` (na start tylko odczyt).
- Wyszukiwanie kontaktów: `POST /crm/v3/objects/contacts/search` z filtrem po `firstname`, `lastname`, `email`, `phone`, `company`. Debounce 300 ms w UI, minimum 3 znaki.
- Pobranie pojedynczego kontaktu: `GET /crm/v3/objects/contacts/{id}` z properties `firstname,lastname,email,phone,company`.
- Cache: po przypisaniu kontaktu do rezerwacji zapisujemy zdenormalizowane pola w `Rental`. Odświeżenie cache przy otwarciu modala (jeśli starsze niż np. 24 h) — bez blokowania UI.
- Rate limit HubSpot: ~100 żądań / 10 s dla Private App. Wyszukiwanie z debounce mieści się bez problemu.
- Zapis do HubSpot (np. notatka o wynajmie) — **poza zakresem pierwszej wersji**, ale model danych i warstwa integracji powinny być na to przygotowane.

### Bramka SMS

- SMSAPI.pl, endpoint `POST https://api.smsapi.pl/sms.do`, autoryzacja OAuth tokenem.
- Nazwa nadawcy (sender name) musi być zarejestrowana u operatora — do ustawienia w konfiguracji.
- Warstwa abstrakcji: interfejs `SmsProvider { send(to, body): Promise<{id, status}> }`, implementacja `SmsApiProvider` — pozwala podmienić dostawcę bez zmian w logice.
- Numery telefonu z HubSpot mogą być w różnych formatach — normalizacja do E.164 (`+48...`) przed wysyłką (biblioteka `libphonenumber-js`).
- Limit długości SMS: 160 znaków dla GSM-7, 70 dla Unicode (polskie znaki!). Licznik znaków w UI ostrzegający o rozbiciu na kilka wiadomości.

### E-mail

- Resend albo nodemailer + SMTP firmowej skrzynki.
- Ten sam wzorzec abstrakcji co przy SMS: `EmailProvider { send(to, subject, body) }`.

---

## Worker przypomnień

Cron uruchamiany **co godzinę** (Vercel Cron: `0 * * * *` → `/api/cron/send-reminders`, zabezpieczony sekretem w nagłówku).

Logika:
1. Pobierz wszystkie `ReminderRule` ze statusem `SCHEDULED` i `scheduledFor <= now()`.
2. Dla każdej: sprawdź, czy rezerwacja nadal istnieje i nie jest oznaczona jako `deletedInGoogle`; jeśli tak — status `CANCELLED`.
3. Sprawdź, czy jest przypisany klient z numerem telefonu (SMS) lub e-mailem; jeśli brak — status `FAILED` z opisem błędu.
4. Wyślij przez odpowiedniego providera.
5. Zapisz rekord w `Message`, ustaw status `SENT` lub `FAILED` z treścią błędu.
6. Zapisz podsumowanie do `SyncLog` lub osobnego logu.

Godzina wysyłki (domyślnie 10:00) konfigurowalna; `scheduledFor` liczone jako `startsAt − daysBefore dni`, ustawione na tę godzinę w strefie `Europe/Warsaw`.

**Strefa czasowa**: wszystko w bazie w UTC, prezentacja i wyliczanie `scheduledFor` w `Europe/Warsaw`. Uwaga na zmianę czasu letni/zimowy.

**Idempotencja**: jeśli cron uruchomi się dwa razy, przypomnienie nie może wyjść dwa razy. Przed wysyłką zmiana statusu na pośredni lub blokada na poziomie transakcji bazy.

---

## Kolejność implementacji

Poniższe etapy są zaprojektowane tak, żeby po każdym z nich aplikacja była uruchamialna i testowalna.

**Etap 1 — fundament**
Projekt Next.js + TypeScript + Tailwind. Prisma + PostgreSQL, schema z modelami `User`, `Device`. NextAuth z Credentials providerem. Ekran `/login`, middleware chroniący pozostałe trasy. Szkielet layoutu z nawigacją. Seed z jednym kontem administratora.

**Etap 2 — urządzenia i połączenie z Google**
Ekran `/urzadzenia` z CRUD urządzeń. Autoryzacja Google Calendar API. Endpoint pobierający listę kalendarzy konta, żeby przypisać je do urządzeń. Ręczna pełna synchronizacja (`events.list`) zapisująca rezerwacje do modelu `Rental`. Bez UI kalendarza — na razie wystarczy lista rezerwacji, żeby sprawdzić, że dane się zaciągają.

**Etap 3 — kalendarz**
Ekran `/kalendarz` z widokiem miesięcznym i tygodniowym, kolorowaniem po urządzeniach i filtrem. Modal szczegółów rezerwacji — na razie tylko sekcja terminu i urządzenia, z zapisem z powrotem do Google (`events.update`, `events.insert`, `events.delete`). Tworzenie nowej rezerwacji z poziomu aplikacji.

**Etap 4 — synchronizacja automatyczna**
Synchronizacja przyrostowa z `syncToken`. Webhook `events.watch` + endpoint odbierający powiadomienia. Cron odnawiający kanały. Cron fallbackowy co 15 minut. Model `SyncLog` i wyświetlanie statusu synchronizacji na `/urzadzenia`.

**Etap 5 — HubSpot**
Konfiguracja tokenu w Ustawieniach. Wyszukiwarka kontaktów w modalu rezerwacji. Przypisywanie i odpinanie klienta, cache pól kontaktowych. Wyświetlanie nazwy klienta na wydarzeniach w kalendarzu.

**Etap 6 — wiadomości doraźne**
Integracja z bramką SMS i e-mail. Sekcja „Wyślij wiadomość" w modalu. Model `Message` i historia wysyłek. Ustawienia bramki z testową wysyłką.

**Etap 7 — przypomnienia automatyczne**
Model `ReminderRule` i `MessageTemplate`. Sekcja przypomnień w modalu rezerwacji. Ekran szablonów w Ustawieniach. Worker cron wysyłający zaplanowane przypomnienia. Przeliczanie `scheduledFor` przy zmianie terminu rezerwacji.

**Etap 8 — widok nadchodzących i dopracowanie**
Ekran `/nadchodzace` ze statusami powiadomień. Ekran `/ustawienia/uzytkownicy`. Obsługa błędów, komunikaty, stany ładowania. Reset hasła.

---

## Zasady i konwencje

- Interfejs w języku polskim. Kod, nazwy zmiennych i komentarze po angielsku.
- Wszystkie daty w bazie w UTC; konwersja na `Europe/Warsaw` w warstwie prezentacji i przy planowaniu przypomnień.
- Tokeny API nigdy nie trafiają do repozytorium — zmienne środowiskowe, `.env.example` z pustymi wartościami.
- Każda integracja zewnętrzna (Google, HubSpot, SMS, e-mail) w osobnym module z jasnym interfejsem, żeby dało się ją zamockować w testach i podmienić dostawcę.
- Błędy integracji nie mogą wywracać aplikacji — jeśli HubSpot nie odpowiada, kalendarz nadal działa, tylko wyszukiwarka kontaktów pokazuje komunikat.
- Rate limity: obsługa `429` z ponowieniem (exponential backoff) dla wszystkich integracji.
- Uprawnienia: rola `STAFF` nie ma dostępu do `/ustawienia/integracje`, `/ustawienia/bramka`, `/ustawienia/uzytkownicy`. Sprawdzanie po stronie serwera, nie tylko ukrywanie w UI.

---

## Zmienne środowiskowe

```
DATABASE_URL=
NEXTAUTH_SECRET=
NEXTAUTH_URL=

GOOGLE_SERVICE_ACCOUNT_EMAIL=
GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY=
GOOGLE_IMPERSONATED_USER=
GOOGLE_WEBHOOK_BASE_URL=

HUBSPOT_ACCESS_TOKEN=

SMSAPI_TOKEN=
SMSAPI_SENDER_NAME=

EMAIL_FROM=
RESEND_API_KEY=

CRON_SECRET=
REMINDER_SEND_HOUR=10
TZ=Europe/Warsaw
```

---

## Poza zakresem pierwszej wersji

Warto o tym pamiętać przy projektowaniu, ale nie implementować teraz: zapis notatek z powrotem do HubSpota, statystyki wykorzystania urządzeń i przychodów, obsługa umów i dokumentów wynajmu, moduł transportu i logistyki, rezerwacje szkoleń, powiadomienia wewnętrzne dla pracowników, aplikacja mobilna.
