import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/auth-guards";
import { backfillFromLandingUrl, clickIdStats } from "@/lib/leads/google-conversions";
import { normalizeAttribution } from "@/lib/leads/attribution-view";

// Wniosek 54, etap 1: jednorazowe uzupełnienie starych sygnałów — gbraid /
// wbraid z landing_url, gdy nie ma ich w attribution (nie nadpisuje niczego,
// gclid zostaje). GET / POST bez „apply” = tylko statystyka (nic nie zapisuje).
// Statystyka liczy sygnały z formularzy WWW od 11.10.2026 (start pomiaru).
const SINCE = new Date("2026-10-11T00:00:00+02:00");

async function loadRows() {
  const rows = await prisma.lead.findMany({ where: { createdAt: { gte: SINCE }, attribution: { not: Prisma.DbNull } }, select: { id: true, attribution: true } });
  return rows.map((r) => ({ id: r.id, attribution: normalizeAttribution(r.attribution) }));
}

export async function GET() {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  return NextResponse.json({ since: SINCE.toISOString().slice(0, 10), stats: clickIdStats(await loadRows()) });
}

export async function POST(req: NextRequest) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as { apply?: boolean };
  const rows = await loadRows();
  const todo = rows.map((r) => ({ id: r.id, next: backfillFromLandingUrl(r.attribution) })).filter((r) => r.next);
  if (body.apply === true) {
    for (const r of todo) await prisma.lead.update({ where: { id: r.id }, data: { attribution: r.next as Prisma.InputJsonValue } });
  }
  return NextResponse.json({ applied: body.apply === true, updated: body.apply === true ? todo.length : 0, wouldUpdate: todo.length, stats: clickIdStats(rows) });
}
