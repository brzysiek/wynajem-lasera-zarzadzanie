# Prompt dla Claude Code — moduł finansowy wydarzeń (panel.wynajemlasera.pl)

## 0. Kontekst i cel

**Hierarchia źródeł prawdy w tym pakiecie — przeczytaj to jako pierwsze:**
Towarzyszy temu plikowi plik `mockup-master-finanse-wynajmu.html` — **to jest nadrzędne źródło prawdy
dla wyglądu** (dokładne kolory, odstępy, promienie zaokrągleń, typografia, layout). Otwórz go w
przeglądarce przed pisaniem UI. Jeśli cokolwiek w tekście/ASCII-wireframe'ach poniżej wygląda inaczej
niż w tym pliku HTML — **HTML wygrywa**. Ten plik `.md` jest źródłem prawdy dla modelu danych, logiki
cenowej, uprawnień i zachowania (co się dzieje po kliknięciu, jakie są reguły walidacji) — w tych
sprawach wygrywa on, nie HTML (HTML ma tylko przykładowe, statyczne dane).

Panel do zarządzania wynajmem urządzeń (Next.js 16 fork, Prisma 6 + adapter mariadb, next-auth v5,
role ADMIN/STAFF/KIEROWCA) potrzebuje modułu finansowego przypisanego do wydarzenia (`Rental`), a nie
do klienta. Cel: kierowca odbierając/oddając sprzęt widzi dokładną kwotę do rozliczenia z klientką
(gotówka lub info że przelew), a dane finansowe nadają się do przyszłej analizy (Obszar #4 projektu:
ROI per urządzenie / model współpracy).

