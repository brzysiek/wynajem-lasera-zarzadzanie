import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StageTip } from "./stage-tip";
import { DEFAULT_PLAYBOOK } from "@/lib/leads/playbook";
import type { BureauInput } from "@/lib/leads/bureau-prompt";

// Podpowiedź w karcie sygnału (wniosek 47, część 3/3): przy wyłączonej fladze
// przyciski wysyłające przez panel znikają, są „Kopiuj prompt dla BIURO”, a
// treść promptu nie pojawia się w interfejsie.
const bureau: BureauInput = { id: "LEAD-ID-123", name: "MG Beauty", city: "Kraków", stageLabel: "Nowe", stepType: "PIERWSZY_KONTAKT", stepNote: null, stepAt: null, devices: ["Alma"], dates: "20–24.10", followUpNo: 0, returnAt: null };

const html = (stage: "SYGNAL" | "WYWIAD" | "OFERTA" | "ODLOZONE", smsText: string | null = "Dzień dobry, dzwoniłam w sprawie wynajmu") =>
  renderToStaticMarkup(createElement(StageTip, { leadId: "LEAD-ID-123", stage, followUpNo: 1, playbook: DEFAULT_PLAYBOOK, smsText, canAct: true, bureau }));

describe("StageTip bez kanałów w panelu", () => {
  for (const stage of ["SYGNAL", "WYWIAD", "OFERTA", "ODLOZONE"] as const) {
    it(`${stage}: jest „Kopiuj prompt dla BIURO”, nie ma wysyłki ani szkicu maila`, () => {
      const h = html(stage);
      expect(h).toContain("Kopiuj prompt dla BIURO");
      expect(h).not.toContain("Wyślij SMS z szablonu");
      expect(h).not.toContain("Przygotuj ofertę");
      expect(h).not.toContain("mailto:");
      // treść promptu nie jest widoczna w interfejsie
      expect(h).not.toContain("BIURO ·");
      expect(h).not.toContain("LEAD-ID-123 ·");
    });
  }

  it("etap Nowe: dwa przyciski (SMS po nieodebranym i mail z ofertą), bez telefonu — tylko oferta", () => {
    expect(html("SYGNAL").match(/Kopiuj prompt dla BIURO/g)).toHaveLength(2);
    expect(html("SYGNAL", null).match(/Kopiuj prompt dla BIURO/g)).toHaveLength(1);
  });

  it("zostają skrypty i pytania wywiadu", () => {
    const h = html("SYGNAL");
    expect(h).toContain(DEFAULT_PLAYBOOK.questions[0]);
  });
});
