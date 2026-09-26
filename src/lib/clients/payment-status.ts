// Status płatności faktury / wynajmu na karcie klienta (prompt 3B-karta,
// sekcja 1). Liczony przy odczycie z tego, co panel już zna — bez drugiej
// logiki płatności: zapłatę oznacza istniejąca tabela FakturowniaPayment
// (wyciąg bankowy / ręczne oznaczenie na /finanse/faktury). Czyste funkcje
// bez zależności (vitest bez aliasu "@/").

export type PaymentStatus =
  | { kind: "ZAPLACONA"; paidAt: Date }
  | { kind: "GOTOWKA" }
  | { kind: "PO_TERMINIE"; days: number }
  | { kind: "OCZEKUJE"; dueInDays: number | null }
  | { kind: "ZAPLANOWANY" }
  | { kind: "BEZ_FAKTURY" };

export type PaymentKind = PaymentStatus["kind"];

function dayIndex(d: Date): number {
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000;
}

export function invoicePaymentStatus(
  inv: { paidAt: Date | null; paymentType: string | null; paymentTo: Date | null; cashConfirmed: boolean },
  today: Date,
): PaymentStatus {
  if (inv.paidAt) return { kind: "ZAPLACONA", paidAt: inv.paidAt };
  if (inv.paymentType === "cash" || inv.cashConfirmed) return { kind: "GOTOWKA" };
  if (inv.paymentTo) {
    const diff = dayIndex(today) - dayIndex(inv.paymentTo);
    if (diff > 0) return { kind: "PO_TERMINIE", days: diff };
    return { kind: "OCZEKUJE", dueInDays: -diff };
  }
  return { kind: "OCZEKUJE", dueInDays: null };
}

// Wiersz bez faktury: przyszły wynajem = zaplanowany; odebrana gotówka
// (potwierdzenie kierowcy) = gotówka; reszta = brak faktury w systemie.
export function rentalWithoutInvoiceStatus(r: { startsAt: Date; cashConfirmed: boolean }, today: Date): PaymentStatus {
  if (dayIndex(r.startsAt) > dayIndex(today)) return { kind: "ZAPLANOWANY" };
  if (r.cashConfirmed) return { kind: "GOTOWKA" };
  return { kind: "BEZ_FAKTURY" };
}

const dm = (d: Date) => `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}`;

export function paymentLabel(s: PaymentStatus): string {
  switch (s.kind) {
    case "ZAPLACONA":
      return `Zapłacona ${dm(s.paidAt)}`;
    case "GOTOWKA":
      return "Gotówka";
    case "PO_TERMINIE":
      return `Po terminie ${s.days} ${s.days === 1 ? "dzień" : "dni"}`;
    case "OCZEKUJE":
      return s.dueInDays == null ? "Oczekuje" : s.dueInDays === 0 ? "Termin dziś" : `Oczekuje · ${s.dueInDays} ${s.dueInDays === 1 ? "dzień" : "dni"}`;
    case "ZAPLANOWANY":
      return "Zaplanowany";
    case "BEZ_FAKTURY":
      return "Brak faktury w systemie";
  }
}

export const isUnpaid = (s: PaymentStatus) => s.kind === "PO_TERMINIE" || s.kind === "OCZEKUJE";
