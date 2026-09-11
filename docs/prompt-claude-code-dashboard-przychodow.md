# Prompt dla Claude Code — dashboard przychodów (ADMIN) + pola czasu dostawy/odbioru

## 0. Kontekst i cel

**Hierarchia źródeł prawdy:** towarzyszy temu plikowi `mockup-dashboard-przychodow.html` — to jest
nadrzędne źródło prawdy dla wyglądu. Ten plik `.md` jest źródłem prawdy dla logiki agregacji, definicji
okresów i zasad liczenia. Przy sprzeczności co do wyglądu wygrywa HTML.

To **pierwsza faza** szerszego planu monitoringu finansowego (przychody → koszty → marża → wartość
klienta/urządzenia). Ta faza dotyczy **wyłącznie przychodów** (w szerokim sensie: kwoty, liczby
wynajmów, wykorzystania urządzeń) — nie projektuj i nie buduj niczego związanego z kosztami poza
jednym drobnym, celowo wydzielonym dodatkiem opisanym w sekcji 10 (to tylko zbieranie danych, nie
moduł kosztowy).

Ten dashboard to **warstwa agregacji nad istniejącym modelem `RentalFinance`** (z modułu finansowego
wydarzeń — jeśli jeszcze nie wdrożony w pełni, ta funkcja od niego zależy i nie zadziała bez pól
`totalNet`, `baseRentalPriceSource`, `pulseCalculationStatus`, `paymentMethod`). **Nie twórz nowych
modeli Prisma dla samych przychodów** — to czyste zapytania/agregacje SQL nad danymi, które już tam są.

