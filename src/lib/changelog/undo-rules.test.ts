import { describe, expect, it } from "vitest";
import { checkUndo, isUndoable, sameLogValue, undoKind } from "./undo-rules";

const e = (p: Partial<Parameters<typeof checkUndo>[0]>) => ({ entity: "CLIENT", operation: "FIELD_CHANGE", field: "city", after: '"Kraków"', undoneById: null, undoOfId: null, ...p });

describe("undo", () => {
  it("rodzaje wpisów", () => {
    expect(undoKind(e({}))).toBe("client-field");
    expect(undoKind(e({ entity: "CONTACT", field: "phone" }))).toBe("contact-field");
    expect(undoKind(e({ entity: "CONTACT", field: "isPrimary" }))).toBeNull();
    expect(undoKind(e({ operation: "QUALIFY", field: "qualifiedAt" }))).toBe("qualification");
    expect(undoKind(e({ entity: "HISTORY", operation: "MATCH_ASSIGN", field: "clientId" }))).toBeNull();
    expect(isUndoable(e({ operation: "UNDO" }))).toBe(false);
  });
  it("bez konfliktu, gdy wartość się nie zmieniła", () => {
    expect(checkUndo(e({}), '"Kraków"')).toEqual({ ok: true });
  });
  it("konflikt, gdy ktoś zmienił wartość później", () => {
    expect(checkUndo(e({}), '"Krakow"')).toMatchObject({ ok: false, reason: "conflict" });
  });
  it("już cofnięty / nie do cofnięcia", () => {
    expect(checkUndo(e({ undoneById: "u1" }), '"Kraków"')).toMatchObject({ ok: false, reason: "already-undone" });
    expect(checkUndo(e({ entity: "TASK" }), '"x"')).toMatchObject({ ok: false, reason: "not-undoable" });
  });
  it("kwoty 150 i 150.00 są równe", () => {
    expect(sameLogValue('"150"', '"150.00"')).toBe(true);
    expect(sameLogValue('"150"', '"151"')).toBe(false);
    expect(sameLogValue("null", "null")).toBe(true);
    expect(sameLogValue('["A"]', '["A"]')).toBe(true);
  });
});
