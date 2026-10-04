// Moduł „Porządki” — reguły wniosków: kto może ustawić status, podobne
// wnioski (ochrona przed duplikatami), walidacja i eksport (Markdown / CSV).
// Czysty moduł (vitest, bez @/).
import {
  CAUSE_KEYS,
  CAUSE_LABEL,
  OPEN_STATUSES,
  PRIORITY_KEYS,
  PRIORITY_LABEL,
  PRIORITY_RANK,
  RELATION_LABEL,
  STATUS_KEYS,
  STATUS_LABEL,
  TYPE_KEYS,
  TYPE_LABEL,
  proposalNumber,
  type AreaKey,
  type CauseKey,
  type PriorityKey,
  type ProposalStatusKey,
  type ProposalTypeKey,
  type RelationKey,
} from "./labels";

// Statusy decyzyjne i realizacji ustawia tylko ADMIN (Tomek, Ania). Pozostali
// (AGENT, STAFF) — tylko „nowy” ↔ „do decyzji”, i tylko dopóki wniosek nie
// przeszedł dalej.
const NON_ADMIN_STATUSES: ProposalStatusKey[] = ["NOWY", "DO_DECYZJI"];

export function canSetStatus(role: string, from: ProposalStatusKey, to: ProposalStatusKey): boolean {
  if (from === to) return false;
  if (role === "ADMIN") return true;
  return NON_ADMIN_STATUSES.includes(from) && NON_ADMIN_STATUSES.includes(to);
}

// Pola wniosku zmienia autor albo ADMIN; po wyjściu z „nowy / do decyzji”
// autor-nie-admin już nie edytuje treści (decyzja zapadła).
export function canEditProposal(role: string, userId: string, p: { authorId: string | null; status: ProposalStatusKey }): boolean {
  if (role === "ADMIN") return true;
  return p.authorId === userId && NON_ADMIN_STATUSES.includes(p.status);
}

export function sortProposals<T extends { priority: PriorityKey; createdAt: string | Date }>(list: T[]): T[] {
  return [...list].sort(
    (a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

// --- podobne wnioski (po tytule i obszarze) ---

const STOP = new Set(["i", "w", "z", "na", "do", "nie", "się", "sie", "o", "od", "po", "dla", "przy", "oraz", "lub", "że", "ze", "jest", "brak", "a"]);

function words(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/ł/g, "l")
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 3 && !STOP.has(w))
      // Prosty „rdzeń”: polskie końcówki fleksyjne nie rozróżniają wniosków.
      .map((w) => (w.length > 5 ? w.slice(0, 5) : w)),
  );
}

export function titleSimilarity(a: string, b: string): number {
  const A = words(a);
  const B = words(b);
  if (A.size === 0 || B.size === 0) return 0;
  let common = 0;
  for (const w of A) if (B.has(w)) common++;
  return common / Math.min(A.size, B.size);
}

export type SimilarCandidate = { id: string; number: number; title: string; area: string; status: string };

