import { auth } from "@/auth";
import { PageHeader } from "@/components/page-header";
import { CalendarHistoryImportPanel } from "@/components/calendar-history-import-panel";
import { ExcelInvoiceImportPanel } from "@/components/excel-invoice-import-panel";
import { HubspotImportPanel } from "@/components/hubspot-import-panel";
import { InvoiceHistoryImportPanel } from "@/components/invoice-history-import-panel";
import { LeadsImportPanel } from "@/components/leads-import-panel";
import { getFakturowniaConfigStatus } from "@/lib/integrations/fakturownia";
import { getHubspotConfigStatus } from "@/lib/integrations/hubspot";

// Ustawienia → System → Importy historii (wniosek 55): narzędzia jednorazowe, dawniej
// wymieszane z kluczami API w Integracjach. ADMIN uruchamia; STAFF widzi tylko opis.
export default async function ImportsSettingsPage() {
  const session = await auth();
  const isAdmin = session?.user.role === "ADMIN";
  const hubspot = getHubspotConfigStatus().configured;
  const fakturownia = getFakturowniaConfigStatus().configured;
  return (
    <div>
      <PageHeader title="Importy historii" description="Jednorazowe narzędzia: dane z HubSpota, historia kalendarzy i faktur. Nie są potrzebne na co dzień." />
      {!isAdmin ? (
        <section className="rounded-lg border border-gray-200 bg-white p-6 text-sm text-gray-700">
          <p className="mt-0 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-blue-900">Tylko podgląd — importy uruchamia administrator.</p>
          <ul className="mb-0 flex list-disc flex-col gap-1 pl-5">
            <li>Import z HubSpota (klienci, kontakty, transakcje) {hubspot ? "— HubSpot połączony" : "— HubSpot niepołączony"}.</li>
            <li>Zapytania z HubSpota do sygnałów.</li>
            <li>Historia kalendarzy (wynajmy sprzed okna synchronizacji).</li>
            <li>Historia faktur z Fakturowni {fakturownia ? "— Fakturownia połączona" : "— Fakturownia niepołączona"} i z plików Excel.</li>
          </ul>
        </section>
      ) : (
        <>
          <HubspotImportPanel configured={hubspot} />
          <LeadsImportPanel configured={hubspot} />
          <CalendarHistoryImportPanel />
          <InvoiceHistoryImportPanel configured={fakturownia} />
          <ExcelInvoiceImportPanel />
        </>
      )}
    </div>
  );
}
