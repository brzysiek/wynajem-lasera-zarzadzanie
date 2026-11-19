import { TrafficEmpty } from "@/components/marketing/traffic-empty";
import { TrafficView } from "@/components/marketing/traffic-view";
import { loadCampaignReport } from "@/lib/marketing/load";
import { periodFromParams, warsawDay } from "@/lib/marketing/period";
import { CH } from "@/lib/marketing/source";
import { compareAdsWithLeads } from "@/lib/traffic/report";
import { loadTrafficReport } from "@/lib/traffic/load";

// Marketing → Ruch na stronie (wniosek 54, etap 2): dane z anonimowego licznika. Dopóki nie
// ma danych w okresie, zostaje komunikat „Ruszy po wdrożeniu etapu 2”.
export default async function TrafficPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const period = periodFromParams(sp, "28", warsawDay(new Date()));
  const [{ report, join }, leadsReport] = await Promise.all([loadTrafficReport(period.from, period.to), loadCampaignReport(period.from, period.to)]);
  if (!report.hasData) return <TrafficEmpty />;
  const google = leadsReport.channels.find((c) => c.label === CH.GOOGLE_ADS);
  const comparison = compareAdsWithLeads(
    join.byCampaign,
    (google?.children ?? []).filter((c) => !c.key.startsWith("(")).map((c) => ({ key: c.key, label: c.label, leads: c.metrics.leads.razem })),
  );
  return <TrafficView report={report} comparison={comparison} />;
}
