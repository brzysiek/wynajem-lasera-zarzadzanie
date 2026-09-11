# Prompt dla Claude Code — nowa powłoka aplikacji (nawigacja + paleta marki)

## 0. Kontekst i cel

**Hierarchia źródeł prawdy:** towarzyszy temu plikowi `mockup-powloka-aplikacji.html` — to jest
nadrzędne źródło prawdy dla wyglądu. Ten plik `.md` jest źródłem prawdy dla struktury, zachowania i
zakresu zmiany.

To jest **zmiana fundamentalna, dotykająca każdej strony aplikacji** — nie jest to kolejna funkcja
biznesowa, tylko przebudowa wspólnego layoutu (powłoki), w którym żyją wszystkie dotychczasowe i
przyszłe strony. Zrób to jako osobny krok, przed/niezależnie od dalszej pracy nad konkretnymi
funkcjami — reszta pracy (moduł finansowy, Zadania, dashboardy) zakłada, że będzie żyła wewnątrz tej
nowej powłoki, ale **logika i dane tamtych funkcji się nie zmieniają**, zmienia się tylko to, co je
otacza.

### 0.1 Zakres tej zmiany — co wchodzi, co świadomie zostaje na później

**Wchodzi teraz:**
- Nowy układ nawigacji: lewy panel (zwijany) + prawy pasek ikon (trwały, z wysuwanymi panelami).
- Nowa paleta kolorów i krój pisma (rebranding) — **ale tylko dla elementów powłoki**: topbar, sidebar,
  pasek ikon, wysuwane panele. Patrz sekcja 3 po dokładny zakres.

**Świadomie NIE wchodzi teraz** (osobny, przyszły krok — nie zgaduj, nie rozszerzaj zakresu):
- Przekolorowanie zawartości istniejących stron (Kalendarz, Finanse/Przychody, Finanse/Koszty, widok
  kierowcy, panel Zadań) na nową paletę — te strony **zachowują dzisiejszą kolorystykę** (niebieski
  `#2F6FD1` i pochodne) wewnątrz swojej treści, dopóki nie dostaniesz osobnego zlecenia na ich
  przemalowanie. Zmienia się tylko rama wokół nich (sidebar, topbar, pasek ikon).
