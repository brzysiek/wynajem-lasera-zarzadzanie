import { describe, expect, it } from "vitest";
import { nextStatus, parseRating, parseReportInput } from "./analysis-rules";

const base = { okres_od: "2026-11-13", okres_do: "2026-11-19", tytul: "Tydzień 13–19.11", tresc_md: "# Raport", wnioski: [{ tytul: "A", opis: "a" }], propozycje: [] };

describe("raport marketingowy — wejście z MCP", () => {
  it("poprawny raport z propozycjami", () => {
    const r = parseReportInput({ ...base, propozycje: [{ obszar: "google_ads", tytul: "Wykluczyć frazę", uzasadnienie: "koszt bez zapytań" }] });
    expect(r).toMatchObject({ ok: true, value: { periodFrom: "2026-11-13", proposals: [{ area: "google_ads", title: "Wykluczyć frazę" }] } });
  });
  it("odrzuca: złe daty, brak wniosków, więcej niż 3 wnioski, zły obszar, brak uzasadnienia", () => {
    expect(parseReportInput({ ...base, okres_od: "13.11.2026" }).ok).toBe(false);
    expect(parseReportInput({ ...base, okres_od: "2026-11-20" }).ok).toBe(false);
    expect(parseReportInput({ ...base, wnioski: [] }).ok).toBe(false);
    expect(parseReportInput({ ...base, wnioski: Array.from({ length: 4 }, () => ({ tytul: "x", opis: "y" })) }).ok).toBe(false);
    expect(parseReportInput({ ...base, tresc_md: " " }).ok).toBe(false);
    expect(parseReportInput({ ...base, propozycje: [{ obszar: "tiktok", tytul: "x", uzasadnienie: "y" }] }).ok).toBe(false);
    expect(parseReportInput({ ...base, propozycje: [{ obszar: "meta", tytul: "x" }] }).ok).toBe(false);
  });
});

describe("przejścia statusów propozycji", () => {
  it("czeka → akceptuję / odrzucam; cofnięcie do wdrożenia; wdrożenie tylko po akceptacji", () => {
    expect(nextStatus("czeka", "accept")).toEqual({ ok: true, value: "zaakceptowana" });
    expect(nextStatus("czeka", "reject")).toEqual({ ok: true, value: "odrzucona" });
    expect(nextStatus("zaakceptowana", "undo")).toEqual({ ok: true, value: "czeka" });
    expect(nextStatus("odrzucona", "undo")).toEqual({ ok: true, value: "czeka" });
    expect(nextStatus("zaakceptowana", "implement")).toEqual({ ok: true, value: "wdrozona" });
  });
  it("blokuje niedozwolone przejścia", () => {
    expect(nextStatus("zaakceptowana", "accept").ok).toBe(false);
    expect(nextStatus("odrzucona", "implement").ok).toBe(false);
    expect(nextStatus("czeka", "implement").ok).toBe(false);
    expect(nextStatus("wdrozona", "undo").ok).toBe(false);
    expect(nextStatus("wdrozona", "implement").ok).toBe(false);
    expect(nextStatus("czeka", "undo").ok).toBe(false);
  });
});

describe("ocena frazy", () => {
  it("wymaga kampanii, frazy, poprawnej oceny i uzasadnienia; „brak” zdejmuje ocenę", () => {
    expect(parseRating({ kampania: "alma", fraza: "wynajem lasera", ocena: "dziala", uzasadnienie: "2 rezerwacje" })).toMatchObject({ ok: true, value: { rating: "dziala" } });
    expect(parseRating({ kampania: "alma", fraza: "x", ocena: "super", uzasadnienie: "y" }).ok).toBe(false);
    expect(parseRating({ kampania: "alma", fraza: "x", ocena: "dziala" }).ok).toBe(false);
    expect(parseRating({ kampania: "alma", fraza: "x", ocena: "brak" }).ok).toBe(true);
    expect(parseRating({ fraza: "x", ocena: "brak" }).ok).toBe(false);
  });
});
