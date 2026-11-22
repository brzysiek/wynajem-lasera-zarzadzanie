import { describe, expect, it, vi } from "vitest";

const { findUnique } = vi.hoisted(() => ({ findUnique: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { user: { findUnique } } }));

import { DRIVER_USER_WHERE, canBeAssignedAsDriver, resolveDriverId } from "./rental-driver";

describe("kto może być kierowcą w rezerwacji", () => {
  it("rola KIEROWCA zawsze; ADMIN/STAFF tylko z flagą driverAssignable; AGENT nigdy", () => {
    expect(canBeAssignedAsDriver({ role: "KIEROWCA", driverAssignable: false })).toBe(true);
    expect(canBeAssignedAsDriver({ role: "ADMIN", driverAssignable: true })).toBe(true);
    expect(canBeAssignedAsDriver({ role: "STAFF", driverAssignable: true })).toBe(true);
    expect(canBeAssignedAsDriver({ role: "ADMIN", driverAssignable: false })).toBe(false);
    expect(canBeAssignedAsDriver({ role: "AGENT", driverAssignable: true })).toBe(false);
  });
  it("filtr list wyboru zgadza się z regułą", () => {
    expect(DRIVER_USER_WHERE.OR).toEqual([{ role: "KIEROWCA" }, { role: { in: ["ADMIN", "STAFF"] }, driverAssignable: true }]);
  });
  it("walidacja zapisu: przyjmuje Tomka z flagą, odrzuca ADMIN-a bez flagi, pozwala wyczyścić", async () => {
    findUnique.mockResolvedValueOnce({ id: "t", role: "ADMIN", driverAssignable: true });
    expect(await resolveDriverId("t")).toEqual({ ok: true, driverId: "t" });
    findUnique.mockResolvedValueOnce({ id: "a", role: "ADMIN", driverAssignable: false });
    const bad = await resolveDriverId("a");
    expect(bad.ok).toBe(false);
    findUnique.mockResolvedValueOnce(null);
    expect((await resolveDriverId("zzz")).ok).toBe(false);
    expect(await resolveDriverId("")).toEqual({ ok: true, driverId: null });
  });
});
