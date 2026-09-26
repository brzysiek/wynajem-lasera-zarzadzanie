import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-guards";
import { OFFICE_AND_AGENT } from "@/lib/permissions";
import { loadProposalsForExport } from "@/lib/porzadki/proposals";
import { proposalsToCsv, proposalsToMarkdown } from "@/lib/porzadki/rules";
import { download, proposalFilters } from "@/lib/porzadki/http";

// Eksport wniosków do Markdown (do projektu „SEOWIEC”) albo CSV, z tymi
// samymi filtrami co lista (?format=md|csv&status=PRZYJETY&obszar=…).
export async function GET(req: NextRequest) {
  const session = await requireSession(OFFICE_AND_AGENT);
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const sp = req.nextUrl.searchParams;
  const list = await loadProposalsForExport(proposalFilters(sp));
  const stamp = new Date().toISOString().slice(0, 10);
  if (sp.get("format") === "csv") return download(proposalsToCsv(list), `wnioski-${stamp}.csv`, "text/csv");
  return download(proposalsToMarkdown(list), `wnioski-${stamp}.md`, "text/markdown");
}
