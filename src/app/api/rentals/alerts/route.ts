import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { auth } from "@/auth";
import { VIEW_COOKIE, actsAsDriver } from "@/lib/effective-role";
import { loadRentalAlerts } from "@/lib/rental-alerts-load";

// Ostrzeżenia kalendarza (wynajmy bez kierowcy/kontaktu/telefonu) — używane
// przez ikonę + wysuwany panel na prawym pasku (src/components/notifications-context.tsx),
// dawniej liczone tylko wewnątrz kalendarz/page.tsx dla banera nad siatką.
// Admin only; podgląd kierowcy dostaje puste (tak jak dawniej baner).
export async function GET() {
  const session = await auth();
  const viewCookie = (await cookies()).get(VIEW_COOKIE)?.value;
  const driverMode = actsAsDriver(session?.user.role, session?.user.canActAsDriver, viewCookie);

  if (driverMode || session?.user.role !== "ADMIN") {
    return NextResponse.json({ alerts: [] });
  }

  const alerts = await loadRentalAlerts();
  return NextResponse.json({ alerts });
}
