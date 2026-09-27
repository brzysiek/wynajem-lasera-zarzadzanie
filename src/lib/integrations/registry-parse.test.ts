import { describe, expect, it } from "vitest";
import { parseCeidg, parseWhiteList, planEnrichment, splitAddress } from "./registry-parse";

describe("Biała lista MF", () => {
  it("podmiot → REGON, status VAT, adres, rachunki", () => {
    const body = {
      result: {
        subject: {
          name: "STUDIO URODY „MIWINI” BARBARA TRZASKA",
          nip: "9441828201",
          statusVat: "Czynny",
          regon: "526905596",
          residenceAddress: null,
          workingAddress: "RUDAWSKA 4, 32-064 RUDAWA",
          accountNumbers: ["12105000000000000000000000", "zły"],
        },
        requestId: "x",
      },
    };
    expect(parseWhiteList(body)).toEqual({
      name: "STUDIO URODY „MIWINI” BARBARA TRZASKA",
      regon: "526905596",
      vatStatus: "Czynny",
      bankAccounts: ["12105000000000000000000000"],
      street: "Rudawska 4",
      zip: "32-064",
      city: "Rudawa",
    });
    expect(parseWhiteList({ result: { subject: null } })).toBeNull();
  });
  it("adres z wersalików", () => {
    expect(splitAddress("UL. JANA PAWŁA II 12/3, 30-001 KRAKÓW")).toEqual({ street: "ul. Jana Pawła II 12/3", zip: "30-001", city: "Kraków" });
  });
});

describe("CEIDG", () => {
  it("firma → data rozpoczęcia, PKD, REGON, forma", () => {
    const body = {
      firma: [
        {
          nazwa: "Studio Urody „MiWiNi” Barbara Trzaska",
          dataRozpoczecia: "2023-12-02",
          wlasciciel: { imie: "Barbara", nazwisko: "Trzaska", nip: "9441828201", regon: "526905596" },
          adresDzialalnosci: { ulica: "Rudawska", budynek: "4", kod: "32-064", miasto: "Rudawa" },
          pkdGlowny: { kod: "96.02.Z", nazwa: "Fryzjerstwo i pozostałe zabiegi kosmetyczne" },
          pkd: [{ kod: "96.02.Z" }, { kod: "8559B" }, "47.75.Z"],
        },
      ],
    };
    expect(parseCeidg(body)).toEqual({
      legalForm: "JDG",
      name: "Studio Urody „MiWiNi” Barbara Trzaska",
      businessStartDate: "2023-12-02",
      regon: "526905596",
      street: "ul. Rudawska 4",
      zip: "32-064",
      city: "Rudawa",
      pkd: [
        { code: "96.02.Z", name: "Fryzjerstwo i pozostałe zabiegi kosmetyczne", main: true },
        { code: "85.59.B", name: null, main: false },
        { code: "47.75.Z", name: null, main: false },
      ],
    });
    expect(parseCeidg({ firma: [] })).toBeNull();
  });
});

describe("plan uzupełnienia", () => {
  it("nie nadpisuje pól zablokowanych ani nazwy / adresu biura", () => {
    const plan = planEnrichment(
      { name: "MiWiNi", street: "Rudawska 4", regon: null, vatStatus: "Czynny", businessStartDate: new Date("2023-12-02T12:00:00Z"), pkd: null },
      { name: "STUDIO", street: "Rudawska 4", regon: "526905596", vatStatus: "Czynny", businessStartDate: "2023-12-02", pkd: [{ code: "96.02.Z", name: null, main: true }], legalForm: "JDG" },
      (f) => f === "legalForm",
    );
    expect(plan).toEqual({ regon: "526905596", pkd: [{ code: "96.02.Z", name: null, main: true }] });
  });
});
