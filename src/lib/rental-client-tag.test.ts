import { describe, expect, it } from "vitest";
import { parseClientTag, stripClientTag, withClientTag } from "./rental-client-tag";

describe("klient w wydarzeniu Google (wniosek 23)", () => {
  it("znacznik w opisie: odczyt, dopisanie jednego, usunięcie do edycji", () => {
    expect(parseClientTag("Dostawa 9:00\n\n[klient:cmuhfo7tg004wbhiph05pziyc]")).toBe("cmuhfo7tg004wbhiph05pziyc");
    expect(parseClientTag("bez znacznika")).toBeNull();
    const d = withClientTag("Dostawa 9:00\n\n[klient:stary123456]", "nowy1234567");
    expect(d).toBe("Dostawa 9:00\n\n[klient:nowy1234567]");
    expect(stripClientTag(d)).toBe("Dostawa 9:00");
    expect(withClientTag(null, "abc123456")).toBe("[klient:abc123456]");
    expect(withClientTag("opis [klient:abc123456]", null)).toBe("opis");
  });
});
