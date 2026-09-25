// Ostrzeżenia "brak maila kontrahenta" — wynajmy zakończone, z doliczonym
// VAT (a więc dotyczy ich faktura), dla których HubSpot nie ma zapisanego
// adresu e-mail (Rental.contactEmailCache) — bez tego nie da się utworzyć
// ani szkicu faktury, ani przypomnienia o płatności (patrz
// src/lib/invoicing/contact-email.ts, używane przez
// src/app/api/fakturownia/invoices/[id]/{create-draft,remind-draft}). Ten
// sam próg czasowy co "brak faktury" (INVOICE_ALERT_SINCE) — z tego samego
// powodu: wynajmy sprzed integracji nie mają sensownej historii do
// sprawdzania. Moduł client-safe (bez Prismy), serwerowa część w
// src/lib/missing-email-alerts-load.ts.
import { INVOICE_ALERT_SINCE, pluralWynajem } from "@/lib/invoice-alerts";

export { INVOICE_ALERT_SINCE, pluralWynajem };

export type MissingEmailAlert = {
  id: string;
  title: string;
  endsAt: string; // ISO
  deviceName: string;
  deviceColor: string;
  contactName: string | null;
};
