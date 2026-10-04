import { describe, expect, it } from "vitest";
import { proposalFilters } from "./http";

describe("proposalFilters — zakres (skrzynka Tomka)", () => {
  const scope = (q: string) => proposalFilters(new URLSearchParams(q)).scope;
  it("domyślnie backlog deweloperski", () => {
    expect(scope("")).toBe("dev");
    expect(scope("status=open")).toBe("dev");
  });
  it("skrzynka=1 → skrzynka, skrzynka=all → wszystkie", () => {
    expect(scope("skrzynka=1")).toBe("inbox");
    expect(scope("skrzynka=true")).toBe("inbox");
    expect(scope("skrzynka=all")).toBe("all");
  });
});
