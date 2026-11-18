import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth-guards";
import { buildCsv } from "@/lib/leads/google-conversions";
import { conversionPreview, markExported } from "@/lib/leads/google-conversions-load";

// Wniosek 54, etap 1: konwersje offline do Google Ads — ADMIN.
// GET = podgląd (liczby), POST = plik CSV. POST { mark: true } oznacza
// wiersze jako wyeksportowane (nie pójdą drugi raz), { all: true } dokłada
// także już wyeksportowane (ponowne pobranie, bez oznaczania).
export async function GET() {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const p = await conversionPreview();
  return NextResponse.json({
    pending: p.pending.length,
    already: p.already,
    leadsChecked: p.leadsChecked,
    leadsEligible: p.leadsEligible,
    skipped: p.skipped,
    byName: p.byName,
  });
}

export async function POST(req: NextRequest) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as { mark?: boolean; all?: boolean };
  const p = await conversionPreview();
  const all = body.all === true;
  const rows = (all ? [...p.pending, ...p.alreadyRows] : p.pending).sort((a, b) => a.at.getTime() - b.at.getTime());
  const batch = `csv-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}`;
  // Oznaczamy tylko świeże wiersze i tylko na wyraźne życzenie.
  if (body.mark === true && !all) await markExported(p.pending, batch);
  return new NextResponse(buildCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="konwersje-google-ads-${batch.slice(4, 12)}.csv"`,
      "Cache-Control": "no-store",
      "X-Rows": String(rows.length),
    },
  });
}
