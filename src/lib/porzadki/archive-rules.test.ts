import { describe, expect, it } from "vitest";
import { parseArchiveInput, parseTypeIds } from "./archive-rules";

describe("parseArchiveInput", () => {
  it("powód i dopisek wymagane", () => {
    expect(parseArchiveInput({}).ok).toBe(false);
    expect(parseArchiveInput({ reason: "SPAM" }).ok).toBe(false);
    expect(parseArchiveInput({ reason: "SPAM", note: "  " }).ok).toBe(false);
    expect(parseArchiveInput({ reason: "KOSZ", note: "x" }).ok).toBe(false);
  });
  it("klucze angielskie i polskie", () => {
    expect(parseArchiveInput({ reason: "SPOZA_BRANZY", note: " firma budowlana ", batch: "P-1" })).toEqual({ ok: true, value: { reason: "SPOZA_BRANZY", note: "firma budowlana", batch: "P-1" } });
    expect(parseArchiveInput({ powod: "DUPLIKAT", dopisek: "ten sam NIP", paczka: "" })).toEqual({ ok: true, value: { reason: "DUPLIKAT", note: "ten sam NIP", batch: null } });
  });
});

describe("parseTypeIds", () => {
  it("typ i lista identyfikatorów", () => {
    expect(parseTypeIds({ type: "client", ids: ["a", "", 3, "b"] })).toEqual({ type: "client", ids: ["a", "b"] });
    expect(parseTypeIds({ type: "rental", ids: ["a"] })).toBeNull();
    expect(parseTypeIds({ type: "lead", ids: [] })).toBeNull();
    expect(parseTypeIds(null)).toBeNull();
  });
});
