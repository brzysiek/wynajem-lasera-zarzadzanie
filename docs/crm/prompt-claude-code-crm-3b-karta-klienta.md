# Prompt dla Claude Code — karta klienta z zakładkami: wynajmy i faktury, komunikacja (CRM, prompt 3B)

## 0. Kontekst i cel

Karta klienta (`/klienci/[id]`, `src/components/clients/client-card.tsx`) pokazuje dziś wszystko na jednej
osi „Historia”: wynajmy, faktury (`ClientInvoice`), SMS-y. Faktury giną między SMS-ami, nie ma PDF ani
statusu płatności, a po podłączeniu Gmaila (prompt 3, sekcja 4) oś stanie się nieczytelna.

Cel: podzielić kartę na **4 zakładki** i dodać pełną **tabelę wynajmów i faktur ze statusem płatności**.
Zakładka „Komunikacja” jest od razu gotowa na e-maile z etapu B promptu 3 — do tego czasu pokazuje SMS-y,
rozmowy i notatki.

### Pliki wizualne (zapisz w repozytorium w `docs/crm/`)

| Plik | Co pokazuje |
| --- | --- |
| `mockup-karta-klienta.html` | Pełna karta `/klienci/[id]` — 4 zakładki wyrenderowane jedna pod drugą (żółty pasek = nazwa zakładki i adres `?tab=`) |
| `zrzuty/karta-1-przeglad.png` | Zakładka „Przegląd” — docelowy wygląd 1:1 |
| `zrzuty/karta-2-wynajmy-i-faktury.png` | Zakładka „Wynajmy i faktury” |
| `zrzuty/karta-3-komunikacja.png` | Zakładka „Komunikacja” z podglądem wątku e-mail |
| `zrzuty/karta-4-dane.png` | Zakładka „Dane” |
| `mockup-klienci.html` + `zrzuty/lista-klientow.png` | Lista `/klienci` z kartą w prawej kolumnie — **zaktualizowana**: nazwa klienta i przycisk „Pełna karta klienta →” prowadzą do `/klienci/[id]` |
| `mockup-sygnaly.html` + `zrzuty/sygnaly-na-dzis.png` | Tylko kontekst (moduł sygnałów) — nie buduj teraz |

Zrzuty PNG to obowiązujący wygląd (krój Jost, 1440 px). Pliki HTML pozwalają odczytać dokładne
odstępy, rozmiary i kolory. Zasady jak w poprzednich promptach: odwzoruj układ i hierarchię, kolory z
`shell-tokens.ts`, buduj z istniejących komponentów, nie kopiuj markupu 1:1. O logice decyduje ten
prompt, o wyglądzie makieta. Dane w makietach są przykładowe.

**Zanim zaczniesz:** przeczytaj `client-card.tsx`, `src/lib/clients/load.ts`, `summary.ts`,
`src/lib/history/*`, model `FakturowniaPayment` i `/finanse/faktury` (jak dziś liczony jest status
„zapłacona” i jak serwowany jest PDF — `GET /api/fakturownia/invoices/[id]/pdf`). Wykorzystaj to, nie
buduj drugiej logiki płatności.

---

## 1. Zmiany w danych (minimalne)

- `ClientInvoice`: dodaj `paymentTo DateTime?` (termin płatności z Fakturowni, pole `payment_to`) i
  `paymentType String?` (`transfer` / `cash` / …). Uzupełnij przy imporcie i w codziennym cronie; dla już
  zaimportowanych faktur — jednorazowy backfill z Fakturowni (53 faktury, bez limitów).
- Status płatności faktury liczony przy odczycie (czysta funkcja z testami, `src/lib/clients/payment-status.ts`):
  - `ZAPLACONA` — jest `FakturowniaPayment` dla `fakturowniaInvoiceId` (data z `paidAt`),
  - `GOTOWKA` — `paymentType = cash` albo wynajem z panelu z płatnością gotówką i `confirmedAt`,
  - `PO_TERMINIE` — brak zapłaty i `paymentTo < dziś` (liczba dni po terminie),
  - `OCZEKUJE` — brak zapłaty, termin w przyszłości,
  - dla wiersza bez faktury: `ZAPLANOWANY` (wynajem w przyszłości), `BEZ_FAKTURY` (historyczny z kalendarza
    albo wynajem bez VAT).

