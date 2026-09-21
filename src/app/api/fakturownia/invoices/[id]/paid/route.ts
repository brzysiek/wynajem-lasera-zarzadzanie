import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { logInfo } from "@/lib/logger";

// Status "zapłacona" żyje TYLKO u nas (FakturowniaPayment) — Fakturownia go
// nie zna (brak płatnego połączenia z bankiem). CELOWO niezależne od
// Rental/RentalFinance — działa dla DOWOLNEJ faktury z działu w Fakturowni,
// także wystawionej ręcznie zanim ta integracja powstała (większość faktur
// w dziale nie ma odpowiednika w tej apce). Ręczny toggle tutaj; masowe
// ustawianie na podstawie wgranego wyciągu bankowego — osobny endpoint
// (bank-statement).
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

  if (body.paid) {
    await prisma.fakturowniaPayment.upsert({
      where: { fakturowniaInvoiceId: invoiceId },
      create: { fakturowniaInvoiceId: invoiceId, paidAt: new Date() },
      update: {}, // już oznaczona — nie nadpisuj oryginalnej daty zapłaty
    });
  } else {
    await prisma.fakturowniaPayment.deleteMany({ where: { fakturowniaInvoiceId: invoiceId } });
  }

  logInfo("fakturownia_paid_toggled", { userId: session.user.id, invoiceId, paid: body.paid });
  return NextResponse.json({ ok: true });
}
