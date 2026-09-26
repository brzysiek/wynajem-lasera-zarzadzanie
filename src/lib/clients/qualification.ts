// Kwalifikacja klienta (prompt 2 v2, 1.0): „sygnał to zapytanie, klient to
// gabinet, z którym faktycznie był kontakt”. Czyste funkcje bez zależności.

export type QualifyReason = "CALL" | "EMAIL_REPLY" | "RENTAL" | "HISTORY" | "MANUAL" | "BACKFILL" | "HUBSPOT";

export const QUALIFY_REASON_LABEL: Record<QualifyReason, string> = {
  CALL: "rozmowa",
  EMAIL_REPLY: "odpowiedź mailem",
  RENTAL: "rezerwacja",
  HISTORY: "historia wynajmów",
  MANUAL: "ręcznie",
  BACKFILL: "porządkowanie bazy",
  HUBSPOT: "kontakt w HubSpot",
};

// Wynajem, historia z kalendarza (AUTO/CONFIRMED) albo faktura kwalifikują
// zawsze — liczone przy odczycie, bez zapisu flagi (ustalone 26.09.2026).
// `active` = kwalifikacja włączona (po porządkowaniu bazy); wcześniej
// wszyscy klienci są na liście jak dotąd, żeby nic nie zniknęło.
export function isQualified(
  c: { qualifiedAt: Date | string | null; rentals: number; history: number; invoices: number },
  active: boolean,
): boolean {
  if (!active) return true;
  return c.qualifiedAt != null || c.rentals > 0 || c.history > 0 || c.invoices > 0;
}
