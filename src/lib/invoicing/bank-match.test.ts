import { describe, expect, it } from "vitest";
import { matchTransactionsToInvoices } from "./bank-match";
import type { BankTransaction } from "./bank-statement-parse";

const tx = (over: Partial<BankTransaction>): BankTransaction => ({ date: "2026-09-03", description: "", amount: 0, ...over });

describe("matchTransactionsToInvoices", () => {
  it("dopasowuje po kwocie + tokenie nazwy nabywcy w opisie", () => {
    const matches = matchTransactionsToInvoices(
      [tx({ description: "DERMA HARMONIA KLAUDIA GĄDEK, WYNAJEM LASERA", amount: 897.9 })],
      [{ id: 1, number: "041/09/2026", buyerName: "Derma Harmonia Klaudia Gądek", priceGross: "897.90" }],
    );
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ invoiceId: 1 });
    expect(matches[0].candidates).toHaveLength(1);
  });

  it("dopasowuje po numerze faktury w opisie, nawet gdy kwota się nie zgadza", () => {
    const matches = matchTransactionsToInvoices(
      [tx({ description: "PRZELEW ZEWNĘTRZNY, FV nr 02/08/2026", amount: 1500 })],
      [{ id: 2, number: "02/08/2026", buyerName: "Firma Usługowa Beauty by Ewa Caputa", priceGross: "1512.90" }],
    );
    expect(matches).toHaveLength(1);
    expect(matches[0].invoiceId).toBe(2);
  });

  it("nie dopasowuje transakcji wychodzących (ujemna kwota)", () => {
    const matches = matchTransactionsToInvoices(
      [tx({ description: "Derma Harmonia zwrot", amount: -897.9 })],
      [{ id: 1, number: "041/09/2026", buyerName: "Derma Harmonia", priceGross: "897.90" }],
    );
    expect(matches).toHaveLength(0);
  });

  it("sama zgodność kwoty bez nazwy nabywcy w opisie NIE wystarcza", () => {
    const matches = matchTransactionsToInvoices(
      [tx({ description: "ANTHROPIC ZAKUP PRZY UŻYCIU KARTY", amount: 897.9 })],
      [{ id: 1, number: "041/09/2026", buyerName: "Derma Harmonia Klaudia Gądek", priceGross: "897.90" }],
    );
    expect(matches).toHaveLength(0);
  });

  it("kilka pasujących transakcji tej samej kwoty = niejednoznaczne (candidates.length > 1)", () => {
    const matches = matchTransactionsToInvoices(
      [
        tx({ description: "Klinika Uroda wpłata 1", amount: 2300, date: "2026-09-05" }),
        tx({ description: "Klinika Uroda wpłata 2", amount: 2300, date: "2026-09-09" }),
      ],
      [{ id: 3, number: "037/09/2026", buyerName: "Klinika Uroda sp. z o.o.", priceGross: "2300.00" }],
    );
    expect(matches).toHaveLength(1);
    expect(matches[0].candidates).toHaveLength(2);
  });

  it("faktura bez żadnego kandydata nie pojawia się w wyniku", () => {
    const matches = matchTransactionsToInvoices(
      [tx({ description: "coś zupełnie innego", amount: 50 })],
      [{ id: 4, number: "099/09/2026", buyerName: "Gabinet Wenus", priceGross: "1100.00" }],
    );
    expect(matches).toHaveLength(0);
  });
});
