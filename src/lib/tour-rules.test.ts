import { describe, expect, it } from "vitest";
import { vocative } from "./tour-rules";

describe("powitanie przewodnika", () => {
  it("wołacz imienia", () => {
    expect(vocative("Ania")).toBe("Aniu");
    expect(vocative("Tomek Kowalski")).toBe("Tomku");
    expect(vocative("Zosia")).toBe("Zosiu");
    expect(vocative("Marek")).toBe("Marek");
    expect(vocative("")).toBe("");
  });
});
