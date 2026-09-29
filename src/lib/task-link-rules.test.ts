import { describe, expect, it } from "vitest";
import { allLinksResolved, linksFromArrays, rentalChipLabel, rentalIssues, type RentalIssueInput } from "./task-link-rules";

const finance: NonNullable<RentalIssueInput["finance"]> = {
  deviceVariant: "dye_vl",
  totalNet: 870,
  baseNet: 800,
  pulseNet: null,
  transportNet: 70,
  transportSeparate: false,
  capUsed: null,
  capCount: null,
  capFee: null,
  membraneUsed: null,
  membraneCount: null,
  membraneFee: null,
};
const rental = (x: Partial<RentalIssueInput> = {}): RentalIssueInput => ({ eventType: "WYNAJEM", clientId: "c1", variantOptions: ["dye_vl", "dye_vl_ipixel"], finance, ...x });

describe("powiązania zadań (wniosek 22)", () => {
  it("braki wynajmu liczone z danych; poprawiony = []", () => {
    expect(rentalIssues(rental())).toEqual([]);
    expect(rentalIssues(rental({ clientId: null, finance: null }))).toEqual(["brak klienta", "brak kwoty"]);
    expect(rentalIssues(rental({ finance: { ...finance, deviceVariant: null } }))).toEqual(["brak wariantu"]);
    expect(rentalIssues(rental({ finance: { ...finance, totalNet: 900 } }))).toEqual(["kwota ≠ pozycje"]);
    expect(rentalIssues(rental({ finance: { ...finance, transportSeparate: true, totalNet: 800 } }))).toEqual([]);
  });

  it("chip wynajmu i podpowiedź zamknięcia", () => {
    expect(rentalChipLabel("Alma", new Date(2026, 10, 5), "Karpierz")).toBe("Alma · 05.11 · Karpierz");
    expect(allLinksResolved([{ kind: "RENTAL", refId: "r", label: "", href: null, issues: [] }])).toBe(true);
    expect(allLinksResolved([{ kind: "RENTAL", refId: "r", label: "", href: null, issues: ["brak kwoty"] }])).toBe(false);
    expect(allLinksResolved([{ kind: "CLIENT", refId: "c", label: "", href: null, issues: null }])).toBe(false);
  });

  it("tablice ID z MCP → powiązania bez powtórzeń; brak pól = bez zmian", () => {
    expect(linksFromArrays({})).toBeNull();
    expect(linksFromArrays({ wynajmy: ["r1", "r1"], klienci: ["c1"] })).toEqual([
      { kind: "RENTAL", refId: "r1" },
      { kind: "CLIENT", refId: "c1" },
    ]);
    expect(() => linksFromArrays({ faktury: "x" })).toThrow();
  });
});