**Zanim zaczniesz kodować**: przeczytaj `AGENTS.md`/`CLAUDE.md` w repo (zmodyfikowany fork Next.js —
„This is NOT the Next.js you know") oraz `node_modules/next/dist/docs`. Przeczytaj też aktualny
`prisma/schema.prisma`, `src/lib/auth-guards.ts`, `src/proxy.ts` i istniejący komponent
`rental-readonly-view` zanim zaczniesz modyfikować — poniższa specyfikacja opisuje *co* ma powstać,
nie zakłada dokładnej dzisiejszej struktury pliku po pliku.

**Styl kodu**: repo jest mocno okomentowane (każda nieoczywista decyzja ma komentarz — LVE, basePath,
sync itp.). Trzymaj się tego stylu, szczególnie przy logice cenowej poniżej — jest nieoczywista i
przyszły czytelnik (człowiek lub Claude) musi zrozumieć *dlaczego*, nie tylko *co*.

**Jeśli coś w tej specyfikacji jest niejednoznaczne albo koliduje z tym, co faktycznie znajdziesz w
repo — zatrzymaj się i zapytaj, nie zgaduj.** W szczególności: nazwy/identyfikatory istniejących
urządzeń w tabeli `Device`, dokładny kształt istniejącego `Setting` (typ pola `value`), oraz to, jak
dziś (jeśli w ogóle) obsługiwane są szkolenia w tym panelu.

---

## 1. Model danych — zmiany w Prisma

### 1.1 Nowe enumy

```
enum DevicePricingCategory {
  LIGHTSHEER_VARIANT     // DESIRE, LIGHT, QUATTRO — współdzielą tabelę cen wariantów głowicy
  LIGHTSHEER_ET400_FLAT  // ET400 — cena stała, bez wariantów, bez impulsów
  ALMA_HARMONY           // Alma Harmony XL Pro — wariant głowicy + zawsze dopłata za impulsy
  COOLTECH_FLAT
  RESURFX_FLAT
  OBSERV_FLAT
}

enum RentalEventType {
  WYNAJEM
  SZKOLENIE
}

enum PriceSource {
  PRICE_LIST        // pobrana automatycznie z tabeli PriceRule
  MANUAL            // wpisana ręcznie (nadpisanie albo brak reguły w cenniku)
  PULSE_CALCULATED  // wyliczona z licznika impulsów (tylko LightSheer wariant elastyczny)
}

enum PaymentMethod {
  CASH
  TRANSFER
}

enum PulseCalculationStatus {
  PENDING       // liczniki jeszcze nie odczytane — pokazujemy wartość tymczasową
  CALCULATED    // liczniki wpisane, kwota faktycznie wyliczona
}
```

### 1.2 Rozszerzenie `Device`

```
model Device {
  // ...istniejące pola bez zmian...
  pricingCategory  DevicePricingCategory?
  variantOptions   Json?   // np. ["single_standard","single_flex","double"] dla LightSheer,
                            // ["dye_vl","dye_vl_ipixel"] dla Alma, null dla kategorii FLAT
}
```

Uzasadnienie `variantOptions` jako pola konfigurowalnego (nie sztywnego enuma per urządzenie):
LightSheer LIGHT fizycznie nigdy nie ma podwójnej głowicy, DESIRE i QUATTRO — mogą mieć obie. Zamiast
zaszywać to w kodzie na podstawie nazwy urządzenia (kruche przy zmianie floty), ADMIN ustawia to raz
przy konfiguracji urządzenia na `/urzadzenia`.

Po migracji: pole `pricingCategory`/`variantOptions` będzie `null` dla wszystkich istniejących urządzeń
— **wymaga ręcznego uzupełnienia przez ADMINA po wdrożeniu** dla każdego z ~8 urządzeń we flocie
(patrz sekcja 4.1). Nie zgaduj tego automatycznie na podstawie nazwy w migracji.

### 1.3 Rozszerzenie `Rental`

```
model Rental {
  // ...istniejące pola bez zmian...
  eventType    RentalEventType @default(WYNAJEM)
  driverNotes  String?  @db.Text   // uwagi wpisywane przez rolę KIEROWCA, osobne od internalNotes
}
```

`transportPrice` / cache kontaktu HubSpot zostają bez zmian i **nie dotyczą** wydarzeń typu SZKOLENIE
(patrz 3.6).

### 1.4 Nowy model `RentalFinance` (relacja 1:1 z `Rental`)

```
model RentalFinance {
  id       String @id @default(cuid())
  rentalId String @unique
  rental   Rental @relation(fields: [rentalId], references: [id], onDelete: Cascade)

  // --- cena bazowa (wynajem LUB szkolenie) ---
  baseRentalPriceNet        Decimal
  baseRentalPriceSource     PriceSource
  baseRentalPriceOverrideNote String? @db.Text   // powód nadpisania / ręcznego wpisania

  // --- wariant wybrany przy wynajmie (odzwierciedla Device.variantOptions) ---
  deviceVariant String?   // np. "single_flex", "double", "dye_vl_ipixel" — null dla FLAT i SZKOLENIA

  // --- liczniki impulsów (LightSheer wariant "single_flex" ORAZ Alma Harmony zawsze) ---
  pulseCounterStart      Int?
  pulseCounterEnd        Int?
  pulseCalculationStatus PulseCalculationStatus?

  // --- dopłata za impulsy Alma Harmony (DODATKOWA do baseRentalPriceNet, nie zastępuje jej) ---
  pulseSurchargeNet Decimal?   // tylko ALMA_HARMONY; dla LightSheer flex impulsy określają
                                // baseRentalPriceNet bezpośrednio (patrz 3.2) — to pole zostaje null

  // --- nakładki HS (tylko LightSheer wariant "double") — materiał zużywalny, nie flaga tak/nie:
  // przy dłuższym wynajmie (2-3 dni, kilka klientek/zabiegów) może zejść więcej niż jedna sztuka.
  capCountUsed Int?       // null/0 gdy checkbox odznaczony (nakładka niezużyta); checkbox to główny
                          // przełącznik — po zaznaczeniu wartość skacze od razu na 1, stepper obok
                          // checkboxa pozwala doprecyzować, jeśli zużyto więcej (patrz 3.4)
  capFeeNet    Decimal?   // cena jednostkowa (snapshot z PricingSetting) — mnożona przez capCountUsed,
                          // patrz 3.4; odświeżana przy każdym zapisie, gdy capCountUsed > 0

  // --- VAT ---
  vatApplicable Boolean @default(false)
  vatRate       Decimal @default(23)   // zapisane per-wydarzenie na wypadek przyszłej zmiany stawki

  // --- suma — przeliczana i zapisywana po każdej zmianie pól powyżej, NIE ufaj wartości z klienta ---
  totalNet   Decimal
  totalGross Decimal

  // --- płatność ---
  paymentMethod  PaymentMethod
  cashCollected  Boolean?   // potwierdzenie odbioru gotówki przez kierowcę

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

### 1.5 Cennik jako dane w bazie (nie w kodzie)

```
model PriceRule {
  id              String @id @default(cuid())
  pricingCategory DevicePricingCategory
  variant         String?    // null dla ET400_FLAT / COOLTECH_FLAT / RESURFX_FLAT / OBSERV_FLAT
  durationDays    Int
  priceNet        Decimal

  @@unique([pricingCategory, variant, durationDays])
}

model PulseTier {
  id                    String  @id @default(cuid())
  pricingCategory        DevicePricingCategory   // dziś realnie tylko LIGHTSHEER_VARIANT
  durationDays           Int
  order                  Int       // kolejność progu w ramach danego durationDays, rosnąco
  maxPulses              Int?      // null = ostatni / otwarty próg
  priceNet               Decimal
  isOverflowTier         Boolean @default(false)
  overflowStepPulses     Int?      // np. 1500 — tylko gdy isOverflowTier
  overflowStepPriceNet   Decimal?  // np. 100 — tylko gdy isOverflowTier

  @@unique([pricingCategory, durationDays, order])
}

model PricingSetting {
  id    String  @id @default(cuid())
  key   String  @unique   // "cap_fee_hs_net" | "vat_rate_default" | "alma_pulse_rate_net"
  value Decimal
}
```

Sprawdź najpierw, czy istniejący model `Setting` (key-value, dziś używany m.in. dla
`sms_reminders_enabled`) obsługuje wartości liczbowe z odpowiednią precyzją — jeśli tak, rozważ jego
reużycie zamiast nowego `PricingSetting`. Jeśli `Setting.value` to zwykły `String`, zostań przy nowym
dedykowanym modelu (precyzja Decimal ma znaczenie przy kwotach).

### 1.6 Migracja

Zgodnie z konwencją repo: **nie** `prisma migrate deploy` / `prisma migrate dev` (silnik Rust wisza na
CloudLinux LVE). Wygeneruj migrację przez:

```
prisma migrate diff --from-migrations ./prisma/migrations --to-schema-datamodel ./prisma/schema.prisma \
  --script > prisma/migrations/<timestamp>_rental_finance/migration.sql
```

bez lokalnej bazy, zgodnie z opisem w README. Migracja aplikuje się na serwerze przez
`deploy/migrate.mjs` przy deployu (push na `main` → serwer 1 automatycznie, serwer 2 ręcznie przez
GitHub Actions).

---

## 2. Dane startowe (seed) — dokładnie z cennika 2025/26

### `PriceRule`

| pricingCategory | variant | durationDays | priceNet |
|---|---|---|---|
| LIGHTSHEER_VARIANT | single_standard | 1 | 850 |
| LIGHTSHEER_VARIANT | single_standard | 2 | 1500 |
| LIGHTSHEER_VARIANT | single_standard | 3 | 2000 |
| LIGHTSHEER_VARIANT | double | 1 | 1100 |
| LIGHTSHEER_VARIANT | double | 2 | 1900 |
| LIGHTSHEER_VARIANT | double | 3 | 2500 |
| LIGHTSHEER_ET400_FLAT | null | 1 | 650 |
| LIGHTSHEER_ET400_FLAT | null | 2 | 1100 |
| LIGHTSHEER_ET400_FLAT | null | 3 | 1450 |
| ALMA_HARMONY | dye_vl | 1 | 1200 |
| ALMA_HARMONY | dye_vl | 2 | 2000 |
| ALMA_HARMONY | dye_vl | 3 | 2500 |
| ALMA_HARMONY | dye_vl_ipixel | 1 | 1900 |
| ALMA_HARMONY | dye_vl_ipixel | 2 | 3100 |
| ALMA_HARMONY | dye_vl_ipixel | 3 | 3900 |
| COOLTECH_FLAT | null | 1 | 950 |
| COOLTECH_FLAT | null | 2 | 1500 |
| COOLTECH_FLAT | null | 3 | 2000 |
| RESURFX_FLAT | null | 1 | 900 |
| RESURFX_FLAT | null | 2 | 1600 |
| RESURFX_FLAT | null | 3 | 2100 |
| OBSERV_FLAT | null | 1 | 800 |
| OBSERV_FLAT | null | 7 | 1200 |
| OBSERV_FLAT | null | 14 | 2000 |

Uwaga: `durationDays` = faktyczna liczba dni wynajmu (Observ „1 tydzień"/„2 tygodnie" to po prostu
7 i 14 dni — nie potrzeba osobnej jednostki, bo `Rental` już liczy czas trwania w dniach).

### `PulseTier` (tylko `LIGHTSHEER_VARIANT`, dotyczy wariantu `single_flex`)

**durationDays = 1** (bez reguły nadwyżki — powyżej 12 000 impulsów cena zostaje 950 zł, kropka):

| order | maxPulses | priceNet | isOverflowTier |
|---|---|---|---|
| 1 | 10000 | 750 | false |
| 2 | 12000 | 850 | false |
| 3 | null | 950 | false |

**durationDays = 2**:

| order | maxPulses | priceNet | isOverflowTier | overflowStepPulses | overflowStepPriceNet |
|---|---|---|---|---|---|
| 1 | 20000 | 1300 | false | – | – |
| 2 | 21500 | 1400 | false | – | – |
| 3 | 23000 | 1500 | false | – | – |
| 4 | 24500 | 1600 | false | – | – |
| 5 | 26000 | 1700 | false | – | – |
| 6 | null | 1700 | **true** | 1500 | 100 |

**durationDays = 3**:

| order | maxPulses | priceNet | isOverflowTier | overflowStepPulses | overflowStepPriceNet |
|---|---|---|---|---|---|
| 1 | 20000 | 1600 | false | – | – |
| 2 | 21500 | 1700 | false | – | – |
| 3 | 23000 | 1800 | false | – | – |
| 4 | 24500 | 1900 | false | – | – |
| 5 | 26000 | 2000 | false | – | – |
| 6 | null | 2000 | **true** | 1500 | 100 |

### `PricingSetting`

| key | value |
|---|---|
| cap_fee_hs_net | 70 |
| vat_rate_default | 23 |
| alma_pulse_rate_net | 0.06 |

---

## 3. Logika biznesowa

Napisz to jako czyste, dobrze przetestowane funkcje w `src/lib/pricing/` (nowy katalog), wywoływane
zarówno przy tworzeniu/edycji wynajmu przez biuro, jak i przy przeliczeniu po wpisaniu liczników przez
kierowcę. **Suma (`totalNet`/`totalGross`) zawsze przeliczana server-side** — nigdy nie ufaj wartości
przysłanej z klienta.

### 3.1 Cena bazowa — ogólny przepływ (WYNAJEM)

1. Policz `durationDays` z `startsAt`/`endsAt` (istniejąca logika — wszystkie wynajmy są całodniowe).
2. Jeśli `device.pricingCategory` to `LIGHTSHEER_VARIANT` i wybrany `deviceVariant === "single_flex"`
   → cena bazowa **nie** pochodzi z `PriceRule`, tylko z logiki progów impulsów (patrz 3.2).
3. W pozostałych przypadkach: szukaj `PriceRule` po (`pricingCategory`, `variant`, `durationDays`).
   - Znaleziono → `baseRentalPriceNet` = wartość z tabeli, `baseRentalPriceSource = PRICE_LIST`.
   - Nie znaleziono (np. 4-dniowy wynajem lasera, nietypowy okres Observ) → pole zostaje puste,
     biuro **musi** wpisać ręcznie, `baseRentalPriceSource = MANUAL`.
4. Biuro może zawsze nadpisać wartość z cennika ręcznie — wtedy `baseRentalPriceSource = MANUAL`
   i UI pokazuje pole `baseRentalPriceOverrideNote` (opcjonalne, ale zachęcane — audyt „czemu cena
   odbiegała od cennika").

### 3.2 Taryfa elastyczna LightSheer (`deviceVariant === "single_flex"`)

To jest **jedyny** przypadek, gdzie impulsy zastępują (nie dodają się do) cenę bazową.

- **Przy tworzeniu wynajmu**, zanim sprzęt wróci: `baseRentalPriceNet = 750`,
  `baseRentalPriceSource = MANUAL` (placeholder), `pulseCalculationStatus = PENDING`. UI pokazuje pod
  polem dopisek: *„Kwota tymczasowa — zostanie wyliczona po odczycie liczników impulsów"*. To wartość
  literalnie 750 niezależnie od liczby dni wynajmu — to świadomy placeholder, nie próba zgadnięcia
  ceny z tabeli 2-3-dniowej.
- **Po wpisaniu `pulseCounterStart`/`pulseCounterEnd`** (przez kierowcę lub biuro): policz
  `pulsesUsed = pulseCounterEnd - pulseCounterStart` (waliduj: end ≥ start, oba nieujemne).
  Znajdź w `PulseTier` (dla `LIGHTSHEER_VARIANT`, danego `durationDays`) pierwszy próg, gdzie
  `pulsesUsed <= maxPulses` (progi posortowane po `order` rosnąco).
  - Jeśli trafiono zwykły próg (`isOverflowTier = false`) → `baseRentalPriceNet = tier.priceNet`.
  - Jeśli żaden zwykły próg nie pasuje → trafia na `isOverflowTier = true` próg:
    `baseRentalPriceNet = tier.priceNet + ceil((pulsesUsed - tier.maxPulsesPoprzedniegoProgu) / overflowStepPulses) * overflowStepPriceNet`.
    Uwaga: to dotyczy **tylko** `durationDays` 2 i 3 — dla `durationDays = 1` ostatni próg (950 zł,
    >12 000 impulsów) jest zamknięty, bez nadwyżki, zgodnie z tabelą w sekcji 2.
  - Ustaw `baseRentalPriceSource = PULSE_CALCULATED`, `pulseCalculationStatus = CALCULATED`.

### 3.3 Dopłata za impulsy Alma Harmony

Dotyczy **zawsze**, niezależnie od wybranej głowicy (`dye_vl` lub `dye_vl_ipixel`) — impulsy Dye-VL są
liczone w obu wariantach.

- `baseRentalPriceNet` pochodzi normalnie z `PriceRule` (3.1) — **to jest cena bazowa, nie zmienia się
  przez impulsy**.
- Po wpisaniu liczników: `pulseSurchargeNet = pulsesUsed * alma_pulse_rate_net` (z `PricingSetting`,
  domyślnie 0,06 zł/impuls). To pole **dodaje się** do sumy (patrz 3.5), nie zastępuje bazowej ceny.
- Analogicznie do 3.2: przed odczytem liczników `pulseCalculationStatus = PENDING` i UI informuje, że
  ostateczna kwota dopłaty zostanie wyliczona po zwrocie sprzętu.

### 3.4 Nakładki HS (LightSheer, wariant `double`) — ilość, nie flaga

Widoczne tylko gdy `device.pricingCategory === LIGHTSHEER_VARIANT` i wybrany `deviceVariant ===
"double"` (w praktyce dotyczy DESIRE/QUATTRO z podwójną głowicą — LIGHT nigdy nie ma tego wariantu w
swoich `variantOptions`, więc pole się nie pojawi).

**To jest materiał zużywalny — checkbox jako główny przełącznik, licznik jako doprecyzowanie.** Typowy
przypadek to 0 albo 1 sztuka; przy dłuższym wynajmie (2–3 dni, kilka klientek/zabiegów) czasem więcej.
UI: checkbox „Nakładka HS zużyta" + stepper (`−`/liczba/`+`) widoczny **tylko gdy checkbox zaznaczony**
— patrz 4.4.

- `capCountUsed` — liczba całkowita, `null`/`0` gdy checkbox odznaczony (nakładka niezużyta).
- **Zaznaczenie checkboxa** → `capCountUsed` ustawia się na `1` (domyślna, najczęstsza wartość),
  stepper się odsłania. Kierowca może zwiększyć przez `+`, jeśli zużyto więcej niż jedną sztukę.
  Stepper ma dolną granicę `1` **w stanie zaznaczonym** — `-` jest nieaktywne przy wartości `1` (żeby
  zejść do zera, odznacza się checkbox, nie zjeżdża się stepperem w dół — dwa różne mechanizmy nie
  powinny robić tego samego).
- **Odznaczenie checkboxa** → `capCountUsed` wraca do `0`/`null`, stepper znika. Nie zachowuj ukrytej
  wartości „na zapas" — jeśli ktoś odznaczy przez pomyłkę i zaznaczy ponownie, zaczyna od `1`, nie od
  poprzedniej liczby (prostsze i bardziej przewidywalne niż ukryty stan).
- `capFeeNet` — cena jednostkowa, snapshot wartości `cap_fee_hs_net` z `PricingSetting`, odświeżany
  przy każdym zapisie `RentalFinance`, dopóki `capCountUsed > 0` (nie licz na żywo z ustawień przy
  każdym odczycie — cena mogła się zmienić między wynajmami, snapshot chroni historyczne dane
  finansowe przed retroaktywną zmianą; przy `capCountUsed = 0` pole może zostać `null`).
- Koszt całkowity nakładek = `capCountUsed * capFeeNet` (patrz wzór sumy w 3.5).
- Rozsądny miękki sygnał w UI (nie blokujący zapisu): jeśli `capCountUsed >= 4`, pokaż subtelne
  ostrzeżenie „Nietypowo duża liczba — sprawdź przed zapisaniem" — to niemal na pewno pomyłka we
  wprowadzaniu danych, nie realny scenariusz, ale nie blokuj zapisu, bo być może jednak tak było.

### 3.5 VAT i suma końcowa

```
totalNet =
    baseRentalPriceNet
  + (pulseSurchargeNet ?? 0)                       // tylko Alma
  + (rental.transportPrice ?? 0)                   // pomijane dla eventType = SZKOLENIE, patrz 3.6
  + ((capCountUsed ?? 0) * (capFeeNet ?? 0))        // nakładki HS — ilość razy cena jednostkowa

totalGross = vatApplicable
  ? round2(totalNet * (1 + vatRate / 100))
  : totalNet
```

Przelicz i zapisz `totalNet`/`totalGross` przy **każdym** zapisie `RentalFinance` (create/update) —
niezależnie od tego, które pole się zmieniło. To pole ma być zawsze aktualne dla widoku kierowcy i pod
przyszłe raportowanie SQL (Obszar #4 projektu), więc lepiej trzymać je zdenormalizowane niż liczyć
w locie przy każdym odczycie.

### 3.6 Szkolenie (`eventType = SZKOLENIE`) — uproszczona ścieżka

Świadomie okrojony zakres w tej iteracji — **nie** projektuj pełnego flow szkoleń (przypisanie
specjalisty, powiązanie z urządzeniem itp.), jeśli nie jest to już gdzieś w repo. Dla samego modułu
finansowego:

- Brak logiki cennika/wariantów/impulsów/nakładki — wszystkie te pola zostają `null`.
- `baseRentalPriceNet` — zawsze wpisywana ręcznie przez biuro (**„ustalona cena szkolenia"**),
  `baseRentalPriceSource = MANUAL`.
- `rental.transportPrice` **pomijany** w kalkulacji `totalNet` dla szkoleń — ustalona cena szkolenia
  jest kwotą całościową, transport nie jest osobną pozycją (potwierdzone przez klienta — inaczej niż
  przy wynajmie).
- VAT, sposób płatności, `cashCollected` — działają identycznie jak przy wynajmie.

Jeśli w trakcie implementacji okaże się, że szkolenia dziś w ogóle nie mają reprezentacji w
`Rental`/kalendarzu (np. są prowadzone poza tym panelem) — zatrzymaj się i zapytaj, zanim dodasz
`eventType` jako pole wyboru w formularzu; nie zgaduj.

---

## 4. UI — zmiany w istniejących i nowych widokach

### 4.1 `/urzadzenia` (rozszerzenie istniejącego, tylko ADMIN)

Formularz edycji urządzenia dostaje dwa nowe pola:
- Select `pricingCategory` (jedna z 6 wartości enuma).
- Multi-select `variantOptions`, którego dostępne opcje zależą od wybranej kategorii:
  - `LIGHTSHEER_VARIANT` → checkboxy: „pojedyncza głowica — standard", „pojedyncza głowica —
    elastyczna (impulsy)", „podwójna głowica". Dla LIGHT odznacz ręcznie opcję „podwójna głowica" przy
    konfiguracji (system tego nie wymusza — to świadoma decyzja ADMINA per urządzenie).
  - `ALMA_HARMONY` → checkboxy: „Dye-VL", „Dye-VL + Er:YAG iPixel".
  - pozostałe kategorie (`*_FLAT`) → pole `variantOptions` ukryte/nieaktywne, zawsze `null`.

Po wdrożeniu migracji ADMIN musi ręcznie skonfigurować to dla wszystkich ~8 urządzeń we flocie —
dodaj krótką notatkę/banner na `/urzadzenia`, jeśli jakieś urządzenie ma `pricingCategory = null`
(„Brak konfiguracji cennika — wynajem tego urządzenia będzie wymagał ręcznego wpisania ceny").

Dodatkowo: przy edycji urządzenia pokaż **klikalny link do faktycznego kalendarza w Google Calendar**
(budowany z istniejącego `googleCalendarId`), obok nowych pól `pricingCategory`/`variantOptions`.
`googleCalendarId` to zwykle nieczytelny identyfikator — ADMIN konfigurując cennik patrzy głównie na
nazwę/kolor urządzenia w panelu, więc link pozwala jednym kliknięciem zweryfikować „czy na pewno
konfiguruję właściwy fizyczny sprzęt", zanim zatwierdzi ceny.

### 4.2 NOWA: `/ustawienia/cennik` (tylko ADMIN)

Trzy sekcje edytowalne w miejscu (bez osobnych formularzy modalnych, jeśli to pasuje do istniejącego
stylu innych stron `/ustawienia/*`):

1. **Tabela cen podstawowych** (`PriceRule`) — pogrupowana wg `pricingCategory`, wiersze
   `variant × durationDays → priceNet`, edytowalne inline, przycisk dodania nowego wiersza (na wypadek
   nowego okresu wynajmu, np. 4 dni).
2. **Progi impulsów LightSheer** (`PulseTier`) — osobna tabela per `durationDays` (1/2/3), z
   możliwością edycji `maxPulses`/`priceNet`, oraz edycji `overflowStepPulses`/`overflowStepPriceNet`
   dla ostatniego progu przy 2 i 3 dniach.
3. **Pojedyncze wartości** (`PricingSetting`) — proste pola liczbowe: cena nakładki HS, domyślna
   stawka VAT, stawka za impuls Almy.

To jest strona, która pozwala zespołowi samodzielnie zaktualizować cennik przy corocznej zmianie, bez
angażowania Claude Code / redeployu.

### 4.3 `/kalendarz/wynajem/nowy` i `/kalendarz/wynajem/[id]` (rozszerzenie istniejącego formularza)

Nowa sekcja „Finanse", widoczna dla ADMIN/STAFF (nie dla KIEROWCA — ten ma osobny, ograniczony widok,
patrz 4.4). Priorytet inny niż w widoku kierowcy: nie szybki odczyt, tylko szybkie, przewidywalne
wprowadzanie danych z jasnym sygnałem, skąd wzięła się cena.

**Układ (desktop, sekcja w istniejącym formularzu):**

```
┌───────────────────────────────────────────────┐
│ Finanse                                         │
├───────────────────────────────────────────────┤
│ Typ wydarzenia    ( • Wynajem   ○ Szkolenie )   │
│                                                   │
│ Urządzenie         LightSheer DESIRE      ▾      │
│ Wariant             Podwójna głowica       ▾      │
│                                                   │
│ Cena wynajmu (netto)                             │
│  1500 zł     🏷 z cennika                        │
│  [ Zmień ręcznie ]                               │
│                                                   │
│ ☐ VAT (23%)                                      │
│ Sposób płatności   ( • Gotówka   ○ Przelew )    │
│                                                   │
├───────────────────────────────────────────────┤
│ Razem netto:    1 720 zł                         │
│ Razem brutto:   1 720 zł  (VAT wyłączony)        │
└───────────────────────────────────────────────┘
```

Zasady:
- **Etykieta przy cenie zawsze mówi, skąd pochodzi wartość**: `🏷 z cennika` / `✎ ręcznie` /
  `⏳ z impulsów (tymczasowo)` — jednym rzutem oka widać status, bez klikania w cokolwiek. To
  bezpośrednio odzwierciedla pole `baseRentalPriceSource`.
- **Pole notatki przy nadpisaniu pojawia się dopiero po kliknięciu „Zmień ręcznie"** — nie zaśmieca
  widoku, gdy cena jest standardowa.
- **Podsumowanie (Razem netto/brutto) jest sticky** — zawsze widoczne, przelicza się na żywo przy
  każdej zmianie, żeby biuro widziało efekt swojej edycji bez przewijania.

**Sekwencja wypełniania (interakcja, nie tylko statyczny layout):**

1. **Typ wydarzenia** na samej górze (Wynajem/Szkolenie) — reszta formularza reaguje natychmiast, bez
   zapisywania całości.
   - „Szkolenie" chowa całą resztę (urządzenie/wariant/impulsy/nakładka/transport) — zostaje tylko
     cena + VAT + płatność.
2. **Wybór urządzenia** (pole już istnieje w formularzu) → dopiero teraz, jeśli urządzenie ma
   skonfigurowane `variantOptions`, pojawia się select wariantu. Pusty dropdown wariantu, zanim
   urządzenie jest wybrane, tylko myli — nie pokazuj go wcześniej.
   - Jeśli urządzenie **nie ma jeszcze skonfigurowanego cennika** (`pricingCategory`/`variantOptions`
     puste) → od razu komunikat inline *„To urządzenie nie ma skonfigurowanego cennika — wpisz cenę
     ręcznie"* + pole ceny w trybie ręcznym. Nie udawaj, że system spróbuje coś zgadnąć.
3. **Cena auto-uzupełnia się** dopiero, gdy znany jest wariant i czas trwania (daty są już wcześniej w
   formularzu — logika z sekcji 3). Dla wariantu `single_flex` (LightSheer, taryfa elastyczna) —
   pokazuje się `750 zł` z etykietą `⏳ tymczasowo` i **bez** możliwości kliknięcia „Zmień ręcznie" na
   tym etapie — to i tak placeholder do przeliczenia po zwrocie sprzętu, edycja ręczna wprowadzałaby w
   błąd.
4. „Zmień ręcznie" (dostępne dla wszystkich wariantów poza `single_flex`) → dopiero po kliknięciu
   pojawia się edytowalne pole ceny + opcjonalne (ale zachęcane w UI) pole notatki
   (`baseRentalPriceOverrideNote`).
5. VAT / sposób płatności — zwykłe, zawsze widoczne pola.
6. Podsumowanie na dole (sticky) — przelicza się przy każdej zmianie pól powyżej.
7. **Zapis**: jeśli wybrany wariant wymaga liczników impulsów (`single_flex` lub `ALMA_HARMONY`),
   pokaż przy zapisie nieblokujący komunikat *„Liczniki impulsów uzupełni kierowca po zwrocie
   sprzętu"* — żeby biuro nie szukało tego pola bez sensu na etapie tworzenia rezerwacji.

### 4.4 Widok kierowcy (`rental-readonly-view` lub odpowiednik)

Dziś w 100% read-only — zmienia się na **częściowo edytowalny**, ograniczony do konkretnych pól (patrz
sekcja 5). To najważniejszy ekran w całej tej funkcjonalności — kierowca patrzy na niego w terenie i
musi w 2 sekundy wiedzieć „ile biorę i jak". Poniższy układ i sekwencja wypełniania to nie tylko
sugestia — traktuj to jako wymaganie projektowe, nie tylko listę pól do umieszczenia gdziekolwiek.

**Układ (mobile, od góry do dołu wg priorytetu):**

```
┌─────────────────────────────────┐
│ ← Wynajem · LightSheer DESIRE    │
│   28 sie – 30 sie · 3 dni ·      │
│   podwójna głowica               │
├─────────────────────────────────┤
│                                   │
│   💵  GOTÓWKA                    │
│                                   │
│      1 790 zł                    │
│      do odebrania                │
│                                   │
│   [ ] Gotówka odebrana           │
│                                   │
├─────────────────────────────────┤
│ Klientka                         │
│ Anna Kowalska  ·  📞 501 234 567 │
│ ul. Kwiatowa 12, Kraków           │
│ dostawa 9:00 · odbiór 17:00       │
├─────────────────────────────────┤
│ ▸ Rozbicie kwoty (zwinięte)      │
│    Wynajem            1 500 zł   │
│    Transport             150 zł  │
│    Nakładki HS (2×70zł)  140 zł  │
├─────────────────────────────────┤
│ Nakładka HS                      │
│ [x] Zużyta       [ − ] 2 [ + ]   │
├─────────────────────────────────┤
│ Uwagi kierowcy                   │
│ ┌───────────────────────────┐   │
│ │                           │   │
│ └───────────────────────────┘   │
├─────────────────────────────────┤
│         [ Zapisz ]               │
└─────────────────────────────────┘
```

**Nagłówek musi zawsze pokazywać cztery rzeczy razem**: nazwę urządzenia, zakres dat, liczbę dni i —
jeśli urządzenie ma warianty — czytelną etykietę wybranego wariantu (nie sam klucz typu `double`).
To pierwsza rzecz, jaką czyta kierowca po otwarciu wydarzenia — nazwa urządzenia bez wariantu jest
niewystarczająca (np. „LightSheer DESIRE" nic nie mówi, czy nakładka HS w ogóle wchodzi w grę, dopóki
nie wiadomo, że to wariant z podwójną głowicą).

**Mapowanie kluczy wariantów na etykiety do wyświetlenia** (to samo mapowanie reużyj w widoku biura,
sekcja 4.3, i wszędzie indziej, gdzie `deviceVariant` trafia przed oczy użytkownika — nie duplikuj
tekstów w kilku miejscach kodu):

| klucz (`deviceVariant`) | etykieta PL |
|---|---|
| `single_standard` | pojedyncza głowica |
| `single_flex` | pojedyncza głowica — elastyczna (impulsy) |
| `double` | podwójna głowica |
| `dye_vl` | Dye-VL |
| `dye_vl_ipixel` | Dye-VL + Er:YAG iPixel |
| `null` (urządzenia bez wariantów: ET400, Cooltech, ResurFX, Observ) | — (pomiń ten fragment nagłówka/formularza, nie pokazuj pustego pola ani myślnika) |

Zasady:
- **Banner płatności jest pierwszą rzeczą, jaką widać.** Kolor koduje informację jeszcze zanim
  kierowca przeczyta tekst — np. wyrazisty kolor (czerwień/pomarańcz) dla `CASH` z dużą kwotą, stonowany
  kolor (zieleń/szarość) dla `TRANSFER` z komunikatem „nie pobieraj gotówki", sekcja finansowa poniżej
  może być wtedy mniej eksponowana/zwinięta.
- **Rozbicie kwoty jest domyślnie zwinięte** (`▸`, rozwijane jednym tapnięciem) — kierowcę interesuje
  suma, nie księgowość.
- **Pola specyficzne dla urządzenia (nakładka HS, liczniki impulsów) pokazują się wyłącznie, gdy
  dotyczą danego urządzenia/wariantu.** Przy ET400, Cooltechu, ResurFX ta sekcja w ogóle nie istnieje
  w DOM-ie — formularz się nie rozrasta bez potrzeby.
- Reszta wydarzenia (urządzenie, adres, terminy, dane kontaktowe, notatki biura) — zostaje read-only
  jak dziś.

**Sekwencja wypełniania (interakcja, nie tylko statyczny layout):**

1. Kierowca otwiera wydarzenie ze swojej listy przypisanych wynajmów.
2. Banner płatności + kwota widoczne od razu. Jeśli wariant wymaga liczników impulsów (LightSheer
   `single_flex` lub Alma) — kwota ma dopisek „tymczasowa, uzupełnij liczniki poniżej"
   (`pulseCalculationStatus = PENDING`).
3. Zaznaczenie „Nakładka HS zużyta" → `capCountUsed` ustawia się na `1`, obok checkboxa (ten sam
   wiersz, nie osobna sekcja poniżej) odsłania się stepper (`−`/`+`) do doprecyzowania, jeśli zużyto
   więcej niż jedną sztukę. **Suma na górze
   przelicza się natychmiast** przy każdej zmianie (client-side, dla odczucia responsywności),
   niezależnie od pełnego zapisu formularza. Odznaczenie checkboxa chowa stepper i zeruje wartość —
   bez ukrytego stanu „na zapas". Przy `capCountUsed >= 4` pokaż subtelne, nieblokujące ostrzeżenie
   (patrz 3.4) — to prawie na pewno pomyłka, ale nie blokuj zapisu.
4. Wpisanie liczników start/koniec → walidacja na żywo: `end < start` → pole końcowe podświetla się na
   czerwono z komunikatem „Licznik końcowy nie może być mniejszy niż początkowy", zapis zablokowany do
   poprawy.
5. Po poprawnych licznikach: etykieta zmienia się z „tymczasowa" na „wyliczona"
   (`pulseCalculationStatus = CALCULATED`), suma na górze aktualizuje się o wynik z logiki 3.2/3.3.
6. „Gotówka odebrana" — pole **niezależne** od reszty, kierowca może je zaznaczyć w dowolnym momencie
   (np. przy standardowej taryfie zna kwotę od razu i nie musi czekać na liczniki).
7. Uwagi kierowcy — opcjonalne pole tekstowe.
8. **Jeden przycisk „Zapisz" na dole, wysyła wszystkie zmienione pola w jednym requeście** — celowo
   bez autozapisu przy każdym polu (`onBlur`/`onChange`). W terenie zdarza się słabszy zasięg; jeden
   jasny moment zapisu jest bezpieczniejszy niż rozjechane, częściowo zapisane stany pośrednie.

---

## 5. Uprawnienia i bezpieczeństwo

To jest **zmiana modelu bezpieczeństwa**, nie tylko UI — potwierdzona świadomie przez właściciela
produktu, ale wdroż ją precyzyjnie, bo dziś rola KIEROWCA jest w 100% zablokowana na poziomie API
(`src/proxy.ts` + `requireStaffSession()`), a to się zmienia punktowo.

- KIEROWCA dostaje prawo edycji **wyłącznie** następujących pól, **wyłącznie** na wydarzeniach, gdzie
  `rental.driverId === session.user.id`:
  - `RentalFinance.capCountUsed`
  - `RentalFinance.pulseCounterStart`, `pulseCounterEnd`
  - `RentalFinance.cashCollected`
  - `Rental.driverNotes`
- Nic więcej — żadnych innych pól `Rental`/`RentalFinance`, żadnego tworzenia/usuwania, żadnych innych
  wydarzeń (nawet w trybie odczytu poza tym, co już dziś widzi).
- Egzekwuj to **server-side** w API route (nowy guard, np. `requireDriverFieldEditSession()` w
  `src/lib/auth-guards.ts`, analogicznie do istniejących `requireAdminSession()`/
  `requireStaffSession()`) — waliduj zarówno rolę, jak i przypisanie (`driverId`), jak i **whitelistę
  pól** w body requestu (odrzuć request, jeśli próbuje zmienić cokolwiek spoza whitelisty, nie tylko
  zignoruj po cichu — łatwiej debugować, trudniej o niezauważony błąd uprawnień).
- Zaktualizuj `src/proxy.ts`, jeśli dotychczasowy matcher/wyjątek dla ról blokuje KIEROWCĘ na poziomie
  routingu stron (dziś nawigacja tej roli to tylko „Kalendarz" — endpoint API do zapisu tych pól
  prawdopodobnie potrzebuje nowego wyjątku, bo `matcher` dziś wyklucza `api`, ale logika autoryzacji i
  tak musi wiedzieć o tym nowym, węższym uprawnieniu).

---

## 6. Świadomie otwarte / uproszczone w tej iteracji

Nie projektuj tego teraz, zapytaj przed rozszerzeniem zakresu:

- Pełny flow szkoleń (przypisanie specjalisty, ewentualny osobny kalendarz) — dziś tylko pole
  `eventType` + uproszczona ścieżka finansowa z 3.6.
- Wynajmy dłuższe niż 3 dni (poza Observ 1/7/14) lub nietypowe okresy — zawsze `MANUAL`, bez
  automatycznego wyliczania, biuro wpisuje ręcznie.
- Historia zmian cennika (`PriceRule`/`PulseTier`) — edycja nadpisuje wartość, bez wersjonowania. Jeśli
  to ważne dla przyszłej analizy historycznej cen, zgłoś to jako osobny temat, nie dodawaj bez pytania.

---

## 7. Kolejność pracy / checklist przed wysłaniem do review

1. Przeczytaj `AGENTS.md`/`CLAUDE.md`, aktualny `schema.prisma`, `auth-guards.ts`, `proxy.ts`,
   komponent widoku kierowcy.
2. Migracja Prisma (sekcja 1) + seed danych (sekcja 2) — wygenerowana zgodnie z konwencją repo
   (`prisma migrate diff`, bez lokalnej bazy), zastosowana przez `deploy/migrate.mjs`.
3. Logika biznesowa w `src/lib/pricing/` (sekcja 3) — z testami jednostkowymi dla: taryfy elastycznej
   (progi + nadwyżka 2/3-dniowa), dopłaty Alma, sumy netto/brutto z i bez VAT.
4. Rozszerzenie `auth-guards.ts` + `proxy.ts` (sekcja 5) — to najbardziej wrażliwa część, testuj
   ręcznie na koncie testowym KIEROWCY przed review.
5. UI: `/urzadzenia`, nowa `/ustawienia/cennik`, formularz wynajmu, widok kierowcy (sekcja 4).
6. Wdrożenie **najpierw na serwer 1** (test, auto-deploy przy push na `main`), weryfikacja ręczna
   scenariuszy z sekcji 3, dopiero potem ręczne wdrożenie na serwer 2 (produkcja) przez GitHub Actions.
7. Po migracji: przypomnienie dla ADMINA, żeby uzupełnił `pricingCategory`/`variantOptions` na
   `/urzadzenia` dla całej floty — bez tego wszystkie wynajmy wpadną w tryb ręcznego wpisywania ceny.
