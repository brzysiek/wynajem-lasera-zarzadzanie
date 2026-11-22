import { describe, expect, it } from "vitest";
import { actsAsDriver, isDriverOwnPreview, isDriverPreview } from "./effective-role";

describe("podgląd kierowcy", () => {
  it("oba tryby (driver, driver_own) to podgląd tylko dla ADMIN/STAFF z canActAsDriver", () => {
    for (const v of ["driver", "driver_own"]) {
      expect(isDriverPreview("ADMIN", true, v)).toBe(true);
      expect(actsAsDriver("ADMIN", true, v)).toBe(true);
      expect(isDriverPreview("ADMIN", false, v)).toBe(false);
      expect(isDriverPreview("AGENT", true, v)).toBe(false);
      expect(isDriverPreview("KIEROWCA", true, v)).toBe(false);
    }
    expect(isDriverPreview("ADMIN", true, undefined)).toBe(false);
    expect(isDriverPreview("ADMIN", true, "cokolwiek")).toBe(false);
  });
  it("„tylko moje” tylko dla driver_own", () => {
    expect(isDriverOwnPreview("ADMIN", true, "driver_own")).toBe(true);
    expect(isDriverOwnPreview("ADMIN", true, "driver")).toBe(false);
    expect(isDriverOwnPreview("ADMIN", false, "driver_own")).toBe(false);
    expect(isDriverOwnPreview("KIEROWCA", true, "driver_own")).toBe(false);
  });
  it("prawdziwy KIEROWCA zawsze działa jak kierowca, ale nie jest podglądem", () => {
    expect(actsAsDriver("KIEROWCA", false, undefined)).toBe(true);
    expect(isDriverPreview("KIEROWCA", true, "driver")).toBe(false);
  });
});
