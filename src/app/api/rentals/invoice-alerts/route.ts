import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { auth } from "@/auth";
import { VIEW_COOKIE, actsAsDriver } from "@/lib/effective-role";
import { loadInvoiceAlerts } from "@/lib/invoice-alerts-load";

// Wynajmy zakończone, z doliczonym VAT, bez wystawionej faktury. Ten sam
// wzorzec co GET /api/rentals/alerts i /report-alerts — pasek ikon / karta
// powiadomień (src/components/notifications-context.tsx). Admin only;
// podgląd kierowcy dostaje puste.
export async function GET() {
  const session = await auth();
  const viewCookie = (await cookies()).get(VIEW_COOKIE)?.value;
  const driverMode = actsAsDriver(session?.user.role, session?.user.canActAsDriver, viewCookie);

  if (driverMode || session?.user.role !== "ADMIN") {
    return NextResponse.json({ invoiceAlerts: [] });
  }

  const invoiceAlerts = await loadInvoiceAlerts();
  return NextResponse.json({ invoiceAlerts });
}
