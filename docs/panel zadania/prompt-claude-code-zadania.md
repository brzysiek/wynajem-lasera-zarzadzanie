# Prompt dla Claude Code — redesign i rozszerzenie funkcji „Zadania" (panel.wynajemlasera.pl)

## 0. Kontekst i cel

W panelu istnieje już wstępna wersja funkcji „Zadania" — ikona w prawym górnym rogu paska nawigacji
(dziś teczka z czerwoną plakietką liczby), wysuwany panel z listy po prawej stronie, formularz dodania
zadania (tytuł, szczegóły, data, select „Odpowiedzialny…"), lista zadań z tekstem w stylu
„Tomek · zlecił: Tomek". To rozszerzenie i redesign tej **istniejącej** funkcji, nie budowa od zera.

**Zanim zaczniesz kodować**: znajdź i przeczytaj istniejący model zadań w `schema.prisma`, istniejący
komponent panelu zadań i istniejące API routes. Nazwy pól/modeli poniżej to **docelowy kształt**, nie
zakładaj, że dokładnie tak nazywa się to dziś w repo — dopasuj migrację do tego, co faktycznie znajdziesz,
zamiast nadpisywać na ślepo. Jeśli dzisiejsza struktura danych fundamentalnie nie pozwala na coś z tej
specyfikacji (np. zadanie nie ma dziś żadnego pola „kto zlecił") — zatrzymaj się i zapytaj.

Cel wizualny: **maksymalnie zbliżone do Google Tasks** (to świadome, wprost wyrażone życzenie właściciela
produktu — nie odchodź od tego stylu w stronę czegoś bardziej „oryginalnego") — biel, niebieski akcent,
okrągłe checkboxy, chipy terminu, zwinięta sekcja „Ukończone". W jednym miejscu celowo odchodzimy od
czystego Google Tasks: **kafelek osoby odpowiedzialnej** (sekcja 3) — Google Tasks nie ma multi-user
assignee w tej formie, tu jest to potrzebne i ważniejsze niż wierność wzorcowi.

---

## 1. Model danych

### 1.1 Rozszerzenie `User`

```
enum GrammaticalGender {
  M
  F
}

model User {
  // ...istniejące pola bez zmian...
  grammaticalGender GrammaticalGender?
}
```

Potrzebne do poprawnej odmiany czasownika „zlecił"/„zleciła" (polska gramatyka — forma zależy od płci
**zlecającego**, nie odbiorcy zadania). Pole ustawiane przez ADMINA przy tworzeniu/edycji konta na
`/ustawienia/uzytkownicy` — dodaj tam prosty select (Mężczyzna/Kobieta) do istniejącego formularza
edycji użytkownika. Dla istniejących kont po migracji pole będzie `null` — dodaj krótkie
przypomnienie/banner w `/ustawienia/uzytkownicy`, jeśli jakikolwiek użytkownik ma `grammaticalGender =
null` („Uzupełnij płeć gramatyczną — potrzebna do poprawnych komunikatów w Zadaniach"). Do czasu
uzupełnienia: użyj formy „zlecił" jako bezpiecznego fallbacku (nie blokuj wyświetlania).

### 1.2 Model `Task` (dostosuj do istniejącego, jeśli już istnieje pod inną nazwą/kształtem)

```
enum TaskStatus {
  TODO
  DONE
}

model Task {
  id           String     @id @default(cuid())
  title        String
  details      String?    @db.Text
  dueDate      DateTime?  // tylko data, bez godziny — analogicznie do Rental (całodniowe daty)
  status       TaskStatus @default(TODO)
  completedAt  DateTime?

  assigneeId   String     // osoba odpowiedzialna (wykonawca)
  assignee     User       @relation("TaskAssignee", fields: [assigneeId], references: [id])

  createdById  String     // osoba zlecająca
  createdBy    User       @relation("TaskCreatedBy", fields: [createdById], references: [id])

  createdAt    DateTime   @default(now())
  updatedAt    DateTime   @updatedAt
}
```

Migracja zgodnie z konwencją repo: `prisma migrate diff --from-migrations ... --to-schema-datamodel ...`
bez lokalnej bazy, aplikowana przez `deploy/migrate.mjs` (nie `prisma migrate deploy`) — patrz istniejący
`README.md`/wcześniejsze migracje w projekcie dla dokładnej składni.

---

## 2. Logika: odmiana „zlecił"/„zleciła" i wyświetlanie zlecającego

```
function verbZlecil(gender: GrammaticalGender | null): string {
  if (gender === "F") return "zleciła";
  return "zlecił"; // fallback też dla null, żeby nic się nie wyświetlało pusto
}
```

**Zasady wyświetlania linii pod tytułem zadania:**

- Jeśli `assigneeId !== createdById` → pokaż zwykłym, wyciszonym tekstem (mniejsza czcionka, kolor
  drugorzędny, **bez pogrubienia**): `zlecił(a): {createdBy.name}` — forma czasownika wg
  `createdBy.grammaticalGender` (funkcja wyżej).
- Jeśli `assigneeId === createdById` (zadanie samemu sobie) → **pomiń całkowicie** tę linię, nie
  pokazuj „zlecił: Tomek" — to nadmiarowa informacja, skoro ta sama osoba już jest w kafelku
  odpowiedzialnego (sekcja 3). To założenie robocze — jeśli po wdrożeniu okaże się nieintuicyjne,
  łatwo odwrócić.

---

## 3. Kafelek osoby odpowiedzialnej (nowy element, kluczowa zmiana względem dzisiejszego tekstu)

Dziś odpowiedzialny i zlecający są zwykłym tekstem obok siebie („Tomek · zlecił: Tomek") — nieczytelne,
bo nic nie odróżnia wizualnie, które imię pełni którą rolę. Zamiast tego:

- **Osoba odpowiedzialna** dostaje osobny, samodzielny element — pigułkę (pill): mały kolorowy awatar
  (koło ~18–20px, jednolity kolor tła, biały inicjał imienia, pogrubiony) + imię, na neutralnym,
  jasnym tle pigułki (nie kolorowym — kolor żyje wyłącznie w awatarze).
  - **Ważne rozgraniczenie znaczenia koloru**: kolor awatara koduje **tożsamość osoby**, kolor chipa
    terminu (sekcja 4) koduje **pilność** (dziś/jutro/po terminie). Te dwie palety muszą się wizualnie
    różnić — nie używaj czerwieni ani żółci w awatarach osób, żeby nie kolidowało znaczeniowo z chipem
    „po terminie"/„jutro".
  - Kolor awatara: deterministyczny hash z `userId` na stałą paletę (żeby dana osoba miała zawsze ten
    sam kolor wszędzie w aplikacji, bez ręcznego przypisywania). Zaproponowana paleta (unika czerwieni/
    żółci): `#1A73E8` (niebieski), `#7C3AED` (fiolet), `#0D9488` (teal), `#EA580C` (pomarańcz),
    `#DB2777` (róż), `#4B5563` (grafit) — jako fallback przy większej liczbie użytkowników niż kolorów
    w palecie.
- **Zlecający** zostaje zwykłym tekstem obok/pod kafelkiem (patrz sekcja 2) — celowo drugoplanowy,
  mniejszy, bez awatara. To kontekst, nie główny bohater wiersza zadania.

Przykład docelowego wiersza (opisowo, nie dosłowny markup):

```
☐ Uzupełnić cennik urządzeń na sezon 2026/27
  [🟣A Anna]  ·  zlecił: Tomek
```

---

## 4. Chip terminu — logika kolorów i zachowania

- **Brak terminu jest stanem domyślnym i prawidłowym** — jeśli `dueDate === null`, nie pokazuj żadnego
  chipa, żadnego myślnika, żadnego placeholdera. Pusta przestrzeń to nie błąd.
- Gdy `dueDate` ustawione, chip w jednym z trzech kolorów wg porównania z dzisiejszą datą
  (strefa `Europe/Warsaw`, tak jak reszta aplikacji liczy daty):
  - `dueDate` = dziś → chip niebieski (`#E8F0FE` tło / `#1A73E8` tekst), etykieta „Dziś".
  - `dueDate` = jutro → chip żółty (`#FEF7E0` tło / `#B06000` tekst), etykieta „Jutro".
  - `dueDate` < dziś (przeterminowane, status wciąż `TODO`) → chip czerwony (`#FCE8E6` tło / `#D93025`
    tekst), etykieta z faktyczną datą lub „Wczoraj" jeśli dokładnie dzień wcześniej.
  - `dueDate` > jutro → neutralny szary chip z datą (np. „12 wrz"), bez sygnalizacji pilności.
  - Zadanie ze statusem `DONE` — nie pokazuj już koloru pilności (przeterminowane ukończone zadanie nie
    powinno wyglądać alarmująco) — chip neutralny lub żaden, tekst przekreślony wystarcza.

### Wybór terminu — popover przy dodawaniu/edycji zadania

Klik w chip/przycisk „Termin" otwiera mały popover:

1. **Dzisiaj** — jeden klik, ustawia `dueDate` na dziś.
2. **Jutro** — jeden klik, ustawia `dueDate` na jutro.
3. **Wybierz datę…** — otwiera standardowy date-picker (użyj tego samego komponentu, którego już
   używacie gdzie indziej w panelu do wyboru dat, np. przy tworzeniu wynajmu — nie wprowadzaj nowej
   biblioteki tylko dla tego).
4. **Usuń termin** — widoczne **tylko** gdy `dueDate` jest już ustawione na edytowanym zadaniu; ustawia
   `dueDate = null`.

---

## 5. Ikona w pasku nawigacji i plakietka

- Zmień ikonę z dzisiejszej (teczka) na ikonę w stylu checklisty/schowka z checkmarkiem (SVG, prosty
  kontur, jeden kolor — spójna z resztą ikon w topbarze) — czytelniej sygnalizuje „zadania".
- Plakietka liczby: **liczba zadań ze statusem `TODO` przypisanych do zalogowanego użytkownika**
  (`assigneeId === session.user.id`), nie wszystkich zadań w systemie — to ma być osobisty licznik „ile
  mam do zrobienia", tak jak w Google Tasks/Gmail.

---

## 6. Panel — struktura i zachowanie

- Nagłówek: „Zadania", ikona odświeżenia, ikona zamknięcia (`✕`) — jak dziś.
- Rząd „+ Dodaj zadanie" na górze listy — klik rozwija formularz (tytuł, szczegóły, chip „Termin" z
  popoverem z sekcji 4, select „Odpowiedzialny"), przyciski Anuluj/Dodaj. Zachowaj dzisiejszy sposób
  wywoływania formularza (osobny panel/modal), tylko przestyluj zgodnie z tokenami w sekcji 8.
- Lista zadań `TODO`, posortowana: przeterminowane i dzisiejsze na górze, potem wg rosnącej daty
  terminu, zadania bez terminu na końcu listy.
- Klik w checkbox → natychmiastowa zmiana wizualna (przekreślenie, wyszarzenie) + zapis `status = DONE`,
  `completedAt = now()` — zadanie znika z głównej listy i trafia do sekcji „Ukończone".
- Sekcja „Ukończone (n)" — zwinięta domyślnie (`<details>` lub odpowiednik), licznik w nagłówku,
  ukończone zadania posortowane od najnowszych. Bez automatycznego czyszczenia/archiwizacji na tym
  etapie — zostają widoczne, dopóki ktoś ich nie usunie ręcznie.
- Hover na wierszu zadania (desktop) odsłania ikonę usunięcia — zachowaj, jeśli już tak działa.

---

## 7. Design tokeny (kolory, kształt) — dostosuj do istniejących zmiennych Tailwind, jeśli już masz
zbliżone; jeśli nie, wprowadź:

- Tło panelu: `#FFFFFF`, obramowanie: `#E8EAED`, promień: `10px`.
- Tekst główny: `#202124`, tekst drugorzędny (metadane, „zlecił"): `#5F6368`, tekst wyciszony
  (placeholdery, zadania bez terminu w polu tytułu): `#9AA0A6`.
- Akcent (checkboxy zaznaczone, przycisk „Dodaj", chip „Dziś", stan focus): `#1A73E8` /
  tło-pastel `#E8F0FE`.
- Checkbox: koło `20px`, obramowanie `2px solid #DADCE0` gdy niezaznaczone; wypełnione `#1A73E8` z
  białym znacznikiem gdy zaznaczone.
- Chipy terminu: pełne zaokrąglenie (pill), padding ok. `3px 9px`, czcionka ok. `11.5px` waga 600.
- Kafelek odpowiedzialnego: pill, tło `#F8F9FA`, obramowanie `1px solid #E8EAED`, awatar wg palety z
  sekcji 3.
- Font: systemowy stack już używany w aplikacji — nie wprowadzaj nowego fontu.

---

## 8. Uprawnienia — otwarte, nie zgaduj

Nie wiem, czy ta funkcja ma być dostępna dla roli KIEROWCA, czy tylko ADMIN/STAFF — dzisiejsze zrzuty
ekranu pokazują to wyłącznie z konta ADMIN. Sprawdź, czy dzisiejsza implementacja już to jakoś
ogranicza (np. przez `requireStaffSession()`), i jeśli nie ma jasnej odpowiedzi w kodzie — zapytaj,
zanim zdecydujesz się rozszerzyć lub zawęzić dostęp.

Podobnie: nie wiem, czy lista zadań w panelu ma pokazywać **wszystkie** zadania zespołu, czy tylko te
przypisane do zalogowanej osoby (plakietka w sekcji 5 zawsze liczy „moje", ale to nie przesądza, co
widać po otwarciu panelu). Jeśli dzisiejsza implementacja już to rozstrzyga — zostaw jak jest i tylko
przestyluj; jeśli nie — zapytaj, zanim zmienisz zakres widoczności.

---

## 9. Świadomie pozostawione poza zakresem tej iteracji

- Powiadomienia (SMS/mail) przy zbliżającym się lub mijającym terminie — dziś tylko wizualne
  oznaczenie kolorem w panelu. Osobny temat, jeśli okaże się potrzebny.
- Wiele osób odpowiedzialnych za jedno zadanie — model zakłada dokładnie jedną (`assigneeId`,
  pojedyncza relacja), zgodnie z dzisiejszym selectem „Odpowiedzialny…" (pojedynczy wybór).
- Archiwizacja/auto-usuwanie starych ukończonych zadań.
- Ręczna zmiana koloru awatara przez użytkownika — dziś w pełni deterministyczna z hasha, bez edycji.

---

## 10. Checklist przed review

1. Przeczytaj istniejący model zadań, komponent panelu i API routes — dopasuj migrację do
   rzeczywistości repo, nie do zgadywanych nazw z tej specyfikacji.
2. Migracja: `User.grammaticalGender`, model `Task` (lub dopasowanie istniejącego) — wygenerowana
   zgodnie z konwencją repo, zastosowana przez `deploy/migrate.mjs`.
3. Logika odmiany czasownika (sekcja 2) i logika kolorów chipa terminu (sekcja 4) — proste, czyste
   funkcje, warto pokryć testem jednostkowym (kilka przypadków: dziś/jutro/przeterminowane/brak daty/
   płeć M, F, null).
4. UI: ikona (sekcja 5), panel i lista (sekcja 6), kafelek odpowiedzialnego (sekcja 3), tokeny wizualne
   (sekcja 7).
5. Rozstrzygnij i wdroż uprawnienia (sekcja 8) — po konsultacji, jeśli kod dziś tego nie przesądza.
6. Test ręczny: zadanie z terminem dziś/jutro/przeterminowane, zadanie bez terminu, zadanie zlecone
   samemu sobie (linia „zlecił" znika), zadanie zlecone przez kobietę (poprawna forma „zleciła").
