import { NextResponse } from "next/server";
import { requireStaffSession } from "@/lib/auth-guards";
import { countFreshLeads } from "@/lib/leads/load";

// Plakietka „Sygnały” w menu: nowe sygnały bez kontaktu. ADMIN/STAFF.
export async function GET() {
  const session = await requireStaffSession();
  if (!session) return NextResponse.json({ count: 0 }, { status: 403 });
  return NextResponse.json({ count: await countFreshLeads() });
}
