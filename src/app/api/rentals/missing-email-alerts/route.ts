import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { auth } from "@/auth";
import { VIEW_COOKIE, actsAsDriver } from "@/lib/effective-role";
import { loadMissingEmailAlerts } from "@/lib/missing-email-alerts-load";

// Wynajmy zakończone, z doliczonym VAT, dla których HubSpot nie ma
// zapisanego adresu e-mail kontrahenta — bez tego nie da się utworzyć
// szkicu faktury ani przypomnienia o płatności. Ten sam wzorzec co
// GET /api/rentals/invoice-alerts — pasek ikon / karta powiadomień
// (src/components/notifications-context.tsx). Admin only; podgląd
// kierowcy dostaje puste.
export async function GET() {
  const session = await auth();
  const viewCookie = (await cookies()).get(VIEW_COOKIE)?.value;
  const driverMode = actsAsDriver(session?.user.role, session?.user.canActAsDriver, viewCookie);

  if (driverMode || session?.user.role !== "ADMIN") {
    return NextResponse.json({ missingEmailAlerts: [] });
  }

  const missingEmailAlerts = await loadMissingEmailAlerts();
  return NextResponse.json({ missingEmailAlerts });
}
