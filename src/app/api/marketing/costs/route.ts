import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth-guards";
import { parseCostsCsv, previewCosts } from "@/lib/marketing/costs-csv";
import { costStatus, saveCosts } from "@/lib/marketing/load";

// Wniosek 54, etap 1b: import kosztów z Google Ads (CSV raportu słów kluczowych,
// segment Dzień) — ADMIN. POST { text } = podgląd (nic nie zapisuje),
// POST { text, apply: true } = zapis (nadpisuje dni z zakresu pliku).
const MAX_CHARS = 8_000_000;

export async function GET() {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  return NextResponse.json(await costStatus());
}

export async function POST(req: NextRequest) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const body = (await req.json().catch(() => null)) as { text?: unknown; apply?: unknown } | null;
  const text = typeof body?.text === "string" ? body.text : "";
  if (!text.trim()) return NextResponse.json({ message: "Wklej albo wybierz plik CSV." }, { status: 400 });
  if (text.length > MAX_CHARS) return NextResponse.json({ message: "Plik jest za duży." }, { status: 413 });
  const parsed = parseCostsCsv(text);
  const preview = previewCosts(parsed);
  if (!parsed.headerFound || !parsed.rows.length) return NextResponse.json({ message: preview.warnings[0] ?? "Brak wierszy do zapisu.", preview }, { status: 422 });
  if (body?.apply !== true) return NextResponse.json({ applied: false, preview });
  const batch = `import-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}`;
  const res = await saveCosts(parsed.rows, batch);
  return NextResponse.json({ applied: true, preview, ...res, status: await costStatus() });
}
