import { OverviewView } from "@/components/marketing/overview-view";
import { conversionPreview } from "@/lib/leads/google-conversions-load";
import { waitingProposals } from "@/lib/marketing/analysis";
import { costStatus, loadCampaignReport } from "@/lib/marketing/load";
import { overview, todoItems } from "@/lib/marketing/overview";
import { daysBetween, periodFromParams, periodQuery, warsawDay } from "@/lib/marketing/period";

// Marketing → Przegląd (wniosek 54, etap 1c).
export default async function OverviewPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const now = new Date();
  const period = periodFromParams(sp, "28", warsawDay(now));
  const [cur, prev, waiting, costs, conv] = await Promise.all([
    loadCampaignReport(period.from, period.to),
    loadCampaignReport(period.prevFrom, period.prevTo),
    waitingProposals(),
    costStatus(),
    conversionPreview(),
  ]);
  const o = overview(cur, prev);
  const todo = todoItems({ unsourced: cur.unsourced.length, waitingProposals: waiting, lastCostImportAt: costs.lastImportAt, now, pendingConversions: conv.pending.length, query: periodQuery(period) });
  const len = daysBetween(period.from, period.to);
  return <OverviewView o={o} prevLabel={`poprzednie ${len} dni`} todo={todo} />;
}
