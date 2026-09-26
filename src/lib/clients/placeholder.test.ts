import { describe, expect, it } from "vitest";
import { isPlaceholderCompany, isPlaceholderEmail } from "./placeholder";

describe("dane zastępcze", () => {
  it("adresy e-mail", () => {
    for (const e of ["brak10@brak.pl", "BRAK1@brak.pl", "x@example.com", "brak@gmail.com", "brak_3@wp.pl", "nie@onet.pl"]) expect(isPlaceholderEmail(e), e).toBe(true);
    for (const e of ["miwini.studiourody@gmail.com", "joannabakalarz74@gmail.com", "brakowski@wp.pl", "", null]) expect(isPlaceholderEmail(e), String(e)).toBe(false);
  });
  it("firmy", () => {
    expect(isPlaceholderCompany({ name: null, domain: "brak.pl" })).toBe(true);
    expect(isPlaceholderCompany({ name: "  " })).toBe(true);
    expect(isPlaceholderCompany({ name: "Studio X", domain: "www.brak.pl" })).toBe(true);
    expect(isPlaceholderCompany({ name: "Studio Urody MiWiNi", domain: "miwini.pl" })).toBe(false);
  });
});
