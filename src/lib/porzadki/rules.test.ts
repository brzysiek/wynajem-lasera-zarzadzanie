import { describe, expect, it } from "vitest";
import { canEditProposal, canSetStatus, parseProposalInput, proposalsToCsv, proposalsToMarkdown, similarProposals, sortProposals, titleSimilarity, type ProposalExport } from "./rules";
import { proposalNumber } from "./labels";

describe("canSetStatus", () => {
  it("agent i pracownik: tylko nowy ↔ do decyzji", () => {
    expect(canSetStatus("AGENT", "NOWY", "DO_DECYZJI")).toBe(true);
    expect(canSetStatus("AGENT", "DO_DECYZJI", "NOWY")).toBe(true);
    for (const to of ["PRZYJETY", "W_REALIZACJI", "ZROBIONY", "ODRZUCONY", "DUPLIKAT"] as const) {
      expect(canSetStatus("AGENT", "DO_DECYZJI", to), to).toBe(false);
      expect(canSetStatus("STAFF", "NOWY", to), to).toBe(false);
    }
    expect(canSetStatus("AGENT", "PRZYJETY", "NOWY")).toBe(false);
  });
  it("admin: każdy status, ale nie ten sam", () => {
    expect(canSetStatus("ADMIN", "NOWY", "ZROBIONY")).toBe(true);
    expect(canSetStatus("ADMIN", "ODRZUCONY", "DO_DECYZJI")).toBe(true);
    expect(canSetStatus("ADMIN", "NOWY", "NOWY")).toBe(false);
  });
});

describe("canEditProposal", () => {
  it("autor dopóki czeka na decyzję, admin zawsze", () => {
    expect(canEditProposal("AGENT", "a", { authorId: "a", status: "DO_DECYZJI" })).toBe(true);
    expect(canEditProposal("AGENT", "a", { authorId: "a", status: "PRZYJETY" })).toBe(false);
    expect(canEditProposal("AGENT", "a", { authorId: "b", status: "NOWY" })).toBe(false);
    expect(canEditProposal("ADMIN", "x", { authorId: "b", status: "ZROBIONY" })).toBe(true);
  });
});

describe("podobne wnioski", () => {
  const list = [
    { id: "1", number: 1, title: "Formularz rezerwacji gubi numer telefonu", area: "INTEGRACJE", status: "NOWY" },
    { id: "2", number: 2, title: "Formularz rezerwacji gubi numer telefonu", area: "INTEGRACJE", status: "ZROBIONY" },
    { id: "3", number: 3, title: "Faktury bez NIP", area: "FINANSE", status: "NOWY" },
  ];
  it("odmiana i inny szyk nie przeszkadzają", () => {
    expect(titleSimilarity("Numer telefonu ginie w formularzu rezerwacji", list[0].title)).toBeGreaterThanOrEqual(0.5);
  });
  it("tylko otwarte; inny obszar wymaga prawie tego samego tytułu", () => {
    // 2 z 3 słów wspólne: w tym samym obszarze — podobny, w innym — nie.
    expect(similarProposals("Rezerwacja bez telefonu klientki", "INTEGRACJE", list).map((p) => p.id)).toEqual(["1"]);
    expect(similarProposals("Rezerwacja bez telefonu klientki", "KLIENCI", list)).toEqual([]);
    expect(similarProposals("Formularz rezerwacji gubi numer telefonu", "KLIENCI", list).map((p) => p.id)).toEqual(["1"]);
  });
});

describe("parseProposalInput", () => {
  it("wymagane: tytuł, obszar, typ", () => {
    expect(parseProposalInput({}, false).ok).toBe(false);
    const r = parseProposalInput({ title: " Brak NIP ", area: "FINANSE", type: "BRAK_DANYCH", causes: ["PANEL", "PANEL"] }, false);
    expect(r).toMatchObject({ ok: true, data: { title: "Brak NIP", priority: "MEDIUM", causes: ["PANEL"], clientIds: [], blocksCleanup: false } });
  });
  it("PATCH — tylko obecne pola", () => {
    expect(parseProposalInput({ priority: "HIGH" }, true)).toEqual({ ok: true, data: { priority: "HIGH" } });
    expect(parseProposalInput({ area: "XYZ" }, true).ok).toBe(false);
  });
});

describe("eksport", () => {
  const p: ProposalExport = {
    number: 7,
    title: "Scalanie duplikatów",
    area: "KLIENCI",
    type: "UX",
    status: "PRZYJETY",
    priority: "HIGH",
    priorityReason: "blokuje porządki",
    blocksCleanup: true,
    scale: "224 klientów",
    causes: ["HUBSPOT"],
    problem: "Dwie karty; tego samego gabinetu",
    evidence: null,
    proposal: "Przycisk „Scal”",
    decision: null,
    author: "Klaudiusz",
    createdAt: "2026-09-27T10:00:00.000Z",
    updatedAt: "2026-09-28T10:00:00.000Z",
    clients: ["Gabinet Bella"],
    relations: [{ kind: "DEPENDS_ON", number: 3 }],
    comments: [{ author: "Tomek", createdAt: "2026-09-28T09:00:00.000Z", body: "OK" }],
  };
  it("Markdown ma numer, pola i komentarze", () => {
    const md = proposalsToMarkdown([p]);
    expect(md).toContain("## W-0007 — Scalanie duplikatów");
    expect(md).toContain("- **Priorytet:** wysoki — blokuje porządki");
    expect(md).toContain("- **Powiązania:** zależy od W-0003");
    expect(md).toContain("### Propozycja");
    expect(md).toContain("- **Tomek** (2026-09-28): OK");
  });
  it("CSV: średnik, cudzysłowy przy średniku w treści", () => {
    const csv = proposalsToCsv([p]);
    expect(csv.startsWith("﻿Numer;Tytuł")).toBe(true);
    expect(csv).toContain('"Dwie karty; tego samego gabinetu"');
  });
  it("sortowanie: priorytet, potem najnowsze", () => {
    const s = sortProposals([
      { priority: "LOW" as const, createdAt: "2026-09-28" },
      { priority: "HIGH" as const, createdAt: "2026-09-01" },
      { priority: "HIGH" as const, createdAt: "2026-09-20" },
    ]);
    expect(s.map((x) => `${x.priority}${x.createdAt.slice(8)}`)).toEqual(["HIGH20", "HIGH01", "LOW28"]);
  });
  it("numer wniosku", () => {
    expect(proposalNumber(12)).toBe("W-0012");
  });
});
