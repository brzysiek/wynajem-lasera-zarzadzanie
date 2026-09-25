import { describe, expect, it } from "vitest";
import { daysPastDue, formatRentalDateForEmail } from "./email-template";

describe("daysPastDue", () => {
  it("returns a positive count when the due date already passed", () => {
    expect(daysPastDue("2026-09-01", new Date("2026-09-08T12:00:00"))).toBe(7);
  });

  it("returns 0 on the due date itself", () => {
    expect(daysPastDue("2026-09-08", new Date("2026-09-08T23:00:00"))).toBe(0);
  });

  it("returns a negative count before the due date", () => {
    expect(daysPastDue("2026-09-15", new Date("2026-09-08T00:00:00"))).toBe(-7);
  });
});

describe("formatRentalDateForEmail", () => {
  it("formats a single-day rental without a range", () => {
    const r = formatRentalDateForEmail(new Date("2026-10-15T09:00:00"), new Date("2026-10-15T17:00:00"));
    expect(r).toEqual({ text: "15.10.2026", isRange: false });
  });

  it("formats a multi-day rental within the same month as a short range", () => {
    const r = formatRentalDateForEmail(new Date("2026-10-15T09:00:00"), new Date("2026-10-17T17:00:00"));
    expect(r).toEqual({ text: "15–17.10.2026", isRange: true });
  });

  it("formats a multi-day rental crossing months with two full dates", () => {
    const r = formatRentalDateForEmail(new Date("2026-09-28T09:00:00"), new Date("2026-10-02T17:00:00"));
    expect(r).toEqual({ text: "28.09.2026–02.10.2026", isRange: true });
  });
});
