import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { auth } from "@/auth";
import { VIEW_COOKIE, actsAsDriver } from "@/lib/effective-role";
import { loadReportAlerts } from "@/lib/report-alerts-load";

// Wynajmy/szkolenia zakończone, dla których kierowca nie zapisał żadnych
// danych rozliczenia (albo brakuje liczników impulsów). Ten sam wzorzec co
// GET /api/rentals/alerts i GET /api/rentals/revenue-alerts — pasek ikon /
// karta powiadomień (src/components/notifications-context.tsx). Admin only;
// podgląd kierowcy dostaje puste.
export async function GET() {
  const session = await auth();
  const viewCookie = (await cookies()).get(VIEW_COOKIE)?.value;
  const driverMode = actsAsDriver(session?.user.role, session?.user.canActAsDriver, viewCookie);

  if (driverMode || session?.user.role !== "ADMIN") {
    return NextResponse.json({ reportAlerts: [] });
  }

  const reportAlerts = await loadReportAlerts();
  return NextResponse.json({ reportAlerts });
}
