import { NextRequest, NextResponse } from "next/server";
import { requireStaffSession } from "@/lib/auth-guards";
import { loadClientDetail } from "@/lib/clients/load";
import { updateOpportunity } from "@/lib/clients/opportunities";

// Zmiana etapu / zamknięcie szansy sprzedaży (ADMIN/STAFF).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; oppId: string }> }) {
  const session = await requireStaffSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const { id, oppId } = await params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ message: "Nieprawidłowe dane." }, { status: 400 });
  const r = await updateOpportunity(id, oppId, body, { userId: session.user.id });
  if (!r.ok) return NextResponse.json({ message: r.message }, { status: r.status });
  return NextResponse.json({ detail: await loadClientDetail(id) });
}
