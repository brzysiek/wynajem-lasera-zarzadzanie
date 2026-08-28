# wynajem-lasera-zarzadzanie

Panel do zarządzania wynajmem urządzeń — WynajemLasera.pl. Pełna specyfikacja: [`SPECYFIKACJA-wynajemlasera-app.md`](./SPECYFIKACJA-wynajemlasera-app.md).

Ten etap (Etap 1 — fundament) zawiera: szkielet stron nawigacji bez funkcjonalności biznesowej, logowanie (NextAuth Credentials) oraz schemat bazy danych do ręcznego zastosowania.

## Stack

Next.js 16 (App Router) · TypeScript · Tailwind CSS v4 · Prisma 6 · MySQL · NextAuth v5 (beta)

> Specyfikacja wskazuje `bcrypt` do hashowania haseł — użyto `bcryptjs` (czysty JS, bez kompilacji natywnej), API jest kompatybilne.

> Aplikacja jest wdrażana pod ścieżką `/wynajem` (patrz `basePath` w `next.config.ts`), bo docelowa domena to `brzychu.cfolks.pl/wynajem/`, nie osobna subdomena. Lokalnie (`npm run dev`) aplikacja jest więc dostępna pod `http://localhost:3000/wynajem`, nie pod samym `/`.

## Wymagania

- Node.js 20+
- Baza MySQL (lokalna lub np. PlanetScale)

## Konfiguracja

1. Zainstaluj zależności:

   ```bash
   npm install
   ```

2. Skopiuj `.env.example` do `.env` i uzupełnij przynajmniej:

   ```bash
   cp .env.example .env
   ```

   - `DATABASE_URL` — connection string do Twojej bazy MySQL, np. `mysql://user:haslo@localhost:3306/nazwa_bazy`.
   - `NEXTAUTH_SECRET` — wygeneruj np. `openssl rand -base64 32`.
   - `NEXTAUTH_URL` — `http://localhost:3000` na dev, `https://brzychu.cfolks.pl` na produkcji (bez `/wynajem` — Next.js sam dokleja `basePath`, dopisanie go tutaj psuje parsowanie akcji NextAuth; patrz sekcja Deploy).
   - `EMAIL_FROM`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` — wymagane, żeby działał reset hasła (`/forgot-password`), wysyłany przez zwykłe SMTP (np. skrzynka pocztowa w tej samej domenie, założona w panelu cyberfolks/cPanel — **Email Accounts**). `SMTP_PORT=465` włącza szyfrowanie TLS od razu (implicit TLS), `587`/`25` używają STARTTLS.

   Pozostałe zmienne (Google, HubSpot, SMS) dotyczą kolejnych etapów integracji i mogą na razie zostać puste.

3. Załóż schemat bazy danych migracjami Prisma (tworzy wszystkie tabele, enumy i klucze obce z `prisma/migrations/`):

   ```bash
   npx prisma migrate deploy
   ```

   Następnie wgraj konto startowe administratora:

   ```bash
   mysql -u UZYTKOWNIK -p NAZWA_BAZY < sql/seed.sql
   ```

   - `sql/seed.sql` — konto startowe administratora:
     - login: `lukasz@wynajemlasera.pl`
     - hasło: `12345678`

   Źródłem prawdy dla schematu jest `prisma/schema.prisma` + katalog `prisma/migrations/`. Na deployu `deploy/deploy-finish.sh` aplikuje migracje automatycznie przez `node deploy/migrate.mjs` (nie `prisma migrate deploy` — patrz sekcja Deploy → „Migracje bazy”).

4. Wygeneruj Prisma Client (wymagane do działania `@/lib/prisma`):

   ```bash
   npx prisma generate
   ```

5. Uruchom aplikację:

   ```bash
   npm run dev
   ```

   Aplikacja jest dostępna pod `http://localhost:3000` i przekierowuje do `/login`.

## Struktura stron

Wszystkie strony poza `/login`, `/forgot-password` i `/reset-password` są chronione (przekierowanie do `/login` dla niezalogowanych, zarówno w `proxy.ts`, jak i w layoucie `(app)`):

