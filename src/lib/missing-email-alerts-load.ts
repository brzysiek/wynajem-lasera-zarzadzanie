import { prisma } from "@/lib/prisma";
import { INVOICE_ALERT_SINCE, type MissingEmailAlert } from "@/lib/missing-email-alerts";

// Serwerowa (Prisma) część modelu "brak maila kontrahenta" —
// src/lib/missing-email-alerts.ts ma tylko typ/próg i jest client-safe.
// Odpytywane przez GET /api/rentals/missing-email-alerts (pasek ikon —
// notifications-context.tsx). Filtr `contactEmailCache` po stronie JS, nie
// SQL — musi obsłużyć zarówno `null`, jak i sam-biały-znak (ten sam wzorzec
// `?.trim()` co reszta kodu operującego na tym polu, np. create-draft).
export async function loadMissingEmailAlerts(): Promise<MissingEmailAlert[]> {
  const now = new Date();

  const rows = await prisma.rental.findMany({
    where: {
      deletedInGoogle: false,
      endsAt: { lte: now, gte: INVOICE_ALERT_SINCE },
      finance: { vatApplicable: true },
    },
    orderBy: { endsAt: "desc" },
    select: {
      id: true,
      title: true,
      endsAt: true,
      contactNameCache: true,
      contactEmailCache: true,
      device: { select: { name: true, color: true } },
    },
  });

  return rows
    .filter((r) => !r.contactEmailCache?.trim())
    .map((r): MissingEmailAlert => ({
      id: r.id,
      title: r.title,
      endsAt: r.endsAt.toISOString(),
      deviceName: r.device.name,
      deviceColor: r.device.color,
      contactName: r.contactNameCache,
    }));
}
