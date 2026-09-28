import { NextResponse } from "next/server";
import { requireStaffSession } from "@/lib/auth-guards";
import { loadTermsReview, syncAllFutureRentalsToTerms } from "@/lib/clients/terms-backfill";
import { logInfo } from "@/lib/logger";

// Kwoty wg warunków: przelicz policzone przyszłe rezerwacje wszystkich
// klientów z tabelą cen wg aktualnych zasad (biuro). Ręczne, potwierdzone i
// zafakturowane — bez zmian; rezerwacje bez kwoty — bez zmian.
export async function POST() {
  const session = await requireStaffSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const result = await syncAllFutureRentalsToTerms({ userId: session.user.id });
  logInfo("terms_resync_all", { userId: session.user.id, ...result });
  return NextResponse.json({ ...result, review: await loadTermsReview() });
}
