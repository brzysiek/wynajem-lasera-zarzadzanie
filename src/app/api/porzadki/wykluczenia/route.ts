import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession, requireSession } from "@/lib/auth-guards";
import { OFFICE_AND_AGENT } from "@/lib/permissions";
import { addExclusions, listExclusions, setHideKeywords } from "@/lib/porzadki/exclusions";
import { getHideKeywords } from "@/lib/porzadki/exclusion-load";
import { logInfo } from "@/lib/logger";

// Lista wykluczeń domen i adresów (wniosek 7). Odczyt: ADMIN/STAFF/AGENT;
// zmiany tylko ADMIN (agent proponuje przez kolejkę propozycji).
export async function GET() {
  const session = await requireSession(OFFICE_AND_AGENT);
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  return NextResponse.json({ rows: await listExclusions(), keywords: await getHideKeywords() });
}

// Body: { values: "edina.pl\ntylia.pl", kind: "EXCLUDE" | "HIDE", note? }
// albo { keywords: "wynaj, laser, …" } (słowa, które pokazują wątki „HIDE”).
export async function POST(req: NextRequest) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const body = await req.json().catch(() => null);
  if (typeof body?.keywords === "string") {
    const applied = await setHideKeywords(body.keywords);
    return NextResponse.json({ applied, rows: await listExclusions() });
  }
  const kind = body?.kind === "HIDE" ? "HIDE" : body?.kind === "EXCLUDE" ? "EXCLUDE" : null;
  if (!kind || typeof body?.values !== "string") return NextResponse.json({ message: "Podaj values i kind (EXCLUDE albo HIDE)." }, { status: 400 });
  const note = typeof body.note === "string" && body.note.trim() ? body.note.trim().slice(0, 500) : null;
  const r = await addExclusions(body.values, kind, note, session.user.id);
  if (!r.values.length) return NextResponse.json({ message: r.errors[0] ?? "Brak poprawnych domen." }, { status: 400 });
  logInfo("exclusions_added", { userId: session.user.id, kind, count: r.values.length });
  return NextResponse.json({ ...r, rows: await listExclusions() });
}