- `/forgot-password` — prośba o link do resetu hasła (mailem, przez SMTP)
- `/reset-password?token=...` — ustawienie nowego hasła po kliknięciu w link z maila
- `/kalendarz` — widok miesięczny/tygodniowy wynajmów, filtr urządzeń, tworzenie/edycja/usuwanie rezerwacji (synchronizacja z Google Calendar)
- `/nadchodzace` — lista nadchodzących wynajmów (placeholder)
- `/urzadzenia` — lista urządzeń, mapowanie na kalendarze Google, ręczna synchronizacja (dodawanie/edycja tylko dla `ADMIN`)
- `/ustawienia/konto` — dane własnego konta
- `/ustawienia/szablony` — szablony wiadomości
- `/ustawienia/integracje` — tylko `ADMIN`; instrukcje konfiguracji Google Calendar i HubSpot (przygotowanie danych dostępowych — kod właściwej synchronizacji to osobny etap)
- `/ustawienia/bramka` — tylko `ADMIN`
- `/ustawienia/uzytkownicy` — tylko `ADMIN`

Dostęp do stron `ADMIN`-only jest sprawdzany po stronie serwera (`requireAdmin()` w `src/lib/auth-guards.ts`), zgodnie z zasadą ze specyfikacji, że rola `STAFF` nie może uzyskać dostępu nawet przy znajomości adresu URL.

### Rola `KIEROWCA`

Trzecia rola (obok `ADMIN` i `STAFF`), pomyślana jako dostęp „tylko do wglądu" dla kierowcy realizującego dostawy:

- Po zalogowaniu widzi wyłącznie `/kalendarz` w trybie podglądu — bez tworzenia, edycji i przeciągania rezerwacji (`proxy.ts` przekierowuje z pozostałych tras na `/kalendarz`).
- W kalendarzu widzi tylko wynajmy, do których został przypisany przez administratora (`GET /api/rentals` filtruje po `rentals.driverId`).
- Kliknięcie kafelka otwiera `RentalReadonlyView` — urządzenie, termin, adres i godziny dostawy/odbioru oraz dane kontaktu, bez żadnych akcji.
- Kierowcę przypisuje **tylko `ADMIN`** — pole „Kierowca" w formularzu wynajmu (`RentalForm`, `canManageDrivers`); zapisy `POST/PATCH /api/rentals` z rolą `KIEROWCA` zwracają 403 (`requireStaffSession()`).
- Na kafelku w kalendarzu obok ikony kontaktu HubSpot pojawia się ikona kierownicy z natywnym tooltipem `Kierowca: <imię>`.

## Struktura projektu

- `prisma/schema.prisma` — źródło prawdy dla modelu danych.
- `prisma/migrations/` — migracje Prisma (na deployu aplikowane przez `deploy/migrate.mjs`, patrz sekcja Deploy → „Migracje bazy”).
- `sql/seed.sql` — konto startowe administratora, wgrywane ręcznie po założeniu schematu.
- `src/auth.ts` — konfiguracja NextAuth (Credentials provider).
- `src/proxy.ts` — ochrona tras (odpowiednik `middleware.ts` w Next.js 16).
- `src/app/(app)` — strony wymagające zalogowania, wspólny layout z nawigacją.
- `src/app/login` — ekran logowania.
- `src/app/forgot-password`, `src/app/reset-password` — reset hasła (publiczne, patrz „Struktura stron”).
- `src/app/api/auth/forgot-password`, `src/app/api/auth/reset-password` — endpointy resetu hasła; `src/lib/password-reset.ts` (generowanie/haszowanie tokenu) i `src/lib/email.ts` (wysyłka przez SMTP) zawierają logikę.
- `deploy/deploy-pull.sh` — synchronizuje kod źródłowy na serwerze (git fetch/reset).
- `deploy/deploy-finish.sh` — na serwerze: `npm install`, `prisma generate`, migracje bazy (`node deploy/migrate.mjs`), restart Passengera (bez builda — patrz niżej, dlaczego).
- `deploy/migrate.mjs` — runner migracji: wykonuje `prisma/migrations/*/migration.sql` sterownikiem `mariadb` (bez silnika Rust Prismy), śledzi je w `_prisma_migrations`.
- `deploy/generate-actions-key.sh` — jednorazowy generator klucza SSH dla GitHub Actions.
- `.github/workflows/deploy.yml` — automatyczny deploy po pushu do `main`.
- `server.js` — custom server wymagany przez Passenger (Node.js Selector w cPanel); `npm start` uruchamia ten plik zamiast `next start`.

