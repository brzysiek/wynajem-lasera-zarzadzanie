import { describe, expect, it } from "vitest";
import { groupAttribution, normalizeAttribution, shortenId } from "./attribution-view";

describe("groupAttribution", () => {
  const attr = {
    utm_source: "google",
    utm_campaign: "meta-test",
    gclid: "Cj0KCQjw-DLUGAGCLID-0123456789abcdefghijklmnop",
    last_utm_source: "facebook",
    last_fbclid: "",
    fbp: "fb.1.1696000000000.123456789",
    landing_url: "https://wynajemlasera.pl/lightsheer/?utm_source=google",
    form: "kontakt",
    "acceptance-752": "1",
    "acceptance-100": "",
  };
  it("grupuje i ukrywa puste pola oraz puste grupy", () => {
    const g = groupAttribution(attr);
    expect(g.map((x) => x.title)).toEqual(["Pierwsze wejście", "Ostatnie wejście", "Meta (cookies, za zgodą)", "Strona i zgody"]);
    expect(g[0].rows.map((r) => r.key)).toEqual(["utm_source", "utm_campaign", "gclid"]);
    expect(g[1].rows.map((r) => r.key)).toEqual(["last_utm_source"]); // last_fbclid pusty
    expect(g[3].rows.map((r) => `${r.key}=${r.value}`)).toEqual(["landing_url=https://wynajemlasera.pl/lightsheer/?utm_source=google", "form=kontakt", "acceptance-100=nie", "acceptance-752=✓ tak"]);
  });
  it("bez danych — brak grup (sekcja się nie pokazuje)", () => {
    expect(groupAttribution(null)).toEqual([]);
    expect(groupAttribution({})).toEqual([]);
    expect(groupAttribution({ utm_source: "  " })).toEqual([]);
  });
  it("brak fbp/fbc → bez grupy Meta", () => {
    expect(groupAttribution({ utm_source: "x" }).some((g) => g.title.startsWith("Meta"))).toBe(false);
  });
});

describe("normalizeAttribution", () => {
  it("zostawia teksty i listy tekstów, resztę odrzuca", () => {
    expect(normalizeAttribution({ a: "1", b: ["x", "y"], c: 5, d: { z: 1 }, e: [1] })).toEqual({ a: "1", b: ["x", "y"] });
    expect(normalizeAttribution(null)).toBeNull();
    expect(normalizeAttribution([])).toBeNull();
    expect(normalizeAttribution({ c: 5 })).toBeNull();
  });
});

describe("shortenId", () => {
  it("krótkie bez zmian, długie skrócone z początkiem i końcem", () => {
    expect(shortenId("abc123")).toBe("abc123");
    const long = "Cj0KCQjw-DLUGAGCLID-0123456789abcdefghijklmnop";
    const s = shortenId(long);
    expect(s.length).toBe(28);
    expect(s.startsWith("Cj0KCQjw")).toBe(true);
    expect(s.endsWith(long.slice(-10))).toBe(true);
    expect(s).toContain("…");
  });
});
