import { auth } from "@/auth";
import { requireOffice } from "@/lib/auth-guards";
import { PageHeader } from "@/components/page-header";
import { IntegrationsTabs } from "@/components/integrations-tabs";
import { getFakturowniaConfigStatus } from "@/lib/integrations/fakturownia";
import { getGoogleCalendarConfigStatus } from "@/lib/integrations/google-calendar";
import { getHubspotConfigStatus } from "@/lib/integrations/hubspot";
import { getSzybkiSmsConfigStatus } from "@/lib/integrations/szybkisms";

// Integracje (wniosek 55): tylko połączenia i klucze. ADMIN — pełne panele; STAFF — tylko
// podgląd stanu (bez sekretów, bez przycisków; zapis w API zwraca 403).
export default async function IntegrationsLayout({ children }: { children: React.ReactNode }) {
  await requireOffice();
  const session = await auth();
  if (session?.user.role !== "ADMIN") {
    const google = getGoogleCalendarConfigStatus() as { configured?: boolean };
    const rows: [string, boolean][] = [
      ["Google Calendar", Boolean(google.configured)],
      ["HubSpot", getHubspotConfigStatus().configured],
      ["SzybkiSMS", getSzybkiSmsConfigStatus().configured],
      ["Fakturownia", getFakturowniaConfigStatus().configured],
    ];
    return (
      <div>
        <PageHeader title="Integracje" description="Połączenia z zewnętrznymi usługami." />
        <section className="rounded-lg border border-gray-200 bg-white p-6 text-sm text-gray-700">
          <p className="mt-0 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-blue-900">Tylko podgląd — klucze i połączenia zmienia administrator.</p>
          <ul className="mb-0 flex list-none flex-col gap-2 p-0">
            {rows.map(([name, ok]) => (
              <li key={name} className="flex items-center gap-2">
                <span className={`inline-block h-2.5 w-2.5 rounded-full ${ok ? "bg-green-600" : "bg-amber-500"}`} aria-hidden="true" />
                <b>{name}</b>
                <span className="text-gray-500">{ok ? "połączony" : "niepołączony"}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    );
  }
  return (
    <div>
      <PageHeader title="Integracje" description="Połączenia z zewnętrznymi usługami — status, test połączenia i instrukcje konfiguracji. Importy jednorazowe są w osobnej pozycji „Importy historii”." />
      <IntegrationsTabs />
      {children}
    </div>
  );
}
