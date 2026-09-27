import { NextRequest, NextResponse } from "next/server";
import { requireStaffSession } from "@/lib/auth-guards";
import { deleteAddress, updateAddress } from "@/lib/clients/delivery";
import { loadClientDetail } from "@/lib/clients/load";
import { logInfo } from "@/lib/logger";

type Ctx = { params: Promise<{ id: string; addressId: string }> };

// Zmiana adresu dostawy ({ isDefault: true } = ustaw jako domyślny,
// { recalc: true } = przelicz współrzędne i trasę). Tylko biuro.
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const session = await requireStaffSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const { id, addressId } = await params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ message: "Nieprawidłowe dane." }, { status: 400 });
  const result = await updateAddress(id, addressId, body, { userId: session.user.id });
  if (!result.ok) return NextResponse.json({ message: result.message }, { status: result.status });
  logInfo("client_delivery_address_updated", { userId: session.user.id, clientId: id, addressId, fields: Object.keys(body) });
  return NextResponse.json({ detail: await loadClientDetail(id), warning: result.warning });
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const session = await requireStaffSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const { id, addressId } = await params;
  const result = await deleteAddress(id, addressId, { userId: session.user.id });
  if (!result.ok) return NextResponse.json({ message: result.message }, { status: result.status });
  logInfo("client_delivery_address_deleted", { userId: session.user.id, clientId: id, addressId });
  return NextResponse.json({ detail: await loadClientDetail(id) });
}
