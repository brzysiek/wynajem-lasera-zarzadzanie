import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-guards";
import { OFFICE_AND_AGENT } from "@/lib/permissions";
import { listLeadDuplicates } from "@/lib/leads/cleanup";

// Zdublowane otwarte sygnały u jednego klienta (lejek) — odczyt; duplikat
// archiwizuje się propozycją „archiwizacja” (sygnal_id, powód DUPLIKAT).
export async function GET() {
  const session = await requireSession(OFFICE_AND_AGENT);
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  return NextResponse.json({ duplicates: await listLeadDuplicates() });
}
