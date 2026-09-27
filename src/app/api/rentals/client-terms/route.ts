import { NextRequest, NextResponse } from "next/server";
import { requireStaffSession } from "@/lib/auth-guards";
import { loadTermsForRental } from "@/lib/clients/terms";

// Formularz rezerwacji: warunki handlowe klienta (ceny, transport, faktura,
// płatność) do podstawienia — ?klient= albo ?kontakt= (HubSpot), &dzien= dzień
// dostawy (czy transport już jest w innej rezerwacji), &bez= edytowana rezerwacja.
export async function GET(req: NextRequest) {
  const session = await requireStaffSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const q = req.nextUrl.searchParams;
  const terms = await loadTermsForRental({ clientId: q.get("klient"), hubspotContactId: q.get("kontakt"), day: q.get("dzien"), excludeRentalId: q.get("bez") });
  return NextResponse.json({ terms });
}
