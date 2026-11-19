import { ChannelsView } from "@/components/marketing/channels-view";
import { loadCampaignReport } from "@/lib/marketing/load";
import { periodFromParams, periodQuery, warsawDay } from "@/lib/marketing/period";

// Marketing → Kampanie (wniosek 54, etap 1c): kanały, kampanie Google Ads / Meta,
// leady bez źródła. Okres ze wspólnego selektora (parametr w adresie).
export default async function CampaignsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const period = periodFromParams(sp, "28", warsawDay(new Date()));
  const report = await loadCampaignReport(period.from, period.to);
  const csvQuery = `from=${period.from}&to=${period.to}`;
  return <ChannelsView report={report} query={`${periodQuery(period)}`} csvQuery={csvQuery} hasCosts={report.total.metrics.cost > 0} />;
}
