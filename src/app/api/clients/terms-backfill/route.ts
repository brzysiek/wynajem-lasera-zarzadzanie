import { NextRequest, NextResponse } from "next/server";
import { requireStaffSession } from "@/lib/auth-guards";
import { applyBackfill, loadTermsReview } from "@/lib/clients/terms-backfill";
import { logInfo } from "@/lib/logger";

// Kwoty wg warunków (etap D): uzupełnienie rozliczeń przyszłych rezerwacji
// bez kwoty u klientów z tabelą cen. Tylko biuro — agent tylko czyta stronę.
export async function POST(req: NextRequest) {
  const session = await requireStaffSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const body = (await req.json().catch(() => null)) as { rentalIds?: unknown } | null;
  const ids = Array.isArray(body?.rentalIds) ? body.rentalIds.filter((x): x is string => typeof x === "string").slice(0, 500) : [];
  if (!ids.length) return NextResponse.json({ message: "Zaznacz rezerwacje." }, { status: 400 });
  const result = await applyBackfill(ids, { userId: session.user.id });
  logInfo("terms_backfill_applied", { userId: session.user.id, requested: ids.length, done: result.done, skipped: result.skipped.length });
  return NextResponse.json({ ...result, review: await loadTermsReview() });
}
