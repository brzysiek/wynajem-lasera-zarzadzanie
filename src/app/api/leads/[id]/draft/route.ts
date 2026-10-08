import { NextRequest, NextResponse } from "next/server";
import { requireStaffSession } from "@/lib/auth-guards";
import { DraftError, discardMailDraft, upsertMailDraft, type DraftPatch } from "@/lib/leads/mail-draft";
import { logError } from "@/lib/logger";

// Szkic odpowiedzi przy sygnale (wniosek 44): zapis zmian biura (PUT, tworzy
// szkic, gdy go nie ma) i odrzucenie (DELETE). ADMIN/STAFF — agent zapisuje
// propozycje narzędziem MCP „szkic_maila_utworz”. Panel niczego nie wysyła.
function fail(err: unknown, leadId: string, userId: string) {
  if (err instanceof DraftError) return NextResponse.json({ message: err.message }, { status: err.status });
  logError("mail_draft_failed", err, { leadId, userId });
  return NextResponse.json({ message: "Nie udało się zapisać szkicu." }, { status: 500 });
}

const text = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireStaffSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return NextResponse.json({ message: "Nieprawidłowe dane." }, { status: 400 });
  const patch: DraftPatch = { to: text(body.to), subject: text(body.subject), bodyText: text(body.bodyText) };
  if (body.note !== undefined) patch.note = body.note === null ? null : text(body.note);
  if (body.replyToEmailId !== undefined) patch.replyToEmailId = body.replyToEmailId === null ? null : (text(body.replyToEmailId) ?? undefined);
  try {
    return NextResponse.json({ draft: await upsertMailDraft(id, { kind: "USER", userId: session.user.id }, patch) });
  } catch (err) {
    return fail(err, id, session.user.id);
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireStaffSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const { id } = await params;
  try {
    await discardMailDraft(id, { kind: "USER", userId: session.user.id });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return fail(err, id, session.user.id);
  }
}
