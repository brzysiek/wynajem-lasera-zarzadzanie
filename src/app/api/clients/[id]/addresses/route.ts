import { NextRequest, NextResponse } from "next/server";
import { requireStaffSession } from "@/lib/auth-guards";
import { createAddress } from "@/lib/clients/delivery";
import { loadClientDetail } from "@/lib/clients/load";
import { logInfo } from "@/lib/logger";

// Paszport dostawy: nowy adres dostawy klienta. Tylko biuro — agent proponuje
// adresy przez kolejkę propozycji. Odpowiedź po geokodowaniu i trasie (kilka s).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireStaffSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ message: "Nieprawidłowe dane." }, { status: 400 });
  const result = await createAddress(id, body, { userId: session.user.id });
  if (!result.ok) return NextResponse.json({ message: result.message }, { status: result.status });
  logInfo("client_delivery_address_created", { userId: session.user.id, clientId: id });
  return NextResponse.json({ detail: await loadClientDetail(id), warning: result.warning });
}
