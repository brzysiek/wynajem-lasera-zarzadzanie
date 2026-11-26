import { describe, expect, it } from "vitest";
import { parseBeacon } from "./ingest";
import { buildTrafficReport, inquiryStage, type TrafficRow } from "./report";

// Wniosek 63: raport porzuceń „w którym miejscu” dla jednoekranowego formularza zapytania 6252
// + wspólna pozycja „okno zapytania” (stare 5878/5795 i nowe 6252).

const CH = "Bezpośrednio";
const day = (iso: string) => new Date(`${iso}T10:00:00Z`);
function view(pv: string, path: string, dev: string, at = "2026-11-26"): TrafficRow {
  return { at: day(at), pv, path, dev, type: "wejscie", channel: CH, data: { src: "", prev: "", utm: {}, zgoda: "brak" } };
}
function ev(pv: string, path: string, dev: string, type: string, data: Record<string, unknown>, at = "2026-11-26"): TrafficRow {
  return { at: day(at), pv, path, dev, type, channel: CH, data };
}
const RANGE = { from: "2026-11-18", to: "2026-11-27" };

describe("inquiryStage — etap porzucenia formularza 6252", () => {
  it("rozpoznaje elementy formularza", () => {
    expect(inquiryStage("[zf-chg] zmień")).toBe("urzadzenie");
    expect(inquiryStage("[zf-chg] wybierz")).toBe("urzadzenie");
    expect(inquiryStage("zq-dev")).toBe("urzadzenie");
    expect(inquiryStage("wl-kontakt")).toBe("kontakt");
    expect(inquiryStage("miejscowosc")).toBe("miejscowosc");
    expect(inquiryStage("[button] w tym miesiącu")).toBe("kiedy");
    expect(inquiryStage("[button] jeszcze nie wiem")).toBe("kiedy");
    expect(inquiryStage("[zf-kiedy] w przyszłym")).toBe("kiedy");
    expect(inquiryStage("[zf-datebtn] Mam konkretną datę")).toBe("data");
    expect(inquiryStage("contact-date-from")).toBe("data");
    expect(inquiryStage("contact-days")).toBe("data");
    expect(inquiryStage("[zf-days] 3")).toBe("data");
    expect(inquiryStage("contact-name")).toBe("imie");
    expect(inquiryStage("acceptance-rez")).toBe("zgoda");
    expect(inquiryStage("[zf-go] Wyślij zapytanie")).toBe("wyslij_bez_skutku");
  });
  it("nieznane i inne", () => {
    expect(inquiryStage("")).toBe("nieznane");
    expect(inquiryStage("(nieznane pole)")).toBe("nieznane");
    expect(inquiryStage("cos-innego")).toBe("inne");
  });
});

