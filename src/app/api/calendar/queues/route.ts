import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-guards";
import { OFFICE_AND_AGENT } from "@/lib/permissions";
import { loadCalendarQueues } from "@/lib/calendar/queues";

// Kalendarz → „Do dopięcia” (wniosek 26). Tylko odczyt; agent też widzi.
export async function GET() {
  const session = await requireSession(OFFICE_AND_AGENT);
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const queues = await loadCalendarQueues();
  return NextResponse.json({ queues, total: queues.reduce((s, q) => s + q.items.length, 0) });
}