## Deploy na cyberfolks (cPanel Node.js Selector) z automatycznym wdrożeniem po pushu

To konto ma dostęp SSH **bez roota**, ale panel cyberfolks daje **Node.js
Selector** (Passenger) — to on uruchamia i nadzoruje proces Node zamiast
PM2/systemd, a routing `brzychu.cfolks.pl/wynajem/` → aplikacja obsługuje
sam, bez ręcznej konfiguracji Nginx. Dlatego cały setup poniżej różni się od
typowego wdrożenia na VPS: nie instalujemy nic systemowo, nie dotykamy
firewalla ani SSL (AutoSSL w cPanel ogarnia certyfikat dla całej domeny).

Ciągłe wdrażanie działa tak: każdy push do `main` uruchamia
`.github/workflows/deploy.yml`, które:

1. Buduje aplikację (`npm run build`) **na runnerze GitHub Actions**, nie na
   serwerze — koszty budowy (kompilacja SWC/webpack) potrafią uruchomić
   więcej wątków systemowych, niż pozwala na to limit CloudLinux LVE
   konta cyberfolks (nawet gdy `ulimit -u` na koncie wygląda na
   nieograniczony — to osobny, niewidoczny limit), więc `next build`
   na samym koncie kończy się panikiem Rusta/tokio.
2. Synchronizuje kod źródłowy na serwerze (`deploy/deploy-pull.sh` — git
   fetch/reset).
3. Wysyła gotowy zbudowany katalog `.next/` na serwer przez `rsync`.
4. Na serwerze uruchamia `deploy/deploy-finish.sh` (`npm install`,
   `prisma generate`, migracje bazy przez `node deploy/migrate.mjs` — to
   lekkie operacje, działają bez problemu lokalnie na koncie — i restart
   aplikacji przez Passengera).

### Krok 1 — załóż aplikację Node.js w panelu cyberfolks

W panelu (sekcja **Setup Node.js App** / Node.js Selector):

1. **Node.js version** — 20.x (najnowsza dostępna 20.x).
2. **Application mode** — `Production`.
3. **Application root** — `domains/brzychu.cfolks.pl/public_html/wynajem` (czyli pełna ścieżka `/home/brzychu/domains/brzychu.cfolks.pl/public_html/wynajem` — ten katalog musi być głównym katalogiem repo, patrz Krok 2).
4. **Application URL** — domena `brzychu.cfolks.pl`, ścieżka `wynajem`.
5. **Application startup file** — `server.js`.
6. Zapisz. Panel pokaże komendę do wejścia do wirtualnego środowiska Node, w stylu:

   ```bash
   source /home/brzychu/nodevenv/domains/brzychu.cfolks.pl/public_html/wynajem/20/bin/activate && cd /home/brzychu/domains/brzychu.cfolks.pl/public_html/wynajem
   ```

   Zapisz sobie tę ścieżkę do `nodevenv/...` (może się różnić od powyższej — użyj dokładnie tej, którą pokazał panel) — to Twój `NODEVENV_DIR` z Kroku 5.

### Krok 2 — sklonuj repo na konto

Panel Node.js Selector zwykle od razu tworzy katalog aplikacji (`Application root`
z Kroku 1) i może wrzucić do niego placeholder (`app.js`, `package.json`).
Zwykłe `git clone` odmówi klonowania do niepustego katalogu, więc zamiast
tego zainicjalizuj repo bezpośrednio w tym katalogu. Masz już skonfigurowany
klucz SSH między serwerem a GitHubem (do pobierania kodu), więc zalogowany po
SSH na konto cyberfolks:

