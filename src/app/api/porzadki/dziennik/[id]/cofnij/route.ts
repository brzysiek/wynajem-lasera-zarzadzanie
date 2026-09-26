import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth-guards";
import { UndoError, undoChange } from "@/lib/changelog/load";
import { logError, logInfo } from "@/lib/logger";

// „Cofnij” wpis dziennika — tylko ADMIN. Przywraca „wartość przed”, jeśli
// bieżąca wartość nadal równa się „wartości po”; inaczej 409 z konfliktem.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const { id } = await params;
  try {
    const r = await undoChange(id, session.user.id);
    logInfo("changelog_undo", { userId: session.user.id, entryId: id, undoId: r.undoId });
    return NextResponse.json(r);
  } catch (err) {
    if (err instanceof UndoError) return NextResponse.json({ message: err.message, conflict: err.conflict ?? null }, { status: err.status });
    logError("changelog_undo_failed", err, { userId: session.user.id, entryId: id });
    return NextResponse.json({ message: "Nie udało się cofnąć." }, { status: 500 });
  }
}
