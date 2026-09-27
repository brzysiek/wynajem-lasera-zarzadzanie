import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth-guards";
import { archive2025, listArchive2025Candidates } from "@/lib/leads/cleanup";
import { logInfo } from "@/lib/logger";

// Lejek: archiwum „2025 – bez kontaktu” — lista kandydatów i archiwizacja
// zaznaczonych (ADMIN, po przejrzeniu listy; przywrócenie w Porządki → Archiwum).
export async function GET() {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  return NextResponse.json({ candidates: await listArchive2025Candidates() });
}

export async function POST(req: NextRequest) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const body = (await req.json().catch(() => null)) as { ids?: unknown } | null;
  const ids = Array.isArray(body?.ids) ? body.ids.filter((x): x is string => typeof x === "string").slice(0, 500) : [];
  if (!ids.length) return NextResponse.json({ message: "Zaznacz sygnały." }, { status: 400 });
  const archived = await archive2025(ids, session.user.id);
  logInfo("leads_archived_2025", { userId: session.user.id, requested: ids.length, archived });
  return NextResponse.json({ archived, candidates: await listArchive2025Candidates() });
}
