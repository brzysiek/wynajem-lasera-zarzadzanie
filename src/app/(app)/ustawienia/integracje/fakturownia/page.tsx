import { getFakturowniaConfigStatus } from "@/lib/integrations/fakturownia";
import { FakturowniaPanel } from "@/components/fakturownia-panel";

function Code({ children }: { children: string }) {
  return <code className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-800">{children}</code>;
}

function Steps({ children }: { children: React.ReactNode }) {
  return <ol className="list-decimal space-y-4 pl-5 text-sm text-gray-700">{children}</ol>;
}

export default async function FakturowniaIntegrationPage() {
  const { configured: fakturowniaConfigured } = getFakturowniaConfigStatus();

  return (
    <div>
      <FakturowniaPanel initiallyConfigured={fakturowniaConfigured} />

      <div className="mb-6 rounded-lg border border-[#CFE0F0] bg-[#EAF4FB] p-4 text-sm text-[#14567F]">
        Konfiguracja poniżej ustawia tylko dane dostępowe do Fakturowni (token, konto, dział wystawiający). Samo
        wystawianie faktur z panelu wynajmu dodamy w kolejnym kroku — czeka jeszcze na ustalenie tytułu/opisu pozycji
        na fakturze. Do KSeF faktury nie będą wysyłane — apka nigdy nie ustawia tej flagi przy tworzeniu faktury.
      </div>

      <section className="rounded-lg border border-gray-200 bg-white p-6">
        <h2 className="mb-1 text-lg font-semibold text-gray-900">Fakturownia — jak przygotować dane dostępowe</h2>
        <p className="mb-5 text-sm text-gray-500">
          Cel: wyszukiwanie kontrahenta po NIP i wystawianie faktury bezpośrednio z panelu rozliczenia wynajmu.
        </p>

        <Steps>
          <li>
            Zaloguj się do Fakturowni i przejdź do <Code>Ustawienia → Ustawienia konta → Integracja</Code>.
          </li>
          <li>
            W sekcji „Kod autoryzacyjny API” kliknij <Code>Zobacz ApiTokeny</Code> i wygeneruj nowy token (albo użyj
            istniejącego). <span className="font-medium text-gray-800">Token widoczny jest w pełni tylko przez 60
            minut od utworzenia albo do pierwszego użycia</span> — skopiuj go od razu.
          </li>
          <li>
            Subdomena konta to fragment adresu w pasku przeglądarki, gdy jesteś zalogowany — np. dla{" "}
            <Code>tslizowski.fakturownia.pl</Code> subdomeną jest <Code>tslizowski</Code>.
          </li>
          <li>
            ID działu, z którego mają być wystawiane faktury (dział <Code>wynajemlasera</Code>), znajdziesz w adresie
            strony działu w Fakturowni, np. <Code>.../departments/1868546/</Code> → ID to <Code>1868546</Code>.
          </li>
          <li>Wklej subdomenę, token i ID działu w panelu wyżej i kliknij „Zapisz” — aplikacja zapisze je w .env i się zrestartuje.</li>
          <li>
            Kliknij „Testuj połączenie” — oprócz potwierdzenia, że token działa, pokaże też listę wszystkich działów
            zdefiniowanych na koncie (przydatne, żeby zweryfikować, że wpisane ID się zgadza).
          </li>
        </Steps>
      </section>
    </div>
  );
}
