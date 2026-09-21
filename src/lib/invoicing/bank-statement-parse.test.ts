import { describe, expect, it } from "vitest";
import { parseBankStatementCsv } from "./bank-statement-parse";

// Wiersze wzięte 1:1 z realnego eksportu mBanku (lista_operacji_*.csv),
// żeby test odzwierciedlał prawdziwy format, nie wyobrażenie o nim.
const HEADER_LINES = [
  "mBank S.A. Bankowość Detaliczna;",
  "#Klient;",
  "ESTEGH SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ;",
  "Lista operacji;",
  "#Za okres:;",
  "01.09.2026;21.09.2026;",
  "      #Waluta;#Wpływy;#Wydatki;",
  "PLN;25 751,57;-26 226,66;",
  "#Data operacji;#Opis operacji;#Rachunek;#Kategoria;#Kwota;",
].join("\n");

const DATA_LINES = [
  '2026-09-21;"UPSELL.PL  ZAKUP PRZY UŻYCIU KARTY - INTERNET";"mBiznes konto premium z kredytem (gwarancja BGK) 4111 ... 9961";"Promocja i reklama";-217,71 PLN;;',
  '2026-09-03;"DERMA HARMONIA KLAUDIA GĄDEK, WYNAJEM LASERA  PROSZÓWKI 625  32-700 PROSZÓWKI PRZELEW WEWNĘTRZNY PRZYCHODZĄCY  53114020040000360285261371  ";"mBiznes konto premium z kredytem (gwarancja BGK) 4111 ... 9961";"Sprzedaż towarów i usług";897,90 PLN;;',
  '2026-09-08;"FIRMA USŁUGOWA BEAUTY BY EWA CAPUTAROMANA CIESIELSKIEGO 6/LU5 31-587 KRAKÓW, FV nr 02/08/2026  31-587 KRAKÓW PRZELEW ZEWNĘTRZNY PRZYCHODZĄCY  24105014451000009258520700  ";"mBiznes konto premium z kredytem (gwarancja BGK) 4111 ... 9961";"Wpływy - inne";1 512,90 PLN;;',
].join("\n");

describe("parseBankStatementCsv", () => {
  it("pomija linie nagłówka/metadanych (nie zaczynają się od daty)", () => {
    const rows = parseBankStatementCsv(HEADER_LINES);
    expect(rows).toHaveLength(0);
  });

  it("parsuje wiersze danych: datę, opis, kwotę", () => {
    const rows = parseBankStatementCsv(`${HEADER_LINES}\n${DATA_LINES}`);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ date: "2026-09-21", amount: -217.71 });
    expect(rows[0].description).toContain("UPSELL.PL");
  });

  it("wpływ (dodatnia kwota) z nazwą nadawcy w opisie", () => {
    const rows = parseBankStatementCsv(DATA_LINES);
    const derma = rows.find((r) => r.description.includes("DERMA HARMONIA"));
    expect(derma).toMatchObject({ date: "2026-09-03", amount: 897.9 });
  });

  it("kwota z separatorem tysięcy (spacja) parsuje się poprawnie", () => {
    const rows = parseBankStatementCsv(DATA_LINES);
    const beauty = rows.find((r) => r.description.includes("BEAUTY BY EWA CAPUTA"));
    expect(beauty?.amount).toBe(1512.9);
  });

  it("numer faktury w tytule przelewu zostaje w opisie (do dopasowania)", () => {
    const rows = parseBankStatementCsv(DATA_LINES);
    const beauty = rows.find((r) => r.description.includes("FV nr 02/08/2026"));
    expect(beauty).toBeDefined();
  });

  it("puste linie i linie bez poprawnej kwoty są pomijane", () => {
    const rows = parseBankStatementCsv("\n\n2026-09-01;\"coś bez kwoty\";\"konto\";\"kat\";;;\n");
    expect(rows).toHaveLength(0);
  });
});