---

## 2. Zakładki

Pasek zakładek pod nagłówkiem karty. Aktywna zakładka w URL: `/klienci/[id]?tab=przeglad|transakcje|komunikacja|dane`
(link do konkretnej zakładki da się wysłać; domyślnie `przeglad`). Nagłówek karty (nazwa, status, osoba,
telefon, e-mail, miasto, NIP, „klient od”, przyciski Zadzwoń / SMS / E-mail / Nowa rezerwacja / Notatka)
jest wspólny dla wszystkich zakładek. Przy statusie dodatkowy czerwony chip „N faktur po terminie”, gdy są.

Liczniki przy zakładkach: „Wynajmy i faktury” — czerwony chip „N po terminie” (tylko gdy > 0);
„Komunikacja” — liczba pozycji.

Karta w prawej kolumnie na liście `/klienci` (drawer) zostaje **skrócona** do zawartości „Przeglądu” +
link „Pełna karta →” (`/klienci/[id]`).

### 2.0 Nawigacja lista → karta

- Na `/klienci` klik w wiersz otwiera kartę w prawej kolumnie (drawer) — jak dziś, ale jej treść to
  skrócony „Przegląd” (patrz niżej).
- W drawerze: **nazwa klienta jest linkiem** do `/klienci/[id]`, a pod danymi kontaktowymi jest przycisk
  **„Pełna karta klienta →”** (obrys w kolorze marki, `zrzuty/lista-klientow.png`).
- Ctrl/Cmd + klik w nazwę na liście otwiera pełną kartę w nowej karcie przeglądarki (zwykły `<a href>`).
- Na pełnej karcie „← Klienci” wraca do listy **z zachowanym filtrem, wyszukiwaniem i sortowaniem**
  (parametry w URL listy albo stan w `sessionStorage`).
- Linki do klienta z innych miejsc panelu (przychody, wynajem, sygnały, dopasowania) prowadzą do pełnej karty.

### 2.1 Przegląd

- 4 kafelki: Wynajmy (12 mies. / łącznie) · Przychód netto (12 mies., średnia na wynajem) · Ostatni
  wynajem (+ następny zaplanowany) · **Do zapłaty** (suma netto faktur `OCZEKUJE` + `PO_TERMINIE`, czerwony
  wariant, gdy jest cokolwiek po terminie).
- „Ostatnie zdarzenia” — 5 najnowszych pozycji ze wszystkich źródeł (wynajem, faktura, SMS, e-mail,
  rozmowa, notatka) + linki do pozostałych zakładek.
- Prawa kolumna: „Następny krok” (jak dziś), „Otwarte sygnały” (gdy moduł sygnałów istnieje), „W skrócie”:
  ulubione urządzenie z liczbą wynajmów, rytm wynajmów (mediana odstępu między wynajmami, gdy ≥ 3),
  ostatni kontakt (najnowsza pozycja komunikacji), typowa forma płatności.

### 2.2 Wynajmy i faktury

- 4 kafelki: Zafakturowano (bieżący rok, netto, liczba faktur) · Zapłacono · Po terminie (kwota, numer
  najstarszej, dni) · Wynajmy bez faktury (liczba, z informacją „sprzed 2026 (z kalendarza)”).
- Tabela — **jeden wiersz na wynajem**, z dołączoną fakturą; faktura bez wynajmu = osobny wiersz:
  Termin · Wynajem (urządzenie + szczegóły: dni, głowice, impulsy, transport) · Źródło (`panel` /
  `kalendarz` / `faktura`) · Netto · Nr faktury · Płatność (chip wg sekcji 1) · akcje.
  - Łączenie: `RentalFinance.fakturowniaInvoiceId` → faktura wynajmu z panelu; `ClientInvoice` bez
    `rentalId` → najbliższy wynajem z `Rental`/`RentalHistory` w ±7 dniach od `sellDate`, inaczej osobny wiersz.
  - Akcje: **PDF** (istniejący endpoint PDF, nowa karta), **Przypomnij** przy `PO_TERMINIE` — szkic
    maila w Gmailu z istniejącym mechanizmem przypomnienia (`remind-draft`), jak na `/finanse/faktury`.
    Klik w wiersz wynajmu z panelu → istniejący widok wynajmu.
  - Filtry: Wszystko · Niezapłacone · lata (od najnowszego). Sortowanie: termin malejąco, przyszłe na górze.
  - Wiersz `PO_TERMINIE` z lekkim czerwonym tłem.
  - Eksport CSV widocznych wierszy.
