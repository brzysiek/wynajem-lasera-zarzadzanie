import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { logInfo, logWarn } from "@/lib/logger";

// Status "zapłacona" żyje TYLKO u nas (RentalFinance.paidAt) — Fakturownia
// go nie zna (brak płatnego połączenia z bankiem). Ręczny toggle tutaj;
// masowe ustawianie na podstawie wgranego wyciągu bankowego — osobny
// endpoint (bank-statement).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });

  const { id } = await params;
  const invoiceId = Number(id);
  if (!Number.isInteger(invoiceId)) return NextResponse.json({ message: "Nieprawidłowe ID faktury." }, { status: 400 });

  const body = await req.json().catch(() => null);
  if (typeof body?.paid !== "boolean") {
    return NextResponse.json({ message: "Wymagane pole „paid” (boolean)." }, { status: 400 });
  }

  const { count } = await prisma.rentalFinance.updateMany({
    where: { fakturowniaInvoiceId: invoiceId },
    data: { paidAt: body.paid ? new Date() : null },
  });

  if (count === 0) {
    logWarn("fakturownia_paid_toggle_no_match", { userId: session.user.id, invoiceId });
    return NextResponse.json(
      { message: "Ta faktura nie jest powiązana z żadnym wynajmem w tej apce — nie można oznaczyć." },
      { status: 404 },
    );
  }

  logInfo("fakturownia_paid_toggled", { userId: session.user.id, invoiceId, paid: body.paid });
  return NextResponse.json({ ok: true });
}