```bash
cd /home/brzychu/domains/brzychu.cfolks.pl/public_html/wynajem
rm -rf ./* ./.[!.]*        # usuń placeholder wygenerowany przez panel (katalog musi być pusty)
git init
git remote add origin git@github.com:brzysiek/wynajem-lasera-zarzadzanie.git
git fetch origin main
git checkout -f main
cp .env.example .env
```

Uzupełnij w `.env`:

- `DATABASE_URL` — patrz Krok 3 (baza).
- `NEXTAUTH_SECRET` — `openssl rand -base64 32`.
- `NEXTAUTH_URL=https://brzychu.cfolks.pl` (bez `/wynajem`, patrz sekcja Konfiguracja wyżej).

Potem zainstaluj zależności i wygeneruj klienta Prisma (w środowisku Node z
Kroku 1) — **nie buduj tutaj ręcznie** (`npm run build` na tym koncie kończy
się panikiem Rusta/tokio przez limity CloudLinux LVE, patrz wyżej); pierwszy
build dostarczy dopiero pierwszy automatyczny deploy z Kroku 6:

```bash
source /home/brzychu/nodevenv/domains/brzychu.cfolks.pl/public_html/wynajem/20/bin/activate
cd /home/brzychu/domains/brzychu.cfolks.pl/public_html/wynajem
npm install
npx prisma generate
```

### Krok 3 — baza MySQL

cyberfolks (jak większość cPanel-i) udostępnia **MySQL Databases** w
panelu — tam zakładasz bazę i użytkownika (cPanel zwykle prefiksuje nazwy
loginem konta, np. `twojuser_wynajem`). Connection string do `.env`:

```
DATABASE_URL=mysql://twojuser_wynajem:HASLO@localhost:3306/twojuser_wynajem
```

Zastosuj schemat (po SSH, w katalogu aplikacji), a konto startowe wgraj
`mysql`-em lub przez phpMyAdmin z panelu:

```bash
node deploy/migrate.mjs
mysql -u twojuser_wynajem -p twojuser_wynajem < sql/seed.sql
```

`deploy/migrate.mjs` na pustej bazie wykona wszystkie migracje z
`prisma/migrations/` po kolei. Na kolejnych deployach `deploy/deploy-finish.sh`
uruchamia go sam — patrz „Migracje bazy” niżej. (`prisma migrate deploy` na
tym koncie się zawiesza — silnik Rust vs limity LVE.)

Konto startowe z `sql/seed.sql`: login `lukasz@wynajemlasera.pl`, hasło `12345678` — zmień je po pierwszym logowaniu przez „Nie pamiętam hasła” na `/login` (wymaga skonfigurowanego `RESEND_API_KEY`/`EMAIL_FROM`, patrz sekcja Konfiguracja). Zmiana hasła z poziomu zalogowanego konta (bez maila) to kolejny etap prac.

### Krok 4 — klucz SSH dla GitHub Actions

Ten istniejący klucz (serwer → GitHub) służy tylko do `git pull`, nie do
logowania z zewnątrz. Do tego, żeby GitHub Actions mogło wejść NA serwer,
potrzebny jest osobny klucz — wygeneruj go jednym poleceniem, zalogowany po
SSH na konto cyberfolks:

```bash
cd /home/brzychu/domains/brzychu.cfolks.pl/public_html/wynajem
bash deploy/generate-actions-key.sh
```

Skrypt wypisze na końcu gotowy klucz prywatny oraz podpowie dokładne
wartości do wpisania w GitHub.

### Krok 5 — sekrety i zmienne w GitHub

**Settings → Secrets and variables → Actions → New repository secret:**

| Sekret | Wartość |
|---|---|
| `DEPLOY_SSH_HOST` | host serwera (z wyjścia skryptu z Kroku 4) |
| `DEPLOY_SSH_PORT` | port SSH cyberfolks (sprawdź w panelu, często inny niż 22) |
| `DEPLOY_SSH_USER` | login konta cyberfolks |
| `DEPLOY_SSH_KEY` | klucz prywatny z Kroku 4 |

**Settings → Secrets and variables → Actions → Variables → New repository variable:**

