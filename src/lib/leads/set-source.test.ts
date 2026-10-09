import { describe, expect, it } from "vitest";
import { deriveStageSource, stageSet, stageSourceText, stepSet, stepSourceText, whoText } from "./set-source";

const at = new Date(2026, 9, 9, 11, 4);

describe("opisy źródła", () => {
  it("krok: ręcznie, wynik rozmowy, automat z podtypem", () => {
    expect(stepSourceText("USER", "Ania", at)).toBe("ustawił: Ania · 09.10");
    expect(stepSourceText("OUTCOME", "Ania", at)).toBe("ustawił: wynik rozmowy · 09.10");
    expect(stepSourceText("AUTO_MAIL_IN", null, at)).toBe("ustawił: automat (mail od klientki) · 09.10");
    expect(stepSourceText("AUTO_SPRING", null, at)).toBe("ustawił: automat (lista „Wracają z wiosny”) · 09.10");
  });
  it("etap: z godziną, ten sam tekst co w dymku chipa", () => {
    expect(stageSourceText("AUTO_FORM", null, at)).toBe("Etap ustawił: automat (formularz WWW) · 09.10, 11:04");
    expect(stageSourceText("USER", "Tomek", at)).toBe("Etap ustawił: Tomek · 09.10, 11:04");
  });
  it("nieznany kod to „automat”, brak imienia przy USER to „biuro”", () => {
    expect(whoText("COS_NOWEGO", null)).toBe("automat");
    expect(whoText("USER", null)).toBe("biuro");
    expect(whoText("PROPOSAL", null)).toBe("automat (zaakceptowana propozycja)");
  });
});

describe("dane do zapisu", () => {
  it("stageSet / stepSet niosą kod, osobę i czas", () => {
    expect(stageSet("USER", "u1", at)).toEqual({ stageSource: "USER", stageSourceById: "u1", stageSourceAt: at });
    expect(stepSet("AUTO_FORM", undefined, at)).toEqual({ stepSource: "AUTO_FORM", stepSourceById: null, stepSourceAt: at });
  });
});

describe("deriveStageSource — odtwarzanie ze starej osi czasu", () => {
  it("automaty z maili po treści wpisu", () => {
    expect(deriveStageSource({ body: "auto · mail od klientki: „Pytanie” → W kontakcie", userName: null, at })?.code).toBe("AUTO_MAIL_IN");
    expect(deriveStageSource({ body: "auto · mail z ofertą: „Oferta” → Oferta wysłana · follow-up za 3 dni rob.", userName: null, at })?.code).toBe("AUTO_MAIL_OFFER");
    expect(deriveStageSource({ body: "auto · mail wysłany: „X” → W kontakcie", userName: null, at })?.code).toBe("AUTO_MAIL_OUT");
  });
  it("wpis osoby → ręcznie z imieniem; powiązanie z wynajmem bez osoby → automat", () => {
    expect(deriveStageSource({ body: "W kontakcie → Oferta wysłana", userName: "Ania", at })).toMatchObject({ code: "USER", userName: "Ania" });
    expect(deriveStageSource({ body: "Powiązano z rezerwacją: LightSheer, 15.10.2026", userName: null, at })?.code).toBe("AUTO_RENTAL");
  });
  it("wpis bez autora i bez znanego wzorca → null (nie zgadujemy)", () => {
    expect(deriveStageSource({ body: "Nowe → W kontakcie", userName: null, at })).toBeNull();
    expect(deriveStageSource({ body: null, userName: null, at })).toBeNull();
  });
});
