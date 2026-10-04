import { cache } from "react";
import { prisma } from "@/lib/prisma";

// Obszary wniosków ze słownika proposal_areas (04.10.2026). dev=false —
// „Skrzynka Tomka” (marketing, strona, oferta, organizacja): notatki i
// decyzje biznesowe, nie backlog programistyczny. Klasyfikacja wyłącznie z
// bazy — nowy obszar to nowy wiersz.

export type AreaDef = { key: string; label: string; hint: string | null; dev: boolean };

export const loadAreas = cache(async (): Promise<AreaDef[]> => {
  const rows = await prisma.proposalArea.findMany({ orderBy: [{ sortOrder: "asc" }, { key: "asc" }] });
  return rows.map((r) => ({ key: r.key, label: r.label, hint: r.hint, dev: r.dev }));
});

export async function findArea(key: string | null | undefined): Promise<AreaDef | null> {
  if (!key) return null;
  return (await loadAreas()).find((a) => a.key === key) ?? null;
}

export function areaListText(areas: AreaDef[]): string {
  return areas.map((a) => a.key).join(", ");
}
