import { AnalysisView } from "@/components/marketing/analysis-view";
import { getReport, listReports } from "@/lib/marketing/analysis";

// Marketing → Analiza (wniosek 54, etap 1c): raporty Claude’a i propozycje zmian.
// Decyzje podejmuje tylko administrator (layout Marketingu + API).
export default async function AnalysisPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const reports = await listReports();
  const id = reports.find((r) => r.id === sp.raport)?.id ?? reports[0]?.id ?? null;
  const report = id ? await getReport(id) : null;
  return <AnalysisView report={report} reports={reports} />;
}
