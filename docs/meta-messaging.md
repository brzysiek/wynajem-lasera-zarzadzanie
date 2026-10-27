# Messenger i Instagram Direct w panelu (wniosek 42)

Wiadomości z Facebooka (Messenger) i Instagrama (Direct) trafiają do panelu przez webhook Meta.
Faza 1 jest **tylko do odbioru** (panel nie wysyła; odpowiadamy w aplikacji Meta):

- nowa rozmowa bez otwartego sygnału → sygnał „Nowe” typu Messenger / Instagram (źródło: automat);
- nasza odpowiedź (echo) → sygnał „W kontakcie” + pierwszy kontakt, krok za 2 dni robocze;
- wiadomość klientki przy sygnale odłożonym albo bez kroku na dziś → krok „odpowiedzieć” na teraz;
- cała rozmowa (dymki, godziny, licznik „klientka czeka”) w karcie sygnału i w karcie klienta (Komunikacja);
- telefon / e-mail podany w rozmowie = twardy klucz, dopina sygnał do klientki z bazy; samo imię i nazwisko
  to tylko **propozycja połączenia** (plakietka „Możliwe połączenie” na kafelku Tablicy i „Na dziś”,
  kafelek „Do połączenia” w pasku dnia; „Połącz” scala, „To ktoś inny” chowa; wszystko w dzienniku zmian).

**Adres webhooka**

- serwer testowy: `https://brzychu.cfolks.pl/wynajem/api/webhooks/meta`
- produkcja: `https://panel.wynajemlasera.pl/api/webhooks/meta`

Ten sam adres obsługuje weryfikację („Verify and Save”, żądanie GET) i zdarzenia (POST, podpis
`X-Hub-Signature-256`). Ustawienia → Integracje → **Meta** pokazują adres, które zmienne są ustawione
(nigdy ich wartości), ostatnie zdarzenia z webhooka oraz przyciski „Sprawdź / odnów subskrypcję Meta”.

## Zmienne środowiskowe (wpisuje Tomek wprost na serwerze — nie do repo, nie na czat)

| Zmienna | Co to |
|---|---|
| `META_VERIFY_TOKEN` | dowolny długi ciąg, który sam wymyślasz; wpisujesz go też w polu „Verify token” w Meta |
| `META_APP_SECRET` | App Secret aplikacji (Ustawienia aplikacji → Podstawowe) — do podpisu webhooka |
| `META_PAGE_ACCESS_TOKEN` | token strony (bez wygasania — niżej); potrzebny do imion klientek i przycisków subskrypcji |
| `META_PAGE_ID` | ID strony Facebook |
| `META_APP_ID` | opcjonalnie: ID aplikacji (panel pokaże, która subskrypcja jest „nasza”) |

Bez `META_APP_SECRET` każdy POST jest odrzucany (403). Bez `META_PAGE_ACCESS_TOKEN` rozmowy też się zapisują,
tylko bez imienia klientki (sygnał nazywa się wtedy „Messenger 1234”).

## Ścieżka główna: aplikacja własna, Standard Access, tryb Live, bez App Review

Aplikacja obsługuje wyłącznie naszą stronę (i powiązane konto IG), więc zakładamy:

- aplikacja typu **Business**, uprawnienia na poziomie **Standard Access** (dla osób z rolą w aplikacji);
- tryb aplikacji **Live**;
- **bez App Review i bez weryfikacji firmy** — wg dokumentacji Messenger Platform App Review nie jest wymagane,
  gdy wiadomości są wysyłane i odbierane tylko dla własnej strony.

Dokumentacja webhooków bywa tu niejednoznaczna (mówi o powiadomieniach od osób z rolą), dlatego rozstrzyga **test z
punktu „Sprawdzenie odbioru”** (wiadomość z konta bez żadnej roli). Jeśli nie przychodzi — plan B poniżej.

### 1. Aplikacja w Meta for Developers

1. developers.facebook.com → **Moje aplikacje → Utwórz aplikację** → typ **Business**.
2. Dodaj produkt **Messenger** (i **Instagram**, jeśli osobny w Twoim panelu).
3. **Webhooks**: Callback URL = adres z góry, Verify token = wartość `META_VERIFY_TOKEN` → **Verify and Save**
   (serwer musi mieć już ustawione `META_VERIFY_TOKEN`).
4. Pola webhooka:
   - **Messenger (obiekt Page):** `messages`, `message_echoes`, `standby`; opcjonalnie `message_reads`
     (panel je ignoruje);
   - **Instagram (obiekt Instagram):** `messages`. W API Instagrama echa naszych odpowiedzi przychodzą
     zwykle w tym samym polu `messages` z `is_echo: true` — panel obsługuje oba przypadki. Jeśli w panelu
     webhooków IG widzisz osobne pole echa (`message_echoes`), zaznacz je też.
5. **Subskrypcja strony do aplikacji**: w Messenger → Ustawienia → „Add or remove Pages” podłącz stronę, a
   potem w panelu: **Ustawienia → Integracje → Meta → „Odnów subskrypcję”** (robi
   `POST /{page-id}/subscribed_apps` z `subscribed_fields=messages,message_echoes,standby`).
   „Sprawdź subskrypcję” pokazuje, jakie pola ma dziś każda aplikacja podpięta do strony.

