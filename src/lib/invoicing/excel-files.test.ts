import { describe, expect, it } from "vitest";
import { zipSync } from "fflate";
import { expandFiles } from "./excel-files";

const b = (n: number) => new Uint8Array([n]);

describe("pliki importu faktur z Excela", () => {
  it("ZIP folderu z Dysku: arkusze z podfolderu, PDF-y i śmieci macOS pomijane", () => {
    const zip = zipSync({
      "Faktury wynajem/FV 2026_01_03 P. B. Trzaska.xls": b(1),
      "Faktury wynajem/FV 2026_01_03 P. B. Trzaska.pdf": b(2),
      "Faktury wynajem/FV 2026_02_01 X.xlsx": b(3),
      "__MACOSX/Faktury wynajem/._FV 2026_02_01 X.xlsx": b(4),
    });
    const r = expandFiles([{ name: "Faktury wynajem-20260927.zip", data: zip }, { name: "FV 2025_12_09 SPA ORKANA.xls", data: b(5) }, { name: "notatka.txt", data: b(6) }]);
    expect(r.sheets.map((s) => s.name)).toEqual(["FV 2026_01_03 P. B. Trzaska.xls", "FV 2026_02_01 X.xlsx", "FV 2025_12_09 SPA ORKANA.xls"]);
    expect(r.other).toBe(2);
  });
});