Dostęp: **wyłącznie rola ADMIN** — to wrażliwe dane finansowe firmy. Użyj istniejącego
`requireAdminSession()` (API) i odpowiedniego guarda routingu (strony) — analogicznie do
`/ustawienia/uzytkownicy`, `/ustawienia/integracje`. Dodaj nową pozycję nawigacji (np. „Finanse")
widoczną tylko dla ADMINA — sprawdź, jak dziś ukrywacie pozycje nawigacji per rola, i zastosuj ten sam
mechanizm.

---

## 1. Trzy tryby wyboru okresu

Segmentowany przełącznik: **Miesiąc / Zakres / Sezon**. Domyślny tryb przy pierwszym wejściu: Miesiąc,
domyślny okres: bieżący miesiąc kalendarzowy.

**Aktualizacja — wspólny stan ze stroną Koszty**: od wdrożenia `prompt-claude-code-dashboard-kosztow.md`
i `prompt-claude-code-powloka-aplikacji.md`, ta strona i `/finanse/koszty` **współdzielą wybrany
okres** — zmiana trybu/wartości na jednej z nich obowiązuje też na drugiej (obie to podpozycje w
podmenu „Finanse" w lewym panelu, patrz specyfikacja powłoki, sekcja 2). Zaimplementuj to jako
współdzielony stan po stronie klienta, nie dwa niezależne selektory, które tylko wyglądają tak samo.
„Wpisy kosztów" (trzecia podpozycja Finansów) **nie** uczestniczy w tym współdzielonym stanie — ma
własny, niezależny filtr okresu.

### Miesiąc
- Nawigacja strzałkami `‹ Wrzesień 2026 ›` — poprzedni/następny miesiąc kalendarzowy.
- Okres: `[1. dzień miesiąca 00:00, ostatni dzień miesiąca 23:59]` w strefie `Europe/Warsaw` (tak samo
  jak reszta aplikacji liczy daty).

### Zakres
- Dwa pola daty („Od" / „Do"), użyj tego samego komponentu date-pickera, którego już używacie przy
  tworzeniu wynajmu — nie wprowadzaj nowej biblioteki tylko dla tego widoku.
- Brak nawigacji strzałkami (to nie ma naturalnego „poprzedniego" zakresu).
- **Brak wskaźnika trendu w tym trybie** (patrz sekcja 4) — nie ma jednoznacznego okresu porównawczego.

### Sezon
- Sezon to **zawsze wrzesień–sierpień**, stały preset (nie konfigurowalny przez użytkownika w tej
  fazie): sezon „2026/2027" = `[1 września 2026 00:00, 31 sierpnia 2027 23:59]`.
- Nawigacja strzałkami `‹ Sezon 2026/2027 ›` — poprzedni/następny sezon (±1 rok).
- Domyślny sezon przy pierwszym wejściu w tym trybie: sezon zawierający dzisiejszą datę (jeśli dziś
  jest np. w lutym 2027 — to sezon 2026/2027).

---

## 2. Co wchodzi do przychodu i jak jest grupowane

**Podstawa: `RentalFinance.totalNet` (netto, bez VAT)** — potwierdzona decyzja: przychód liczymy netto,
niezależnie od tego, czy dany klient rozlicza się z VAT czy bez (VAT to podatek przechodni, nie
przychód firmy).

**Przypisanie do okresu: wg `Rental.startsAt`** (data rozpoczęcia wynajmu/szkolenia) — potwierdzona
decyzja. Wynajem zaczynający się 30 sierpnia, kończący 2 września, liczy się **w całości** do sierpnia
— dotyczy to przychodu, liczby wynajmów i dni wykorzystania (sekcja 5) jednolicie, żeby liczby w
dashboardzie się ze sobą zgadzały (ten sam zestaw wydarzeń leży u podstaw każdej metryki na tej
stronie).

**Filtrowanie:**
- Włącz `eventType = WYNAJEM` i `eventType = SZKOLENIE` — oba to przychód firmy.
- Wyklucz wydarzenia usunięte (`deletedInGoogle = true` lub odpowiednik soft-delete, sprawdź dokładną
  nazwę pola w aktualnym `schema.prisma`).
- Nie filtruj po statusie ceny (`baseRentalPriceSource`) — licz wszystko, co ma jakąkolwiek wartość w
  `totalNet`, nawet jeśli to wartość tymczasowa (`PULSE_CALCULATED` w toku / placeholder). To jest
  **świadoma decyzja**: to dashboard „preliminowany" (projekcja), nie księgowość — wartości tymczasowe
  należą do obrazu, dopóki się nie doprecyzują. Zamiast wykluczać, **sygnalizuj niepewność** (patrz
  sekcja 9).

**Grupowanie (dotyczy zarówno tabeli urządzeń, jak i liczby wynajmów/średniej/wykorzystania):**
- Dla `eventType = WYNAJEM` → grupuj po `Rental.deviceId`, etykieta = nazwa urządzenia (`Device.name`
  lub odpowiednik pola nazwy).
- Dla `eventType = SZKOLENIE` → **zawsze** jedna zbiorcza pozycja „Szkolenia", niezależnie od tego, czy
  wydarzenie ma przypisane urządzenie. Nie miesza się z rozbiciem per urządzenie — inny rodzaj wartości
  (usługa, nie wynajem sprzętu). W tabeli zawsze na końcu listy, niezależnie od kwoty (kursywa, szary
  kolor, patrz mockup), z myślnikiem zamiast wskaźnika wykorzystania (sekcja 5 nie ma sensu dla usługi
  bez fizycznego, ograniczonego zasobu).
- Urządzenia bez żadnego przychodu w danym okresie **nie pojawiają się** na liście (nie pokazuj wierszy
  zerowych).
- Sortowanie: malejąco po przychodzie, z wyjątkiem „Szkolenia" zawsze na końcu.

---

## 3. Pasek KPI (cztery karty nad tabelą)

Zgodnie z mockupem, cztery karty w rzędzie, dla całego wybranego okresu (suma po wszystkich
urządzeniach + szkolenia razem):

1. **Przychód netto** — suma `totalNet` z sekcji 2 + wskaźnik trendu (sekcja 4).
2. **Liczba wynajmów** — liczba wydarzeń (WYNAJEM + SZKOLENIE) spełniających filtr z sekcji 2. Pod
   spodem drobny podpis „w tym N szkoleń" (sama liczba `eventType = SZKOLENIE` w okresie) — pomiń ten
   podpis, jeśli `N = 0`. Plus wskaźnik trendu.
3. **Średnia wartość wynajmu** — `Przychód netto / Liczba wynajmów` dla całego okresu (WYNAJEM +
   SZKOLENIE łącznie — to ogólna średnia transakcji, nie per-urządzenie; ta druga jest w tabeli,
   sekcja 6). Jeśli `Liczba wynajmów = 0` — pokaż „—" zamiast dzielenia przez zero. Plus wskaźnik
   trendu.
4. **Unikalni klienci** — `COUNT DISTINCT` po identyfikatorze kontaktu HubSpot (`hubspotContactId`)
   wśród wydarzeń z sekcji 2 w danym okresie. **Bez wskaźnika trendu** w tej fazie (patrz sekcja 11 —
   pełna analiza klienta to świadomie przyszły temat, to tylko lekki podgląd liczby przy okazji).
   Wydarzenia bez przypiętego kontaktu HubSpot (`hubspotContactId = null`) nie wchodzą do tego
   liczenia (nie licz `null` jako „jednego klienta").

---

## 4. Wskaźnik trendu (Przychód, Liczba wynajmów, Średnia wartość — tylko tryby Miesiąc i Sezon)

- **Miesiąc**: porównanie z bezpośrednio poprzednim miesiącem kalendarzowym.
- **Sezon**: porównanie z bezpośrednio poprzednim sezonem.
- **Zakres**: brak wskaźnika trendu na żadnej karcie — nie pokazuj tego elementu w ogóle w tym trybie
  (nie zostawiaj pustego miejsca po nim, usuń go z layoutu).
- Wzór: `(bieżący - poprzedni) / poprzedni * 100`, zaokrąglone do liczby całkowitej, liczony osobno dla
  każdej z trzech metryk (mają różne wartości bazowe, nie muszą się matematycznie sumować do siebie —
  to trzy niezależne trendy pokazane obok siebie, nie rozbicie jednego trendu na składowe).
- Jeśli poprzedni okres miał wartość `0` (zł lub wynajmów) — nie dziel przez zero, pokaż zamiast tego
  neutralny stan (brak chipa trendu) — nie renderuj `Infinity%`/`NaN%`.
- Kolor: zielony + strzałka w górę dla wzrostu, czerwony + strzałka w dół dla spadku, zgodnie z
  mockupem.

---

## 5. Wskaźnik wykorzystania urządzenia

To metryka specyficzna dla fizycznego, ograniczonego zasobu (jedno urządzenie = jeden kalendarz =
może być wynajęte tylko jednej klientce naraz) — pokazuje, czy niski przychód urządzenia wynika ze
słabego popytu, czy z tego, że urządzenie stoi bezczynnie mimo dostępności. **Dotyczy wyłącznie
urządzeń (`eventType = WYNAJEM`), nie „Szkoleń"** (patrz sekcja 2).

**Formuła:**

```
dni_wynajete(urządzenie, okres) = suma durationDays dla wszystkich wynajmów tego urządzenia,
                                    których startsAt mieści się w okresie
                                    (ta sama reguła przypisania co w sekcji 2 — spójność z resztą strony)

dni_w_okresie = liczba dni kalendarzowych okresu (np. 30 dla września, ~365 dla sezonu)

wykorzystanie% = min(100, round(dni_wynajete / dni_w_okresie * 100))
```

**Świadome uproszczenie**, spójne z regułą przypisania z sekcji 2: 3-dniowy wynajem zaczynający się 30
sierpnia liczy się w całości (3 dni) do sierpnia, mimo że fizycznie 2 z tych dni przypadają na
wrzesień. To nie jest błąd — to ta sama zasada „wynajem należy do miesiąca, w którym się zaczyna",
zastosowana konsekwentnie, żeby suma dni wykorzystania w tabeli urządzeń nie kłóciła się z liczbą
wynajmów i przychodem tego samego urządzenia w tym samym wierszu.

`min(100, ...)` jako zabezpieczenie — przy normalnych danych nie powinno przekroczyć 100%, ale nie
pozwól, żeby błąd w danych (np. nakładające się rezerwacje z powodu błędu synchronizacji z Google
Calendar) wyrenderował wskaźnik typu 140%.

Nie próbuj na tym etapie uwzględniać, czy urządzenie było `active` przez cały okres (np. dodane do
floty w połowie miesiąca) — licz zawsze względem pełnej liczby dni okresu. Jeśli to da wyraźnie
myląco niski wynik dla nowo dodanych urządzeń, zgłoś to jako obserwację, ale nie buduj na to
osobnej logiki bez pytania.

---

## 6. Insight: najlepiej / najsłabiej wykorzystane urządzenie

Dwa małe boksy nad tabelą (patrz mockup): urządzenie z najwyższym i najniższym wskaźnikiem
wykorzystania (sekcja 5) w wybranym okresie, wyłącznie spośród urządzeń, które **miały choć jeden
wynajem w okresie** (nie pokazuj urządzenia z 0% tylko dlatego, że nie miało żadnego ruchu — to
najpewniej urządzenie nieaktywne/wycofane, nie insight wart podświetlenia; jeśli mniej niż dwa
urządzenia mają jakikolwiek przychód w okresie, ukryj oba boksy zamiast pokazywać to samo urządzenie
w obu).

---

## 7. Tabela rozbicia na urządzenia

Kolumny (zgodnie z mockupem): **Urządzenie / Przychód / Udział / Wynajmy / Śr. wartość /
Wykorzystanie**.

- Przychód — suma `totalNet` dla urządzenia w okresie (sekcja 2).
- Udział — % udziału tego urządzenia w sumie całego okresu (przychód urządzenia / przychód całego
  okresu). Kosmetyka zaokrągleń jak poprzednio — nie martw się o to, że suma % w kolumnie może wyjść
  99% lub 101% przy zaokrągleniach, to nie księgowość.
- Wynajmy — liczba wydarzeń tego urządzenia w okresie.
- Śr. wartość — `Przychód urządzenia / Liczba wynajmów urządzenia`. Zero wynajmów nie wystąpi tu z
  definicji (wiersze bez przychodu są ukryte, patrz sekcja 2).
- Wykorzystanie — sekcja 5; dla wiersza „Szkolenia" zawsze myślnik `—`, nie licz tego pola.

---

## 8. Rozkład długości wynajmu

Mały panel (patrz mockup, sekcja „Długość wynajmu"): liczba i % wydarzeń `eventType = WYNAJEM` w
okresie wg `durationDays` — **trzy kategorie: 1 dzień / 2 dni / 3 dni**. Wydarzenia dłuższe niż 3 dni
(rzadkie, patrz moduł finansowy — tam były traktowane jako wyjątek wymagający ręcznej ceny) dolicz do
kategorii „3 dni" zamiast tworzyć czwartą, rzadko używaną kategorię — jeśli to da wyraźnie mylący
obraz po wdrożeniu, zgłoś to zamiast cicho zostawiać.

„Szkolenia" **nie wchodzą** do tego rozkładu — to rozkład specyficzny dla wynajmu sprzętu (gdzie
długość wynajmu ma znaczenie cennikowe), nie dla szkoleń.

---

## 9. Sposób płatności

Mały panel (patrz mockup): suma `totalNet` i % podzielone wg `RentalFinance.paymentMethod` (`CASH` /
`TRANSFER`) dla całego okresu — **WYNAJEM + SZKOLENIE razem**, w przeciwieństwie do rozkładu długości
(sekcja 8) tu nie ma powodu wykluczać szkoleń, płatność dotyczy obu typów wydarzeń tak samo.

---

## 10. Sygnalizacja niepewnych/tymczasowych cen

Jeśli w wybranym okresie istnieje choć jedno `RentalFinance` z `pulseCalculationStatus = PENDING`
(czeka na odczyt liczników przez kierowcę — patrz moduł finansowy, sekcja 3.2/3.3) — pokaż subtelny
komunikat (żółte tło, jak w mockupie): **„N wynajmów w tym okresie ma jeszcze nieostateczną cenę
(czekają na odczyt liczników impulsów) — suma jest szacunkowa i może się zmienić."** `N` = dokładna
liczba takich wydarzeń w okresie. Brak takich wydarzeń → nie pokazuj komunikatu w ogóle (nie pokazuj
„0 wynajmów…").

---

## 11. Struktura strony (kolejność elementów, zgodnie z mockupem)

1. `/finanse/przychody` — ADMIN-only, druga podpozycja w podmenu „Finanse" w lewym panelu (patrz
   `prompt-claude-code-powloka-aplikacji.md`, sekcja 2) — **nie** samodzielna strona z własnym pełnym
   nagłówkiem najwyższego poziomu. Nagłówek strony to teraz breadcrumb „Finanse" + tytuł „Przychody"
   (wzorzec z mockupu powłoki, `.breadcrumb` + `.page-title`), nie „Finanse — Przychody" jako jeden
   ciąg tekstu.
2. Segmentowany przełącznik trybu okresu (sekcja 1) — **współdzielony z `/finanse/koszty`**, patrz
   aktualizacja w sekcji 1 wyżej.
3. Nawigator okresu (strzałki + etykieta, albo dwa pola daty w trybie Zakres).
4. Pasek czterech kart KPI (sekcja 3) — **wspólny dla wszystkich zakładek poniżej**, nie przelicza się
   przy przełączaniu zakładki, tylko przy zmianie okresu.
5. Komunikat o niepewnych cenach, gdy dotyczy (sekcja 10) — również wspólny.
6. **Trzy zakładki treści** (zwykłe zakładki UI, przełączane klientem bez przeładowania strony —
   patrz mockup, sekcja JS): **Urządzenia** (domyślna), **Klienci**, **Mapa cieplna**.
   - Urządzenia: insighty best/worst wykorzystania (sekcja 6) + tabela urządzeń (sekcja 7) + dwa
     panele: długość wynajmu (sekcja 8) i sposób płatności (sekcja 9).
   - Klienci: sekcja 12.
   - Mapa cieplna: sekcja 13.

---

## 12. Zakładka „Klienci"

Analogicznie do zakładki „Urządzenia", ale grupowanie po kliencie zamiast po urządzeniu. Ten sam
zestaw wydarzeń co w sekcji 2 (WYNAJEM + SZKOLENIE, ta sama reguła przypisania okresu).

**Grupowanie:** po `Rental.hubspotContactId`. Wydarzenia bez przypiętego kontaktu (`null`) —
zgrupuj razem jako jedną pozycję „Bez przypisanego klienta" na końcu tabeli (analogicznie do
„Szkoleń" w tabeli urządzeń) — nie pomijaj ich całkowicie, bo to wciąż realny przychód, tylko nie da
się go dziś przypisać do konkretnej osoby.

**Nagłówkowa statystyka nad tabelą:** „Średni przychód na klienta" = `Przychód netto całego okresu /
Liczba unikalnych klientów` (ten sam licznik co karta KPI nr 4, sekcja 3) — pokazana jako pojedyncza,
wyeksponowana liczba nad tabelą (patrz mockup), nie jako kolejna karta KPI.

**Insight best/worst — analogicznie do zakładki Urządzenia (sekcja 6), ale na innej metryce.**
Świadoma decyzja: **nie** rób tego na przychodzie — tabela jest już posortowana malejąco po przychodzie,
więc „zwycięzca" byłby dokładnie pierwszym wierszem, a taki insight nic by nie wnosił ponad to, co i
tak widać. Zamiast tego licz best/worst po **średniej wartości wynajmu tego klienta**
(`Przychód klienta / Liczba wynajmów klienta`, ta sama kolumna co w tabeli) — to ujawnia coś innego niż
kolejność wg przychodu: klient z rzadkimi, ale dużymi zleceniami kontra klient z drobną, częstą
sprzedażą, niezależnie od tego, kto z nich zarobił łącznie więcej.
- 🏆 „Najwyższa śr. wartość wynajmu" — klient z największą średnią.
- 📉 „Najniższa śr. wartość wynajmu" — klient z najmniejszą średnią.
- Pomiń przy tym liczeniu wiersz „Bez przypisanego klienta" oraz zbiorczy wiersz „pozostali klienci" —
  to insight o konkretnych, nazwanych klientach, nie o technicznych pozycjach zbiorczych.
- Tak jak w sekcji 6 — jeśli mniej niż dwóch (nazwanych) klientów ma przychód w okresie, ukryj oba
  boksy zamiast pokazywać tego samego klienta w obu.

**Kolumny tabeli:** Klient / Przychód / Udział / Wynajmy / Śr. wartość / Urządzenia.
- Klient — etykieta z `contactNameCache` (lub `contactCompanyCache`, jeśli nazwa firmy jest bardziej
  sensowna do wyświetlenia niż imię i nazwisko — sprawdź, które pole jest dziś faktycznie wypełniane
  konsekwentnie i użyj tego; jeśli oba, preferuj nazwę firmy/gabinetu, bo to częściej powtarzalny
  klient biznesowy niż osoba prywatna).
- Urządzenia — liczba **różnych** urządzeń, z których klient korzystał w okresie (nie suma wynajmów) —
  np. „2 różne" jeśli wynajmował DESIRE i Cooltech, nawet jeśli DESIRE wynajmował trzykrotnie. Dla
  pozycji „Bez przypisanego klienta" i przy 1 urządzeniu pokaż po prostu liczbę / myślnik, jak w
  mockupie.

**Odznaka „Nowy":** pokaż przy nazwie klienta, jeśli **jego pierwszy wynajem w całej historii** mieści
się w wybranym okresie — czyli nie istnieje żadne inne `Rental` tego `hubspotContactId` z `startsAt`
wcześniejszym niż początek wybranego okresu. To zapytanie pomocnicze (subquery/osobne zapytanie per
klient w okresie), nie przechowuj tego jako flagi w bazie — licz na żywo przy każdym wyświetleniu
strony.

**Długi ogon klientów:** jeśli liczba unikalnych klientów w okresie przekracza sensowną liczbę do
pokazania w całości (orientacyjnie: więcej niż ok. 8-10, zwłaszcza w trybie Sezon) — pokaż tylko
najwyższych rangą klientów, a resztę zwiń w jeden wiersz zbiorczy „pozostali klienci (N)" z sumą ich
przychodu, liczby wynajmów i średniej — dokładnie jak w mockupie. Nie buduj na tym etapie paginacji ani
wyszukiwarki — to nadmiarowe dla obecnej skali biznesu; jeśli w przyszłości lista realnie urośnie,
wróćcie do tego.

---

## 13. Zakładka „Mapa cieplna"

Jeden widok kalendarza pokazujący **jednocześnie** wzorzec dni miesiąca (czytany w pionie, wiersz =
tydzień) i dni tygodnia (czytany w poziomie, kolumna = dzień tygodnia) — to nie dwa osobne wykresy,
tylko jedna siatka, którą da się czytać na oba sposoby. Pod spodem dodatkowo pasek sum per dzień
tygodnia (patrz niżej) — to już realne, osobne podsumowanie ułatwiające odczyt bez „uśredniania
wzrokiem" po wierszach siatki.

**Przełącznik metryki** (Przychód / Liczba wynajmów / Obłożenie) nad siatką — zmienia, co koduje kolor
komórki. **Obłożenie liczy się fundamentalnie inaczej niż pozostałe dwie** — patrz osobna podsekcja
13.1 poniżej, nie zgaduj na podstawie wzorca z Przychodu/Liczby wynajmów.
- Przychód: suma `totalNet` wydarzeń zaczynających się danego dnia (`startsAt`, ta sama reguła co
  wszędzie na tej stronie), z uwzględnieniem filtra urządzenia (sekcja 13.2).
- Liczba wynajmów: liczba wydarzeń zaczynających się danego dnia, z uwzględnieniem filtra urządzenia.
- Obłożenie: patrz sekcja 13.1.
- Domyślnie aktywna: Przychód.

### 13.1 Metryka „Obłożenie" — osobna logika liczenia

To metryka o innej naturze niż pozostałe dwie: nie chodzi o to, **kiedy zaczął się** wynajem, tylko o
to, **czy urządzenie było danego dnia fizycznie zajęte** — czyli cały zakres dat wynajmu
(`startsAt`…`endsAt` włącznie), nie tylko dzień rozpoczęcia. 3-dniowy wynajem zaczynający się w
poniedziałek zajmuje poniedziałek, wtorek i środę — wszystkie trzy dni mają tu znaczenie, w
przeciwieństwie do Przychodu/Liczby wynajmów, gdzie cały wynajem „należy" wyłącznie do poniedziałku
(sekcja 2). To świadoma, celowa niespójność między metrykami na tej samej stronie — nie próbuj tego
ujednolicać, obie logiki są poprawne dla tego, do czego służą.

```
dla każdego dnia D w wyświetlanym okresie:
  Y(D) = liczba urządzeń z aktywnego filtra (sekcja 13.2), które istnieją/są aktywne w systemie
         (nie licz historycznie względem D — patrz uproszczenie z sekcji 5, ten sam kompromis)
  X(D) = liczba urządzeń z Y(D), które mają jakikolwiek wynajem (eventType = WYNAJEM, wyklucz
         SZKOLENIE — obłożenie fizycznego zasobu, nie usługi) obejmujący dzień D
         (startsAt <= D <= endsAt)

  wyświetlana wartość komórki: "X(D)/Y(D)"
  kolor komórki: wg PROPORCJI X(D)/Y(D), nie surowej wartości X(D) — patrz uzasadnienie niżej
```

**Kolor wg proporcji, nie surowej liczby** — to różni się od skalowania w Przychodzie/Liczbie wynajmów
(sekcja 13, gdzie skala jest względna do maksimum w okresie, ale liczona na surowej wartości). Tu „2 z
2 urządzeń zajęte" (100% obłożenia) musi wyglądać inaczej niż „2 z 6 urządzeń zajęte" (33%), mimo tej
samej surowej liczby `2` — inaczej metryka nie miałaby sensu przy zmianie filtra. Wzór na poziom:
`poziom = clamp(ceil(X/Y * 5), 1, 5)` — te same 5 koszyków co w pozostałych metrykach, tylko inny
licznik proporcji.

**Uproszczony zapis komórki, gdy `Y = 1`** (filtr zawężony do jednego, konkretnego urządzenia): pokaż
po prostu wypełnioną/pustą komórkę (binarne zajęte/wolne), **nie** tekst „1/1" — przy jednym urządzeniu
ułamek nic nie wnosi, tylko zaśmieca komórkę (patrz mockup dla przypadku ogólnego z `Y=4`, gdzie ułamek
faktycznie niesie informację).

**Pasek sum per dzień tygodnia w trybie Obłożenie** — w przeciwieństwie do Przychodu/Liczby wynajmów
(gdzie to suma), tu pokaż **średnią proporcję %** dla danego dnia tygodnia w całym okresie (np.
„piątki: średnio 62% obłożenia"), nie sumę surowych liczb `X` — suma nie miałaby tu jasnej
interpretacji.

### 13.2 Filtr urządzeń — poziomy rząd checkboxów

**Nie dropdown — poziomy rząd checkboxów**, jeden na urządzenie, pogrupowany wizualnie wg
`Device.family` (etykieta rodziny nad/przy grupą, patrz mockup), wszystkie zaznaczone domyślnie
(= „wszystkie urządzenia"). Odznaczenie zawęża filtr do dowolnej kombinacji — nie tylko do gotowych
grup jak „cały LightSheer" czy pojedyncze urządzenie, użytkownik może zaznaczyć np. „DESIRE + Alma
Harmony" naraz, jeśli akurat to chce porównać. To bardziej elastyczne niż wcześniej rozważany dropdown
z gotowymi opcjami — nie buduj już tamtej wersji.

- Grupowanie wizualne (etykiety „LightSheer", „Inne" itd.) generuj dynamicznie z unikalnych wartości
  `Device.family` obecnych w bazie (to samo pole co poprzednio, ustawiane przez ADMINA na
  `/urzadzenia`) — nie zahardkoduj listy rodzin.
- Dodaj przycisk „zaznacz wszystkie" / „odznacz wszystkie" (przełącza się w zależności od aktualnego
  stanu — patrz mockup) dla wygody przy zawężaniu do jednego urządzenia (szybciej odznaczyć wszystko i
  zaznaczyć jedno, niż klikać siedem razy).
- Wybrany zestaw urządzeń wpływa na `Y` w sekcji 13.1 (liczba urządzeń w mianowniku — dokładnie tyle,
  ile checkboxów jest zaznaczonych) oraz na to, które wydarzenia wchodzą do sumy w trybach
  Przychód/Liczba wynajmów.
- Stan „nic niezaznaczone" (wszystkie checkboxy odznaczone) — pokaż pustą siatkę z komunikatem „Wybierz
  co najmniej jedno urządzenie", nie dziel przez zero w `Y=0`.

**Zakres siatki zależy od trybu okresu** (sekcja 1):
- Miesiąc: klasyczna siatka kalendarza miesięcznego (tygodnie jako wiersze, poniedziałek–niedziela
  jako kolumny, zgodnie z polskim standardem tygodnia). Dni spoza wybranego miesiąca (dopełnienie
  pierwszego/ostatniego tygodnia) pokaż wyblakłe, bez wartości — dokładnie jak w mockupie (`.pad`).
- Zakres / Sezon: **nie renderuj tej samej siatki dla kilkunastu miesięcy naraz** (nieczytelne) — dla
  tych trybów przełącz na ciągłą siatkę w stylu „GitHub contribution graph" (kolumny = kolejne
  tygodnie całego okresu idące w prawo, 7 wierszy = dni tygodnia, bez podziału na miesiące, bez
  numerów dni w komórce — tylko intensywność koloru). To świadoma różnica względem trybu Miesiąc, nie
  przeocz jej przy implementacji.

**Skala kolorów:** 5 poziomów intensywności (patrz mockup — od jasnoniebieskiego do ciemnoniebieskiego)
wyznaczonych względem **maksymalnej wartości dnia w aktualnie wyświetlanym okresie** (nie względem
jakiejś stałej, uniwersalnej skali) — czyli skala „oddycha" razem z okresem: pełny, najciemniejszy
kolor zawsze oznacza „najlepszy dzień w tym konkretnym widoku", nie jakiś globalny rekord. Podział na
5 koszyków: `poziom = clamp(ceil(wartość / max * 5), 1, 5)`. Dni z wartością `0` (brak wynajmów) —
najjaśniejszy odcień/tło, potraktuj jak poziom najniższy, nie jako brak koloru w ogóle (żeby siatka
nie miała „dziur").

**Pasek sum per dzień tygodnia** (pod siatką): 7 słupków (Pon–Nd), wysokość proporcjonalna do sumy
metryki w danym dniu tygodnia **w całym wybranym okresie** (nie per tydzień). Najwyższy słupek
podświetlony innym kolorem (patrz mockup, zielony) + krótki tekst „Najlepszy dzień tygodnia: **X**
(kwota)" nad słupkami.

---


## 14. Dodatek (osobny, mały): pola czasu dostawy/odbioru w widoku kierowcy

To **wyłącznie zbieranie danych**, fundament pod przyszły moduł kosztów bezpośrednich (koszt pracy
kierowcy) — **nie buduj tu żadnego wyliczania kosztu ani dashboardu kosztowego**, to osobny, przyszły
temat.

- Dodaj do `Rental` (lub `RentalFinance`, cokolwiek pasuje lepiej do istniejącej struktury) dwa
  opcjonalne pola: `deliveryDurationMinutes: Int?` i `pickupDurationMinutes: Int?` — czas w minutach,
  wpisywany ręcznie przez kierowcę.
- W widoku kierowcy (ten sam widok, w którym są liczniki impulsów, nakładka HS itd. — patrz moduł
  finansowy) dodaj dwa proste pola liczbowe: „Czas dostawy (min)" i „Czas odbioru (min)" — mogą zostać
  puste, to nie jest wymagane do zapisania reszty formularza.
- Uprawnienia: dołącz te dwa pola do whitelisty pól edytowalnych przez rolę KIEROWCA (ta sama whitelista
  co `capCountUsed`, `pulseCounterStart/End`, `driverNotes`, `cashCollected` — patrz moduł finansowy,
  sekcja 5).
- Nigdzie jeszcze nie wyświetlaj tego w dashboardzie przychodów ani żadnym innym raporcie — te dane po
  prostu się zbierają, czekając na przyszłą fazę „koszty".

---

## 15. Świadomie poza zakresem tej fazy

- Wszelkie koszty (ogólne, per urządzenie, z czasu pracy kierowcy) — osobna, przyszła faza z własnym
  modelem danych (`Cost`/`Expense`: kwota, data, kategoria, opcjonalnie `deviceId`).
- Segmentacja klientów poza „Nowy"/nie-nowy (np. klasy wartości, cross-sell po urządzeniach) — zakładka
  „Klienci" (sekcja 12) pokazuje podstawowe rozbicie, ale nie buduj na razie nic bardziej zaawansowanego
  niż to, co tam opisane.
- Konfigurowalne granice sezonu (dziś zawsze wrzesień–sierpień, na sztywno).
- Eksport danych (CSV/Excel) — nie proszono o to, nie dodawaj na wyrost.
- Marża/rentowność (wymaga kosztów, których jeszcze nie ma).
- Uwzględnianie `Device.active`/daty dodania urządzenia we wskaźniku wykorzystania (sekcja 5) — licz
  zawsze względem pełnego okresu.

---

## 16. Checklist przed review

1. Sprawdź dokładne nazwy pól soft-delete, nazwy urządzenia i pole `durationDays`/sposobu liczenia
   długości wynajmu w aktualnym `schema.prisma` przed napisaniem zapytań — nie zgaduj na podstawie tej
   specyfikacji.
2. Zapytania agregujące (sekcja 2) — przetestuj na danych z co najmniej dwóch miesięcy, żeby sprawdzić
   granice okresu (wydarzenie zaczynające się dokładnie o północy pierwszego/ostatniego dnia miesiąca).
3. Wskaźnik trendu (sekcja 4) — przetestuj przypadek „poprzedni okres = 0" dla każdej z trzech metryk
   osobno (nie może wywalić dzielenia przez zero ani pokazać `NaN`/`Infinity`).
4. Wskaźnik wykorzystania (sekcja 5) — przetestuj skrajny przypadek nakładających się/błędnych danych
   (wynik nie może przekroczyć 100%).
5. Insight best/worst (sekcja 6) — przetestuj przypadek 0 i 1 urządzenia z przychodem w okresie (boksy
   muszą się wtedy ukryć, nie pokazać to samo urządzenie dwa razy).
6. Komunikat o niepewnych cenach (sekcja 10) — przetestuj z 0, 1 i kilkoma wydarzeniami `PENDING`.
7. Uprawnienia — potwierdź, że STAFF i KIEROWCA nie widzą ani strony, ani pozycji w nawigacji, ani nie
   mogą uderzyć w endpoint API bezpośrednio.
8. Dodatek z sekcji 14: migracja pól czasu + rozszerzenie whitelisty KIEROWCY — osobny, mały test, że
   te pola faktycznie się zapisują i nic więcej się nie zepsuło w istniejącym widoku kierowcy.
9. Zakładka Klienci (sekcja 12) — przetestuj odznakę „Nowy" na kliencie z historią sprzed okresu (nie
   powinna się pojawić) i bez historii (powinna). Przetestuj zwijanie „pozostali klienci" przy większej
   liczbie unikalnych klientów niż próg z sekcji 12. Przetestuj insight best/worst — musi liczyć się po
   średniej wartości wynajmu, nie po przychodzie (inna kolejność niż w samej tabeli), i pomijać wiersze
   zbiorcze („pozostali klienci", „Bez przypisanego klienta").
10. Mapa cieplna (sekcja 13) — przetestuj przełączanie trybu Miesiąc→Sezon (siatka musi się przełączyć
    na format ciągły, nie próbować wyrenderować klasycznego kalendarza na 12 miesięcy naraz). Sprawdź,
    że skala kolorów przelicza się na nowo przy każdej zmianie okresu (nie zostaje z poprzedniego
    zakresu).
11. Metryka Obłożenie (sekcja 13.1) — przetestuj osobno od Przychodu/Liczby wynajmów: wynajem
    wielodniowy musi zaznaczać wszystkie dni swojego zakresu, nie tylko dzień startu. Sprawdź `Y=1`
    (pojedyncze urządzenie — zapis binarny, bez ułamka) i `Y>1` (grupa/wszystkie — zapis „X/Y").
    Sprawdź, że kolor komórki zmienia się przy zmianie filtra nawet dla tej samej surowej liczby `X`
    (bo liczy się proporcja, nie wartość bezwzględna).
12. Filtr urządzenia (sekcja 13.2) — sprawdź, że pole `Device.family` faktycznie grupuje poprawnie
    (np. wybór „Wszystkie LightSheer" faktycznie sumuje DESIRE+LIGHT+QUATTRO+ET400, nic więcej, nic
    mniej) i że dropdown aktualizuje się dynamicznie, jeśli ktoś doda nowe urządzenie z nową wartością
    `family`.
13. Przełączanie zakładek treści (Urządzenia/Klienci/Mapa cieplna) — potwierdź, że pasek KPI i
    komunikat o niepewnych cenach nie znikają/nie przeliczają się przy samym przełączeniu zakładki,
    tylko przy zmianie okresu (są wspólne dla wszystkich trzech).
