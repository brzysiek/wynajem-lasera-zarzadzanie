import { describe, expect, it } from "vitest";
import { bareTitle, clientTitleName, retitle, titleDiffers } from "./title-rules";

describe("tytuł rezerwacji z nazwy roboczej", () => {
  it("nazwa robocza, inaczej pełna", () => {
    expect(clientTitleName({ name: "Maria Jarząbek Gabinet", shortName: "Maria Jarząbek" })).toBe("Maria Jarząbek");
    expect(clientTitleName({ name: "Gabinet X", shortName: " " })).toBe("Gabinet X");
  });
  it("prefiks godziny zostaje", () => {
    expect(retitle("10:00 NOWA PaNI", "Maria Jarząbek", null)).toBe("10:00 Maria Jarząbek");
    expect(retitle("NOWA PaNI", "Maria Jarząbek", "08:30")).toBe("08:30 Maria Jarząbek");
    expect(retitle("NOWA PaNI", "Maria Jarząbek", null)).toBe("Maria Jarząbek");
    expect(bareTitle("10:00 Inn Beauty")).toBe("Inn Beauty");
  });
  it("porównanie bez prefiksu i wielkości liter", () => {
    expect(titleDiffers("10:00 maria jarząbek", "Maria Jarząbek")).toBe(false);
    expect(titleDiffers("NOWA PaNI", "Maria Jarząbek")).toBe(true);
  });
});