| Zmienna | Wartość |
|---|---|
| `APP_DIR` | `/home/brzychu/domains/brzychu.cfolks.pl/public_html/wynajem` |
| `NODEVENV_DIR` | `/home/brzychu/nodevenv/domains/brzychu.cfolks.pl/public_html/wynajem/20` (dokładna wartość z Kroku 1 — potwierdź w panelu) |

### Krok 6 — deploy

Od tej pory każdy `git push origin main` automatycznie wdraża aplikację —
postęp widać w zakładce **Actions** w GitHub. Można też odpalić wdrożenie
ręcznie przyciskiem **Run workflow** przy `deploy.yml`.

## Drugi serwer (deploy na dwa konta cyberfolks naraz)

Serwer 1 jest wdrażany pod ścieżką `/wynajem` swojej domeny (patrz
ostrzeżenie na górze tego pliku). **Serwer 2 jest wdrażany pod samym
adresem swojej domeny** (bez `/wynajem`), np. `https://panel.wynajemlasera.pl/`
zamiast `.../wynajem/`. Next.js zapisuje tę ścieżkę (`basePath`) na stałe
wewnątrz zbudowanych plików — nie da się tego przełączyć w locie na
serwerze — dlatego `deploy.yml` ma **dwa osobne joby budujące** aplikację
(`build-server-1` z `NEXT_PUBLIC_BASE_PATH=/wynajem`, `build-server-2` z
pustym `NEXT_PUBLIC_BASE_PATH`), a nie jeden współdzielony build. Oba
używane env-y są wpisane wprost w `deploy.yml` — nie trzeba nic dodatkowo
ustawiać w sekretach/zmiennych GitHuba z tego powodu.

Poza tym to jest **pełna, niezależna instalacja**: własna baza MySQL,
własny `.env`, własny cron przypomnień SMS — tak samo jak w Krokach 1–4
wyżej, tylko na innym koncie/domenie cyberfolks.

**Deploy na serwer 2 nie jest automatyczny.** Zwykły `push` do `main`
buduje i wdraża tylko serwer 1 (`build-server-1` → `deploy-server-1`), tak
jak dotychczas — `build-server-2`/`deploy-server-2` się wtedy w ogóle nie
uruchamiają. Serwer 2 dostaje build i deploy wyłącznie wtedy, gdy
uruchomisz workflow ręcznie: zakładka **Actions → Deploy to cyberfolks →
Run workflow**, i zaznaczysz checkbox „Wdróż też na serwer 2". Dzięki temu
serwer 2 możesz traktować jako testowy/zapasowy, który aktualizujesz tylko
wtedy, kiedy naprawdę tego chcesz, bez ryzyka przypadkowego wdrożenia przy
każdym push.

1. Powtórz **Krok 1–4** wyżej na nowym koncie cyberfolks (nowa aplikacja
   Node.js w panelu, `git init` + checkout repo, własna baza MySQL +
   `node deploy/migrate.mjs` i `sql/seed.sql`, własny `.env` z osobnym
   `NEXTAUTH_SECRET` i `NEXTAUTH_URL` wskazującym na nową domenę — bez
   `/wynajem` na końcu, tak samo jak dla serwera 1, patrz ostrzeżenie na
   górze tego pliku — oraz `deploy/generate-actions-key.sh` — da nowy,
   osobny klucz SSH tylko dla tego serwera). W panelu **Setup Node.js App**
   dla tej aplikacji ustaw **Application URL** na samą domenę (bez
   dodatkowej ścieżki) — aplikacja ma tu odpowiadać pod `/`, nie pod
   `/wynajem`.
2. Jeśli druga instalacja ma też wysyłać automatyczne przypomnienia SMS,
   skonfiguruj na tym koncie **osobny** Cron Job w cPanelu, wywołujący
   `/api/cron/reminders` (bez `/wynajem` na początku, w odróżnieniu od
   serwera 1 — patrz sekcja „Jak zmienić harmonogram" na stronie
   Przypomnienia SMS w aplikacji) i osobny `CRON_SECRET` w jego `.env` —
   nie używaj tego samego sekretu co pierwszy serwer.
