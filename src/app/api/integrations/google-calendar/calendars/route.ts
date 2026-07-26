import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth-guards";
import { listGoogleCalendars } from "@/lib/integrations/google-calendar";

export async function GET() {
  const session = await requireAdminSession();
  if (!session) {
    return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  }

  try {
    const calendars = await listGoogleCalendars();
    return NextResponse.json({ calendars });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ message }, { status: 502 });
  }
}
