import { beforeEach, describe, expect, it, vi } from "vitest";

// Wniosek 49: akceptacja propozycji POSTPONE wykonuje odłożenie BEZ rozmowy
// (postponeLead), z dopiskiem z propozycji, a nie „Wynik rozmowy”.

const postponeLead = vi.fn(async () => undefined);
const logLeadActivity = vi.fn(async () => undefined);
const proposal = {
  id: "P1",
  kind: "POSTPONE",
  status: "PENDING",
  clientId: "C1",
  contactId: null,
  leadId: "L1",
  field: "returnAt",
  currentValue: null,
  proposedValue: JSON.stringify({ returnAt: "2026-10-13", reason: "INNE", note: "woli popołudnie" }),
  source: "decyzja Tomka",
  confidence: "HIGH",
  batch: "P-1",
  authorId: "agent1",
};
const updates: Record<string, unknown>[] = [];

vi.mock("@/lib/prisma", () => {
  const generic = () => new Proxy({}, { get: () => vi.fn(async () => null) });
  const prisma: Record<string, unknown> = {
    changeProposal: {
      findMany: vi.fn(async () => [proposal]),
      findUnique: vi.fn(async () => proposal),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => (updates.push(data), {})),
    },
    user: { findUnique: vi.fn(async () => ({ id: "agent1", role: "AGENT" })) },
  };
  return { prisma: new Proxy(prisma, { get: (t, k: string) => (k in t ? t[k] : generic()) }) };
});
vi.mock("@/lib/leads/actions", () => ({
  createLead: vi.fn(),
  postponeLead,
  logLeadActivity,
  recordPastContact: vi.fn(),
  syncLeadTasksFromStep: vi.fn(),
  updateLead: vi.fn(),
}));
vi.mock("@/lib/logger", () => ({ logError: vi.fn(), logInfo: vi.fn(), logWarn: vi.fn() }));

const { decideProposals } = await import("./change-proposals");

beforeEach(() => {
  postponeLead.mockClear();
  logLeadActivity.mockClear();
  updates.length = 0;
});

describe("akceptacja propozycji POSTPONE", () => {
  it("wywołuje postponeLead (odłożenie bez rozmowy) z dopiskiem i źródłem PROPOSAL", async () => {
    const r = await decideProposals(["P1"], "accept", { userId: "tomek", role: "ADMIN" }, { force: true });
    expect(r).toMatchObject({ accepted: 1, failed: [] });
    expect(postponeLead).toHaveBeenCalledTimes(1);
    const [id, input, userId, source] = postponeLead.mock.calls[0] as unknown as [string, { returnAt: Date; reason: string; note: string | null }, string | null, string];
    expect(id).toBe("L1");
    expect(input).toMatchObject({ reason: "INNE", note: "woli popołudnie" });
    expect(input.returnAt).toEqual(new Date("2026-10-13T09:00:00"));
    expect(userId).toBe("agent1");
    expect(source).toBe("PROPOSAL");
    expect(logLeadActivity).not.toHaveBeenCalled();
  });
});
