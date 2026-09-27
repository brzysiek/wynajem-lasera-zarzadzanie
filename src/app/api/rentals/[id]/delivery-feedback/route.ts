import { NextRequest, NextResponse } from "next/server";
import { requireDriverFinanceSession } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { addDeliveryFeedback, loadRentalAddress } from "@/lib/clients/delivery";
import { logInfo } from "@/lib/logger";

// Uwagi kierowcy o adresie dostawy (paszport dostawy) — po dostawie albo
// odbiorze. KIEROWCA tylko przy swoim wynajmie; biuro przy każdym.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireDriverFinanceSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const { id } = await params;
  const rental = await prisma.rental.findUnique({ where: { id }, select: { id: true, driverId: true, deliveryAddressId: true, clientId: true } });
  if (!rental || (session.user.role === "KIEROWCA" && rental.driverId !== session.user.id)) {
    return NextResponse.json({ message: "Nie znaleziono wynajmu." }, { status: 404 });
  }
  const body = (await req.json().catch(() => null)) as { text?: unknown } | null;
  if (typeof body?.text !== "string") return NextResponse.json({ message: "Nieprawidłowe dane." }, { status: 400 });
  const result = await addDeliveryFeedback(rental, session.user.id, body.text);
  if (!result.ok) return NextResponse.json({ message: result.message }, { status: 400 });
  logInfo("delivery_feedback_added", { userId: session.user.id, rentalId: id });
  return NextResponse.json({ address: await loadRentalAddress(rental) });
}
