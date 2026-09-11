# Prompt dla Claude Code — dashboard kosztów (ADMIN) + Pojazdy + stawki kierowców

## 0. Kontekst i cel

**Hierarchia źródeł prawdy:** towarzyszą temu plikowi **dwa** pliki HTML — to nadrzędne źródło prawdy
dla wyglądu, każdy dla innej strony:
- `mockup-dashboard-kosztow.html` — strona analityczna `/finanse/koszty` (patrz sekcja 4).
- `mockup-zarzadzanie-kosztami.html` — wizualne źródło prawdy dla wyglądu listy wpisów (dziś: sekcja 5,
  strona „Wpisy kosztów") oraz wyglądu zarządzania kategoriami (dziś: sekcja 6, osobna strona
  `/ustawienia/kategorie-kosztow`) — **routing tych dwóch części się rozszedł** (patrz sekcje 5 i 6),
  mockup pokazuje je jeszcze razem na jednej stronie z dwiema zakładkami — to nieaktualne w warstwie
  struktury/routingu, aktualne w warstwie wyglądu pojedynczych elementów.

Ten plik `.md` jest źródłem prawdy dla modelu danych, logiki liczenia i zachowania obu stron. Przy
sprzeczności co do wyglądu wygrywa odpowiedni plik HTML.

To **druga faza** planu monitoringu finansowego (pierwsza to przychody — `/finanse/przychody`, patrz
`prompt-claude-code-dashboard-przychodow.md`, jeśli jeszcze nie wdrożony w pełni, ta funkcja go zakłada
jako wzorzec: ten sam selektor okresu, ten sam układ KPI + zakładki). **Nie buduj tu widoku
marży/rentowności** (przychód − koszt) — to naturalny **trzeci** krok, dopiero gdy oba dashboardy
(przychody i koszty) działają osobno. Nie łącz ich teraz.

**Zasada nadrzędna całej tej fazy: nigdy nie zgadujemy kosztu z góry.** ADMIN wpisuje realne wydatki
(z faktur), a system **wylicza** z nich pochodne, jednostkowe wartości (koszt na dostawę, koszt na
impuls) z danych, które już są zbierane gdzie indziej w aplikacji — nie odwrotnie.

Dostęp: **wyłącznie rola ADMIN** — analogicznie do dashboardu przychodów, dotyczy obu stron.
`requireAdminSession()` + ukryta pozycja nawigacji dla innych ról.

---

## 1. Nowy model danych

### 1.1 `Vehicle` (nowy byt — Pojazd)

```
model Vehicle {
  id             String   @id @default(cuid())
  name           String        // np. "Skoda Fabia"
  plateNumber    String        // np. "KR 1234A"
  fuelCostPerKm  Decimal       // ustawiane ręcznie przez ADMINA, patrz sekcja 5
  fuelCostUpdatedAt DateTime?  // do wyświetlenia przypomnienia "ostatnia aktualizacja: X dni temu"
  active         Boolean  @default(true)
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
}
```

Zarządzanie (dodawanie/edycja pojazdów) — prosty formularz ADMIN-only, analogiczny do istniejącej
strony `/urzadzenia` (ta sama konwencja UI, nie tworzę dla tego osobnego mockupu — trzymaj się stylu,
który już macie dla podobnych list zarządzania flotą). Proponowana lokalizacja: `/ustawienia/pojazdy`
(nowa zakładka w `/ustawienia`, obok istniejących Integracje/Przypomnienia SMS/Szablony SMS/Cennik/
Użytkownicy).

### 1.2 Rozszerzenie `Rental` — powiązanie z pojazdem

```
model Rental {
  // ...istniejące pola + pola z modułu finansowego...
  vehicleId String?
  vehicle   Vehicle? @relation(fields: [vehicleId], references: [id])
}
```

Wybór pojazdu — pole w formularzu wynajmu po stronie biura (`/kalendarz/wynajem/nowy` i `/[id]`), obok
istniejącego wyboru kierowcy (`driverId`). Opcjonalne — nie blokuj zapisu wynajmu, jeśli nie wybrano
(starsze wynajmy sprzed tej funkcji nie będą go mieć).

### 1.3 Rozszerzenie cache kontaktu — odległość

```
model Rental {
  // ...
  contactDistanceKm Decimal?   // nowe pole cache, obok istniejących contactNameCache,
                                 // contactPhoneCache, contactAddressCache, contactTransportPriceCache
}
```

**Wpisywane ręcznie przez biuro, raz przy danym kliencie** — nie z automatycznego API (patrz sekcja 7,
świadoma decyzja o uproszczeniu). Ten sam mechanizm cache co `contactTransportPriceCache` — jeśli macie
dziś w kodzie wspólne miejsce, gdzie biuro wpisuje/edytuje dane cache kontaktu przy wynajmie, dodaj to
pole tam, nie twórz osobnego formularza.

### 1.4 Rozszerzenie `User` — stawka kierowcy

```
model User {
  // ...istniejące pola...
  hourlyRate Decimal?   // stawka za godzinę pracy, tylko dla roli KIEROWCA; null dla innych ról
}
```

