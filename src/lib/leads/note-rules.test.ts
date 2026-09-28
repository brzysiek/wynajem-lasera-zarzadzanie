import { describe, expect, it } from "vitest";
import { contactFromNotes, isFailedAttemptNote } from "./note-rules";

describe("notatki: nieudana próba czy rozmowa (przegląd 29.09)", () => {
  it("rozpoznaje nieudane próby", () => {
    for (const t of ["nr tel. zajety", "nieudana próba polaczenia tel.", "nieudana proba kontaktu tel.", "Dzwonić jutro - Pani miała zabieg", "'Połączenie zablokowane'. Wysłałam sms.", "Dzwonic jutro."]) {
      expect(isFailedAttemptNote(t)).toBe(true);
    }
    for (const t of ["Kraków - Płaszów. Nowy salon. Pani zainteresowana wynajmem LightSheer.", "Okolice radomia/ mazowieckie. Zadzwonić za 2 h", "Pani pobrała ofertę orientacyjnie. Na ten moment nie jest zainteresowana"]) {
      expect(isFailedAttemptNote(t)).toBe(false);
    }
  });

  it("pierwszy kontakt tylko z rozmowy; próby liczone osobno (maks. 3)", () => {
    const d = (day: number) => new Date(2026, 8, day);
    expect(contactFromNotes([{ text: "nieudana próba", at: d(20) }, { text: "nr zajęty", at: d(21) }])).toEqual({ firstContactAt: null, attempts: 2 });
    expect(contactFromNotes([{ text: "nieudana próba", at: d(20) }, { text: "Rozmowa: chce LightSheer w X", at: d(22) }])).toEqual({ firstContactAt: d(22), attempts: 1 });
  });
});
