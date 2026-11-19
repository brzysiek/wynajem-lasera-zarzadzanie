import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth-guards";
import { LEVELS, flatten, reportCsv, type Level } from "@/lib/marketing/report";
import { loadCampaignReport, resolvePeriod } from "@/lib/marketing/load";

// Wniosek 54, etap 1b: raport kampanii (ADMIN). Domyślnie ostatnie 28 dni.
// ?from=&to= (RRRR-MM-DD), ?format=csv&level=kanal|kampania|grupa|slowo&channel=
export async function GET(req: NextRequest) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const sp = req.nextUrl.searchParams;
  const { from, to } = resolvePeriod(sp.get("from"), sp.get("to"));
  const report = await loadCampaignReport(from, to);
  if (sp.get("format") === "csv") {
    const level = (LEVELS as string[]).includes(sp.get("level") ?? "") ? (sp.get("level") as Level) : "kampania";
    return new NextResponse(reportCsv(flatten(report, level, sp.get("channel"))), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="raport-kampanii-${level}-${from}_${to}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  }
  return NextResponse.json(report, { headers: { "Cache-Control": "no-store" } });
}
