import { NextRequest, NextResponse } from "next/server";
import { requireStaffSession } from "@/lib/auth-guards";
import { applyClientTitle, loadTitleMismatches } from "@/lib/rentals/title-sync";
import { logInfo } from "@/lib/logger";

// Poprawka wniosku 29 (jednorazowo): przyszłe rezerwacje z klientem, których
// tytuł ≠ nazwa robocza — lista (GET) i „Zamień tytuły” (POST { ids }).
// Tylko STAFF/ADMIN, bez automatycznej zamiany.
export async function GET() {
  const session = await requireStaffSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  return NextResponse.json({ items: await loadTitleMismatches() });
}

export async function POST(req: NextRequest) {
  const session = await requireStaffSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const body = (await req.json().catch(() => null)) as { ids?: unknown } | null;
  const ids = Array.isArray(body?.ids) ? body.ids.filter((x): x is string => typeof x === "string").slice(0, 300) : [];
  if (!ids.length) return NextResponse.json({ message: "Zaznacz rezerwacje." }, { status: 400 });
  const res = await applyClientTitle(ids, { userId: session.user.id }, "„Zamień tytuły” — tytuł = nazwa robocza klienta");
  logInfo("rental_titles_replaced", { userId: session.user.id, ...res });
  return NextResponse.json(res);
}
