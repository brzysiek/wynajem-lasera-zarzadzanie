# Webhook formularzy WWW — umowa z panelem i ponawianie po stronie WordPressa

Stan na 06.10.2026. Adres i token webhooka oraz nazwy pól formularzy **nie zmieniają się**. Dochodzi jedno nowe, opcjonalne pole.

## Po co
Wtyczka „CF7 to Webhook” wysyła zgłoszenie raz. Gdy panel nie odpowie (awaria, restart po wdrożeniu, limit czasu), zgłoszenie zostaje tylko w mailu na kontakt@ i we Flamingo, a w panelu go nie ma. Rozwiązanie: WordPress **ponawia wysyłkę**, a panel dzięki identyfikatorowi zgłoszenia nigdy nie utworzy z jednego zgłoszenia dwóch sygnałów.

## Nowe pole: `zgloszenie_id` (klucz idempotencji)
- Unikalny identyfikator **jednego zgłoszenia**, nadany raz przy pierwszej wysyłce i **taki sam w każdym ponowieniu** (np. `wp-<ID wpisu Flamingo>` albo `wp-<unix time>-<losowe>` zapamiętane w kolejce ponowień).
- Dozwolone znaki: litery, cyfry, `_ . : -`; długość 3–100. Inne wartości panel ignoruje (zgłoszenie obsłuży normalnie, bez ochrony przed powtórką).
- Pole jest opcjonalne — bez niego wszystko działa jak dotąd.

## Jak panel odpowiada (decyduje o ponowieniu)
| Odpowiedź panelu | Znaczenie | Ponawiać? |
|---|---|---|
| `200` `{"ok":true,"result":"CREATED"}` | sygnał utworzony | nie |
| `200` `result: "DUPLICATE"` | identyczna treść w 10 min — pominięte | nie |
| `200` `result: "EXCLUDED"` | adres na liście wykluczeń | nie |
| `200` `result: "REPLAY"` | to `zgloszenie_id` zostało już przetworzone | nie (to sukces) |
| `401` | zły/brak tokenu | **nie** — błąd konfiguracji, powiadomić człowieka |
| `500`, timeout, brak połączenia, `502/503/504` | panel nie przetworzył | **tak** |

Zasada dla WordPressa: sukces = każdy `200`. Ponawiać tylko po `5xx`, timeoucie i błędzie połączenia.

## Proponowany harmonogram ponowień
1 min → 5 min → 15 min → 1 h → 6 h → 24 h, potem koniec i mail do administratora z listą zgłoszeń, które nie weszły (są we Flamingo). Każde ponowienie wysyła **ten sam payload z tym samym `zgloszenie_id`**. Limit czasu pojedynczej próby: ok. 10 s. Do ponawiania wystarczy WP-Cron (`wp_schedule_single_event`) i kolejka w opcji albo własnej tabeli.

## Co panel gwarantuje
- To samo `zgloszenie_id` przetworzone raz (wynik CREATED / DUPLICATE / EXCLUDED) → każde kolejne dostaje `REPLAY` i **nic nie robi** (żadnego sygnału, żadnego maila do klienta), bez względu na upływ czasu.
- Zgłoszenie, które zakończyło się błędem 500, **nie blokuje** ponowienia — to samo `zgloszenie_id` zostanie przetworzone przy następnej próbie.
- Osobno działa deduplikacja po treści (10 min, ten sam e-mail + typ + sprzęt/termin/dni/wiadomość) — chroni przed podwójnym kliknięciem.
- Panel alarmuje administratora mailem przy błędzie 500 i gdy nie działają maile automatyczne (WordPress nie musi o tym wiedzieć).

## Test akceptacyjny (adresy `test+www-…@wynajemlasera.pl`)
1. Wyślij zgłoszenie rezerwacji z `zgloszenie_id=test-001` → sygnał + potwierdzenie.
2. Wyślij **ten sam payload** jeszcze raz (np. po godzinie) → odpowiedź `REPLAY`, w panelu nadal jeden sygnał, drugiego maila nie ma.
3. Wyłącz panel (albo podaj zły adres) → ponowienia idą wg harmonogramu; po przywróceniu zgłoszenie wchodzi **raz**.
4. Testowe sygnały do archiwum (karta sygnału → Archiwizuj → „test / wewnętrzny”).

## Czego nie zmieniać
Adres i token webhooka, nazwy pól CF7 i wartości pola `typ`, istniejące formularze (kopie dziedziczą webhook).
