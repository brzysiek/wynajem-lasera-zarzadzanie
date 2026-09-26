import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-guards";
import { ADMIN_AND_AGENT } from "@/lib/permissions";
import { loadFvWithoutInvoice } from "@/lib/invoicing/fv-check-load";

// „FV bez faktury” — zakończone wynajmy ze znacznikiem FV (VAT doliczony)
// bez wystawionej/powiązanej faktury, z podpowiedzią prawdopodobnej faktury
// z Fakturowni. Odczyt: ADMIN i AGENT (kontrola faktur przez agenta).
export async function GET() {
  const session = await requireSession(ADMIN_AND_AGENT);
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  return NextResponse.json({ rentals: await loadFvWithoutInvoice() });
}
