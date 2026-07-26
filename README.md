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

3. Załóż bazę danych **ręcznie**, uruchamiając kolejno pliki SQL z katalogu `sql/`:

   ```bash
   mysql -u UZYTKOWNIK -p NAZWA_BAZY < sql/schema.sql
   mysql -u UZYTKOWNIK -p NAZWA_BAZY < sql/seed.sql
   ```

   - `sql/schema.sql` — pełny schemat (tabele, enumy, klucze obce) wygenerowany z `prisma/schema.prisma`.
   - `sql/seed.sql` — konto startowe administratora:
     - login: `lukasz@wynajemlasera.pl`
     - hasło: `12345678`

   Prisma Client łączy się z bazą przez `DATABASE_URL` z `.env` — nie jest wymagane uruchamianie `prisma migrate`/`prisma db push`, bo schemat zakłada się ręcznie przez powyższe pliki SQL.

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
- `/kalendarz` — widok kalendarza (placeholder)
- `/nadchodzace` — lista nadchodzących wynajmów (placeholder)
- `/urzadzenia` — lista urządzeń (placeholder)
- `/ustawienia/konto` — dane własnego konta
- `/ustawienia/szablony` — szablony wiadomości
- `/ustawienia/integracje` — tylko `ADMIN`; instrukcje konfiguracji Google Calendar i HubSpot (przygotowanie danych dostępowych — kod właściwej synchronizacji to osobny etap)
- `/ustawienia/bramka` — tylko `ADMIN`
- `/ustawienia/uzytkownicy` — tylko `ADMIN`

Dostęp do stron `ADMIN`-only jest sprawdzany po stronie serwera (`requireAdmin()` w `src/lib/auth-guards.ts`), zgodnie z zasadą ze specyfikacji, że rola `STAFF` nie może uzyskać dostępu nawet przy znajomości adresu URL.

## Struktura projektu

- `prisma/schema.prisma` — źródło prawdy dla modelu danych.
- `sql/schema.sql`, `sql/seed.sql` — statyczny SQL wygenerowany z modelu Prisma (bez połączenia z żywą bazą), do ręcznego zastosowania.
- `src/auth.ts` — konfiguracja NextAuth (Credentials provider).
- `src/proxy.ts` — ochrona tras (odpowiednik `middleware.ts` w Next.js 16).
- `src/app/(app)` — strony wymagające zalogowania, wspólny layout z nawigacją.
- `src/app/login` — ekran logowania.
- `src/app/forgot-password`, `src/app/reset-password` — reset hasła (publiczne, patrz „Struktura stron”).
- `src/app/api/auth/forgot-password`, `src/app/api/auth/reset-password` — endpointy resetu hasła; `src/lib/password-reset.ts` (generowanie/haszowanie tokenu) i `src/lib/email.ts` (wysyłka przez SMTP) zawierają logikę.
- `deploy/deploy-pull.sh` — synchronizuje kod źródłowy na serwerze (git fetch/reset).
- `deploy/deploy-finish.sh` — na serwerze: `npm install`, `prisma generate`, restart Passengera (bez builda — patrz niżej, dlaczego).
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
   `prisma generate` — to lekkie operacje, działają bez problemu lokalnie
   na koncie — i restart aplikacji przez Passengera).

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

Zastosuj schemat (jeśli `mysql` jest dostępny po SSH — sprawdź `which mysql`;
jeśli nie, użyj narzędzia SQL z panelu, np. phpMyAdmin, jeśli jest dostępne):

```bash
mysql -u twojuser_wynajem -p twojuser_wynajem < sql/schema.sql
mysql -u twojuser_wynajem -p twojuser_wynajem < sql/seed.sql
```

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

### Co zostaje poza automatem

- Zmiany w `prisma/schema.prisma` **nie** są automatycznie aplikowane do bazy — trzeba ręcznie przygotować i uruchomić SQL migracyjny na serwerze (np. `sql/2026-07-26_add_password_reset_tokens.sql` dla resetu hasła — uruchom go ręcznie na produkcyjnej bazie po tym deployu, `sql/schema.sql` służy tylko do zakładania bazy od zera).
- Sekrety integracji (Google, HubSpot, SMS, e-mail) uzupełnia się bezpośrednio w `.env` na serwerze — nie trzymamy ich w repo ani w Actions.
- Sama aplikacja Node.js w panelu (Krok 1) zakłada się tylko raz, ręcznie — deploy automatyczny aktualizuje już istniejącą aplikację, nie tworzy nowej.
