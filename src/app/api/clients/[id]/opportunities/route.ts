import { NextRequest, NextResponse } from "next/server";
import { requireStaffSession } from "@/lib/auth-guards";
import { loadClientDetail } from "@/lib/clients/load";
import { addOpportunity } from "@/lib/clients/opportunities";

// Szansa sprzedaży z karty klienta (ADMIN/STAFF). Agent dodaje przez MCP
// (szansa_dodaj) ze źródłem.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireStaffSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ message: "Nieprawidłowe dane." }, { status: 400 });
  const r = await addOpportunity(id, body, { userId: session.user.id });
  if (!r.ok) return NextResponse.json({ message: r.message }, { status: r.status });
  return NextResponse.json({ id: r.id, detail: await loadClientDetail(id) });
}