Pole w formularzu edycji użytkownika na `/ustawienia/uzytkownicy` (już ADMIN-only) — widoczne tylko
przy edycji konta z rolą KIEROWCA. **To pole i wszystko z niego wyliczone (sekcja 3.2) nie może się
pojawić w żadnym widoku dostępnym dla roli KIEROWCA — nawet dla właściciela tej stawki, nawet jego
własnej.** Traktuj to jako twardą regułę bezpieczeństwa, nie sugestię UI — sprawdź przy review każdy
endpoint, który zwraca dane wydarzenia do roli KIEROWCA, i upewnij się, że nie serializuje tego pola
ani pochodnych z niego wartości.

### 1.5 `CostCategory` (nowy byt — zarządzana lista kategorii)

```
model CostCategory {
  id        String    @id @default(cuid())
  name      String
  scope     CostScope
  active    Boolean   @default(true)   // dezaktywacja zamiast usuwania, patrz sekcja 6
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt

  @@unique([name, scope])
}
```

**Zmiana względem wcześniejszej wersji tej specyfikacji**: kategoria **nie jest już luźnym stringiem**
na `Cost` — to osobna, edytowalna tabela, zarządzana przez ADMINA na stronie `/ustawienia/kategorie-kosztow`
(sekcja 6), nie
tylko sugerowana lista w dropdownie. Zmiana nazwy kategorii aktualizuje się wszędzie od razu (jeden
wiersz w bazie), bez ryzyka literówek tworzących duplikaty ("Serwis/przegląd" vs "Serwis / przegląd"
jako dwie różne wartości). Zasiej tabelę startowymi wartościami z sekcji 2 podczas migracji.

### 1.6 `Cost` (nowy byt — pojedynczy wpis kosztowy)

```
enum CostScope {
  GENERAL
  VEHICLE
  DEVICE
}

model Cost {
  id          String       @id @default(cuid())
  amount      Decimal         // netto
  date        DateTime        // data poniesienia kosztu (z faktury), nie data wpisania do systemu
  scope       CostScope
  categoryId  String
  category    CostCategory @relation(fields: [categoryId], references: [id])
  description String?      @db.Text
  deviceId    String?         // wypełnione tylko gdy scope = DEVICE
  device      Device?      @relation(fields: [deviceId], references: [id])
  vehicleId   String?         // wypełnione tylko gdy scope = VEHICLE
  vehicle     Vehicle?     @relation(fields: [vehicleId], references: [id])
  createdAt   DateTime     @default(now())
  updatedAt   DateTime     @updatedAt
}
```

`deviceId`/`vehicleId` **muszą być spójne ze `scope`** — waliduj po stronie API: `scope = DEVICE` wymaga
`deviceId` i zabrania `vehicleId`; `scope = VEHICLE` odwrotnie; `scope = GENERAL` zabrania obu. Nie
polegaj wyłącznie na walidacji frontendowej. Dodatkowo waliduj, że `categoryId` wskazuje na
`CostCategory` z tym samym `scope` co sam wpis (nie pozwól przypisać kategorii „Paliwo" ze scope
VEHICLE do kosztu ze scope GENERAL).

**Świadoma elastyczność**: koszt kategorii „Materiały eksploatacyjne" (np. zakup partii nakładek HS,
które mogą trafić do kilku fizycznych urządzeń) może zostać wpisany ze `scope = GENERAL` zamiast
`DEVICE`, jeśli ADMIN nie chce/nie może przypisać go do jednego konkretnego urządzenia — nie wymuszaj
przypisania na siłę tam, gdzie rzeczywistość zakupowa jest rozmyta.

### 1.7 Wizualna reprezentacja powiązania — tag/chip, nie zwykły tekst

**Wszędzie, gdzie wpis kosztowy pokazuje powiązany pojazd lub urządzenie** (kolumna „Powiązane z" na
liście wpisów, sekcja 5) — renderuj to jako kolorowy tag/chip (zaokrąglona pigułka, ikona + nazwa), a
nie jako zwykły tekst w komórce tabeli. Dwa odrębne kolory wg typu powiązania (pojazd vs urządzenie —
patrz mockup `mockup-zarzadzanie-kosztami.html`, klasy `.assoc-tag.vehicle` / `.assoc-tag.device`), żeby
można było rzutem oka odróżnić rodzaj kosztu bez czytania kolumny „Zakres" osobno. Koszty ze
`scope = GENERAL` nie dostają tagu (nie mają do czego) — zostaje sam myślnik.

---

## 2. Taksonomia kategorii — dane startowe do zasiania `CostCategory`

| Zakres | Kategorie startowe (seed przy migracji) |
|---|---|
| GENERAL | Marketing, Hosting/serwer, Księgowość/prawne, Wynagrodzenia biura, Inne ogólne |
| VEHICLE | Serwis/przegląd, Ubezpieczenie, Rata/leasing |
| DEVICE | Serwis/przegląd, Materiały eksploatacyjne, Wymiana lampy/elementu zużywalnego |

