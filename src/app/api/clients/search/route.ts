import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-guards";
import { OFFICE_AND_AGENT } from "@/lib/permissions";
import { searchClients } from "@/lib/clients/search";

// Wyszukiwarka klienta (wniosek 23): nazwa, nazwa robocza, aliasy, osoba,
// telefon (po cyfrach), e-mail, NIP. Tylko odczyt.
export async function GET(req: NextRequest) {
  const session = await requireSession(OFFICE_AND_AGENT);
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const q = (req.nextUrl.searchParams.get("q") ?? "").slice(0, 80);
  return NextResponse.json({ clients: await searchClients(q) });
}
