import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-guards";
import { OFFICE_AND_AGENT } from "@/lib/permissions";
import { countFreshLeads } from "@/lib/leads/load";

// Plakietka „Sygnały” w menu: nowe sygnały bez kontaktu. ADMIN/STAFF/AGENT.
export async function GET() {
  const session = await requireSession(OFFICE_AND_AGENT);
  if (!session) return NextResponse.json({ count: 0 }, { status: 403 });
  return NextResponse.json({ count: await countFreshLeads() });
}
