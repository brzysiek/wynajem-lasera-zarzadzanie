import { NextRequest, NextResponse } from "next/server";
import { requireStaffSession } from "@/lib/auth-guards";
import { loadClientDetail } from "@/lib/clients/load";
import { markInvoiceCash, unmarkInvoiceCash } from "@/lib/invoicing/cash-payments";
import { logInfo } from "@/lib/logger";

// „Opłacona gotówką” z karty klienta (ADMIN/STAFF): { date: RRRR-MM-DD,
// receivedBy?, note? }. DELETE cofa oznaczenie. id = ID faktury w Fakturowni.
function parseId(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireStaffSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const id = parseId((await params).id);
  if (!id) return NextResponse.json({ message: "Nieprawidłowe ID faktury." }, { status: 400 });
  const body = await req.json().catch(() => null);
  const text = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
  const r = await markInvoiceCash(id, { date: typeof body?.date === "string" ? body.date : "", receivedBy: text(body?.receivedBy, 191), note: text(body?.note, 500) }, session.user.id);
  if (!r.ok) return NextResponse.json({ message: r.message }, { status: r.status });
  logInfo("invoice_marked_cash", { userId: session.user.id, invoiceId: id });
  return NextResponse.json({ ok: true, detail: r.clientId ? await loadClientDetail(r.clientId) : null });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireStaffSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const id = parseId((await params).id);
  if (!id) return NextResponse.json({ message: "Nieprawidłowe ID faktury." }, { status: 400 });
  const r = await unmarkInvoiceCash(id, session.user.id);
  if (!r.ok) return NextResponse.json({ message: r.message }, { status: r.status });
  return NextResponse.json({ ok: true, detail: r.clientId ? await loadClientDetail(r.clientId) : null });
}
