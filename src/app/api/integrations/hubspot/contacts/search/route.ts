import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { searchHubspotContacts } from "@/lib/integrations/hubspot";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
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
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ message }, { status: 502 });
  }
}
