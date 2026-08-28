import { describe, expect, it } from "vitest";
import { rentalDurationDays } from "./duration";

const d = (iso: string) => new Date(iso);

describe("rentalDurationDays", () => {
  it("liczy dni inclusive (28–30 sierpnia = 3 dni)", () => {
    expect(rentalDurationDays(d("2026-08-28T00:00:00"), d("2026-08-30T00:00:00"))).toBe(3);
  });

  it("jednodniowy wynajem = 1", () => {
    expect(rentalDurationDays(d("2026-08-28T00:00:00"), d("2026-08-28T00:00:00"))).toBe(1);
  });

  it("tydzień Observ = 7", () => {
    expect(rentalDurationDays(d("2026-08-01T00:00:00"), d("2026-08-07T00:00:00"))).toBe(7);
  });

  it("dwa tygodnie Observ = 14", () => {
    expect(rentalDurationDays(d("2026-08-01T00:00:00"), d("2026-08-14T00:00:00"))).toBe(14);
  });

  it("przejście przez zmianę czasu (DST) nie psuje liczby dni", () => {
    // Ostatnia niedziela października 2026 — koniec czasu letniego w PL.
    expect(rentalDurationDays(d("2026-10-24T00:00:00"), d("2026-10-26T00:00:00"))).toBe(3);
  });

  it("nie zwraca wartości < 1 przy odwróconych datach", () => {
    expect(rentalDurationDays(d("2026-08-30T00:00:00"), d("2026-08-28T00:00:00"))).toBe(1);
  });
});
