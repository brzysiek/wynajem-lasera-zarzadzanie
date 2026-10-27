import { NextRequest, NextResponse } from "next/server";
import { requireStaffSession } from "@/lib/auth-guards";
import { MergeError, dismissMerge, mergeSuggestion } from "@/lib/chat/merge";
import { logError } from "@/lib/logger";

// „Połącz” / „To ktoś inny” z kafelka sygnału (wniosek 42). ADMIN/STAFF.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireStaffSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as { action?: unknown } | null;
  try {
    if (body?.action === "merge") return NextResponse.json({ ok: true, ...(await mergeSuggestion(id, { userId: session.user.id, role: session.user.role })) });
    if (body?.action === "dismiss") {
      await dismissMerge(id, session.user.id);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ message: "Podaj action: merge albo dismiss." }, { status: 400 });
  } catch (err) {
    if (err instanceof MergeError) return NextResponse.json({ message: err.message }, { status: err.status });
    logError("lead_merge_failed", err, { id, userId: session.user.id });
    return NextResponse.json({ message: "Nie udało się zapisać decyzji." }, { status: 500 });
  }
}
