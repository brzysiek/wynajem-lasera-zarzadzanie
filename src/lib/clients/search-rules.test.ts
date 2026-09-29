import { describe, expect, it } from "vitest";
import { emailKey, nipKey, parseClientQuery, phoneKey, splitPersonName } from "./search-rules";

describe("wyszukiwarka klienta (wniosek 23)", () => {
  it("telefon w dowolnym zapisie → ostatnie 9 cyfr", () => {
    expect(phoneKey("+48 500-100-200")).toBe("500100200");
    expect(phoneKey("500100200")).toBe("500100200");
    expect(phoneKey("12 34")).toBeNull();
  });
  it("e-mail i NIP", () => {
    expect(emailKey(" Ania@Example.PL ")).toBe("ania@example.pl");
    expect(emailKey("brak")).toBeNull();
    expect(nipKey("734-107-09-56")).toBe("7341070956");
  });
  it("zapytanie: tekst albo cyfry", () => {
    expect(parseClientQuery("Rdzawka")).toEqual({ text: "Rdzawka", digits: null });
    expect(parseClientQuery("+48 500 100 200")).toEqual({ text: null, digits: "500100200" });
    expect(parseClientQuery("Salon 7")).toEqual({ text: "Salon 7", digits: null });
  });
  it("imię i nazwisko vs nazwa gabinetu", () => {
    expect(splitPersonName("Maria Jarząbek")).toEqual({ firstName: "Maria", lastName: "Jarząbek" });
    expect(splitPersonName("Salon Naturelle")).toEqual({ firstName: null, lastName: null });
  });
});
