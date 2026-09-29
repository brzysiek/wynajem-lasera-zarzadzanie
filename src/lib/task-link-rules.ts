// Powiązania zadań (wniosek 22) — czyste reguły: chip (etykieta, adres) i
// braki wynajmu liczone na bieżąco z danych. Bez zależności (vitest bez "@/").

export const TASK_LINK_KINDS = ["RENTAL", "CLIENT", "LEAD", "INVOICE"] as const;
export type TaskLinkKind = (typeof TASK_LINK_KINDS)[number];

export type TaskLinkDto = {
  kind: TaskLinkKind;
  refId: string;
  label: string;
  href: string | null;
  // Tylko wynajem: braki do poprawienia ([] = ✓ poprawione).
  issues: string[] | null;
};

export type TaskLinkInput = { kind: TaskLinkKind; refId: string };

// {wynajmy, klienci, sygnaly, faktury} (MCP / API) → lista powiązań bez powtórzeń.
export function linksFromArrays(a: { wynajmy?: unknown; klienci?: unknown; sygnaly?: unknown; faktury?: unknown }): TaskLinkInput[] | null {
  const pairs: [TaskLinkKind, unknown][] = [
    ["RENTAL", a.wynajmy],
    ["CLIENT", a.klienci],
    ["LEAD", a.sygnaly],
    ["INVOICE", a.faktury],
  ];
  if (pairs.every(([, v]) => v === undefined)) return null;
  const out: TaskLinkInput[] = [];
  for (const [kind, v] of pairs) {
    if (v === undefined) continue;
    if (!Array.isArray(v)) throw new Error(`Powiązania: oczekiwana tablica ID (${kind}).`);
    for (const id of v) {
      if (typeof id !== "string" || !id.trim()) throw new Error(`Powiązania: nieprawidłowe ID (${kind}).`);
      if (!out.some((x) => x.kind === kind && x.refId === id.trim())) out.push({ kind, refId: id.trim() });
    }
  }
  return out.slice(0, 50);
}

export type RentalIssueInput = {
  eventType: "WYNAJEM" | "SZKOLENIE";
  clientId: string | null;
  variantOptions: string[];
  finance: {
    deviceVariant: string | null;
    totalNet: number;
    baseNet: number;
    pulseNet: number | null;
    transportNet: number | null;
    transportSeparate: boolean;
    capUsed: boolean | null;
    capCount: number | null;
    capFee: number | null;
    membraneUsed: boolean | null;
    membraneCount: number | null;
    membraneFee: number | null;
  } | null;
};

// Braki wynajmu (chip zadania): brak klienta, brak kwoty, brak wariantu
// (urządzenie z wariantami bez wybranego), kwota ≠ pozycje (suma netto
// różni się od sumy pozycji: wynajem + impulsy + transport w sumie +
// nakładki + membrany).
export function rentalIssues(r: RentalIssueInput): string[] {
  const out: string[] = [];
  if (!r.clientId) out.push("brak klienta");
  const f = r.finance;
  if (!f || !(f.totalNet > 0)) {
    out.push("brak kwoty");
    return out;
  }
  if (r.eventType === "WYNAJEM" && r.variantOptions.length > 0 && !f.deviceVariant) out.push("brak wariantu");
  const positions =
    f.baseNet +
    (f.pulseNet ?? 0) +
    (r.eventType === "WYNAJEM" && !f.transportSeparate ? (f.transportNet ?? 0) : 0) +
    (f.capUsed && f.capFee ? f.capFee * Math.max(1, Math.trunc(f.capCount ?? 1)) : 0) +
    (f.membraneUsed && f.membraneFee ? f.membraneFee * Math.max(1, Math.trunc(f.membraneCount ?? 1)) : 0);
  if (Math.abs(positions - f.totalNet) > 0.5) out.push("kwota ≠ pozycje");
  return out;
}

// „Alma · 05.11 · Karpierz”
export function rentalChipLabel(device: string, startsAt: Date, client: string | null): string {
  const d = `${String(startsAt.getDate()).padStart(2, "0")}.${String(startsAt.getMonth() + 1).padStart(2, "0")}`;
  return [device, d, client].filter(Boolean).join(" · ");
}

export function linkHref(kind: TaskLinkKind, refId: string, clientId?: string | null): string | null {
  if (kind === "RENTAL") return `/kalendarz?wynajem=${encodeURIComponent(refId)}`;
  if (kind === "CLIENT") return `/klienci/${encodeURIComponent(refId)}`;
  if (kind === "LEAD") return `/sygnaly?id=${encodeURIComponent(refId)}`;
  // Faktura nie ma własnej karty — karta klienta, zakładka Transakcje.
  return clientId ? `/klienci/${encodeURIComponent(clientId)}?tab=transakcje` : null;
}

// „Wszystko poprawione – zamknij zadanie”: jest co najmniej jeden wynajem i
// żaden nie ma braków.
export function allLinksResolved(links: TaskLinkDto[]): boolean {
  const rentals = links.filter((l) => l.kind === "RENTAL");
  return rentals.length > 0 && rentals.every((l) => (l.issues ?? []).length === 0);
}
