import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-guards";
import { OFFICE_AND_AGENT } from "@/lib/permissions";
import { listIntakes } from "@/lib/leads/mail-intake";

// Kolejka „Do sprawdzenia” (maile od nowych osób, wniosek 43) i odrzucone
// automatycznie z 14 dni. Odczyt: ADMIN/STAFF/AGENT.
export async function GET() {
  const session = await requireSession(OFFICE_AND_AGENT);
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  return NextResponse.json(await listIntakes());
}