Uwaga: **„Paliwo" celowo nie jest kategorią w tej tabeli** — koszt paliwa powstaje automatycznie, per
wynajem, z logiki w sekcji 3.1 (osobny mechanizm niż wpisy `Cost`, patrz niżej), więc nie ma potrzeby
osobnej kategorii do ręcznego wpisywania — zdublowałoby to dane.

---

## 3. Koszty wyliczane automatycznie (nie tabela `Cost` — obliczenia w locie)

### 3.1 Koszt paliwa per wynajem

```
koszt_paliwa(wynajem) = rental.contactDistanceKm * rental.vehicle.fuelCostPerKm
```

Jeśli brakuje `contactDistanceKm` LUB `vehicleId` LUB `vehicle.fuelCostPerKm` — wynik `null`, nie `0`
(to nie znaczy „brak kosztu", tylko „brak danych do wyliczenia") — w UI pokaż to jako „brak danych", nie
jako „0 zł" (patrz mockup, tag „auto" przy koszcie paliwa — pokazuj go tylko gdy wartość faktycznie
policzona).

### 3.2 Koszt pracy kierowcy per wynajem

```
koszt_kierowcy(wynajem) = ((rental.deliveryDurationMinutes ?? 0) + (rental.pickupDurationMinutes ?? 0))
                            / 60 * rental.driver.hourlyRate
```

**Ten wynik nigdy nie trafia do żadnego widoku roli KIEROWCA** (sekcja 1.4). Wyświetlany wyłącznie w
kontekstach ADMIN — jeśli w tej fazie w ogóle go pokazujesz w UI (nie jest jawnie wymagany w mockupie
kosztów, sekcja 5 pokazuje tylko paliwo jako „auto" w zakładce Pojazdy) — możesz go pominąć wizualnie
na start i zostawić jako przygotowaną, ale niewyeksponowaną kalkulację, jeśli to przyspieszy wdrożenie;
nie jest to blokujące dla reszty tej specyfikacji.

### 3.3 Koszt na impuls (tylko urządzenia z licznikami)

```
dla urządzenia D w wybranym okresie:
  suma_wymiany_lampy(D) = suma Cost.amount gdzie scope=DEVICE, deviceId=D,
                            category="Wymiana lampy/elementu zużywalnego", date w okresie
  suma_impulsów(D) = suma (pulseCounterEnd - pulseCounterStart) ze wszystkich RentalFinance
                       urządzenia D w tym samym okresie (ta sama reguła przypisania co w
                       module finansowym/dashboardzie przychodów — startsAt decyduje o okresie)

  koszt_na_impuls(D) = suma_wymiany_lampy(D) / suma_impulsów(D)   (pomiń dzielenie przez zero —
                                                                     brak wyniku, nie 0 ani Infinity)
```

Dotyczy wyłącznie urządzeń, dla których w danym okresie w ogóle wystąpiły zliczone impulsy (LightSheer
wariant elastyczny, Alma Harmony) — dla pozostałych pokaż myślnik `—` (patrz mockup), nie `0,00 zł`.

---

## 4. Struktura strony `/finanse/koszty` (analityczna, tylko do oglądania)

Ten sam wzorzec co `/finanse/przychody` — świadomie, dla spójności UI w całej aplikacji. **Routing i
nawigacja zgodnie z `prompt-claude-code-powloka-aplikacji.md`** — ta strona to jedna z trzech
podpozycji „Finanse" w lewym panelu (Przychody / Koszty / Wpisy kosztów), nie samodzielna strona
najwyższego poziomu z własnym linkiem wyjścia:

1. Nagłówek „Koszty" (breadcrumb „Finanse" nad nim, patrz specyfikacja powłoki) — **bez** przycisku
   „Dodaj koszt" i **bez** linku „Zarządzaj kosztami →** (ten link istniał tylko zanim „Wpisy kosztów"
   dostały własną pozycję w nawigacji — teraz dojście do nich to zwykłe kliknięcie w sidebarze, nie
   link na tej stronie). Ta strona pozostaje wyłącznie do oglądania i analizy, bez żadnej możliwości
   edycji — dokładnie jak `/finanse/przychody`.
2. Segmentowany przełącznik trybu okresu (Miesiąc/Zakres/Sezon) — **ta sama logika okresów co w
   dashboardzie przychodów** (sekcja 1 tamtego pliku) — i od teraz **ten sam, współdzielony stan**:
   zmiana okresu na tej stronie lub na `/finanse/przychody` obowiązuje na obu (patrz
   `prompt-claude-code-powloka-aplikacji.md`, sekcja 2, tam jest szczegół implementacyjny). Nie buduj
   tu drugiego, niezależnego selektora, który tylko wygląda tak samo. Dla wpisów `Cost` okres filtruje
   po polu `date`; dla kosztów wyliczanych (sekcja 3) — po tej samej regule `startsAt`, co reszta
   aplikacji.
