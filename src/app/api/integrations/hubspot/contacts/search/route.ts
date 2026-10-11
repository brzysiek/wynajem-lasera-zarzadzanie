import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-guards";
import { OFFICE_AND_AGENT } from "@/lib/permissions";
import { searchHubspotContacts } from "@/lib/integrations/hubspot";
import { logError } from "@/lib/logger";

export async function GET(req: NextRequest) {
  // Wniosek 31: baza kontaktów HubSpot — biuro i agent, bez roli KIEROWCA.
  const session = await requireSession(OFFICE_AND_AGENT);
  if (!session) {
    return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  }

  const query = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  if (query.length < 3) {
    return NextResponse.json({ message: "Wpisz co najmniej 3 znaki." }, { status: 400 });
  }

  try {
    const contacts = await searchHubspotContacts(query);
    return NextResponse.json({ contacts });
  } catch (err) {
    logError("hubspot_contact_search_failed", err, { userId: session.user.id });
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ message }, { status: 502 });
  }
}
