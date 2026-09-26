import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { toLogValue } from "@/lib/changelog/diff";
import { recordChanges } from "@/lib/changelog/record";
import { logInfo } from "@/lib/logger";

// Powiązanie faktury z Fakturowni (wystawionej poza panelem) z wynajmem —
// zdejmuje wynajem z listy „FV bez faktury”, a faktura nie liczy się drugi
// raz w historii klienta. Tylko ADMIN (agent wskazuje, biuro decyduje).
// matchedByUserId chroni powiązanie przed automatycznym przeliczeniem.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const invoiceId = typeof body?.clientInvoiceId === "string" ? body.clientInvoiceId : "";
  const action = body?.action === "unlink" ? "unlink" : "link";

  const [rental, invoice] = await Promise.all([
    prisma.rental.findUnique({ where: { id }, select: { id: true, clientId: true } }),
    invoiceId ? prisma.clientInvoice.findUnique({ where: { id: invoiceId } }) : null,
  ]);
  if (!rental) return NextResponse.json({ message: "Nie znaleziono wynajmu." }, { status: 404 });
  if (!invoice) return NextResponse.json({ message: "Nie znaleziono faktury." }, { status: 404 });

  if (action === "link") {
    if (invoice.rentalId && invoice.rentalId !== id) {
      return NextResponse.json({ message: `Faktura ${invoice.number} jest już powiązana z innym wynajmem.` }, { status: 409 });
    }
    const clientId = invoice.clientId ?? rental.clientId;
    await prisma.$transaction(async (tx) => {
      await tx.clientInvoice.update({
        where: { id: invoice.id },
        data: {
          rentalId: id,
          clientId,
          ...(clientId ? { matchState: "CONFIRMED", matchMethod: "RENTAL", matchScore: 1 } : {}),
          matchedByUserId: session.user.id,
        },
      });
      await recordChanges(tx, { userId: session.user.id }, [
        { entity: "INVOICE", entityId: invoice.id, clientId, operation: "FIELD_CHANGE", field: "rentalId", before: toLogValue(invoice.rentalId), after: toLogValue(id) },
      ]);
    });
  } else {
    if (invoice.rentalId !== id) return NextResponse.json({ message: "Ta faktura nie jest powiązana z tym wynajmem." }, { status: 409 });
    await prisma.$transaction(async (tx) => {
      await tx.clientInvoice.update({ where: { id: invoice.id }, data: { rentalId: null } });
      await recordChanges(tx, { userId: session.user.id }, [
        { entity: "INVOICE", entityId: invoice.id, clientId: invoice.clientId, operation: "FIELD_CHANGE", field: "rentalId", before: toLogValue(id), after: "null" },
      ]);
    });
  }
  logInfo("rental_invoice_link", { userId: session.user.id, rentalId: id, clientInvoiceId: invoice.id, action });
  return NextResponse.json({ ok: true });
}
