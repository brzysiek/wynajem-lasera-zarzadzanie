import { describe, expect, it } from "vitest";
import { parseSplitInput } from "./split-rules";

describe("parseSplitInput", () => {
  it("MiWiNi z polskimi kluczami", () => {
    expect(
      parseSplitInput({
        osoby_ids: ["k1", "k1", ""],
        nazwa: "Studio Urody „MiWiNi” Barbara Trzaska",
        faktury_nip: "944-182-82-01",
        ulica: "Rudawska 4",
        kod: "32-064",
        miasto: "Rudawa",
        klucze_dopasowan: ["miwini", "mi wi ni"],
      }),
    ).toEqual({
      ok: true,
      value: { contactIds: ["k1"], name: "Studio Urody „MiWiNi” Barbara Trzaska", nip: "9441828201", street: "Rudawska 4", zip: "32-064", city: "Rudawa", invoiceNip: "9441828201", historyKeys: ["miwini", "mi wi ni"] },
    });
  });
  it("jedna konwencja: invoiceNip / historyKeys; bez invoiceNip faktury po NIP-ie klienta", () => {
    const r = parseSplitInput({ osoby_ids: ["k1"], nazwa: "MiWiNi", nip: "9441828201", historyKeys: ["miwini"] });
    expect(r).toMatchObject({ ok: true, value: { nip: "9441828201", invoiceNip: "9441828201", historyKeys: ["miwini"] } });
    expect(parseSplitInput({ osoby_ids: ["k1"], nazwa: "X", invoiceNip: "9441828201" })).toMatchObject({ ok: true, value: { nip: "9441828201", invoiceNip: "9441828201" } });
    expect(parseSplitInput({ osoby_ids: ["k1"], nazwa: "X" })).toMatchObject({ ok: true, value: { nip: null, invoiceNip: null } });
  });
  it("wymagane osoby i nazwa, NIP 10 cyfr", () => {
    expect(parseSplitInput({ nazwa: "X" }).ok).toBe(false);
    expect(parseSplitInput({ osoby_ids: ["k1"] }).ok).toBe(false);
    expect(parseSplitInput({ osoby_ids: ["k1"], nazwa: "X", nip: "123" }).ok).toBe(false);
  });
});
