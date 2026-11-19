import { requireAdmin } from "@/lib/auth-guards";
import { PageHeader } from "@/components/page-header";
import { CampaignReportView } from "@/components/marketing/campaign-report";
import { loadCampaignReport, resolvePeriod, seasonStart, warsawDay } from "@/lib/marketing/load";

// Marketing → Kampanie (wniosek 54, etap 1b). Tylko ADMIN.
export default async function CampaignsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireAdmin();
  const sp = await searchParams;
  const { from, to } = resolvePeriod(sp.from, sp.to);
  const report = await loadCampaignReport(from, to);
  const today = warsawDay(new Date());
  return (
    <div>
      <PageHeader
        title="Marketing → Kampanie"
        description="Skąd przychodzą sygnały i ile to kosztuje: kanał → kampania → grupa → słowo kluczowe. Źródło każdego sygnału ustala panel z danych formularza; koszty pochodzą z importu raportu Google Ads. Każda liczba jest klikalna."
      />
      <CampaignReportView report={report} today={today} seasonFrom={seasonStart(today)} />
    </div>
  );
}
