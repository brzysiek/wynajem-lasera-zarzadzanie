import { NextRequest, NextResponse } from "next/server";
import { requireStaffSession } from "@/lib/auth-guards";
import { addressOptions } from "@/lib/clients/delivery";

// Formularz rezerwacji: adresy dostawy klienta do wyboru (?klient= albo
// ?kontakt= — nowa rezerwacja zna tylko kontakt HubSpot). Tylko biuro.
export async function GET(req: NextRequest) {
  const session = await requireStaffSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const q = req.nextUrl.searchParams;
  return NextResponse.json(await addressOptions({ clientId: q.get("klient"), hubspotContactId: q.get("kontakt") }));
}
