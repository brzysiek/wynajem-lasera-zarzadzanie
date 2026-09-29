import { NextRequest, NextResponse } from "next/server";
import { requireStaffSession } from "@/lib/auth-guards";
import { clearResigned, setResigned } from "@/lib/clients/resign";
import { RESIGN_REASON_KEYS, type ResignReasonKey } from "@/lib/clients/labels";

// Wniosek 24: stan „Zrezygnował” na karcie klienta. ADMIN/STAFF — agent
// zgłasza propozycję „rezygnacja”.
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireStaffSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const reason = body?.reason as ResignReasonKey;
  if (!RESIGN_REASON_KEYS.includes(reason)) return NextResponse.json({ message: "Wybierz powód rezygnacji." }, { status: 400 });
  const recontact = typeof body?.recontactAt === "string" && DAY.test(body.recontactAt) ? new Date(`${body.recontactAt}T09:00:00`) : null;
  try {
    await setResigned(id, { reason, note: typeof body?.note === "string" ? body.note.slice(0, 1000) : null, recontactAt: recontact }, { userId: session.user.id, source: "karta klienta — Zrezygnował" });
  } catch (err) {
    return NextResponse.json({ message: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireStaffSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const { id } = await params;
  await clearResigned(id, { userId: session.user.id, source: "karta klienta — cofnięcie rezygnacji" });
  return NextResponse.json({ ok: true });
}
