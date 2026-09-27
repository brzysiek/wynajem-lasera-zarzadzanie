// Status płatności faktury / wynajmu na karcie klienta (prompt 3B-karta,
// sekcja 1; wniosek 6). Wpłaty pochodzą z importu CSV z banku w Finansach
// (FakturowniaPayment — dopasowanie przelewu albo ręczne oznaczenie), nie
// z Fakturowni. „Po terminie” tylko dla faktur, które import sprawdził:
// wystawionych od początku śledzenia wpłat i z terminem nie późniejszym niż
// ostatni dzień wgranego wyciągu. Pozostałe nieopłacone = „nie sprawdzono”.
// Klient może płacić gotówką (np. MiWiNi raz gotówką, raz przelewem), więc
// brak przelewu = „po terminie” tylko u klienta z formą płatności PRZELEW;
// u pozostałych = „brak przelewu” (do sprawdzenia: gotówka? przypomnienie?).
// Gotówkę oznacza się ręcznie na karcie (data, kto przyjął).
// Czyste funkcje bez zależności (vitest bez aliasu "@/").
import { BANK_STATEMENT_SINCE } from "../invoicing/bank-since";

export type PaymentStatus =
  | { kind: "ZAPLACONA"; paidAt: Date; partial: boolean; method?: "CASH" | "TRANSFER" | "MANUAL" | null; receivedBy?: string | null }
  | { kind: "GOTOWKA" }
  | { kind: "PO_TERMINIE"; days: number }
  | { kind: "OCZEKUJE"; dueInDays: number | null }
  | { kind: "NIE_SPRAWDZONO"; days: number | null } // days = ile po terminie (informacyjnie)
  | { kind: "BRAK_PRZELEWU"; days: number } // wyciąg obejmuje termin, przelewu nie ma — gotówka?
  | { kind: "ZAPLANOWANY" }
  | { kind: "BEZ_FAKTURY" }
  | { kind: "ARCHIWALNA" }; // faktura z Excela sprzed Fakturowni (wniosek 9) — bez danych o wpłacie

export type PaymentKind = PaymentStatus["kind"];

// Przelew księguje się z opóźnieniem, a klienci płacą w dniu terminu —
// „po terminie” dopiero, gdy wyciąg obejmuje co najmniej 5 dni po terminie.
export const PAYMENT_GRACE_DAYS = 5;

// Okres, który sprawdzają importy wyciągów: od początku śledzenia wpłat
// do ostatniego dnia w wgranych plikach. null = nic jeszcze nie wgrano.
export type PaymentCoverage = { from: Date; to: Date } | null;

// Zakres sprawdzony przez wgrane wyciągi: od początku śledzenia (albo od
// pierwszego dnia w plikach, jeśli późniejszy) do ostatniego dnia w plikach.
// Wgrania sprzed zapisywania okresu liczą się do dnia wgrania.
export function paymentCoverage(uploads: { periodFrom: Date | null; periodTo: Date | null; uploadedAt: Date }[]): PaymentCoverage {
  if (!uploads.length) return null;
  const since = new Date(`${BANK_STATEMENT_SINCE}T12:00:00.000Z`);
  const firsts = uploads.map((u) => u.periodFrom ?? since);
  const from = new Date(Math.max(since.getTime(), Math.min(...firsts.map((d) => d.getTime()))));
  const to = new Date(Math.max(...uploads.map((u) => (u.periodTo ?? u.uploadedAt).getTime())));
  return { from, to };
}

function dayIndex(d: Date): number {
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000;
}

export type InvoicePaymentInput = {
  paidAt: Date | null; // FakturowniaPayment.paidAt
  paidAmount?: number | null; // kwota przelewu, gdy opłacona przelewem z wyciągu
  paidMethod?: "CASH" | "TRANSFER" | "MANUAL" | null;
  paidReceivedBy?: string | null;
  clientPaymentForm?: string | null; // GOTOWKA | PRZELEW | OBA (Client.paymentForm)
  totalGross?: number | null;
  paymentType: string | null;
  paymentTo: Date | null;
  issueDate?: Date | null;
  cashConfirmed: boolean;
  archived?: boolean; // faktura z Excela (ujemny fakturowniaInvoiceId)
};

export function invoicePaymentStatus(inv: InvoicePaymentInput, today: Date, coverage: PaymentCoverage = null): PaymentStatus {
  if (inv.paidAt) {
    const partial = inv.paidAmount != null && inv.totalGross != null && inv.paidAmount < inv.totalGross - 0.01;
    return { kind: "ZAPLACONA", paidAt: inv.paidAt, partial, method: inv.paidMethod ?? null, receivedBy: inv.paidReceivedBy ?? null };
  }
  if (inv.archived) return { kind: "ARCHIWALNA" };
  if (inv.paymentType === "cash" || inv.cashConfirmed) return { kind: "GOTOWKA" };
  const due = inv.paymentTo ?? inv.issueDate ?? null;
  if (!due) return { kind: "OCZEKUJE", dueInDays: null };
  const diff = dayIndex(today) - dayIndex(due);
  if (diff <= 0) return { kind: "OCZEKUJE", dueInDays: -diff };
  const checked =
    coverage != null &&
    (!inv.issueDate || dayIndex(inv.issueDate) >= dayIndex(coverage.from)) &&
    dayIndex(due) + PAYMENT_GRACE_DAYS <= dayIndex(coverage.to);
  if (!checked) return { kind: "NIE_SPRAWDZONO", days: diff };
  return inv.clientPaymentForm === "PRZELEW" ? { kind: "PO_TERMINIE", days: diff } : { kind: "BRAK_PRZELEWU", days: diff };
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
      return s.method === "CASH"
        ? `Gotówka ${dm(s.paidAt)}${s.receivedBy ? ` · ${s.receivedBy}` : ""}`
        : `${s.partial ? "Częściowo zapłacona" : "Zapłacona"} ${dm(s.paidAt)}`;
    case "GOTOWKA":
      return "Gotówka";
    case "PO_TERMINIE":
      return `Po terminie ${s.days} ${s.days === 1 ? "dzień" : "dni"}`;
    case "OCZEKUJE":
      return s.dueInDays == null ? "Oczekuje" : s.dueInDays === 0 ? "Termin dziś" : `Oczekuje · ${s.dueInDays} ${s.dueInDays === 1 ? "dzień" : "dni"}`;
    case "NIE_SPRAWDZONO":
      return "Nie sprawdzono";
    case "BRAK_PRZELEWU":
      return "Brak przelewu";
    case "ZAPLANOWANY":
      return "Zaplanowany";
    case "BEZ_FAKTURY":
      return "Brak faktury w systemie";
    case "ARCHIWALNA":
      return "Archiwalna (Excel)";
  }
}

export const isUnpaid = (s: PaymentStatus) => s.kind === "PO_TERMINIE" || s.kind === "OCZEKUJE";