// Otwarte wnioski z tego samego obszaru o podobnym tytule (albo z innego
// obszaru, gdy tytuł prawie ten sam).
export function similarProposals(title: string, area: string, list: SimilarCandidate[], limit = 5) {
  return list
    .filter((p) => (OPEN_STATUSES as string[]).includes(p.status))
    .map((p) => ({ ...p, score: titleSimilarity(title, p.title) }))
    .filter((p) => (p.area === area ? p.score >= 0.5 : p.score >= 0.8))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

// --- walidacja wejścia ---

export type ProposalInput = {
  title: string;
  area: AreaKey;
  type: ProposalTypeKey;
  problem: string | null;
  evidence: string | null;
  scale: string | null;
  causes: CauseKey[];
  proposal: string | null;
  priority: PriorityKey;
  priorityReason: string | null;
  blocksCleanup: boolean;
  clientIds: string[];
};

type Result<T> = { ok: true; data: T } | { ok: false; message: string };

function text(v: unknown, max = 20000): string | null {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
}

// partial = PATCH: tylko pola obecne w body.
export function parseProposalInput(body: Record<string, unknown>, partial: boolean): Result<Partial<ProposalInput>> {
  const out: Partial<ProposalInput> = {};
  const has = (k: string) => k in body;
  if (!partial || has("title")) {
    const t = text(body.title, 191);
    if (!t) return { ok: false, message: "Podaj tytuł wniosku (jedno zdanie)." };
    out.title = t;
  }
  if (!partial || has("area")) {
    // Kod obszaru ze słownika proposal_areas — istnienie sprawdza zapis
    // (createProposal / updateProposal).
    const a = typeof body.area === "string" ? body.area.trim().toUpperCase() : "";
    if (!/^[A-Z_]{2,32}$/.test(a)) return { ok: false, message: "Podaj obszar wniosku (kod, np. KLIENCI albo MARKETING)." };
    out.area = a;
  }
  if (!partial || has("type")) {
    if (!TYPE_KEYS.includes(body.type as ProposalTypeKey)) return { ok: false, message: `Typ: ${TYPE_KEYS.join(", ")}.` };
    out.type = body.type as ProposalTypeKey;
  }
  for (const k of ["problem", "evidence", "proposal"] as const) if (!partial || has(k)) out[k] = text(body[k]);
  if (!partial || has("scale")) out.scale = text(body.scale, 191);
  if (!partial || has("priorityReason")) out.priorityReason = text(body.priorityReason, 191);
  if (!partial || has("causes")) {
    const c = body.causes ?? [];
    if (!Array.isArray(c) || c.some((x) => !CAUSE_KEYS.includes(x as CauseKey))) return { ok: false, message: `Przyczyna: ${CAUSE_KEYS.join(", ")}.` };
    out.causes = [...new Set(c as CauseKey[])];
  }
  if (!partial || has("priority")) {
    const p = body.priority ?? "MEDIUM";
    if (!PRIORITY_KEYS.includes(p as PriorityKey)) return { ok: false, message: "Priorytet: HIGH, MEDIUM albo LOW." };
    out.priority = p as PriorityKey;
  }
  if (!partial || has("blocksCleanup")) out.blocksCleanup = body.blocksCleanup === true;
  if (!partial || has("clientIds")) {
    const ids = body.clientIds ?? [];
    if (!Array.isArray(ids) || ids.some((x) => typeof x !== "string")) return { ok: false, message: "clientIds: lista identyfikatorów klientów." };
    out.clientIds = [...new Set(ids as string[])].slice(0, 200);
  }
  return { ok: true, data: out };
}

export function isStatus(v: unknown): v is ProposalStatusKey {
  return STATUS_KEYS.includes(v as ProposalStatusKey);
}

export function isRelation(v: unknown): v is RelationKey {
  return typeof v === "string" && v in RELATION_LABEL;
}

// --- eksport ---

export type ProposalExport = {
  number: number;
  title: string;
  area: AreaKey;
  areaLabel: string;
  type: ProposalTypeKey;
  status: ProposalStatusKey;
  priority: PriorityKey;
  priorityReason: string | null;
  blocksCleanup: boolean;
  scale: string | null;
  causes: CauseKey[];
  problem: string | null;
  evidence: string | null;
  proposal: string | null;
  decision: string | null;
  author: string | null;
  createdAt: string;
  updatedAt: string;
  clients: string[];
  relations: { kind: RelationKey; number: number }[];
  comments: { author: string | null; createdAt: string; body: string }[];
};

const day = (iso: string) => iso.slice(0, 10);

export function proposalsToMarkdown(list: ProposalExport[], title = "Wnioski — WynajemLasera.pl"): string {
  const out: string[] = [`# ${title}`, "", `Wygenerowano: ${new Date().toISOString().slice(0, 16).replace("T", " ")} · ${list.length} wniosków`, ""];
  for (const p of list) {
    out.push(`## ${proposalNumber(p.number)} — ${p.title}`, "");
    out.push(`- **Obszar:** ${p.areaLabel}`);
    out.push(`- **Typ:** ${TYPE_LABEL[p.type]}`);
    out.push(`- **Status:** ${STATUS_LABEL[p.status]}`);
    out.push(`- **Priorytet:** ${PRIORITY_LABEL[p.priority]}${p.priorityReason ? ` — ${p.priorityReason}` : ""}`);
    if (p.blocksCleanup) out.push("- **Blokuje porządki:** tak");
    if (p.scale) out.push(`- **Skala:** ${p.scale}`);
    if (p.causes.length) out.push(`- **Przyczyna (hipoteza):** ${p.causes.map((c) => CAUSE_LABEL[c]).join(", ")}`);
    if (p.clients.length) out.push(`- **Klienci:** ${p.clients.join(", ")}`);
    if (p.relations.length) out.push(`- **Powiązania:** ${p.relations.map((r) => `${RELATION_LABEL[r.kind]} ${proposalNumber(r.number)}`).join(", ")}`);
    out.push(`- **Autor:** ${p.author ?? "—"} · utworzono ${day(p.createdAt)} · zmieniono ${day(p.updatedAt)}`, "");
    for (const [label, v] of [
      ["Problem", p.problem],
      ["Dowód", p.evidence],
      ["Propozycja", p.proposal],
      ["Decyzja", p.decision],
    ] as const) {
      if (v) out.push(`### ${label}`, "", v, "");
    }
    if (p.comments.length) {
      out.push("### Komentarze", "");
      for (const c of p.comments) out.push(`- **${c.author ?? "—"}** (${day(c.createdAt)}): ${c.body.replace(/\n+/g, " ")}`);
      out.push("");
    }
  }
  return out.join("\n");
}

function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// CSV ze średnikiem (Excel w polskiej wersji) i BOM, jak eksport klientów.
export function toCsv(header: string[], rows: unknown[][]): string {
  return "﻿" + [header, ...rows].map((r) => r.map(csvCell).join(";")).join("\r\n");
}

export function proposalsToCsv(list: ProposalExport[]): string {
  return toCsv(
    ["Numer", "Tytuł", "Obszar", "Typ", "Status", "Priorytet", "Uzasadnienie priorytetu", "Blokuje porządki", "Skala", "Przyczyna", "Problem", "Dowód", "Propozycja", "Decyzja", "Klienci", "Autor", "Utworzono", "Zmieniono"],
    list.map((p) => [
      proposalNumber(p.number),
      p.title,
      p.areaLabel,
      TYPE_LABEL[p.type],
      STATUS_LABEL[p.status],
      PRIORITY_LABEL[p.priority],
      p.priorityReason,
      p.blocksCleanup ? "tak" : "nie",
      p.scale,
      p.causes.map((c) => CAUSE_LABEL[c]).join(", "),
      p.problem,
      p.evidence,
      p.proposal,
      p.decision,
      p.clients.join(", "),
      p.author,
      day(p.createdAt),
      day(p.updatedAt),
    ]),
  );
}
