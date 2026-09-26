import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-guards";
import { OFFICE_AND_AGENT } from "@/lib/permissions";
import { parseRemarkInput, updateRemark } from "@/lib/porzadki/remarks";
import { porzadkiErrorResponse } from "@/lib/porzadki/http";

// Zmiana uwagi (treść, obszar, dowód, klient, status otwarta/zamknięta) —
// autor albo ADMIN.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession(OFFICE_AND_AGENT);
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ message: "Nieprawidłowe dane." }, { status: 400 });
  const { status, ...rest } = body as Record<string, unknown>;
  if (status !== undefined && status !== "OPEN" && status !== "CLOSED") return NextResponse.json({ message: "Status: OPEN albo CLOSED." }, { status: 400 });
  const parsed = parseRemarkInput(rest, true);
  if (!parsed.ok) return NextResponse.json({ message: parsed.message }, { status: 400 });
  try {
    await updateRemark(id, { ...parsed.data, ...(status ? { status: status as "OPEN" | "CLOSED" } : {}) }, { userId: session.user.id, role: session.user.role });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return porzadkiErrorResponse(err, "remark_update_failed", session.user.id);
  }
}