- Pod tabelą: „Wynajmy sprzed 2026 pochodzą z kalendarzy urządzeń. Faktury sprzed KSeF dołączymy później.”

### 2.3 Komunikacja

- Filtry: Wszystko · E-mail · SMS · Rozmowy · Notatki (z licznikami). Lista pogrupowana po miesiącach,
  najnowsze na górze.
- Źródła: `Message` (SMS/e-mail wysłane z panelu), `LeadActivity` (rozmowy, notatki — jeśli prompt 2
  już jest; jeśli nie — notatki z pola notatek klienta i zapisy rozmów, zgodnie z tym, co dziś istnieje),
  aktywności z HubSpota, a po etapie B promptu 3 — `EmailMessage` (wątki zwinięte do jednej pozycji z
  licznikiem wiadomości; oznaczenie ↓ od klienta / ↑ do klienta).
- Pasek „Dodaj notatkę albo zapisz rozmowę…” nad listą (zapis tam, gdzie dziś zapisują się notatki klienta).
- Prawa kolumna: podgląd zaznaczonej pozycji. Dla wątku e-mail — wiadomości wątku, pełna treść ostatnio
  otwartej **pobrana z Gmaila przy otwarciu** (zasady z promptu 3, sekcja 4.4), przyciski „Odpowiedz w
  Gmailu” (link do wątku) i „Zadanie z tego maila” (istniejący moduł Zadań, tytuł = temat, notatka =
  link do wątku, `clientId`).
- Dopóki etap B nie jest wdrożony: filtr „E-mail” pokazuje tylko e-maile wysłane z panelu i z HubSpota,
  a nad listą informacja „Skrzynka Gmail nie jest jeszcze podłączona”.

### 2.4 Dane

- Osoby kontaktowe: karta na osobę, **dwa numery telefonu** (np. „gabinet” i „prywatny” — etykieta
  wybierana z listy + własna) — to realizuje zadanie Ani „miejsce na drugi nr tel przy kontaktach”.
  Wymaga pola `phone2` + `phone2Label` na `ClientContact` (wyszukiwarka i SMS biorą oba numery; SMS
  domyślnie na pierwszy).
- Firma i adres: nazwa, NIP, **ulica, kod, miasto** jako osobne pola (już istnieją — tu tylko prezentacja),
  rodzaj gabinetu, źródło.
- Dane do wynajmu: transport, odległość, uwagi do dostawy, forma płatności, zainteresowania.
- Powiązania: link HubSpot, tagi z HubSpota, kontrahent w Fakturowni (po NIP), aliasy z kalendarza
  (`ClientAlias`) z możliwością usunięcia błędnego aliasu.

---

## 3. Uprawnienia

Bez zmian: `ADMIN`/`STAFF`. `KIEROWCA` — brak dostępu do karty klienta, kwot, faktur i komunikacji
(403 na wszystkich nowych endpointach).

---

## 4. Kryteria odbioru

1. `/klienci/[id]?tab=transakcje` pokazuje wszystkie wynajmy (panel + kalendarz) i faktury klienta; suma
   „Zafakturowano” zgadza się z sumą netto `ClientInvoice` klienta w danym roku.
2. Faktura z wpisem w `FakturowniaPayment` ma status „Zapłacona <data>”; bez wpisu i po terminie —
   „Po terminie N dni” + przycisk „Przypomnij”; PDF otwiera się z Fakturowni.
3. Faktura wynajmu z panelu nie pojawia się dwa razy (raz z wynajmem, raz osobno).
4. Zakładka w URL działa po odświeżeniu i przy wysłaniu linku.
5. Drawer na liście `/klienci` pokazuje skrócony przegląd; nazwa i przycisk „Pełna karta klienta →” prowadzą do `/klienci/[id]`, a „← Klienci” wraca z zachowanym filtrem.
5a. Wygląd zakładek zgadza się ze zrzutami w `docs/crm/zrzuty/` (porównaj zrzutem ekranu przy 1440 px).
6. Drugi numer telefonu jest wyszukiwany na liście klientów.
7. `npm run lint`, `npm test`, build przechodzą.
