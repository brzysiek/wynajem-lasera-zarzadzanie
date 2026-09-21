import type { BankTransaction } from "./bank-statement-parse";

export type MatchableInvoice = { id: number; number: string; buyerName: string; priceGross: string };

export type InvoiceMatch = {
  invoiceId: number;
  candidates: BankTransaction[];
};

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

// Tokeny nazwy nabywcy warte porównywania — pomijamy krótkie ogólniki
// ("sp", "z", "o", "o.o.") które i tak pasowałyby wszędzie.
function significantTokens(name: string): string[] {
  return normalize(name)
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 4);
}

// Dla każdej niezapłaconej faktury szuka transakcji przychodzących (dodatnia
// kwota), które mogą być jej zapłatą — dwa niezależne sygnały:
//   1. numer faktury (same cyfry) widoczny w opisie przelewu (klient wpisał
//      go w tytule) — silny sygnał, nie wymaga zgodności kwoty (np. gdy
//      klient zapłacił zaliczkowo/z korektą),
//   2. dokładna zgodność kwoty ORAZ nazwa nabywcy (którykolwiek istotny
//      token) widoczna w opisie.
// Jedna faktura z dokładnie jednym kandydatem = pewne dopasowanie (wywołujący
// może od razu oznaczyć jako zapłaconą); więcej niż jeden = niejednoznaczne,
// zostaje do ręcznego oznaczenia (patrz PATCH .../paid, już istniejący
// przełącznik w dashboardzie — nie budujemy osobnego selektora kandydatów).
export function matchTransactionsToInvoices(transactions: BankTransaction[], invoices: MatchableInvoice[]): InvoiceMatch[] {
  const incoming = transactions.filter((t) => t.amount > 0);

  return invoices
    .map((inv): InvoiceMatch => {
      const invoiceNumberDigits = inv.number.replace(/[^0-9]/g, "");
      const invoiceAmount = Number(inv.priceGross);
      const buyerTokens = significantTokens(inv.buyerName);

      const candidates = incoming.filter((tx) => {
        const descNorm = normalize(tx.description);
        const numberHit = invoiceNumberDigits.length >= 3 && descNorm.replace(/[^0-9]/g, "").includes(invoiceNumberDigits);
        if (numberHit) return true;
        const amountHit = Number.isFinite(invoiceAmount) && Math.abs(tx.amount - invoiceAmount) < 0.01;
        const nameHit = buyerTokens.some((t) => descNorm.includes(t));
        return amountHit && nameHit;
      });

      return { invoiceId: inv.id, candidates };
    })
    .filter((m) => m.candidates.length > 0);
}
