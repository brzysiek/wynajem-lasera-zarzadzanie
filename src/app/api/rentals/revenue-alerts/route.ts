import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { auth } from "@/auth";
import { VIEW_COOKIE, actsAsDriver } from "@/lib/effective-role";
import { currentAndNextMonthPeriod } from "@/lib/revenue/period";
import { loadUnpricedRentals } from "@/lib/revenue/load";

// Wynajmy/szkolenia BEZ wpisanej kwoty (brak RentalFinance) w bieżącym +
// następnym miesiącu — bez tego nie da się ocenić preliminowanego przychodu.
// Ten sam loadUnpricedRentals co baner na /finanse/przychody (revenue-dashboard.tsx),
// tylko inny zakres (tam: wybrany okres dashboardu) i inne miejsce pokazania
// — pasek ikon / karta powiadomień (src/components/notifications-context.tsx),
// żeby nie trzeba było samemu zaglądać na tamtą stronę. Admin only; podgląd
// kierowcy dostaje puste, tak samo jak GET /api/rentals/alerts.
export async function GET() {
  const session = await auth();
  const viewCookie = (await cookies()).get(VIEW_COOKIE)?.value;
  const driverMode = actsAsDriver(session?.user.role, session?.user.canActAsDriver, viewCookie);

  if (driverMode || session?.user.role !== "ADMIN") {
    return NextResponse.json({ unpriced: [] });
  }

  const unpriced = await loadUnpricedRentals(currentAndNextMonthPeriod());
  return NextResponse.json({ unpriced });
}