3. Pasek **pięciu** kart KPI: **Koszty łącznie** (+ trend), **Ogólne**, **Pojazdy**, **Urządzenia** (bez
   trendu na tych trzech — tylko suma za okres), **Koszt na wynajem** (nowa karta — patrz 4.1). Wartości
   „Pojazdy"/„Urządzenia" to suma wpisów `Cost` danego zakresu **plus** wyliczone koszty paliwa
   (sekcja 3.1) dla „Pojazdy" — koszt kierowcy (3.2) i koszt na impuls (3.3) to metryki
   poglądowe/jednostkowe, **nie wliczaj ich do sumy KPI** (żeby nie podwójnie liczyć — koszt na impuls
   to przecież ten sam wydatek co „Wymiana lampy" w kategorii DEVICE, tylko przeliczony na jednostkę).
   **To samo dotyczy zakładki „Kierowcy" (4.4)** — mimo że koszt pracy dostaje tam teraz własną,
   widoczną tabelę, suma z tej zakładki nadal nie wchodzi do „Koszty łącznie". To świadoma decyzja
   zachowana z wcześniejszej wersji specyfikacji, nie przeocz jej przy dodawaniu nowej zakładki.
4. **Odwrócona kolorystyka trendu względem dashboardu przychodów**: tu strzałka w dół (mniej
   wydanych pieniędzy) jest zielona/dobra, strzałka w górę czerwona/zła — dokładnie odwrotnie niż w
   przychodach, gdzie wzrost = zielony. To celowe, nieujednolicaj.

### 4.1 Karta KPI „Koszt na wynajem"

```
koszt_na_wynajem = koszty_łącznie(okres) / liczba_wynajmów(okres)
```

`liczba_wynajmów(okres)` — ta sama liczba, co karta KPI „Liczba wynajmów" na dashboardzie przychodów
(ten sam okres, ta sama reguła `startsAt`) — nie licz tego drugi raz inną metodą, pobierz/wywołaj tę
samą logikę agregującą. Jeśli `liczba_wynajmów = 0` — pokaż „—", nie dziel przez zero. Bez wskaźnika
trendu na tej karcie (patrz mockup) — to metryka efektywności do oglądania w danym okresie, nie do
porównywania miesiąc do miesiąca w tej fazie.

### 4.2 Trend miesięczny (nowa sekcja, między KPI a zakładkami)

**Poprawka względem wcześniejszej wersji tej specyfikacji**: wykres słupkowy skumulowany (stacked bar)
pokazuje **ostatnie 6 pełnych miesięcy kalendarzowych kończących się na miesiącu zawierającym aktualnie
wybrany okres** (sekcja 1 dashboardu przychodów) — **nie zawsze na „dziś"**. To wynika wprost ze
wspólnego stanu okresu (punkt 2 wyżej) — skoro Przychody i Koszty współdzielą wybrany okres, trend musi
się do niego odnosić spójnie z resztą strony, inaczej wygląda na błąd, gdy cofniesz się np. do marca, a
wykres uparcie pokazuje kwiecień–wrzesień.
- Tryb Miesiąc: 6 miesięcy kończących się na wybranym miesiącu (wybrany miesiąc = ostatni słupek,
  wyróżniony, patrz mockup klasa `.current`).
- Tryb Sezon: 6 miesięcy kończących się na ostatnim miesiącu wybranego sezonu (sierpień danego roku
  sezonu).
- Tryb Zakres: 6 miesięcy kończących się na miesiącu zawierającym koniec wybranego zakresu dat.

- Trzy segmenty w słupku per miesiąc: Ogólne / Pojazdy / Urządzenia — te same trzy sumy, co karty KPI
  (bez kosztu kierowcy, patrz punkt 3 wyżej — konsekwentnie pomijany wszędzie w sumach).
  - Kolor segmentu: Ogólne = kolor marki (`--brand`), Pojazdy = złoty/gold (`--gold`), Urządzenia =
    fiolet (`--purple`) — te same kolory, których już używacie w innych miejscach aplikacji do
    oznaczania tych trzech zakresów (patrz istniejące klasy `.scope-tag` w mockupie „Zarządzaj
    kosztami").
- Liczba nad słupkiem = suma całkowita tego miesiąca. Etykieta miesiąca pod słupkiem, wybrany miesiąc
  wyróżniony pogrubieniem (patrz mockup, klasa `.current`).
- Skalowanie wysokości słupków: względem miesiąca z największą sumą w tych 6 miesiącach (100% wysokości
  = ten miesiąc), reszta proporcjonalnie — analogicznie do skalowania w innych wykresach słupkowych w
  tej aplikacji (np. mapa cieplna w dashboardzie przychodów).

**Insight pod wykresem** — automatyczne wykrywanie największego pojedynczego wzrostu w danym miesiącu
względem poprzedniego, **na poziomie segmentu (Ogólne/Pojazdy/Urządzenia), nie tylko sumy całkowitej**:
```
dla każdego z tych 6 miesięcy (poza pierwszym, brak poprzednika):
  dla każdego segmentu (Ogólne/Pojazdy/Urządzenia):
    wzrost = segment_ten_miesiąc - segment_poprzedni_miesiąc
znajdź największy pojedynczy wzrost (segment, miesiąc) w całym oknie 6 miesięcy
```
Pokaż go jako czerwony komunikat pod wykresem (patrz mockup): który miesiąc, który zakres, o ile wzrósł,
w miarę możliwości jednozdaniowe wyjaśnienie kontekstowe jeśli łatwo je wywnioskować (np. pojedynczy
duży wpis `Cost` odpowiadający za większość wzrostu — jeśli jeden wpis stanowi >60% wzrostu segmentu,
wspomnij go po nazwie/kategorii, jak w przykładzie w mockupie). Jeśli żaden miesiąc nie pokazuje wzrostu
(wszystko płaskie lub malejące) — nie pokazuj tego komunikatu wcale, nie wymyślaj fałszywego alarmu.

### 4.3 Zakładki treści — cztery, nie trzy

**Cztery** zakładki (ten sam mechanizm przełączania co w dashboardzie przychodów — patrz JS w
mockupie): **Kategorie** (domyślna/pierwsza — zastępuje dawną zakładkę „Ogólne"), **Pojazdy**,
**Urządzenia**, **Kierowcy** (nowa).

- **Kategorie** — **zmiana względem wcześniejszej wersji tej specyfikacji**: to już nie jest lista
  wyłącznie kosztów `scope = GENERAL`. To płaska, ranking-owa lista **wszystkich** kategorii ze
  **wszystkich** trzech zakresów razem, posortowana malejąco po kwocie — odpowiada na pytanie „na co
  wydajemy najwięcej, niezależnie od tego, czy to ogólny koszt, pojazd czy urządzenie". Kolumny:
  Kategoria (z małym tagiem koloru wskazującym zakres — `.scope-tag`, patrz mockup) / Kwota. Uwzględnij
  też „Paliwo" jako pozycję (z `⚙ auto`, patrz sekcja 3.1) mimo że nie ma własnej `CostCategory` —
  potraktuj to jako specjalną, doliczaną pozycję w tym rankingu, nie pomijaj jej tylko dlatego, że nie
  ma wiersza w tabeli kategorii. Wiersz sumy na dole = to samo co karta KPI „Koszty łącznie".
- **Pojazdy** — bez zmian w istniejących kolumnach (Pojazd / Paliwo / Inne koszty / Razem), plus
  **nowa kolumna „Koszt/km"** (z `⚙ auto`):
  ```
  koszt_na_km(pojazd) = (paliwo(pojazd, okres) + inne_koszty(pojazd, okres)) / suma_km(pojazd, okres)
  ```
  To całkowity koszt eksploatacji na kilometr (nie tylko paliwo) — pozwala porównać, które auto jest
  realnie tańsze w utrzymaniu, nie tylko które mniej pali. Brak km w okresie (pojazd nieużywany) →
  myślnik, nie dzielenie przez zero. Wiersz sumy nie pokazuje uśrednionego „koszt/km" (niepoprawne
  matematycznie sumować/uśredniać stawki per km różnych pojazdów) — myślnik w wierszu Razem, patrz
  mockup.
- **Urządzenia** — bez zmian względem wcześniejszej wersji specyfikacji.
- **Kierowcy** (nowa) — kolumny: Kierowca / Wynajmy obsłużone (liczba wydarzeń z wypełnionym
  `deliveryDurationMinutes` lub `pickupDurationMinutes` w okresie, przypisanych temu kierowcy) / Łączny
  czas (suma `(deliveryDurationMinutes + pickupDurationMinutes)` w okresie, w godzinach) / Koszt pracy
  (sekcja 3.2, zsumowany per kierowca w okresie). Wiersz sumy na dole.
  - **Twarda reguła bezpieczeństwa, obowiązująca mimo że dane są teraz widoczne w UI**: ta zakładka i
    wszystko w niej pozostaje **wyłącznie dla ADMINA** — żaden kierowca (własne dane też) nie może tego
    zobaczyć w żadnym widoku, do którego ma dostęp. Ekspozycja tych danych tutaj **nie zmienia** reguły
    z sekcji 1.4 — nadal sprawdzaj przy review każdy endpoint zwracany roli KIEROWCA.
  - Suma tej zakładki **nie wchodzi** do KPI „Koszty łącznie" (patrz punkt 3 wyżej) — pokazana tylko
    jako wgląd poglądowy w tym miejscu.

Wspólna zasada dla wszystkich czterech zakładek: pozycje bez żadnych kosztów/czasu w wybranym okresie
(urządzenie, pojazd lub kierowca) **nie pojawiają się** na liście — ten sam wzorzec co w tabeli
urządzeń w dashboardzie przychodów, nie pokazuj wierszy zerowych.

---

## 5. Strona „Wpisy kosztów" — trzecia podpozycja „Finanse" w nawigacji

**Zmiana względem wcześniejszej wersji tej specyfikacji**: to nadal odrębna strona robocza (nie
zakładka na `/finanse/koszty`), ale routing i miejsce w nawigacji się zmieniły — patrz
`prompt-claude-code-powloka-aplikacji.md`, sekcja 2: to teraz trzecia podpozycja w rozwiniętym podmenu
„Finanse" w lewym panelu (`/finanse/koszty/wpisy` albo odpowiednik zgodny z konwencją repo), obok
Przychodów i Kosztów — **nie osobna strona z linkiem „Zarządzaj kosztami →"** (ten link znika, patrz
sekcja 4, punkt 1). Dojście tutaj to teraz zwykłe kliknięcie w sidebarze.

**Zarządzanie kategoriami przeniosło się na osobną stronę w Ustawieniach** (sekcja 6) — ta strona ma
już tylko **jedną** zawartość, bez wewnętrznych zakładek: płaską listę wpisów `Cost` z filtrami i
formularzem dodawania (dawna zakładka „Wpisy"). Jeśli w mockupie `mockup-zarzadzanie-kosztami.html`
widzisz jeszcze zakładkę „Kategorie" obok „Wpisy" — to nieaktualny fragment tego mockupu, zignoruj go;
ta specyfikacja tekstowa jest tu źródłem prawdy dla struktury stron, mockup pozostaje źródłem prawdy
tylko dla wyglądu samej listy wpisów i formularza.

Przycisk **„+ Dodaj koszt"** w prawym górnym rogu nagłówka strony — otwiera formularz (sekcja 5.2), w
produkcji jako modal/panel boczny (w mockupie pokazany jako rozwijana karta pod nagłówkiem, wyłącznie
dla czytelności specyfikacji).

Płaska tabela wszystkich wpisów `Cost` w wybranym okresie (**własny, niezależny filtr okresu** — w
przeciwieństwie do Przychodów/Kosztów, ta strona **nie** uczestniczy we wspólnym stanie okresu z sekcji
4, punkt 2, bo to strona robocza do przeglądania/poprawiania konkretnych wpisów, nie analityczna),
niezależnie od zakresu: Data / Zakres / Kategoria / Powiązane z / Opis / Kwota / Akcje.
- **Kolumna „Powiązane z"** — tag/chip, nie zwykły tekst, patrz sekcja 1.7. Koszty `GENERAL` dostają
  myślnik, nie tag.
- Filtry nad tabelą (patrz mockup): pole wyszukiwania tekstowego (dopasowuje po widocznej treści
  wiersza — opis, kategoria, powiązanie) + dropdown zakresu (Wszystkie/Ogólny/Pojazd/Urządzenie).
  Licznik wyników obok filtrów aktualizuje się na żywo.
- Kolumna Akcje: **Edytuj** otwiera ten sam formularz „Dodaj koszt" (sekcja 5.2), wypełniony
  istniejącymi wartościami, w trybie edycji (zapis nadpisuje rekord, nie tworzy nowego). **Usuń** — w
  mockupie usuwa wiersz od razu (dla czytelności demo); **w produkcji wymagaj potwierdzenia** przed
  usunięciem (prosty modal/confirm) — to nieodwracalna operacja na danych finansowych, nie usuwaj bez
  potwierdzenia tak jak w statycznym mockupie.
- Sortowanie domyślne: malejąco po dacie (najnowsze na górze) — nowo dodany wpis ląduje na początku
  listy.

### 5.1 (usunięta — była to zakładka „Wpisy" wewnątrz tej strony; skoro strona ma teraz tylko jedną
zawartość, opis wtopiony bezpośrednio w sekcję 5 wyżej, żeby nie zostawiać pustego, mylącego numeru
podsekcji).

### 5.2 Formularz „Dodaj koszt"

Pola (patrz mockup):
1. **Zakres** — dropdown/przełącznik Ogólne / Pojazd / Urządzenie.
2. **Kategoria** — dropdown, tylko **aktywne** `CostCategory` danego zakresu (zarządzane na
   `/ustawienia/kategorie-kosztow`, sekcja 6).
3. **Jeśli Pojazd** — dodatkowy select z listą aktywnych `Vehicle`.
4. **Jeśli Urządzenie** — dodatkowy select z listą aktywnych `Device`.
5. **Kwota (netto)** i **Data** — obok siebie (patrz mockup, `two-col`).
6. **Opis** — opcjonalne pole tekstowe.
7. Przyciski Anuluj / Dodaj.

Zmiana „Zakresu" resetuje wybraną kategorię (lista opcji się zmienia, stara wartość może nie pasować do
nowego zakresu) i pokazuje/chowa odpowiedni dodatkowy select (Pojazd/Urządzenie).

