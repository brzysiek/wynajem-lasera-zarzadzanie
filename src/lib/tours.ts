import { prisma } from "@/lib/prisma";

// Przewodniki po panelu (wniosek 19) — flaga przy użytkowniku (User.tourSeen),
// nie w przeglądarce. „Później” pokazuje przewodnik przy kolejnym wejściu,
// najwyżej 3 razy; „Pomiń” / koniec = obejrzany.
export const TOURS = ["signalsV2"] as const;
export type TourKey = (typeof TOURS)[number];
export const TOUR_MAX_LATER = 3;

type TourState = Record<string, { done?: boolean; later?: number }>;

function read(v: unknown): TourState {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as TourState) : {};
}

export async function shouldShowTour(userId: string, tour: TourKey): Promise<boolean> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { tourSeen: true } });
  const s = read(u?.tourSeen)[tour];
  return !s?.done && (s?.later ?? 0) < TOUR_MAX_LATER;
}

export async function markTour(userId: string, tour: TourKey, action: "later" | "done"): Promise<void> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { tourSeen: true } });
  const all = read(u?.tourSeen);
  const cur = all[tour] ?? {};
  all[tour] = action === "done" ? { ...cur, done: true } : { ...cur, later: (cur.later ?? 0) + 1 };
  await prisma.user.update({ where: { id: userId }, data: { tourSeen: all } });
}

export { vocative } from "./tour-rules";