### 2. Token strony bez wygasania

1. W Graph API Explorer wybierz swoją aplikację i wygeneruj **token użytkownika** z uprawnieniami
   `pages_messaging`, `pages_manage_metadata`, `pages_show_list`, `pages_read_engagement`
   (dla IG dodatkowo `instagram_basic`, `instagram_manage_messages`).
2. Zamień go na długoterminowy (ważny ok. 60 dni):
   `GET /oauth/access_token?grant_type=fb_exchange_token&client_id={app-id}&client_secret={app-secret}&fb_exchange_token={krótki-token}`.
3. Wywołaj `GET /me/accounts` z tym długim tokenem — **token strony zwrócony tą drogą nie wygasa**.
   To jest `META_PAGE_ACCESS_TOKEN`. (Token użytkownika możesz potem wyrzucić.)
4. Nie wklejaj tokenów ani App Secret do czatu, repo ani maili — tylko do konfiguracji serwera.
   Zmiana hasła do Facebooka albo odebranie roli w aplikacji unieważnia token — wtedy powtórz kroki 1–3.

### 3. Przełączenie aplikacji na Live

W Ustawienia → Podstawowe uzupełnij to, czego Meta wymaga do trybu Live:

- adres **Polityki prywatności** (strona wynajemlasera.pl),
- **instrukcja usunięcia danych** (adres strony z opisem albo callback),
- **ikona aplikacji** (1024×1024), **kategoria**,
- adres e-mail do kontaktu.

Przełącznik „Tryb aplikacji” → **Live**. Bez trybu Live webhook dostaje tylko zdarzenia od osób z rolą w aplikacji.

### 4. Instagram

- konto IG musi być **profesjonalne (firmowe)** i **połączone ze stroną Facebook**;
- w aplikacji Instagram: Ustawienia → Prywatność → Wiadomości → **„Zezwól na dostęp do wiadomości”**
  (narzędzia połączone);
- „Sprawdź subskrypcję” w panelu pokazuje powiązane konto IG strony (jeśli go nie widać, połączenie nie jest zrobione).

## Współistnienie z HubSpotem (standby)

HubSpot zostaje podpięty do strony, dopóki nasz odbiór nie zadziała na produkcji (dopiero wtedy go odpinamy).
Jeśli Meta traktuje HubSpota jako **główną aplikację rozmowy**, nasza aplikacja dostaje zdarzenia w tablicy
`standby` zamiast `messaging`. Panel obsługuje oba identycznie (wiadomość od klientki albo echo naszej
odpowiedzi) i deduplikuje po identyfikatorze wiadomości (`mid`) — ta sama wiadomość nigdy nie zrobi dwóch wpisów
ani dwóch sygnałów. Subskrybujemy pole `standby`. **Bez Handover Protocol**: nie przejmujemy rozmowy, tylko czytamy.

## Sprawdzenie odbioru (kryterium nr 9)

1. Upewnij się, że w Ustawienia → Integracje → Meta wszystkie zmienne są „ustawione” i „Sprawdź subskrypcję”
   pokazuje `messages`, `message_echoes`, `standby`.
2. Z konta Facebook, które **nie ma żadnej roli** w aplikacji ani na stronie, napisz do strony. Sygnał typu
   Messenger powinien pojawić się w panelu **w ciągu minuty** (Sygnały → Nowe, karta → sekcja „Czat”).
3. To samo z konta Instagram bez roli napisz do konta firmowego IG.
4. Odpowiedz z aplikacji Meta (Business Suite / Messenger) — echo przesuwa sygnał do „W kontakcie”.
5. Jeśli wiadomość nie przychodzi: w Ustawienia → Integracje → Meta sprawdź „Ostatnie zdarzenia”
   (UNAUTHORIZED = zły `META_APP_SECRET`; brak wpisów = Meta nic nie wysyła). Zgłoś Tomkowi/Klaudiuszowi z
   odpowiedzią Meta i treścią tego logu — wtedy decydujemy: App Review albo pośrednik.

## Plan B: App Review

Gdyby test z pkt „Sprawdzenie odbioru” pokazał, że Meta nie wysyła zdarzeń od osób bez roli w aplikacji:

- złóż App Review o `pages_messaging` (oraz `instagram_manage_messages` dla IG) z krótkim nagraniem użycia
  (odbiór wiadomości, odczyt w panelu, brak wysyłki automatycznej);
- wymagana jest wtedy weryfikacja firmy (Business Verification) w Menedżerze firmy;
- albo użyć pośrednika (np. aplikacji, która już ma te uprawnienia), a panel odbierałby od niego webhook.

## Dane i prywatność

Inaczej niż przy Gmailu, treść rozmów jest **przechowywana w panelu** (tabele `chat_threads`, `chat_messages`) —
po to, żeby cała rozmowa była widoczna w karcie. Dostęp mają ADMIN, STAFF i agent (odczyt). Webhook weryfikuje
podpis `X-Hub-Signature-256` na surowym ciele żądania; błędny podpis → 403 i wpis UNAUTHORIZED w logu webhooka.

## Faza 2 (poza tym wdrożeniem)

Import historii konwersacji z HubSpota (archiwum jest na dysku kontakt@) oraz wysyłka odpowiedzi z panelu.
