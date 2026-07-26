import { requireAdmin } from "@/lib/auth-guards";
import { PageHeader } from "@/components/page-header";
import { IntegrationsPanel } from "@/components/integrations-panel";
import { getHubspotConfigStatus } from "@/lib/integrations/hubspot";
import { getGoogleCalendarConfigStatus } from "@/lib/integrations/google-calendar";

function Code({ children }: { children: string }) {
  return <code className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-800">{children}</code>;
}

function Pre({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-lg bg-gray-900 p-4 font-mono text-xs text-gray-100">
      <code>{children}</code>
    </pre>
  );
}

function Steps({ children }: { children: React.ReactNode }) {
  return <ol className="list-decimal space-y-4 pl-5 text-sm text-gray-700">{children}</ol>;
}

export default async function IntegrationsSettingsPage() {
  await requireAdmin();

  const { configured: hubspotConfigured } = getHubspotConfigStatus();
  const googleStatus = getGoogleCalendarConfigStatus();

  return (
    <div>
      <PageHeader
        title="Integracje"
        description="Połączenie z Kalendarzem Google i HubSpot — status, test połączenia i instrukcje konfiguracji."
      />

      <IntegrationsPanel hubspotConfigured={hubspotConfigured} googleStatus={googleStatus} />

      <div className="mb-6 rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
        Instrukcje niżej pokazują, skąd wziąć dane dostępowe dla obu integracji. Token HubSpot można ustawić od razu w
        panelu wyżej. Dane logowania Google (klucz service accounta) ustawia się bezpośrednio w <Code>.env</Code> na
        serwerze — panel wyżej tylko testuje, czy działają.
      </div>

      <div className="space-y-8">
        {/* GOOGLE */}
        <section className="rounded-lg border border-gray-200 bg-white p-6">
          <h2 className="mb-1 text-lg font-semibold text-gray-900">Google Calendar — jak przygotować dane dostępowe</h2>
          <p className="mb-5 text-sm text-gray-500">
            Model: jedno konto serwisowe (service account) z domain-wide delegation, podszywające się pod jedno konto
            w Google Workspace, które jest właścicielem/współdzielącym kalendarze urządzeń. Mapowanie
            kalendarz↔urządzenie ustawia się później, w widoku Urządzenia.
          </p>

          <Steps>
            <li>
              Wejdź na <Code>console.cloud.google.com</Code> i utwórz projekt (np. <Code>WynajemLasera</Code>).
            </li>
            <li>
              Włącz API: <Code>APIs &amp; Services → Library</Code> → wyszukaj „Google Calendar API” → Enable.
            </li>
            <li>
              Utwórz konto serwisowe: <Code>IAM &amp; Admin → Service Accounts → Create Service Account</Code> (np.{" "}
              <Code>wynajem-lasera-calendar</Code>). Zapisz jego adres e-mail (
              <Code>...@twoj-projekt.iam.gserviceaccount.com</Code>) — to wartość{" "}
              <Code>GOOGLE_SERVICE_ACCOUNT_EMAIL</Code>.
            </li>
            <li>
              Wygeneruj klucz: w tym koncie serwisowym → <Code>Keys → Add Key → Create new key → JSON</Code>. Pobierze
              się plik z polem <Code>private_key</Code> — to wartość <Code>GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY</Code>{" "}
              (format w <Code>.env</Code> opisany niżej).
            </li>
            <li>
              Włącz delegację: w tym koncie serwisowym → <Code>Advanced settings → Domain-wide Delegation</Code> →
              „Enable Google Workspace Domain-wide Delegation”. Zapisz wygenerowane <Code>Client ID</Code> (długi
              numer, nie e-mail).
            </li>
            <li>
              Jako administrator Google Workspace: <Code>admin.google.com → Security → API controls →
              Domain-wide delegation → Add new</Code> → wklej <Code>Client ID</Code> z poprzedniego kroku, w polu
              „OAuth scopes” wpisz <Code>https://www.googleapis.com/auth/calendar</Code>.
            </li>
            <li>
              Wybierz konto Workspace, które ma być właścicielem/współdzielącym 7 kalendarzy urządzeń (np.{" "}
              <Code>biuro@twojadomena.pl</Code>) — to wartość <Code>GOOGLE_IMPERSONATED_USER</Code>. Konto serwisowe
              „podszywa się” pod nie, żeby mieć dostęp do jego kalendarzy.
            </li>
            <li>
              W <Code>.env</Code> na serwerze:
              <Pre>{`GOOGLE_SERVICE_ACCOUNT_EMAIL=wynajem-lasera-calendar@twoj-projekt.iam.gserviceaccount.com
GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\\nMIIEvQ...\\n-----END PRIVATE KEY-----\\n"
GOOGLE_IMPERSONATED_USER=biuro@twojadomena.pl`}</Pre>
              Uwaga o formacie klucza: plik JSON z Google zawiera prawdziwe znaki nowej linii w <Code>private_key</Code>
              , a <Code>.env</Code> wymaga jednej linii — zamień rzeczywiste nowe linie na dosłowny dwuznak{" "}
              <Code>\n</Code> (backslash + n), tak jak w przykładzie. Aplikacja sama to odwraca przy użyciu.
            </li>
            <li>
              Zrestartuj aplikację (<Code>touch tmp/restart.txt</Code> albo przez deploy) i kliknij „Testuj /
              autoryzuj ponownie” w panelu wyżej — sprawdzi, czy dane faktycznie autoryzują dostęp do kalendarzy
              wskazanego konta.
            </li>
            <li>
              <Code>GOOGLE_WEBHOOK_BASE_URL</Code> jest potrzebny dopiero na późniejszym etapie (powiadomienia push z
              Google o zmianach w kalendarzu) — na razie może zostać pusty.
            </li>
          </Steps>
        </section>

        {/* HUBSPOT */}
        <section className="rounded-lg border border-gray-200 bg-white p-6">
          <h2 className="mb-1 text-lg font-semibold text-gray-900">HubSpot — jak przygotować dane dostępowe</h2>
          <p className="mb-5 text-sm text-gray-500">
            Cel: synchronizacja klientów/kontaktów (CRM) — przypisywanie kontaktu HubSpot do rezerwacji.
          </p>

          <Steps>
            <li>
              Zaloguj się do HubSpot kontem z uprawnieniami <Code>Super Admin</Code> — tylko takie konto może
              tworzyć Private Apps.
            </li>
            <li>
              Przejdź do <Code>Settings (ikona zębatki) → Integrations → Private Apps</Code> i kliknij{" "}
              <Code>Create a private app</Code>.
            </li>
            <li>
              W zakładce „Basic Info” podaj nazwę (np. <Code>WynajemLasera integracja</Code>).
            </li>
            <li>
              W zakładce „Scopes” zaznacz tylko to, co potrzebne, np. <Code>crm.objects.contacts.read</Code> /{" "}
              <Code>crm.objects.contacts.write</Code> (wyszukiwanie i przypisywanie kontaktów do rezerwacji).
            </li>
            <li>
              Zapisz (<Code>Create app</Code>). HubSpot pokaże token dostępu (zaczyna się od <Code>pat-...</Code>) —{" "}
              <span className="font-medium text-gray-800">skopiuj go od razu</span>, jest widoczny tylko raz.
            </li>
            <li>Wklej token w polu „HubSpot” w panelu wyżej i kliknij „Zapisz” — aplikacja zapisze go w .env i się zrestartuje.</li>
            <li>Kliknij „Testuj połączenie” w panelu wyżej, żeby potwierdzić, że token i zakresy działają.</li>
            <li>
              Limity API: konta na niższych planach HubSpot mają dzienny limit zapytań (zwykle rzędu 250 000/dobę) —
              wyszukiwanie kontaktów z debounce mieści się w tym bez problemu.
            </li>
          </Steps>
        </section>
      </div>
    </div>
  );
}
