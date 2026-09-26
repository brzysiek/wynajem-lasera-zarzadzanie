import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-guards";
import { OFFICE_AND_AGENT } from "@/lib/permissions";
import { findSimilar } from "@/lib/porzadki/proposals";

// Podobne otwarte wnioski (po tytule i obszarze) — podpowiedź przy tworzeniu.
export async function GET(req: NextRequest) {
  const session = await requireSession(OFFICE_AND_AGENT);
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const sp = req.nextUrl.searchParams;
  const title = sp.get("title")?.trim() ?? "";
  if (title.length < 4) return NextResponse.json({ similar: [] });
  return NextResponse.json({ similar: await findSimilar(title, sp.get("area") ?? "", sp.get("exclude") ?? undefined) });
}
