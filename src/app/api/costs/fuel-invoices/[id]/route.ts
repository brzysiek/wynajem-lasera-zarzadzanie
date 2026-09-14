import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/auth-guards";
import { logInfo } from "@/lib/logger";

// Ręczna korekta dopasowania pojazdu — jedyne edytowalne pole. Reszta
// (kwoty, data, sprzedawca) pochodzi z parsera i nie jest tu edytowalna;
// jeśli faktura źle się sparsowała, usuń ją (DELETE) i wgraj ponownie.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });

  const { id } = await params;
  const existing = await prisma.fuelInvoice.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ message: "Nie znaleziono faktury." }, { status: 404 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || !("vehicleId" in body)) {
    return NextResponse.json({ message: "Nieprawidłowe dane." }, { status: 400 });
  }

  let vehicleId: string | null = null;
  if (body.vehicleId !== null) {
    if (typeof body.vehicleId !== "string" || !body.vehicleId) {
      return NextResponse.json({ message: "Nieprawidłowy pojazd." }, { status: 400 });
    }
    const vehicle = await prisma.vehicle.findUnique({ where: { id: body.vehicleId } });
    if (!vehicle) return NextResponse.json({ message: "Nie znaleziono pojazdu." }, { status: 400 });
    vehicleId = vehicle.id;
  }

  const invoice = await prisma.fuelInvoice.update({
    where: { id },
    data: { vehicleId, matchSource: vehicleId ? "MANUAL" : null },
  });
  logInfo("fuel_invoice_vehicle_corrected", { userId: session.user.id, invoiceId: id, vehicleId });

  return NextResponse.json({ invoice });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });

  const { id } = await params;
  try {
    await prisma.fuelInvoice.delete({ where: { id } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return NextResponse.json({ message: "Nie znaleziono faktury." }, { status: 404 });
    }
    throw err;
  }

  logInfo("fuel_invoice_deleted", { userId: session.user.id, invoiceId: id });
  return NextResponse.json({ ok: true });
}
