import { NextRequest, NextResponse } from "next/server";
import { requireStaffSession } from "@/lib/auth-guards";
import { parsePrices, saveClientPrices } from "@/lib/clients/terms";
import { loadClientDetail } from "@/lib/clients/load";
import { logInfo } from "@/lib/logger";

// Warunki handlowe: tabela cen klienta (urządzenie × dni). Zastępuje całą
// tabelę (np. „Cennik ogólny” = pusta). Tylko biuro — agent proponuje ceny
// przez kolejkę propozycji. Przyszłe rezerwacje: po „Zastosuj” (terms-sync).
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireStaffSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as { prices?: unknown } | null;
  const parsed = parsePrices(body?.prices);
  if (!parsed.ok) return NextResponse.json({ message: parsed.message }, { status: 400 });
  const result = await saveClientPrices(id, parsed.rows, { userId: session.user.id });
  if (!result.ok) return NextResponse.json({ message: result.message }, { status: result.status });
  logInfo("client_prices_saved", { userId: session.user.id, clientId: id, rows: parsed.rows.length, changed: result.changed });
  return NextResponse.json({ detail: await loadClientDetail(id) });
}
