import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth-guards";
import { OFFICE_AND_AGENT } from "@/lib/permissions";
import { changedFields } from "@/lib/changelog/diff";
import { fieldEntries, recordChanges } from "@/lib/changelog/record";
import { logInfo } from "@/lib/logger";

// Edycja własnej notatki (karta klienta / sygnału). Tylko typ NOTE i tylko
// autor — ADMIN/STAFF/AGENT; cudzych notatek nie zmienia nikt. Każda zmiana
// w dzienniku zmian (przed → po), żeby dało się ją odtworzyć.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession(OFFICE_AND_AGENT);
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const text = typeof body?.body === "string" ? body.body.trim().slice(0, 5000) : "";
  if (!text) return NextResponse.json({ message: "Notatka nie może być pusta." }, { status: 400 });

  const activity = await prisma.leadActivity.findUnique({ where: { id } });
  if (!activity) return NextResponse.json({ message: "Nie znaleziono notatki." }, { status: 404 });
  if (activity.type !== "NOTE" || activity.userId !== session.user.id) {
    return NextResponse.json({ message: "Można edytować tylko własne notatki." }, { status: 403 });
  }

  const changes = changedFields({ body: activity.body }, { body: text });
  await prisma.$transaction(async (tx) => {
    await tx.leadActivity.update({ where: { id }, data: { body: text, editedAt: new Date() } });
    await recordChanges(tx, { userId: session.user.id }, fieldEntries("NOTE", id, activity.clientId, changes));
  });
  logInfo("activity_note_edited", { userId: session.user.id, activityId: id });
  return NextResponse.json({ ok: true });
}
