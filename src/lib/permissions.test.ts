import { describe, expect, it } from "vitest";
import { ADMIN_AND_AGENT, AGENT_CLIENT_FIELDS, OFFICE_AND_AGENT, OFFICE_ROLES, agentMayOpenPage, hasRole } from "./permissions";

describe("hasRole", () => {
  it("biuro nie obejmuje agenta ani kierowcy", () => {
    expect(hasRole("ADMIN", OFFICE_ROLES)).toBe(true);
    expect(hasRole("STAFF", OFFICE_ROLES)).toBe(true);
    expect(hasRole("AGENT", OFFICE_ROLES)).toBe(false);
    expect(hasRole("KIEROWCA", OFFICE_ROLES)).toBe(false);
  });
  it("listy z agentem", () => {
    expect(hasRole("AGENT", OFFICE_AND_AGENT)).toBe(true);
    expect(hasRole("KIEROWCA", OFFICE_AND_AGENT)).toBe(false);
    expect(hasRole("AGENT", ADMIN_AND_AGENT)).toBe(true);
    expect(hasRole("STAFF", ADMIN_AND_AGENT)).toBe(false);
    expect(hasRole(undefined, OFFICE_AND_AGENT)).toBe(false);
  });
});

describe("agentMayOpenPage", () => {
  it("dozwolone moduły", () => {
    for (const p of ["/", "/kalendarz", "/kalendarz/wynajem/abc", "/nadchodzace", "/sygnaly", "/klienci", "/klienci/x", "/klienci/dopasowania", "/urzadzenia", "/finanse/faktury", "/wysylka-sms"]) {
      expect(agentMayOpenPage(p), p).toBe(true);
    }
  });
  it("zablokowane: ustawienia, przychody, koszty, nowa rezerwacja", () => {
    for (const p of ["/ustawienia", "/ustawienia/uzytkownicy", "/finanse/przychody", "/finanse/koszty", "/finanse/koszty/wpisy", "/kalendarz/wynajem/nowy", "/finanse"]) {
      expect(agentMayOpenPage(p), p).toBe(false);
    }
  });
  it("prefiks musi być pełnym segmentem", () => {
    expect(agentMayOpenPage("/klienci-tajne")).toBe(false);
    expect(agentMayOpenPage("/finanse/faktury-paliwa")).toBe(false);
  });
});

describe("AGENT_CLIENT_FIELDS", () => {
  it("bez ceny transportu, odległości i notatki biura", () => {
    const f: readonly string[] = AGENT_CLIENT_FIELDS;
    expect(f).toContain("nip");
    expect(f).toContain("statusOverride");
    expect(f).not.toContain("transportPriceNet");
    expect(f).not.toContain("distanceKm");
    expect(f).not.toContain("notes");
  });
});
