import { describe, expect, it } from "vitest";
import { Prisma } from "./types";
import { formatPln } from "./format";

// Nie asertujemy dokładnego separatora tysięcy — pl-PL w różnych wersjach ICU
// używa U+00A0 albo U+202F. Sprawdzamy sens: cyfry, przecinek dziesiętny, "zł".
const norm = (s: string) => s.replace(/\s+/g, " ");

describe("formatPln", () => {
  it("kwota całkowita — bez groszy", () => {
    expect(norm(formatPln(new Prisma.Decimal(1720)))).toBe("1 720 zł");
  });
  it("kwota z groszami — przecinek + 2 miejsca", () => {
    expect(norm(formatPln(new Prisma.Decimal("1234.10")))).toBe("1 234,10 zł");
  });
  it("przyjmuje number i string", () => {
    expect(formatPln(70)).toBe("70 zł");
    expect(norm(formatPln("2500"))).toBe("2 500 zł");
  });
  it("wartość niepoprawna → myślnik", () => {
    expect(formatPln(Number.NaN)).toBe("—");
  });
});