**Po zapisaniu**: formularz się zamyka, nowy wpis ląduje na górze listy — to jest potwierdzenie zapisu,
celowo bez dodatkowego komunikatu/toastu (sam fakt pojawienia się wpisu na liście wystarcza, patrz
mockup — funkcja `submitCost()`). Formularz w trybie edycji (wywołany z akcji „Edytuj" na liście)
różni się tylko tym, że pola są wstępnie wypełnione, a zapis aktualizuje istniejący rekord zamiast
tworzyć nowy.

---

## 6. Strona `/ustawienia/kategorie-kosztow` — zarządzanie kategoriami (przeniesione z dawnej sekcji 5.2)

**Nowe miejsce w nawigacji**: obok Cennika i Pojazdów w Ustawieniach (patrz
`prompt-claude-code-powloka-aplikacji.md`, sekcja 2 — Ustawienia zachowuje dzisiejszy pasek zakładek
wewnątrz strony, dodaj tu nową pozycję do tego paska). To rzadko dotykana konfiguracja, nie codzienna
praca operacyjna — stąd przeniesienie z dawnej strony „Wpisy kosztów", gdzie była zagrzebana jako
druga zakładka obok czegoś używanego codziennie.

Zarządzanie tabelą `CostCategory` (sekcja 1.5) — trzy sekcje, po jednej na `CostScope` (Ogólne / Pojazd
/ Urządzenie), każda pokazująca listę kategorii tego zakresu (patrz mockup
`mockup-zarzadzanie-kosztami.html` — sama zawartość tej sekcji w mockupie, mimo że tam jeszcze
osadzona jako zakładka wewnątrz innej strony, jest wizualnie poprawnym źródłem prawdy dla tego, jak
mają wyglądać poszczególne elementy — przenosisz tylko jej *routing*, nie wygląd):
- Nazwa kategorii + licznik użycia („N wpisów" — liczba `Cost` wskazujących tę kategorię, w całej
  historii, nie tylko w wybranym okresie).
- Przełącznik aktywna/nieaktywna (`CostCategory.active`) — **dezaktywacja, nie usuwanie**. Nieaktywna
  kategoria znika z dropdownu w formularzu „Dodaj koszt" (sekcja 5.2), ale istniejące wpisy `Cost`,
  które jej używają, zostają nienaruszone i nadal ją pokazują (w historii, na stronie „Wpisy kosztów").
  Nie pozwalaj na twarde usunięcie kategorii, która ma choć jeden powiązany `Cost` — API powinno to
  odrzucić; dezaktywacja jest zawsze bezpieczna, usunięcie nie.
- Edycja nazwy (inline, ikona ✎) — aktualizuje jeden wiersz `CostCategory`, widoczne natychmiast
  wszędzie (patrz uzasadnienie w sekcji 1.5).
- Na dole każdej sekcji: pole tekstowe + przycisk „+ Dodaj" do utworzenia nowej kategorii w tym
  zakresie. Waliduj unikalność `(name, scope)` — patrz `@@unique` w modelu (sekcja 1.5).

---

## 7. Świadomie uproszczone — nie buduj automatyzacji, której o to nie proszono

- **Cena paliwa per pojazd (`Vehicle.fuelCostPerKm`) jest wpisywana ręcznie przez ADMINA**, nie
  pobierana automatycznie z żadnego zewnętrznego źródła. Sprawdzono dostępne polskie serwisy z cenami
  paliw (e-petrol.pl i inne) — nie mają publicznego, darmowego API nadającego się do integracji
  produkcyjnej (e-petrol wymaga płatnej subskrypcji z logowaniem, reszta to serwisy konsumenckie bez
  udokumentowanego API). Pokaż w UI przy tym polu (na `/ustawienia/pojazdy`) subtelny wskaźnik „ostatnia
  aktualizacja: X dni temu" (z `Vehicle.fuelCostUpdatedAt`) jako przypomnienie, ale **nie buduj żadnego
  mechanizmu automatycznego pobierania**.
- **Odległość (`contactDistanceKm`) jest wpisywana ręcznie przez biuro, raz przy danym kliencie**, nie
  przez żadne API mapowe (Google Maps czy inne). To świadome uproszczenie — adresy klientów są stabilne
  (gabinet się nie przeprowadza często), więc jednorazowy ręczny wpis (biuro i tak sprawdza adres, żeby
  ustalić cenę transportu) jest tańszy i prostszy niż utrzymywanie integracji z płatnym API. **Nie
  dodawaj integracji z Google Maps ani żadnym innym dostawcą map w tej fazie** — jeśli to się kiedyś
  okaże niewystarczające, to osobny, przyszły temat.
- **Nie buduj widoku marży/rentowności** (przychód − koszt) — patrz sekcja 0.

---

## 8. Checklist przed review

1. Sprawdź, czy `Rental`/`RentalFinance` (moduł finansowy) i istniejące pola cache kontaktu
   (`contactAddressCache` itd.) mają dokładnie taki kształt, jak zakłada ta specyfikacja — dopasuj
   migrację do rzeczywistości repo.
2. Migracja: `Vehicle`, `CostCategory`, `Cost`, `Rental.vehicleId`, `Rental.contactDistanceKm`,
   `User.hourlyRate` — wygenerowana zgodnie z konwencją repo (`prisma migrate diff`, bez lokalnej
   bazy), aplikowana przez `deploy/migrate.mjs`. Nie zapomnij zasiać `CostCategory` danymi startowymi
   z sekcji 2.
3. Walidacja spójności `Cost.scope` z `deviceId`/`vehicleId` **oraz z `categoryId`** (sekcja 1.6) —
   testy na wszystkich trzech zakresach, w tym próba wysłania niespójnej kombinacji (musi zostać
   odrzucona przez API, nie tylko ukryta w UI) i próba przypisania kategorii z innym `scope` niż sam
   koszt.
4. **Test bezpieczeństwa (priorytet)**: zaloguj się jako KIEROWCA i potwierdź, że `hourlyRate` (własny i
   cudzy) oraz wyliczony koszt pracy (sekcja 3.2) nie pojawiają się w żadnej odpowiedzi API dostępnej tej
   roli — nie tylko że są ukryte w UI.
5. Koszt na impuls (sekcja 3.3) — przetestuj dzielenie przez zero (urządzenie bez zliczonych impulsów w
   okresie) i przypadek z kosztami wymiany lampy, ale bez żadnych wynajmów w okresie.
6. Kolorystyka trendu (sekcja 4, punkt 4) — potwierdź, że jest odwrócona względem dashboardu
   przychodów, nie skopiowana jeden do jednego.
7. Formularz „Dodaj koszt" (sekcja 5.2) — przetestuj przełączanie zakresu (kategoria i dodatkowy select
   muszą się poprawnie resetować/pokazywać, a lista kategorii pokazuje wyłącznie aktywne).
8. Strona „Wpisy kosztów" (sekcja 5) — przetestuj filtrowanie (tekst + zakres, łącznie), sortowanie
   malejąco po dacie, i to, że nowo dodany wpis faktycznie tam ląduje po zapisaniu formularza. Potwierdź,
   że „Usuń" pyta o potwierdzenie w produkcji (mockup celowo tego nie ma, żeby nie komplikować demo) —
   nie kopiuj zachowania „usuń bez pytania" z mockupu. Potwierdź, że kolumna „Powiązane z" renderuje się
   jako tag/chip (sekcja 1.7), nie zwykły tekst. Potwierdź, że ta strona ma **własny** filtr okresu,
   niezależny od wspólnego stanu Przychody↔Koszty (sekcja 4, punkt 2).
9. Strona `/ustawienia/kategorie-kosztow` (sekcja 6) — przetestuj dodanie nowej kategorii, dezaktywację
   kategorii z istniejącymi wpisami (musi zostać, tylko zniknąć z dropdownu przy nowych kosztach), próbę
   twardego usunięcia kategorii z powiązanymi `Cost` (musi zostać odrzucona), edycję nazwy (musi się od
   razu odzwierciedlić na stronie „Wpisy kosztów" i w zakładce „Kategorie" dashboardu analitycznego,
   sekcja 4.3).
10. Potwierdź, że `/finanse/koszty` (analityczna) nie ma żadnej możliwości edycji ani przycisku
    „Dodaj koszt" — dojście do „Wpisy kosztów" to teraz kliknięcie w podmenu „Finanse" w lewym panelu
    (patrz `prompt-claude-code-powloka-aplikacji.md`), nie link na tej stronie (dawny link „Zarządzaj
    kosztami →" został usunięty, nie powinien się nigdzie pojawiać w finalnym kodzie).
11. Karta „Koszt na wynajem" (sekcja 4.1) — przetestuj `liczba_wynajmów = 0` (musi pokazać „—", nie
    dzielić przez zero), i że korzysta z tej samej agregacji liczby wynajmów co dashboard przychodów
    (nie duplikuje logiki).
12. Trend miesięczny (sekcja 4.2) — **przetestuj poprawioną logikę**: zmień wybrany okres (np. cofnij
    się do marca 2026 w trybie Miesiąc) i potwierdź, że trend **przelicza się** na 6 miesięcy kończących
    się na marcu, a nie zostaje przy ostatnich 6 miesiącach względem dzisiejszej daty. To jest test na
    poprawkę błędu, nie na „brak przeliczania" — wcześniejsza wersja tej checklisty testowała
    zachowanie, które okazało się błędem projektowym, nie cechą. Przetestuj też wykrywanie insightu:
    przypadek bez żadnego wzrostu (komunikat znika), przypadek z jednym wpisem odpowiadającym za >60%
    wzrostu (wspomniany po nazwie).
13. Zakładka „Kategorie" (sekcja 4.3) — potwierdź, że pokazuje kategorie ze wszystkich trzech zakresów
    razem, z poprawnymi tagami koloru, i że „Paliwo" (mimo braku własnego `CostCategory`) pojawia się
    w rankingu jako pozycja wyliczona automatycznie.
14. Zakładka „Pojazdy", kolumna „Koszt/km" — przetestuj pojazd bez przejechanych km w okresie (myślnik,
    nie dzielenie przez zero) i potwierdź, że wiersz sumy nie próbuje uśredniać stawek per km.
15. Zakładka „Kierowcy" — **priorytet bezpieczeństwa**: potwierdź, że mimo nowej widoczności tych
    danych w UI admina, żaden endpoint dostępny roli KIEROWCA nadal nie zwraca `hourlyRate` ani
    wyliczonego kosztu pracy (to ta sama reguła z sekcji 1.4, tylko teraz łatwiej o przypadkowe
    przeoczenie, skoro dane mają już swój widoczny komponent UI — sprawdź to ze zdwojoną uwagą).
