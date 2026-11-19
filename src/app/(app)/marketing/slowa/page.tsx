import { KeywordsView, type KeywordRowView } from "@/components/marketing/keywords-view";
import { loadRatings, ratingKey } from "@/lib/marketing/analysis";
import { loadCampaignReport } from "@/lib/marketing/load";
import { periodFromParams, periodQuery, warsawDay } from "@/lib/marketing/period";
import { keywordTable } from "@/lib/marketing/report";
import { CH } from "@/lib/marketing/source";

// Marketing → Słowa kluczowe (wniosek 54, etap 1c). Domyślny okres w tej podzakładce:
// cały sezon. Koszty i kliknięcia z importu raportu słów kluczowych, zapytania
// i rezerwacje z leadów po utm_term (z fallbackiem do pierwszego wejścia).
export default async function KeywordsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const period = periodFromParams(sp, "sezon", warsawDay(new Date()));
  const [report, ratings] = await Promise.all([loadCampaignReport(period.from, period.to), loadRatings()]);
  const { rows, withoutKeyword } = keywordTable(report);
  const view: KeywordRowView[] = rows.map((r) => ({ ...r, rating: ratings.get(ratingKey(r.campaignKey, r.keyword)) ?? null }));
  const google = report.channels.find((c) => c.label === CH.GOOGLE_ADS);
  const campaigns = (google?.children ?? []).filter((c) => !c.key.startsWith("(")).map((c) => ({ key: c.key, label: c.label }));
  return (
    <KeywordsView
      rows={view}
      campaigns={campaigns}
      selected={sp.kampania ?? null}
      query={periodQuery(period)}
      leads={report.leads}
      withoutKeyword={withoutKeyword.leads}
      hasCosts={report.total.metrics.cost > 0}
    />
  );
}
