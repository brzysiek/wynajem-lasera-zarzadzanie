import { describe, expect, it, vi } from "vitest";

const now = new Date(2026, 9, 9, 12, 0);
const at = (h: number) => new Date(2026, 9, 9, h, 0);
const mkLead = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  title: `Sygnał ${id}`,
  stage: "WYWIAD",
  clientId: `C${id}`,
  contactName: null,
  contactEmail: `${id}@example.com`,
  nextActionAt: null,
  nextStepType: null,
  createdAt: new Date(2026, 9, 1),
  client: { name: `Gabinet ${id}`, shortName: null, contacts: [] },
  suggestion: null,
  ...over,
});

const leads = [
  mkLead("A", { nextActionAt: at(9), nextStepType: "ODDZWONI" }), // brak sugestii, krok na dziś
  mkLead("B", { suggestion: { generatedAt: at(7), coveredUntil: at(7), requestedAt: null } }), // aktualna → pominięta
  mkLead("C", { suggestion: { generatedAt: at(7), coveredUntil: at(7), requestedAt: at(8) } }), // prośba
  mkLead("D", { suggestion: { generatedAt: at(7), coveredUntil: at(7), requestedAt: null } }), // nowy wpis
];

vi.mock("@/lib/prisma", () => ({
  prisma: {
    lead: { findMany: vi.fn(async () => leads) },
    leadActivity: {
      findMany: vi.fn(async () => [{ leadId: "D", type: "CALL", body: "rozmowa", createdAt: at(10) }]),
      groupBy: vi.fn(async () => [{ leadId: "D", _max: { createdAt: at(10) } }]),
    },
    emailMessage: { findMany: vi.fn(async () => []), groupBy: vi.fn(async () => []) },
  },
}));

const { listSuggestionWork } = await import("./agent-work");

describe("listSuggestionWork (wymaga_sugestii)", () => {
  it("zwraca tylko sygnały do pracy: krok na dziś → prośba → nowe wpisy; aktualnych nie ma", async () => {
    const { rows, total } = await listSuggestionWork(30, now);
    expect(total).toBe(3);
    expect(rows.map((r) => r.id)).toEqual(["A", "C", "D"]);
    expect(rows[0]).toMatchObject({ klient: "Gabinet A", etap: "W kontakcie", krok: "oddzwoni", powody: ["brak sugestii"], sugestia_z: null });
    expect(rows[1].powody).toEqual(["prośba o aktualizację"]);
    expect(rows[2]).toMatchObject({ powody: ["nowe wpisy (1)"], nowe_wpisy: 1 });
  });
  it("limit ucina listę, total zostaje pełny", async () => {
    const { rows, total } = await listSuggestionWork(2, now);
    expect(rows).toHaveLength(2);
    expect(total).toBe(3);
  });
});