3. W GitHubie: **Settings → Secrets and variables → Actions**, dodaj **nowe**
   wpisy (obok istniejących z Kroku 5, nie zamiast nich):

   | Sekret | Wartość |
   |---|---|
   | `DEPLOY2_SSH_HOST` | host drugiego serwera |
   | `DEPLOY2_SSH_PORT` | port SSH drugiego serwera |
   | `DEPLOY2_SSH_USER` | login konta drugiego serwera |
   | `DEPLOY2_SSH_KEY` | klucz prywatny wygenerowany w kroku 1 (na drugim serwerze) |

   | Zmienna | Wartość |
   |---|---|
   | `APP_DIR_2` | ścieżka aplikacji na drugim serwerze |
   | `NODEVENV_DIR_2` | ścieżka `nodevenv/.../20` na drugim serwerze |

4. Zwykły push do `main` wdraża tylko serwer 1. Żeby wdrożyć też serwer 2,
   wejdź w **Actions → Deploy to cyberfolks → Run workflow**, zaznacz
   „Wdróż też na serwer 2" i uruchom — wtedy zbuduje się (osobno, z
   właściwym `basePath`) i wdroży aplikacja na oba serwery równolegle,
   widoczne jako osobne joby w zakładce **Actions**.

### Migracje bazy

Migracje bazy są **automatyczne**. `deploy/deploy-finish.sh` uruchamia na
serwerze `node deploy/migrate.mjs` (po `npm install` / `prisma generate`,
przed restartem Passengera), więc każda nowa migracja z `prisma/migrations/`
aplikuje się razem z deployem — na serwer 1 przy każdym push do `main`, na
serwer 2 przy ręcznym uruchomieniu workflow.

**Dlaczego nie `prisma migrate deploy`:** ta komenda uruchamia silnik
schematu Prisma (binarka Rust), która na tym koncie zawiesza się pod
limitami CloudLinux LVE — dokładnie ten sam powód, dla którego `next build`
robi się w CI, a aplikacja używa adaptera `mariadb` zamiast natywnego
silnika Prisma. `deploy/migrate.mjs` wykonuje pliki
`prisma/migrations/*/migration.sql` tym samym sterownikiem JS `mariadb` i
zapisuje je w tabeli `_prisma_migrations` w formacie Prismy — dzięki czemu
`prisma migrate status` / `prisma migrate diff` dalej działają lokalnie.
`prisma migrate deploy` można nadal odpalić ręcznie na normalnej maszynie
(dev, zakładanie bazy od zera).

Tworzenie nowej migracji (bez lokalnej bazy):

1. Zmień `prisma/schema.prisma`.
2. Wygeneruj SQL migracji z samego schematu (nie wymaga połączenia z bazą):

   ```bash
   npx prisma migrate diff \
     --from-migrations ./prisma/migrations \
     --to-schema-datamodel ./prisma/schema.prisma \
     --script > prisma/migrations/$(date +%Y%m%d%H%M%S)_nazwa/migration.sql
   ```

   (katalog migracji utwórz wcześniej; nazwa = `YYYYMMDDHHMMSS_krotki_opis`).
3. Commit + push. `deploy/migrate.mjs` zastosuje ją na deployu.

Baseline istniejących baz (jednorazowo, obsłużone w skrypcie): bazy powstały
ze starego `sql/schema.sql`, więc przy pierwszym uruchomieniu
`deploy/migrate.mjs` — jeśli tabela `_prisma_migrations` jest pusta, a
tabela `users` już istnieje — zapisuje migrację `0_init` jako zastosowaną
**bez jej wykonywania**, po czym aplikuje resztę (`20260828120000_add_driver_role_and_rental_driver`).
Na kolejnych deployach i na pustej bazie ten krok jest no-opem.

### Co zostaje poza automatem

- Sekrety integracji (Google, HubSpot, SMS, e-mail) uzupełnia się bezpośrednio w `.env` na serwerze — nie trzymamy ich w repo ani w Actions.
- Sama aplikacja Node.js w panelu (Krok 1) zakłada się tylko raz, ręcznie — deploy automatyczny aktualizuje już istniejącą aplikację, nie tworzy nowej.