- Zachowanie na urządzeniach mobilnych (aplikacja ma PWA na iPhone'a) — ten mockup i ta specyfikacja
  dotyczą wyłącznie układu desktopowego. Zachowanie lewego panelu/paska ikon na wąskim ekranie to
  osobny temat do ustalenia, zanim zaczniesz to implementować — zapytaj, zanim zgadniesz (np. czy lewy
  panel ma się chować całkowicie na mobile, czy zamieniać w dolne menu itp.).

---

## 1. Struktura powłoki

Trzy poziome pasy: **topbar** (góra, na całą szerokość) + **treść trzykolumnowa** poniżej (lewy panel /
główna treść / prawy pasek ikon).

### 1.1 Topbar

Wysokość ~56px, biały, dolna krawędź `1px solid var(--border)`. Od lewej: przycisk-hamburger (otwiera/
zamyka lewy panel, patrz 1.2) + logo aplikacji. Od prawej: nazwa zalogowanego użytkownika + przycisk
„Wyloguj" — **bez zmian względem tego, co jest dziś** (patrz istniejący topbar w repo), tylko usuń z
niego dotychczasowe poziome pozycje nawigacji (Kalendarz/Nadchodzące/Urządzenia/Wysyłka SMS/
Ustawienia) — te przenoszą się do lewego panelu (sekcja 2) — i usuń dotychczasową samodzielną ikonę
Zadań z topbaru — ta przenosi się do prawego paska ikon (sekcja 4).

**Logo**: w mockupie wczytane bezpośrednio z publicznego URL-a strony WWW (`wynajemlasera.pl`) — **w
produkcji zamień na lokalny plik statyczny w repo** (np. `public/logo.png` czy odpowiednik), żeby panel
administracyjny nie zależał od dostępności zewnętrznej strony. Poproś o plik graficzny, jeśli nie ma go
jeszcze w repo — nie zgaduj, nie zostawiaj zahardkodowanego zewnętrznego linku w kodzie docelowym.

### 1.2 Lewy panel nawigacyjny (zwijany)

Domyślnie rozwinięty (szerokość ~220px): ikona + etykieta tekstowa per pozycja. Po kliknięciu
hamburgera zwija się do ~64px (same ikony, etykiety znikają — `display:none`, nie tylko wizualnie
ukryte, żeby nie zostawiać w DOM tekstu, który i tak nie ma się pojawić). Animacja szerokości płynna
(`transition`), patrz mockup.

Stan zwinięcia/rozwinięcia: zapamiętaj w `localStorage` (czysto kosmetyczne ustawienie UI, nie dane
biznesowe) — użytkownik nie powinien musieć rozwijać panelu na nowo przy każdym przeładowaniu strony.

**Pozycje nawigacji** (patrz sekcja 2 po dokładną listę i wyjątek dla „Finanse").

### 1.3 Główna treść

Zajmuje pozostałą przestrzeń między lewym panelem a prawym paskiem ikon. To tutaj żyje dotychczasowa
zawartość każdej strony (Kalendarz, Nadchodzące, Urządzenia, Wysyłka SMS, Ustawienia, Finanse/*) —
**bez zmian w tej zawartości**, patrz sekcja 0.1.

### 1.4 Prawy pasek ikon (trwały, nie zwija się)

Stała szerokość ~56px, biały, lewa krawędź `1px solid var(--border)`. **To nie jest to samo co lewy
panel** — nie ma stanu zwiniętego/rozwiniętego, zawsze pokazuje tylko ikony. Kliknięcie ikony otwiera/
zamyka wysuwany panel (slide-out) z prawej strony, nad główną treścią (patrz mockup, `.slideout`) —
panel wysuwa się z szerokości 0 do ~340px, z animacją, nie przesuwa reszty layoutu (pozycja
`absolute`/nakładka, nie `flex` uczestniczący w układzie — patrz dokładnie mechanikę w mockupie, klasy
`.slideout`).

Patrz sekcja 4 po dokładną listę ikon i ich zachowanie.

---

## 2. Migracja pozycji nawigacji z topbaru do lewego panelu

| Dzisiejsza pozycja (topbar) | Nowe miejsce |
|---|---|
| Kalendarz | Lewy panel, pozycja 1 |
| Nadchodzące | Lewy panel, pozycja 2 |
| Urządzenia | Lewy panel, pozycja 3 |
| Wysyłka SMS | Lewy panel, pozycja 4 |
| Ustawienia | Lewy panel, ostatnia pozycja (pod separatorem, patrz mockup `.sidebar-divider`) |
| *(nowe)* Finanse | Lewy panel, między Wysyłka SMS a separatorem — patrz 2.1, wyjątkowe zachowanie |

Każda pozycja: ikona SVG (patrz mockup po dokładne ścieżki — spójny zestaw liniowy, grubość konturu
1.6px, `stroke="currentColor"`, żeby automatycznie dziedziczyły kolor stanu aktywne/nieaktywne) +
etykieta tekstowa. Stan aktywny (bieżąca strona) — tło `var(--brand-soft)`, tekst i ikona
`var(--brand)` (patrz sekcja 3 po wartości tokenów).

**Ustawienia zachowuje dzisiejszą wewnętrzną strukturę zakładek** (Integracje / Przypomnienia SMS /
Szablony SMS / Cennik / Pojazdy / Kategorie kosztów / Użytkownicy — ta ostatnia para to nowsze strony z
poprzednich faz) — to osobna strona z własnym paskiem zakładek *wewnątrz* niej, tak jak dziś. Nie
zagnieżdżaj tych zakładek w lewym panelu — to by go niepotrzebnie rozdęło.

### 2.1 Wyjątek: „Finanse" jako jedyna pozycja z rozwiniętym podmenu w samym panelu

W przeciwieństwie do Ustawień, **Finanse dostaje rozwinięte podmenu bezpośrednio w lewym panelu**
(patrz mockup): kliknięcie „Finanse" rozwija pod spodem trzy pod-pozycje — **Przychody**, **Koszty**,
**Wpisy kosztów** — bez przechodzenia na osobną stronę pośrednią. To świadoma asymetria względem
Ustawień: Finanse to miejsce, do którego wraca się często (monitoring), więc zasługuje na
jedno-kliknięciowy dostęp do każdej z trzech podstron, podczas gdy zakładki Ustawień to rzadziej
dotykana konfiguracja, dla której wystarczy własny pasek zakładek na stronie docelowej.

Gdy panel jest **zwinięty** (sekcja 1.2), podmenu Finansów znika razem z etykietami (patrz mockup,
`.sidebar.collapsed .sub-nav{ display:none }`) — kliknięcie samej ikony „Finanse" w stanie zwiniętym
powinno przenieść na ostatnio odwiedzaną pod-stronę Finansów (albo domyślnie na Przychody, jeśli brak
historii) — nie da się pokazać podmenu przy zwiniętym panelu, więc potrzebny jest sensowny fallback
nawigacyjny.

---

## 3. Paleta kolorów i krój pisma — rebranding, tylko dla powłoki (patrz 0.1)

Źródło: zaktualizowana strona WWW WynajemLasera.pl (materiał referencyjny dostarczony przez klienta).
**Świadomie nie kopiujemy** stylu strony marketingowej (kursywy w nagłówkach, duże, cienkie fonty,
luźne odstępy) — to by pogorszyło czytelność gęstego, operacyjnego panelu. Przenosimy **kolory i krój
pisma**, nie cały język wizualny strony WWW.

```css
--brand: #1B6FA8;        /* nawigacja, aktywne stany, główny akcent */
--brand-soft: #EAF4FB;   /* tło aktywnej pozycji nawigacji, subtelne podświetlenia */
--brand-deep: #14567F;   /* ciemniejszy wariant, np. tekst na jasnym tle brand-soft */
--accent: #E08A5C;       /* akcent/CTA — użyj oszczędnie, patrz niżej gdzie */
--accent-soft: #FBF0E7;
--bg: #F2F4F6;
--surface: #FFFFFF;
--border: #E9EDF1;
--text: #4A4A4A;
--text-muted: #6F7378;
--text-faint: #9AA1A8;
```

Font: **Jost** (Google Fonts), wagi 300/400/500/600 + kursywa 400 (dostępna, ale — patrz wyżej —
świadomie nieużywana w tej fazie w interfejsie funkcjonalnym). Dołącz przez standardowy link do Google
Fonts (patrz `<head>` w mockupie) — to zewnętrzne, publiczne CDN, nie wymaga hostowania fontu we
własnym repo, ale jeśli wolicie hostować lokalnie (niezależność od Google Fonts CDN), to też
akceptowalne — zdecyduj wg tego, jak reszta repo dziś ładuje fonty (sprawdź, nie zgaduj).

**Gdzie stosować `--accent` (terakota)**: w tej fazie **tylko** w drobnych akcentach powłoki — plakietka
liczby na ikonie Zadań (`.rail-badge`, patrz mockup). Nie rozlewaj koloru akcentu szerzej (np. na
przyciski wewnątrz istniejących stron) — to już wykracza poza zakres tej zmiany (sekcja 0.1).

**Wyjątek: panel Zadań zachowuje własny, niezależny kolor.** Zawartość wysuwanego panelu Zadań (patrz
sekcja 4.1) używa koloru `#1A73E8` (niebieski Google) na checkboxach, chipach terminu itd. — to
**świadoma, wcześniejsza decyzja projektowa** („maksymalnie zbliżone do Google Tasks", ustalona przed
tą zmianą) i zostaje bez zmian. Nie przemalowuj wnętrza panelu Zadań na `--brand` — dotyczy to
wyłącznie ramy wokół niego (sam pasek ikon, tło ikony w stanie spoczynku/hover).

---

## 4. Prawy pasek ikon — zawartość

### 4.1 Ikona „Zadania" (istnieje już, zmienia się tylko miejsce)

Przenosi się z dzisiejszego topbaru na pasek ikon — **ta sama zawartość panelu, ten sam SVG ikony, ta
sama logika** (patrz istniejąca specyfikacja `prompt-claude-code-zadania.md`, jeśli wdrożona) —
zmienia się wyłącznie punkt wywołania (ikona na trwałym pasku zamiast w topbarze) i mechanika otwierania
(slide-out z prawej, patrz 1.4, zamiast dotychczasowego zachowania, jeśli było inne). Plakietka liczby
nieukończonych zadań (kolor `--accent`, patrz sekcja 3) zostaje.

### 4.2 Ikona „Powiadomienia" — miejsce zarezerwowane, nie projektuj logiki

Druga ikona na pasku, **wyszarzona, nieaktywna** (`cursor:default`, brak akcji po kliknięciu), z
tooltipem „Powiadomienia — wkrótce" (patrz mockup, klasa `.disabled`). To **wyłącznie przygotowanie
miejsca w UI** na przyszłą funkcję, o której padła luźna wzmianka w rozmowie z klientem, ale która nie
została zaprojektowana — **nie projektuj logiki powiadomień, nie zgaduj, jakie miałyby być typy
powiadomień ani skąd miałyby pochodzić dane.** Jeśli klient zdecyduje się rozwinąć tę funkcję, to osobne
zlecenie z własną specyfikacją.

### 4.3 Kolejne ikony w przyszłości

Pasek jest zaprojektowany jako rozszerzalny — kolejne funkcje (jeśli powstaną) dostają kolejną ikonę w
tym samym pasku, tym samym wzorcem interakcji (klik → slide-out panel). Nie buduj tego teraz, tylko
miej na uwadze przy nazewnictwie komponentów, żeby dodanie kolejnej ikony nie wymagało przepisywania
całego paska (np. komponent pojedynczej ikony + slide-outu powinien być reużywalny, nie zaszyty
na sztywno pod Zadania).

---

## 5. Checklist przed review

1. Sprawdź istniejący layout/komponent nadrzędny (prawdopodobnie coś w stylu `app-shell.tsx` czy
   podobnie — sprawdź faktyczną strukturę w repo) przed rozpoczęciem — to prawdopodobnie jeden,
   centralny plik używany przez wszystkie strony; zmiana w nim dotyka całej aplikacji naraz, testuj
   ostrożnie.
2. Migracja pozycji nawigacji (sekcja 2) — potwierdź, że wszystkie dotychczasowe strony (Kalendarz,
   Nadchodzące, Urządzenia, Wysyłka SMS, Ustawienia) nadal działają identycznie pod nowymi punktami
   wejścia, tylko przeniesionymi z topbaru do sidebaru.
3. Stan zwinięcia lewego panelu (sekcja 1.2) — zapisywany i odczytywany z `localStorage`, przetrwa
   odświeżenie strony.
4. Podmenu „Finanse" (sekcja 2.1) — przetestuj zachowanie przy zwiniętym panelu (fallback nawigacyjny,
   nie zgubiona funkcjonalność).
5. Panel Zadań (sekcja 4.1) — potwierdź, że cała dotychczasowa funkcjonalność (dodawanie, checkboxy,
   terminy, kafelek odpowiedzialnego) działa identycznie po przeniesieniu na pasek ikon — to czysto
   kosmetyczna zmiana miejsca, żadna logika się nie zmienia.
6. Kolorystyka (sekcja 3) — potwierdź, że **tylko** elementy powłoki (topbar, sidebar, pasek ikon,
   rama slide-outu) dostały nową paletę, a zawartość istniejących stron (w tym wnętrze panelu Zadań)
   zachowała dotychczasowe kolory — to świadomie rozdzielone zakresy (sekcja 0.1), nie przypadkowe
   niedopatrzenie.
7. Logo (sekcja 1.1) — potwierdź, że w commitowanym kodzie nie zostaje zahardkodowany zewnętrzny URL do
   `wynajemlasera.pl` (to było tylko dla wygody podglądu w mockupie) — użyj lokalnego assetu z repo.
8. Zapytaj o zachowanie mobilne (sekcja 0.1) zamiast zgadywać, jeśli zadanie obejmuje też widoki na
   telefonie — to świadomie poza zakresem tej specyfikacji.
