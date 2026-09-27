import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { DEFAULT_HIDE_KEYWORDS, buildExclusionMatcher, type ExclusionKind, type ExclusionMatcher } from "@/lib/porzadki/exclusion-rules";

// Odczyt listy wykluczeń (wniosek 7) dla synchronizacji Gmaila i HubSpota —
// osobno od exclusions.ts, żeby nie było cyklu importów z gmail/sync.

export const HIDE_KEYWORDS_KEY = "email_hide_keywords";

// Maile widoczne w historii klienta (ukryte: EXCLUDED / ENGINEERING / MANUAL).
export const VISIBLE_EMAIL: Prisma.EmailMessageWhereInput = { OR: [{ hiddenReason: null }, { hiddenReason: "SHOWN" }] };

let cache: { at: number; match: ExclusionMatcher } | null = null;

export function invalidateExclusions() {
  cache = null;
}

export async function loadExclusionMatcher(): Promise<ExclusionMatcher> {
  if (cache && Date.now() - cache.at < 60_000) return cache.match;
  const rows = await prisma.emailExclusion.findMany({ select: { kind: true, value: true } });
  const match = buildExclusionMatcher(rows.map((r) => ({ kind: r.kind as ExclusionKind, value: r.value })));
  cache = { at: Date.now(), match };
  return match;
}

export async function getHideKeywords(): Promise<string[]> {
  const row = await prisma.setting.findUnique({ where: { key: HIDE_KEYWORDS_KEY } });
  const list = row?.value
    .split(/[\n,;]+/)
    .map((x) => x.trim())
    .filter(Boolean);
  return list?.length ? list : DEFAULT_HIDE_KEYWORDS;
}
