import { NextRequest, NextResponse } from "next/server";
import { requireStaffSession } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { syncFutureRentalsToTerms, type TermsSyncChange } from "@/lib/clients/terms-backfill";
import { logError, logInfo } from "@/lib/logger";

// Wniosek 28: zmiana warunków NIE przelicza przyszłych rezerwacji sama.
// GET — podgląd („Zmienia N przyszłych rezerwacji”, lista); POST
// { action: "apply" } — przelicz (dziennik: „rozliczenie wg warunków
// klienta”), { action: "skip" } — „Tylko nowe rezerwacje” (ten stan
// warunków już nie pyta). Ręczne kwoty zawsze bez zmian.

const skipKey = (id: string) => `terms_sync_skip:${id}`;
const signature = (changes: TermsSyncChange[]) =>
  changes
    .map((c) => `${c.rentalId}:${c.after}`)
    .sort()
    .join("|");

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireStaffSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const { id } = await params;
  try {
    const plan = await syncFutureRentalsToTerms(id, { userId: session.user.id }, new Date(), { dryRun: true });
    const skipped = await prisma.setting.findUnique({ where: { key: skipKey(id) } });
    const sig = signature(plan.changes);
    return NextResponse.json({ changes: plan.changes, manual: plan.manual, skipped: plan.changes.length > 0 && skipped?.value === sig });
  } catch (err) {
    logError("terms_sync_plan_failed", err, { clientId: id });
    return NextResponse.json({ changes: [], manual: 0, skipped: false });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireStaffSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as { action?: string } | null;
  if (body?.action === "skip") {
    const plan = await syncFutureRentalsToTerms(id, { userId: session.user.id }, new Date(), { dryRun: true });
    const sig = signature(plan.changes);
    await prisma.setting.upsert({ where: { key: skipKey(id) }, create: { key: skipKey(id), value: sig }, update: { value: sig } });
    logInfo("terms_sync_skipped", { userId: session.user.id, clientId: id, count: plan.changes.length });
    return NextResponse.json({ ok: true });
  }
  if (body?.action !== "apply") return NextResponse.json({ message: "Nieznana akcja." }, { status: 400 });
  const res = await syncFutureRentalsToTerms(id, { userId: session.user.id });
  await prisma.setting.deleteMany({ where: { key: skipKey(id) } });
  logInfo("terms_sync_applied", { userId: session.user.id, clientId: id, filled: res.filled, updated: res.updated, manual: res.manual });
  return NextResponse.json({ filled: res.filled, updated: res.updated, manual: res.manual });
}
