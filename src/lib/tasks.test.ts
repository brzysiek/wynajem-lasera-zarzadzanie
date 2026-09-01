import { describe, expect, it } from "vitest";
import { dueChip, verbZlecil } from "./tasks";

describe("verbZlecil", () => {
  it("F -> zleciła", () => expect(verbZlecil("F")).toBe("zleciła"));
  it("M -> zlecił", () => expect(verbZlecil("M")).toBe("zlecił"));
  it("null -> zlecił (fallback)", () => expect(verbZlecil(null)).toBe("zlecił"));
  it("undefined -> zlecił (fallback)", () => expect(verbZlecil(undefined)).toBe("zlecił"));
});

describe("dueChip", () => {
  const TODAY = "2026-09-15";

  it("brak daty -> none, pusta etykieta", () => {
    expect(dueChip(null, "OPEN", TODAY)).toEqual({ kind: "none", label: "" });
  });
  it("dzisiejsza data -> today / Dzis", () => {
    expect(dueChip("2026-09-15", "OPEN", TODAY)).toEqual({ kind: "today", label: "Dziś" });
  });
  it("jutrzejsza data -> tomorrow / Jutro", () => {
    expect(dueChip("2026-09-16", "OPEN", TODAY)).toEqual({ kind: "tomorrow", label: "Jutro" });
  });
  it("wczorajsza data -> overdue / Wczoraj", () => {
    expect(dueChip("2026-09-14", "OPEN", TODAY)).toEqual({ kind: "overdue", label: "Wczoraj" });
  });
  it("dawno po terminie -> overdue z konkretna data", () => {
    const r = dueChip("2026-09-01", "OPEN", TODAY);
    expect(r.kind).toBe("overdue");
    expect(r.label).not.toBe("Wczoraj");
  });
  it("za kilka dni -> future z data, bez pilnosci", () => {
    expect(dueChip("2026-09-20", "OPEN", TODAY).kind).toBe("future");
  });
  it("DONE nie sygnalizuje pilnosci nawet po terminie", () => {
    expect(dueChip("2026-09-01", "DONE", TODAY).kind).toBe("future");
  });
});
