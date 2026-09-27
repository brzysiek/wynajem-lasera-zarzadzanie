import { describe, expect, it } from "vitest";
import { buildExclusionMatcher, emailHideReason, normalizeExclusion, parseExclusionList, suggestExclusionDomains, withoutExcluded } from "./exclusion-rules";

const match = buildExclusionMatcher([
  { kind: "EXCLUDE", value: "edina.pl" },
  { kind: "EXCLUDE", value: "rightspace.pl" },
  { kind: "EXCLUDE", value: "szymon.fogel@gmail.com" },
  { kind: "HIDE", value: "kreatywnainzynieria.pl" },
]);
const isOwn = (a: string) => a.endsWith("@wynajemlasera.pl");

describe("lista wykluczeń", () => {
  it("normalizacja wpisów", () => {
    expect(normalizeExclusion("https://www.Edina.pl/kontakt")).toEqual({ ok: true, value: "edina.pl" });
    expect(normalizeExclusion("@tylia.pl")).toEqual({ ok: true, value: "tylia.pl" });
    expect(normalizeExclusion(" Wach.Kuba@gmail.com ")).toEqual({ ok: true, value: "wach.kuba@gmail.com" });
    expect(normalizeExclusion("nie domena").ok).toBe(false);
    expect(parseExclusionList("edina.pl, tylia.pl\nrightspace.pl; edina.pl\nbłąd")).toEqual({ values: ["edina.pl", "tylia.pl", "rightspace.pl"], errors: ["„błąd” to nie domena ani adres e-mail."] });
  });
  it("dopasowanie adresu, domeny i subdomeny", () => {
    expect(match("jan@edina.pl")).toBe("EXCLUDE");
    expect(match("jan@biuro.edina.pl")).toBe("EXCLUDE");
    expect(match("szymon.fogel@gmail.com")).toBe("EXCLUDE");
    expect(match("inna@gmail.com")).toBeNull();
    expect(match("tomek@kreatywnainzynieria.pl")).toBe("HIDE");
  });
  it("maile: wykluczone, inżynieria ukryta, laser z inżynierii widoczny", () => {
    expect(emailHideReason({ from: ["jan@edina.pl"], to: ["kontakt@wynajemlasera.pl"], cc: [], subject: "wr-edina-termin realizacji", snippet: null }, match, isOwn)).toBe("EXCLUDED");
    // Klientka + ktoś spoza listy — nie wykluczamy całości.
    expect(emailHideReason({ from: ["jan@edina.pl"], to: ["klientka@salon.pl"], cc: [], subject: "x", snippet: null }, match, isOwn)).toBeNull();
    expect(emailHideReason({ from: ["tomek@kreatywnainzynieria.pl"], to: ["m.grylewicz@gmail.com"], cc: [], subject: "Budowa Trockiego — harmonogram", snippet: "Pani Małgorzato, przesyłam…" }, match, isOwn)).toBe("ENGINEERING");
    expect(emailHideReason({ from: ["tomek@kreatywnainzynieria.pl"], to: ["szumilas@salon.pl"], cc: [], subject: "Wynajem lasera w listopadzie", snippet: null }, match, isOwn)).toBeNull();
    expect(emailHideReason({ from: ["tomek@kreatywnainzynieria.pl"], to: ["x@salon.pl"], cc: [], subject: "Oferta LightSheer", snippet: null }, match, isOwn)).toBeNull();
  });
  it("import z HubSpota bez wykluczonych osób; propozycja domen po archiwizacji", () => {
    const plan = withoutExcluded(
      [
        { key: "a", contacts: [{ email: "jan@edina.pl" }] },
        { key: "b", contacts: [{ email: "ewa@salon.pl" }, { email: "szymon.fogel@gmail.com" }] },
      ],
      match,
    );
    expect(plan).toEqual([{ key: "b", contacts: [{ email: "ewa@salon.pl" }] }]);
    expect(suggestExclusionDomains(["a@tylia.pl", "b@gmail.com", "c@edina.pl", null, "d@tylia.pl"], new Set(["gmail.com"]), match)).toEqual(["tylia.pl"]);
  });
});
