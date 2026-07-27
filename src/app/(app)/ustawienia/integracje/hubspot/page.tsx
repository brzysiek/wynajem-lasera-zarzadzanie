import { getHubspotConfigStatus } from "@/lib/integrations/hubspot";
import { HubspotPanel } from "@/components/hubspot-panel";

function Code({ children }: { children: string }) {
  return <code className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-800">{children}</code>;
}

function Steps({ children }: { children: React.ReactNode }) {
  return <ol className="list-decimal space-y-4 pl-5 text-sm text-gray-700">{children}</ol>;
}

export default async function HubspotIntegrationPage() {
  const { configured: hubspotConfigured } = getHubspotConfigStatus();

  return (
    <div>
      <HubspotPanel initiallyConfigured={hubspotConfigured} />

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
  );
}