describe("zdarzenie form_otwarty (ingest)", () => {
  it("przyjmuje form_otwarty z numerem formularza", () => {
    const r = parseBeacon(JSON.stringify({ pv: "abc123", path: "/lightsheer/", dev: "telefon", ev: [{ e: "form_otwarty", form: "6252" }] }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.beacon.events).toEqual([{ type: "form_otwarty", t: null, data: { form: "6252" } }]);
  });
});

const rows: TrafficRow[] = [
  // 6252: lightsheer — telefon otwiera okno i porzuca na miejscowości (po błędzie), komputer wysyła, trzeci otwiera bez dotyku
  view("a", "/lightsheer/", "telefon"),
  ev("a", "/lightsheer/", "telefon", "form_otwarty", { form: "6252" }),
  ev("a", "/lightsheer/", "telefon", "form_start", { form: "6252" }),
  ev("a", "/lightsheer/", "telefon", "form_blad", { form: "6252", pola: ["miejscowosc", "acceptance-rez"] }),
  ev("a", "/lightsheer/", "telefon", "form_porzucony", { form: "6252", pole: "miejscowosc", bledy: 1 }),
  view("b", "/lightsheer/", "komputer"),
  ev("b", "/lightsheer/", "komputer", "form_otwarty", { form: "6252" }),
  ev("b", "/lightsheer/", "komputer", "form_start", { form: "6252" }),
  ev("b", "/lightsheer/", "komputer", "form_proba", { form: "6252" }),
  ev("b", "/lightsheer/", "komputer", "form_wyslany", { form: "6252" }),
  view("c", "/lightsheer/", "telefon"),
  ev("c", "/lightsheer/", "telefon", "form_otwarty", { form: "6252" }),
  // 6252 na /rezerwuje-wynajem/: porzucone na „[zf-go]”
  view("d", "/rezerwuje-wynajem/", "telefon"),
  ev("d", "/rezerwuje-wynajem/", "telefon", "form_otwarty", { form: "6252" }),
  ev("d", "/rezerwuje-wynajem/", "telefon", "form_start", { form: "6252" }),
  ev("d", "/rezerwuje-wynajem/", "telefon", "form_proba", { form: "6252" }),
  ev("d", "/rezerwuje-wynajem/", "telefon", "form_porzucony", { form: "6252", pole: "[zf-go] Wyślij zapytanie", bledy: 0 }),
  // stare okno na /lightsheer/ (5878 i 5795 na tej samej stronie) — 20.11 i 24.11
  view("e", "/lightsheer/", "telefon", "2026-11-20"),
  ev("e", "/lightsheer/", "telefon", "form_start", { form: "5878" }, "2026-11-20"),
  ev("e", "/lightsheer/", "telefon", "form_porzucony", { form: "5878", pole: "[lsr-tile] Alma", bledy: 0 }, "2026-11-20"),
  view("f", "/lightsheer/", "komputer", "2026-11-24"),
  ev("f", "/lightsheer/", "komputer", "form_start", { form: "5795" }, "2026-11-24"),
];

describe("raport formularzy: 6252 i okno zapytania", () => {
  const r = buildTrafficReport(rows, RANGE);
  const f = r.forms.find((x) => x.form === "6252")!;

  it("porzucenia wg etapu i błędy wg etapu", () => {
    expect(f.abandonStages).toMatchObject({ miejscowosc: 1, wyslij_bez_skutku: 1, urzadzenie: 0 });
    expect(f.errorStages).toMatchObject({ miejscowosc: 1, zgoda: 1, otwarte_bez_dotkniecia: null });
  });
  it("otwarte bez dotyku: okno otwarte, brak startu i porzucenia", () => {
    expect(f.abandonStages?.otwarte_bez_dotkniecia).toBe(1); // tylko odsłona „c”
    expect(f.opened).toBe(4);
  });
  it("6252 nie dostaje podziału na krok 1 / krok 2 (jednoekranowy)", () => {
    expect(f.abandonSteps).toBeNull();
    expect(r.forms.find((x) => x.form === "5878")?.abandonSteps).not.toBeNull();
  });
  it("bez zdarzeń form_otwarty: otwarcia null i brak „otwarte bez dotyku”", () => {
    const old = buildTrafficReport(rows.filter((x) => x.type !== "form_otwarty"), RANGE);
    const g = old.forms.find((x) => x.form === "6252")!;
    expect(g.opened).toBeNull();
    expect(g.abandonStages?.otwarte_bez_dotkniecia).toBeNull();
  });
  it("lejek wg strony i urządzenia", () => {
    expect(f.byPath.find((p) => p.path === "/lightsheer/")).toMatchObject({ views: 3, opened: 3, started: 2, tried: 1, sent: 1 });
    expect(f.byPath.find((p) => p.path === "/rezerwuje-wynajem/")).toMatchObject({ views: 1, opened: 1, started: 1, tried: 1, sent: 0 });
    expect(f.byDev.find((p) => p.dev === "komputer")).toMatchObject({ started: 1, sent: 1 });
    expect(f.byDev.find((p) => p.dev === "telefon")).toMatchObject({ started: 2, sent: 0 });
  });
  it("okno zapytania: stare i nowe razem, odsłony raz na stronę, granica dat", () => {
    const w = r.inquiryWindow!;
    expect(w.forms.map((x) => [x.form, x.group, x.from, x.to])).toEqual([
      ["5878", "stare", "2026-11-20", "2026-11-20"],
      ["5795", "stare", "2026-11-24", "2026-11-24"],
      ["6252", "nowe", "2026-11-26", "2026-11-26"],
    ]);
    // odsłony: stare okno do pierwszego zdarzenia nowego (e, f), nowe od jego pierwszego zdarzenia (a, b, c)
    const lr = w.byPath.find((p) => p.path === "/lightsheer/")!;
    expect(lr.stare).toMatchObject({ views: 2, started: 2 });
    expect(lr.nowe).toMatchObject({ views: 3, started: 2, sent: 1 });
    expect(w.nowe).toMatchObject({ started: 3, tried: 2, sent: 1 });
    expect(w.stare).toMatchObject({ views: 2, started: 2, sent: 0 });
    expect(w.nowe.views).toBe(4);
  });
  it("brak formularzy → inquiryWindow null", () => {
    expect(buildTrafficReport([view("x", "/", "telefon")], RANGE).inquiryWindow).toBeNull();
  });
});
