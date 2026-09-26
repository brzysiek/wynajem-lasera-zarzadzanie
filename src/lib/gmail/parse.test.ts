import { describe, expect, it } from "vitest";
import { buildAddressIndex, classifyEmail, headerMap, historyQuery, htmlToText, isAutomated, isSkippedByLabels, parseAddresses } from "./parse";

const own = (a: string) => a.endsWith("@wynajemlasera.pl");
const index = buildAddressIndex([
  { clientId: "c1", contactId: "p1", email: "Anna@Gabinet-Aurora.pl" },
  { clientId: "c2", contactId: "p2", email: "ewa@gmail.com" },
  { clientId: "c3", contactId: "p3", email: "a@wspolna.pl" },
  { clientId: "c4", contactId: "p4", email: "b@wspolna.pl" },
]);

describe("parseAddresses", () => {
  it("wyciąga adresy z nagłówka", () => {
    expect(parseAddresses('Anna Nowak <Anna@X.pl>, "Kowalska, Ewa" <ewa@y.pl>, z@z.pl')).toEqual(["anna@x.pl", "ewa@y.pl", "z@z.pl"]);
    expect(parseAddresses(null)).toEqual([]);
  });
});

describe("classifyEmail", () => {
  it("od klientki = IN, do klientki = OUT", () => {
    expect(classifyEmail({ from: ["ewa@gmail.com"], to: ["kontakt@wynajemlasera.pl"], cc: [] }, index, own)).toMatchObject({
      direction: "IN",
      clientId: "c2",
      clientContactId: "p2",
      matchMethod: "EMAIL",
    });
    expect(classifyEmail({ from: ["kontakt@wynajemlasera.pl"], to: ["x@y.pl"], cc: ["anna@gabinet-aurora.pl"] }, index, own)).toMatchObject({
      direction: "OUT",
      clientId: "c1",
    });
  });

  it("nowy adres w firmowej domenie klienta = propozycja (DOMAIN)", () => {
    expect(classifyEmail({ from: ["recepcja@gabinet-aurora.pl"], to: ["kontakt@wynajemlasera.pl"], cc: [] }, index, own)).toMatchObject({
      clientId: "c1",
      clientContactId: null,
      matchMethod: "DOMAIN",
    });
  });

  it("darmowa domena i domena wspólna dla kilku klientów — nie zgadujemy", () => {
    expect(classifyEmail({ from: ["inna@gmail.com"], to: ["kontakt@wynajemlasera.pl"], cc: [] }, index, own)).toBeNull();
    expect(classifyEmail({ from: ["c@wspolna.pl"], to: ["kontakt@wynajemlasera.pl"], cc: [] }, index, own)).toBeNull();
  });

  it("nadawca spoza bazy, klientka w DW — też jej korespondencja", () => {
    expect(classifyEmail({ from: ["ksiegowa@biuro.pl"], to: ["kontakt@wynajemlasera.pl"], cc: ["ewa@gmail.com"] }, index, own)).toMatchObject({
      direction: "IN",
      clientId: "c2",
      matchMethod: "EMAIL",
    });
  });

  it("korespondencja spoza bazy klientów nie trafia do panelu", () => {
    expect(classifyEmail({ from: ["faktury@dostawca.pl"], to: ["kontakt@wynajemlasera.pl"], cc: [] }, index, own)).toBeNull();
  });
});

describe("filtry", () => {
  it("auto-odpowiedzi", () => {
    expect(isAutomated(headerMap([{ name: "Auto-Submitted", value: "auto-replied" }]))).toBe(true);
    expect(isAutomated(headerMap([{ name: "Subject", value: "Automatyczna odpowiedź: urlop" }]))).toBe(true);
    expect(isAutomated(headerMap([{ name: "Subject", value: "Re: wynajem lasera" }]))).toBe(false);
  });
  it("szkice, spam, kosz", () => {
    expect(isSkippedByLabels(["DRAFT"])).toBe(true);
    expect(isSkippedByLabels(["INBOX", "UNREAD"])).toBe(false);
  });
  it("zapytanie historii", () => {
    expect(historyQuery(["a@b.pl"])).toBe("{from:a@b.pl to:a@b.pl cc:a@b.pl} -in:chats -in:drafts");
  });
  it("HTML → tekst bez skryptów", () => {
    expect(htmlToText("<p>Dzień dobry,</p><script>alert(1)</script><p>cena&nbsp;1&nbsp;500 zł</p>")).toBe("Dzień dobry,\ncena 1 500 zł");
  });
});
