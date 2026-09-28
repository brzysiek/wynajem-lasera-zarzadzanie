import { describe, expect, it } from "vitest";
import { parseClientPatch, parseContactInput } from "./validate";

const deps = {
  normalizePhone: (raw: string) => {
    const d = raw.replace(/[^\d+]/g, "");
    if (/^\d{9}$/.test(d)) return `+48${d}`;
    if (/^\+\d{9,15}$/.test(d)) return d;
    return null;
  },
};

describe("parseClientPatch", () => {
  it("zmienia tylko pola obecne w body i normalizuje wartości", () => {
    const r = parseClientPatch({ nip: "679-000-11-22", transportPriceNet: "120,00 zł", distanceKm: "18 km", city: "  Kraków " });
    expect(r).toEqual({ ok: true, data: { nip: "6790001122", transportPriceNet: "120.00", distanceKm: "18.0", city: "Kraków" } });
  });

  it("puste pola czyści na null", () => {
    expect(parseClientPatch({ nip: "", street: "", notes: "  " })).toEqual({ ok: true, data: { nip: null, street: null, notes: null } });
  });

  it("odrzuca pustą nazwę, zły NIP, złą cenę i nieznane wartości", () => {
    expect(parseClientPatch({ name: " " }).ok).toBe(false);
    expect(parseClientPatch({ nip: "123" }).ok).toBe(false);
    expect(parseClientPatch({ transportPriceNet: "dużo" }).ok).toBe(false);
    // Wniosek 17: liczba (propozycja agenta) nie może się zamienić w null.
    expect(parseClientPatch({ transportPriceNet: 70 })).toEqual({ ok: true, data: { transportPriceNet: "70.00" } });
    expect(parseClientPatch({ distanceKm: 35 })).toEqual({ ok: true, data: { distanceKm: "35.0" } });
    expect(parseClientPatch({ transportPriceNet: null })).toEqual({ ok: true, data: { transportPriceNet: null } });
    expect(parseClientPatch({ transportPriceNet: "" })).toEqual({ ok: true, data: { transportPriceNet: null } });
    expect(parseClientPatch({ transportPriceNet: { kwota: 70 } }).ok).toBe(false);
    // Wniosek 15: od kiedy obowiązuje kwota transportu.
    expect(parseClientPatch({ transportPriceSince: "2026-09-01" })).toEqual({ ok: true, data: { transportPriceSince: new Date(Date.UTC(2026, 8, 1, 12)) } });
    expect(parseClientPatch({ transportPriceSince: null })).toEqual({ ok: true, data: { transportPriceSince: null } });
    expect(parseClientPatch({ transportPriceSince: "wczoraj" }).ok).toBe(false);
    expect(parseClientPatch({ invoicePartDefault: 500, pulseRateNet: 0.06 })).toEqual({ ok: true, data: { invoicePartDefault: "500.00", pulseRateNet: "0.0600" } });
    expect(parseClientPatch({ distanceKm: "daleko" }).ok).toBe(false);
    expect(parseClientPatch({ source: "TIKTOK" }).ok).toBe(false);
    expect(parseClientPatch({ deviceInterests: ["LIGHTSHEER", "LASER_X"] }).ok).toBe(false);
    expect(parseClientPatch({ statusOverride: "VIP" }).ok).toBe(false);
  });

  it("zainteresowania bez duplikatów, blokada do zdjęcia", () => {
    expect(parseClientPatch({ deviceInterests: ["LIGHTSHEER", "LIGHTSHEER", "COOLTECH"], statusOverride: null })).toEqual({
      ok: true,
      data: { deviceInterests: ["LIGHTSHEER", "COOLTECH"], statusOverride: null },
    });
  });
});

describe("parseContactInput", () => {
  it("normalizuje telefon i e-mail", () => {
    expect(parseContactInput({ phone: "601 000 111", email: "Ania@Gabinet.PL" }, deps)).toEqual({
      ok: true,
      data: { phone: "+48601000111", email: "ania@gabinet.pl" },
    });
  });

  it("odrzuca zły telefon i e-mail", () => {
    expect(parseContactInput({ phone: "12" }, deps).ok).toBe(false);
    expect(parseContactInput({ email: "nie-mail" }, deps).ok).toBe(false);
  });

  it("nowa osoba musi mieć cokolwiek do kontaktu", () => {
    expect(parseContactInput({ role: "kosmetolog" }, deps, { requireName: true }).ok).toBe(false);
    expect(parseContactInput({ firstName: "Ola" }, deps, { requireName: true }).ok).toBe(true);
  });

  it("drugi numer z etykietą; pusty drugi numer czyści etykietę", () => {
    const r = parseContactInput({ phone2: "602 000 999", phone2Label: "prywatny" }, { normalizePhone: (x) => `+48${x.replace(/\s/g, "")}` });
    expect(r).toEqual({ ok: true, data: { phone2: "+48602000999", phone2Label: "prywatny" } });
    expect(parseContactInput({ phone2: "", phone2Label: "prywatny" }, { normalizePhone: () => null })).toEqual({
      ok: true,
      data: { phone2: null, phone2Label: null },
    });
  });
});
