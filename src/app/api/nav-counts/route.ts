import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-guards";
import { OFFICE_AND_AGENT } from "@/lib/permissions";
import { navCounts } from "@/lib/nav-counts";

// Plakietki w menu bocznym (wniosek 26). ADMIN/STAFF/AGENT.
export async function GET() {
  const session = await requireSession(OFFICE_AND_AGENT);
  if (!session) return NextResponse.json({ sygnaly: 0, klienci: 0, kalendarz: 0 }, { status: 403 });
  return NextResponse.json(await navCounts(session.user.id));
}
