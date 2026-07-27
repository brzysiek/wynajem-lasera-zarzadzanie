import { getSzybkiSmsConfigStatus } from "@/lib/integrations/szybkisms";
import { SzybkiSmsPanel } from "@/components/szybkisms-panel";

function Code({ children }: { children: string }) {
  return <code className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-800">{children}</code>;
}

function Steps({ children }: { children: React.ReactNode }) {
  return <ol className="list-decimal space-y-4 pl-5 text-sm text-gray-700">{children}</ol>;
}

export default async function SzybkiSmsIntegrationPage() {
  const { configured } = getSzybkiSmsConfigStatus();

  return (
    <div>
      <SzybkiSmsPanel initiallyConfigured={configured} />

      <div className="mb-6 rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
        Konfiguracja poniżej ustawia tylko dane dostępowe do bramki SzybkiSMS. Samą wysyłkę przypomnień SMS o
        nadchodzących wynajmach dodamy w kolejnym kroku.
      </div>

      <section className="rounded-lg border border-gray-200 bg-white p-6">
        <h2 className="mb-1 text-lg font-semibold text-gray-900">SzybkiSMS — jak przygotować dane dostępowe</h2>
        <p className="mb-5 text-sm text-gray-500">
          Cel: bramka SMS do wysyłki przypomnień klientom o nadchodzącym wynajmie. Integracja korzysta z REST API
          SzybkiSMS (<Code>https://api.szybkisms.pl/rest</Code>).
        </p>

        <Steps>
          <li>
            Załóż bezpłatne konto na <Code>panel.szybkisms.pl</Code> (jeśli firma jeszcze go nie ma).
          </li>
          <li>
            W panelu klienta aktywuj dostęp przez API i wygeneruj <Code>API Access Token</Code> — dokładna ścieżka
            zależy od aktualnego układu panelu SzybkiSMS (sekcja typu „API” / „Integracje” w ustawieniach konta).
          </li>
          <li>
            Wklej token w polu „SzybkiSMS” w panelu wyżej i kliknij „Zapisz” — aplikacja zapisze go w .env i się
            zrestartuje.
          </li>
          <li>
            Kliknij „Testuj połączenie” w panelu wyżej — sprawdzi token przez zapytanie o dane konta (
            <Code>GET /account</Code>) i pokaże aktualne saldo.
          </li>
          <li>
            Nazwa nadawcy (pole „sender” przy wysyłce) wymaga osobnej rejestracji/akceptacji po stronie SzybkiSMS —
            zajmiemy się tym przy wdrażaniu samej wysyłki SMS.
          </li>
          <li>Doładuj konto — za samo API nie ma opłat, płaci się wyłącznie za wysłane wiadomości.</li>
        </Steps>
      </section>
    </div>
  );
}
